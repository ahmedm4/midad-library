/* ═══════ مِداد — طبقة المزامنة السحابية (Supabase) ═══════
   تصميم «محلي أولاً»: IndexedDB يبقى المصدر السريع، والسحابة مرآة.
   إن لم تُضبط السحابة، يعمل التطبيق كما هو تماماً دون أي أثر. */
const Cloud = (() => {
  const CFG_KEY = 'midad-cloud';
  const BUCKET = 'midad-files';
  const TABLE = 'midad_books';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

  let sb = null;          // عميل Supabase
  let user = null;        // المستخدم الحالي
  let cfg = null;         // {url, anonKey}
  let ready = false;      // SDK مُحمّل والعميل جاهز
  let channel = null;     // اشتراك اللحظة
  const pushTimers = {};  // مؤقتات دفع الحالة لكل كتاب
  const recentlyPushed = new Map(); // كتم صدى اللحظة
  let statusCb = null;

  // الأولوية: إعداد الجهاز المحفوظ، ثم الإعداد المضمّن في التطبيق (config.js)
  const builtinCfg = () => {
    const c = window.MIDAD_CONFIG;
    return (c && c.url && c.anonKey) ? { url: c.url.trim().replace(/\/+$/, ''), anonKey: c.anonKey.trim() } : null;
  };
  const getCfg = () => {
    try { const ls = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); if (ls && ls.url) return ls; } catch {}
    return builtinCfg();
  };
  const isConfigured = () => !!getCfg();
  const hasBuiltin = () => !!builtinCfg();
  const isSignedIn = () => !!user;

  function setStatus(state, msg) { if (statusCb) statusCb(state, msg); }
  function onStatus(cb) { statusCb = cb; emitStatus(); }
  function emitStatus() {
    if (!isConfigured()) return setStatus('off', 'المزامنة غير مفعّلة');
    if (!ready) return setStatus('connecting', 'جارٍ الاتصال…');
    if (!user) return setStatus('signedout', 'سجّل الدخول للمزامنة');
    setStatus('synced', 'متزامن — ' + (user.email || ''));
  }

  /* ── تهيئة ── */
  async function init() {
    cfg = getCfg();
    if (!cfg) { emitStatus(); return; }
    try {
      const createClient = window.__midadSbFactory || (await import(SDK_URL)).createClient;
      sb = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
      ready = true;
      const { data } = await sb.auth.getSession();
      user = data.session ? data.session.user : null;
      sb.auth.onAuthStateChange((_evt, session) => {
        const was = user && user.id;
        user = session ? session.user : null;
        emitStatus();
        if (user && user.id !== was) { subscribe(); syncAll(); }
        if (!user && channel) { sb.removeChannel(channel); channel = null; }
      });
      emitStatus();
      if (user) { subscribe(); syncAll(); }
    } catch (e) {
      console.error('cloud init', e);
      setStatus('error', 'تعذّر تحميل مكتبة المزامنة');
    }
  }

  async function configure(url, anonKey) {
    url = (url || '').trim().replace(/\/+$/, '');
    anonKey = (anonKey || '').trim();
    if (!/^https:\/\/.+\.supabase\.co$/i.test(url)) throw new Error('رابط المشروع غير صحيح (يجب أن ينتهي بـ .supabase.co)');
    if (anonKey.length < 30) throw new Error('مفتاح anon غير صحيح');
    localStorage.setItem(CFG_KEY, JSON.stringify({ url, anonKey }));
    ready = false; user = null;
    await init();
  }

  function disconnect() {
    localStorage.removeItem(CFG_KEY);
    if (sb && channel) sb.removeChannel(channel);
    sb = null; user = null; ready = false; channel = null; cfg = null;
    emitStatus();
  }

  /* ── المصادقة ── */
  async function signIn(email, password) {
    if (!ready) throw new Error('لم تُضبط المزامنة بعد');
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(translateAuthError(error.message));
  }
  async function signUp(email, password) {
    if (!ready) throw new Error('لم تُضبط المزامنة بعد');
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
    if (error) throw new Error(translateAuthError(error.message));
    if (!data.session) return 'confirm'; // يحتاج تأكيد بريد
    return 'ok';
  }
  async function signOut() { if (sb) await sb.auth.signOut(); }

  function translateAuthError(m) {
    if (/invalid login/i.test(m)) return 'البريد أو كلمة المرور غير صحيحة';
    if (/already registered/i.test(m)) return 'هذا البريد مسجّل مسبقاً — سجّل الدخول';
    if (/password/i.test(m) && /6/.test(m)) return 'كلمة المرور يجب ألا تقل عن 6 أحرف';
    return m;
  }

  /* ── مزامنة كاملة ثنائية الاتجاه ── */
  let syncing = false;
  async function syncAll() {
    if (!ready || !user || syncing) return;
    syncing = true;
    setStatus('syncing', 'جارٍ المزامنة…');
    try {
      // نستثني عمود content الثقيل (نص الكتب/الـOCR) — يُجلب كسولاً عند فتح الكتاب فيسرع المزامنة كثيراً
      let { data: rows, error } = await sb.from(TABLE).select('id, owner, meta, state, has_file, deleted, updated_at');
      // بعض الجداول لا تحتوي عمود deleted (الحذف الناعم) — أعِد الجلب بدونه
      if (error && /deleted|column .* does not exist/i.test(error.message || '')) {
        ({ data: rows, error } = await sb.from(TABLE).select('id, owner, meta, state, has_file, updated_at'));
      }
      if (error) throw error;
      const cloudById = new Map((rows || []).map((r) => [r.id, r]));
      const localBooks = await Store.getBooks();
      const localById = new Map(localBooks.map((b) => [b.id, b]));

      // سحابة → محلي (كتب جديدة أو أحدث، واحترام الحذف الناعم)
      for (const r of rows || []) {
        if (r.deleted) { if (localById.has(r.id)) await Store.deleteBook(r.id); continue; }
        const lb = localById.get(r.id);
        const cloudT = new Date(r.updated_at).getTime();
        if (!lb) { await applyCloudRow(r); continue; }
        const localT = lb.updatedAt || 0;
        if (cloudT > localT + 1500) await applyCloudRow(r); // السحابة أحدث
      }
      // محلي → سحابة (كتب لم تُرفع بعد أو أحدث محلياً)
      for (const b of localBooks) {
        const r = cloudById.get(b.id);
        if (r && r.deleted) { await Store.deleteBook(b.id); continue; } // حُذف من جهاز آخر
        if (!r) { await uploadBook(b.id); continue; }
        // إعادة رفع ملف PDF ناقص في السحابة (فشل رفع سابق) إن كان موجوداً محلياً
        if (b.type === 'pdf' && !r.has_file) {
          const pl = await Store.getPayload(b.id);
          if (pl instanceof Blob) { await uploadBook(b.id, { silent: true }); continue; }
        }
        const cloudT = new Date(r.updated_at).getTime();
        if ((b.updatedAt || 0) > cloudT + 1500) await uploadBook(b.id, { silent: true });
      }
      setStatus('synced', 'متزامن — ' + (user.email || ''));
      if (window.Library) Library.refresh();
    } catch (e) {
      console.error('syncAll', e);
      setStatus('error', friendlyErr(e));
    } finally { syncing = false; }
  }

  function friendlyErr(e) {
    const m = (e && e.message) || '';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'تعذّر الوصول للسحابة (تحقق من الاتصال أو أن المشروع غير موقوف)';
    if (/relation .*books.* does not exist|schema/i.test(m)) return 'الجداول غير مُعدّة — نفّذ خطوات الإعداد';
    if (/bucket/i.test(m)) return 'مخزن الملفات غير مُعدّ — نفّذ خطوات الإعداد';
    return m || 'خطأ في المزامنة';
  }

  /* ── تطبيق صف سحابي على المحلي ── */
  async function applyCloudRow(r) {
    if (r.deleted) { if (await Store.getBook(r.id)) await Store.deleteBook(r.id); return; }
    const meta = { ...(r.meta || {}), id: r.id, updatedAt: new Date(r.updated_at).getTime(), cloudHasFile: r.has_file };
    // نص الكتاب يُخزَّن مباشرة؛ ملف PDF يُنزَّل عند أول فتح
    let payload;
    if (r.content != null) {
      if (meta.type === 'pdf') {
        // للكتب المصوّرة: content يحمل نص الـOCR المُزامَن → احفظه للبحث/الذكاء/النسخة النصية
        try { const ft = JSON.parse(r.content); if (ft && ft.text != null) await Store.saveFulltext(r.id, ft); } catch {}
        payload = undefined; // ملف PDF نفسه يُنزَّل عبر ensurePayload
      } else payload = r.content; // كتاب نصي: المحتوى هو النص
    } else payload = undefined;
    const existing = await Store.getBook(r.id);
    if (existing) await Store.updateBook(r.id, meta);
    else await Store.addBook(meta, payload);
    if (r.state) { const st = { ...r.state, bookId: r.id }; await Store.saveState(st); }
    recentlyPushed.set(r.id, new Date(r.updated_at).getTime());
  }

  /* ── رفع كتاب كامل (بيانات + ملف) ── */
  async function uploadBook(id, opts = {}) {
    if (!ready || !user) return;
    const b = await Store.getBook(id);
    if (!b) return;
    const st = await Store.getState(id);
    const payload = await Store.getPayload(id);
    const row = {
      id, owner: user.id,
      meta: stripMeta(b), state: stripState(st),
      content: null, has_file: false,
      updated_at: new Date(b.updatedAt || Date.now()).toISOString(),
    };
    if (b.type === 'pdf' && payload instanceof Blob) {
      // نتحقق من نجاح الرفع فعلاً؛ لا نزعم has_file إلا إذا نجح (يمنع «كتاب لا يفتح» على الأجهزة الأخرى)
      const { error: upErr } = await sb.storage.from(BUCKET).upload(`${user.id}/${id}`, payload, { upsert: true, contentType: 'application/pdf' });
      if (upErr) {
        row.has_file = false;
        console.error('storage upload failed', upErr);
        if (!opts.silent && window.Library) {
          const big = /size|large|exceed|maximum|payload/i.test(upErr.message || '');
          Library.toast(`تعذّر رفع ملف «${b.title || ''}» للسحابة${big ? ' — الملف كبير جداً على حدّ المخزن' : ''}`);
        }
      } else row.has_file = true;
    } else if (typeof payload === 'string') {
      row.content = payload;
    }
    // مزامنة نص الـOCR للكتب المصوّرة عبر عمود content (نص الكتاب المصوّر لا ملفه)
    if (b.type === 'pdf') {
      try { const ft = await Store.getFulltext(id); if (ft && ft.ocr && ft.text != null) row.content = JSON.stringify(ft); } catch {}
    }
    const { error } = await sb.from(TABLE).upsert(row);
    if (error) throw error;
    recentlyPushed.set(id, Date.now());
  }

  const stripMeta = (b) => { const { updatedAt, cloudHasFile, id, ...m } = b; return m; };
  const stripState = (s) => { const { bookId, ...st } = s; return st; };

  /* ── دفع تزايدي ── */
  async function pushBook(id) {
    if (!ready || !user) return;
    await touch(id);
    try { await uploadBook(id); setStatus('synced', 'متزامن — ' + (user.email || '')); }
    catch (e) { console.error('pushBook', e); setStatus('error', friendlyErr(e)); }
  }

  function pushState(id) {
    if (!ready || !user) return;
    clearTimeout(pushTimers[id]);
    pushTimers[id] = setTimeout(async () => {
      try {
        await touch(id);
        const st = await Store.getState(id);
        const { error } = await sb.from(TABLE).update({
          state: stripState(st), updated_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) throw error;
        recentlyPushed.set(id, Date.now());
      } catch (e) { console.error('pushState', e); }
    }, 2500);
  }

  // حذف ناعم (tombstone): لا نحذف الصف فعلياً بل نعلّمه، فينتقل الحذف بأمان
  // دون الاعتماد على أحداث DELETE الخام (غير الموثوقة والخطرة على البيانات).
  async function deleteBook(id) {
    if (!ready || !user) return;
    try {
      await sb.storage.from(BUCKET).remove([`${user.id}/${id}`]).catch(() => {});
      recentlyPushed.set(id, Date.now());
      const { error } = await sb.from(TABLE).update({ deleted: true, content: null, has_file: false, updated_at: new Date().toISOString() }).eq('id', id);
      // إن فشل الحذف الناعم (غالباً عمود deleted غير موجود) نحذف الصف فعلياً حتى لا يعود الكتاب
      if (error) {
        console.warn('tombstone failed → hard delete:', error.message);
        await sb.from(TABLE).delete().eq('id', id);
      }
    } catch (e) {
      console.error('cloud delete', e);
      try { await sb.from(TABLE).delete().eq('id', id); } catch {}
    }
  }

  // ختم الطابع الزمني محلياً حتى تصحّ المقارنة لاحقاً
  async function touch(id) { await Store.updateBook(id, { updatedAt: Date.now() }); }

  // جلب عمود content كسولاً (نص كتاب نصي، أو نص OCR لكتاب مصوّر) عند الحاجة فقط
  async function fetchContent(id) {
    try { const { data } = await sb.from(TABLE).select('content').eq('id', id).limit(1); return (data && data[0]) ? data[0].content : null; }
    catch { return null; }
  }

  /* ── تنزيل المحتوى/الملف عند الحاجة (كسول) ── */
  async function ensurePayload(id) {
    if (!ready || !user) return;
    const b = await Store.getBook(id);
    if (!b) return;
    const have = await Store.getPayload(id);

    // كتاب نصي: المحتوى في عمود content (لم يعُد يُجلب في المزامنة) — اجلبه الآن
    if (b.type !== 'pdf') {
      if (have != null) return;
      const c = await fetchContent(id);
      if (typeof c === 'string') await Store.updatePayload(id, c);
      return;
    }

    // كتاب مصوّر: استعد نص الـOCR من content إن غاب (يُفعّل البحث/الذكاء/النسخة النصية)
    try { if (!(await Store.getFulltext(id))) { const c = await fetchContent(id); if (c) { const ft = JSON.parse(c); if (ft && ft.text != null) await Store.saveFulltext(id, ft); } } } catch {}

    if (have != null) return; // الملف موجود محلياً
    try {
      setStatus('syncing', 'جارٍ تنزيل الكتاب…');
      const { data, error } = await sb.storage.from(BUCKET).download(`${user.id}/${id}`);
      if (error) throw error;
      if (!data || data.size === 0) throw new Error('empty file');
      await Store.updatePayload(id, data); // Blob
      setStatus('synced', 'متزامن — ' + (user.email || ''));
    } catch (e) {
      console.error('download payload', e);
      const notFound = /not.?found|does not exist|empty file|400|404/i.test((e && e.message) || '') || (e && (e.statusCode === '404' || e.status === 404));
      if (notFound) {
        // الملف غير موجود في المخزن — علّم السحابة كي يعيد الجهاز الأصلي رفعه تلقائياً عند مزامنته
        try { await sb.from(TABLE).update({ has_file: false }).eq('id', id); } catch {}
        setStatus('error', 'ملف الكتاب لم يُرفع للسحابة');
      } else setStatus('error', 'تعذّر تنزيل ملف الكتاب — تحقق من الاتصال');
    }
  }

  /* ── اشتراك اللحظة (تغييرات من أجهزة أخرى) ── */
  let refreshTimer = null;
  function subscribe() {
    if (!ready || !user) return;
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('books-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: TABLE, filter: `owner=eq.${user.id}` }, async (payload) => {
        // نتجاهل أحداث الحذف الخام تماماً؛ الحذف المقصود يصل كتحديث deleted=true
        if (payload.eventType === 'DELETE') return;
        const row = payload.new;
        if (!row) return;
        // كتم الصدى: تجاهل ما دفعناه للتو من هذا الجهاز
        const pushedAt = recentlyPushed.get(row.id);
        const rowT = new Date(row.updated_at).getTime();
        if (pushedAt && Math.abs(pushedAt - rowT) < 5000) return;
        await applyCloudRow(row); // يعالج deleted داخلياً
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { if (window.Library) Library.refresh(); }, 400);
      })
      .subscribe();
  }

  return {
    init, configure, disconnect, isConfigured, isSignedIn,
    signIn, signUp, signOut, syncAll, onStatus,
    pushBook, pushState, deleteBook, ensurePayload,
    getUserEmail: () => (user ? user.email : null),
    hasBuiltin,
    aiReady: () => ready && !!user,
    aiInvoke,
  };

  /* ── نداء دالة الذكاء الطرفية ── */
  async function aiInvoke(body) {
    if (!ready) throw new Error('المزامنة غير مفعّلة على هذا الجهاز');
    if (!user) throw new Error('سجّل الدخول أولاً لاستخدام المساعد الذكي');
    const { data, error } = await sb.functions.invoke('ai', { body });
    if (error) {
      let msg = error.message || 'تعذّر الاتصال بالمساعد';
      try { const ctx = await error.context.json(); if (ctx && ctx.error) msg = ctx.error; } catch {}
      if (/not found|404/i.test(msg)) msg = 'دالة الذكاء غير منشورة بعد في مشروعك — راجع خطوات الإعداد';
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return (data && data.text) || '';
  }
})();
window.Cloud = Cloud;
