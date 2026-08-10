/* ═══════ مِداد — طبقة المزامنة السحابية (Supabase) ═══════
   تصميم «محلي أولاً»: IndexedDB يبقى المصدر السريع، والسحابة مرآة.
   إن لم تُضبط السحابة، يعمل التطبيق كما هو تماماً دون أي أثر. */
const Cloud = (() => {
  const CFG_KEY = 'midad-cloud';
  const BUCKET = 'book-files';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

  let sb = null;          // عميل Supabase
  let user = null;        // المستخدم الحالي
  let cfg = null;         // {url, anonKey}
  let ready = false;      // SDK مُحمّل والعميل جاهز
  let channel = null;     // اشتراك اللحظة
  const pushTimers = {};  // مؤقتات دفع الحالة لكل كتاب
  const recentlyPushed = new Map(); // كتم صدى اللحظة
  let statusCb = null;

  const getCfg = () => { try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch { return null; } };
  const isConfigured = () => !!getCfg();
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
      const { createClient } = await import(SDK_URL);
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
      const { data: rows, error } = await sb.from('books').select('id, meta, state, content, has_file, updated_at');
      if (error) throw error;
      const cloudById = new Map((rows || []).map((r) => [r.id, r]));
      const localBooks = await Store.getBooks();
      const localById = new Map(localBooks.map((b) => [b.id, b]));

      // سحابة → محلي (كتب جديدة أو أحدث)
      for (const r of rows || []) {
        const lb = localById.get(r.id);
        const cloudT = new Date(r.updated_at).getTime();
        if (!lb) { await applyCloudRow(r); continue; }
        const localT = lb.updatedAt || 0;
        if (cloudT > localT + 1500) await applyCloudRow(r); // السحابة أحدث
      }
      // محلي → سحابة (كتب لم تُرفع بعد أو أحدث محلياً)
      for (const b of localBooks) {
        const r = cloudById.get(b.id);
        if (!r) { await uploadBook(b.id); continue; }
        const cloudT = new Date(r.updated_at).getTime();
        if ((b.updatedAt || 0) > cloudT + 1500) await uploadBook(b.id);
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
    const meta = { ...(r.meta || {}), id: r.id, updatedAt: new Date(r.updated_at).getTime(), cloudHasFile: r.has_file };
    // نص الكتاب يُخزَّن مباشرة؛ ملف PDF يُنزَّل عند أول فتح
    let payload;
    if (r.content != null) payload = r.content;
    else payload = undefined; // PDF: لاحقاً عبر ensurePayload
    const existing = await Store.getBook(r.id);
    if (existing) await Store.updateBook(r.id, meta);
    else await Store.addBook(meta, payload);
    if (r.state) { const st = { ...r.state, bookId: r.id }; await Store.saveState(st); }
    recentlyPushed.set(r.id, new Date(r.updated_at).getTime());
  }

  /* ── رفع كتاب كامل (بيانات + ملف) ── */
  async function uploadBook(id) {
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
      await sb.storage.from(BUCKET).upload(`${user.id}/${id}`, payload, { upsert: true, contentType: 'application/pdf' });
      row.has_file = true;
    } else if (typeof payload === 'string') {
      row.content = payload;
    }
    const { error } = await sb.from('books').upsert(row);
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
        const { error } = await sb.from('books').update({
          state: stripState(st), updated_at: new Date().toISOString(),
        }).eq('id', id);
        if (error) throw error;
        recentlyPushed.set(id, Date.now());
      } catch (e) { console.error('pushState', e); }
    }, 2500);
  }

  async function deleteBook(id) {
    if (!ready || !user) return;
    try {
      await sb.storage.from(BUCKET).remove([`${user.id}/${id}`]).catch(() => {});
      await sb.from('books').delete().eq('id', id);
    } catch (e) { console.error('cloud delete', e); }
  }

  // ختم الطابع الزمني محلياً حتى تصحّ المقارنة لاحقاً
  async function touch(id) { await Store.updateBook(id, { updatedAt: Date.now() }); }

  /* ── تنزيل ملف عند الحاجة (كسول) ── */
  async function ensurePayload(id) {
    if (!ready || !user) return;
    const have = await Store.getPayload(id);
    if (have != null) return;
    const b = await Store.getBook(id);
    if (!b || b.type !== 'pdf') return;
    try {
      setStatus('syncing', 'جارٍ تنزيل الكتاب…');
      const { data, error } = await sb.storage.from(BUCKET).download(`${user.id}/${id}`);
      if (error) throw error;
      await Store.updatePayload(id, data); // Blob
      setStatus('synced', 'متزامن — ' + (user.email || ''));
    } catch (e) { console.error('download payload', e); setStatus('error', 'تعذّر تنزيل ملف الكتاب'); }
  }

  /* ── اشتراك اللحظة (تغييرات من أجهزة أخرى) ── */
  let refreshTimer = null;
  function subscribe() {
    if (!ready || !user) return;
    if (channel) sb.removeChannel(channel);
    channel = sb.channel('books-' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'books', filter: `owner=eq.${user.id}` }, async (payload) => {
        const row = payload.new || payload.old;
        if (!row) return;
        // كتم الصدى: تجاهل ما دفعناه للتو
        const pushedAt = recentlyPushed.get(row.id);
        const rowT = payload.new ? new Date(payload.new.updated_at).getTime() : 0;
        if (pushedAt && Math.abs(pushedAt - rowT) < 4000) return;
        if (payload.eventType === 'DELETE') {
          if (await Store.getBook(row.id)) await Store.deleteBook(row.id);
        } else {
          await applyCloudRow(payload.new);
        }
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
  };
})();
window.Cloud = Cloud;
