/* ═══════ مِداد — طبقة المزامنة السحابية (Supabase) ═══════
   تصميم «محلي أولاً»: IndexedDB يبقى المصدر السريع، والسحابة مرآة.
   إن لم تُضبط السحابة، يعمل التطبيق كما هو تماماً دون أي أثر. */
const Cloud = (() => {
  const CFG_KEY = 'midad-cloud';
  const BUCKET = 'midad-files';
  const TABLE = 'midad_books';
  const STATS_TABLE = 'midad_stats';
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

  let sb = null;          // عميل Supabase
  let user = null;        // المستخدم الحالي
  let cfg = null;         // {url, anonKey}
  let ready = false;      // SDK مُحمّل والعميل جاهز
  let channel = null;     // اشتراك اللحظة
  const pushTimers = {};  // مؤقتات دفع الحالة لكل كتاب
  const deckTimers = {};  // مؤقتات دفع البطاقات لكل كتاب
  let deckSupported = true;  // يصير false إن كان الجدول بلا عمود deck
  let statsSupported = true; // يصير false إن لم يوجد جدول midad_stats
  let statsTimer = null;     // تجميع دفعات سجلّ القراءة
  const recentlyPushed = new Map(); // كتم صدى اللحظة
  let statusCb = null;

  // الأولوية: إعداد الجهاز المحفوظ، ثم الإعداد المضمّن في التطبيق (config.js)
  const builtinCfg = () => {
    const c = window.MIDAD_CONFIG;
    return (c && c.url && c.anonKey) ? { url: c.url.trim().replace(/\/+$/, ''), anonKey: c.anonKey.trim() } : null;
  };
  /* المشروع المضمّن في config.js مشروعُ صاحب التطبيق: لا يُستعمل للمزامنة إلا على أجهزة
     صاحبه ومن يدعوهم — جهاز سبق تسجيل دخوله فيه (جلسة محفوظة)، أو من اختار صراحةً
     «لدي حساب في مشروع التطبيق». الزوار يبدؤون محلياً، ولهم ربط مشروعهم الخاص. */
  const BUILTIN_OPT = 'midad-use-builtin';
  const refOf = (url) => ((String(url || '').match(/^https:\/\/([^.]+)\./) || [])[1] || '');
  function builtinAllowed() {
    const b = builtinCfg(); if (!b) return false;
    try {
      if (localStorage.getItem(BUILTIN_OPT) === '1') return true;
      // جلسة سابقة على هذا الجهاز ⇒ جهاز صاحب التطبيق/مدعوّ؛ نثبّت ذلك كي لا ينقلب «زائراً»
      // حين تنتهي الجلسة أو يسجّل خروجه (فيرى نموذج الدخول لمشروعه بدل شاشة الإعداد)
      if (localStorage.getItem(`sb-${refOf(b.url)}-auth-token`)) { localStorage.setItem(BUILTIN_OPT, '1'); return true; }
      return false;
    } catch { return false; }
  }
  const getCfg = () => {
    try { const ls = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); if (ls && ls.url) return ls; } catch {}
    return builtinAllowed() ? builtinCfg() : null;
  };
  // تسجيل الدخول بالمشروع المضمّن (صاحب التطبيق أو مدعوّ)
  async function useBuiltin() {
    try { localStorage.setItem(BUILTIN_OPT, '1'); } catch {}
    ready = false; user = null;
    await init();
  }
  /* وضع المزامنة: Google Drive الخاص بالمستخدم (بلا أي إعداد)، أو مشروع Supabase */
  const MODE_KEY = 'midad-cloud-mode';
  const isDriveMode = () => { try { return localStorage.getItem(MODE_KEY) === 'drive'; } catch { return false; } };
  const isConfigured = () => isDriveMode() || !!getCfg();
  const hasBuiltin = () => !!builtinCfg();
  const isSignedIn = () => !!user;

  let lastSyncAt = 0; // وقت آخر مزامنة ناجحة (لعرضه للمستخدم)
  function setStatus(state, msg) { if (statusCb) statusCb(state, msg); }
  function onStatus(cb) { statusCb = cb; emitStatus(); }
  // نصّ «متزامن» مع زمن آخر مزامنة (يطمئن المستخدم أن كل شيء مرفوع)
  function syncedMsg() { return 'متزامن — ' + (user && user.email ? user.email : '') + (lastSyncAt ? ' · ' + agoText(lastSyncAt) : ''); }
  function agoText(t) {
    const s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'حُدّثت الآن';
    const m = Math.round(s / 60); if (m < 60) return `آخر مزامنة قبل ${m} دقيقة`;
    const h = Math.round(m / 60); if (h < 24) return `آخر مزامنة قبل ${h} ساعة`;
    return 'آخر مزامنة قبل ' + Math.round(h / 24) + ' يوم';
  }
  function emitStatus() {
    if (!isConfigured()) return setStatus('off', 'المزامنة غير مفعّلة');
    if (!ready) return setStatus('connecting', 'جارٍ الاتصال…');
    if (!user) return setStatus('signedout', 'سجّل الدخول للمزامنة');
    // بلا شبكة: القراءة تعمل محلياً والتغييرات تُرفع تلقائياً عند عودة الاتصال
    if (!navigator.onLine) return setStatus('offline', 'بلا اتصال — سيُرفع ما جدّ عند عودة الشبكة');
    setStatus('synced', syncedMsg());
  }
  // حدّث المؤشّر فور تغيّر حالة الشبكة
  window.addEventListener('online', emitStatus);
  window.addEventListener('offline', emitStatus);

  /* ── تهيئة ── */
  let initDone = null; // وعد التهيئة: فتح كتاب فور بدء التطبيق ينتظره بدل أن يفشل
  function init() { initDone = initInner(); return initDone; }
  async function initInner() {
    cfg = isDriveMode() ? null : getCfg();
    if (!cfg && !isDriveMode()) { emitStatus(); return; }
    try {
      if (isDriveMode()) sb = window.DriveClient.create({ callFn });
      else {
        const createClient = window.__midadSbFactory || (await import(SDK_URL)).createClient;
        sb = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
      }
      ready = true;
      const { data } = await sb.auth.getSession();
      user = data.session ? data.session.user : null;
      sb.auth.onAuthStateChange((_evt, session) => {
        const was = user && user.id;
        user = session ? session.user : null;
        emitStatus();
        if (user && user.id !== was) { subscribe(); syncAll(); }
        if (!user && channel) { sb.removeChannel(channel); channel = null; }
        // أُلغي إذن Google (من حساب المستخدم) ⇒ عُد لشاشة الاختيار بدل نموذج البريد/كلمة المرور
        if (!user && sb && sb.isDrive) { try { localStorage.removeItem(MODE_KEY); } catch {} ready = false; sb = null; emitStatus(); }
      });
      emitStatus();
      if (user) { subscribe(); syncAll(); }
      startAutoSync();
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
    try { localStorage.removeItem(MODE_KEY); } catch {}
    try { localStorage.removeItem(BUILTIN_OPT); } catch {}
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
  async function signOut() {
    if (sb) await sb.auth.signOut();
    // الخروج من Google يعيد الجهاز إلى شاشة الاختيار (محلي فقط)
    if (isDriveMode()) { try { localStorage.removeItem(MODE_KEY); } catch {} sb = null; ready = false; user = null; emitStatus(); }
  }

  /* ── الدخول بحساب Google (المزامنة في Drive المستخدم) ── */
  const GCLIENT_KEY = 'midad-gclient';
  // هل فعّل صاحب التطبيق الدخول بحساب Google؟ (نسأل دالة الخادم مرة كل ست ساعات)
  async function googleClientId(fresh) {
    try {
      const c = JSON.parse(localStorage.getItem(GCLIENT_KEY) || 'null');
      if (!fresh && c && Date.now() - c.at < (c.id ? 6 * 3600e3 : 10 * 60e3)) return c.id || ''; // غير المفعّل يُعاد فحصه بعد ١٠ دقائق
    } catch {}
    try {
      const r = await callFn('gdrive', { action: 'config' });
      const d = r.ok ? await r.json() : {};
      const id = (d && d.clientId) || '';
      try { localStorage.setItem(GCLIENT_KEY, JSON.stringify({ id, at: Date.now() })); } catch {}
      return id;
    } catch { return ''; }
  }
  async function googleAvailable(fresh) {
    if (!window.DriveClient) return false;
    // «غير مفعّل» لا يُعتمد من الذاكرة عند الطلب الصريح (تفعيل حديث في الخادم يظهر فوراً)
    let id = await googleClientId();
    if (!id && fresh) id = await googleClientId(true);
    return !!id;
  }
  async function signInGoogle() {
    const id = await googleClientId(true);
    if (!id) throw new Error('الدخول بحساب Google غير مُفعّل في هذه النسخة بعد');
    const prevMode = isDriveMode();
    try { localStorage.setItem(MODE_KEY, 'drive'); } catch {}
    try {
      if (!prevMode || !sb || !sb.isDrive) { if (sb && channel) { try { sb.removeChannel(channel); } catch {} channel = null; } ready = false; user = null; await init(); }
      await sb.signIn(id); // يُطلق تغيّر الدخول ⇒ اشتراك + مزامنة كاملة
    } catch (e) {
      if (!user) { try { localStorage.removeItem(MODE_KEY); } catch {} sb = null; ready = false; emitStatus(); if (!prevMode) init(); }
      throw e;
    }
  }

  function translateAuthError(m) {
    if (/invalid login/i.test(m)) return 'البريد أو كلمة المرور غير صحيحة';
    if (/already registered/i.test(m)) return 'هذا البريد مسجّل مسبقاً — سجّل الدخول';
    if (/password/i.test(m) && /6/.test(m)) return 'كلمة المرور يجب ألا تقل عن 6 أحرف';
    return m;
  }

  /* ── مزامنة كاملة ثنائية الاتجاه ── */
  let lastSize = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let syncing = false;
  // quiet: مزامنة خلفية دورية — بلا مؤشّر «جارٍ المزامنة» ولا إعادة رسم إن لم يتغيّر شيء
  async function syncAll(opts = {}) {
    if (!ready || !user || syncing) return;
    const quiet = !!opts.quiet;
    if (quiet && !navigator.onLine) return;
    syncing = true;
    let changed = false;
    if (!quiet) setStatus('syncing', 'جارٍ المزامنة…');
    try {
      // نستثني عمود content الثقيل (نص الكتب/الـOCR) — يُجلب كسولاً عند فتح الكتاب فيسرع المزامنة كثيراً.
      // نتدرّج في الأعمدة: بعض الجداول القديمة بلا deck (البطاقات) أو بلا deleted (الحذف الناعم).
      const COLSETS = [
        'id, owner, meta, state, deck, has_file, deleted, updated_at',
        'id, owner, meta, state, has_file, deleted, updated_at',
        'id, owner, meta, state, has_file, updated_at',
      ];
      let rows = null, error = null;
      for (let i = 0; i < COLSETS.length; i++) {
        ({ data: rows, error } = await sb.from(TABLE).select(COLSETS[i]));
        if (!error) { if (i > 0) deckSupported = false; break; }
        if (!/column .* does not exist|deck|deleted/i.test(error.message || '')) break;
      }
      if (error) throw error;
      const cloudById = new Map((rows || []).map((r) => [r.id, r]));
      const localBooks = await Store.getBooks();
      const localById = new Map(localBooks.map((b) => [b.id, b]));

      // ① سحابة → محلي: الحذف، الكتب الجديدة، ودمج الحالة للموجود في الطرفين
      for (const r of rows || []) {
        if (r.deleted) { if (localById.has(r.id)) await Store.deleteBook(r.id); continue; }
        const lb = localById.get(r.id);
        if (!lb) { await applyCloudRow(r); changed = true; continue; } // كتاب جديد من السحابة (يدمج الحالة داخلياً)
        // حالة الملف في السحابة تبقى محدّثة محلياً (رسائل الفتح تعتمد عليها)
        const fe = (r.meta && r.meta.fileError) || undefined;
        if (lb.cloudHasFile !== !!r.has_file || lb.fileError !== fe) {
          await Store.updateBook(r.id, { cloudHasFile: !!r.has_file, fileError: fe, fileMB: (r.meta && r.meta.fileMB) || undefined });
        }
        const cloudT = new Date(r.updated_at).getTime();
        const localT = lb.updatedAt || 0;
        if (cloudT > localT + 1500) {
          // ميتا السحابة أحدث ⇒ اعتمدها + ادمج الحالة والبطاقات؛ إن أضاف الدمج جديداً ارفعه
          const res = await applyCloudRow(r);
          changed = true;
          const deckAhead = await mergeDeckInto(r.id, r.deck);
          if ((res && res.divergedFromCloud) || deckAhead) await pushStateNow(r.id);
          continue;
        }
        // الطرفان موجودان والميتا المحلية ليست أقدم: ادمج الحالة دون تبديل الميتا
        const localState = await Store.getState(r.id);
        const cloudState = { ...(r.state || {}), bookId: r.id };
        const merged = mergeStates(localState, cloudState);
        const mSig = stateSig(merged);
        if (mSig !== stateSig(localState)) { await Store.saveState(merged); changed = true; }
        const deckAhead = await mergeDeckInto(r.id, r.deck); // بطاقات المراجعة تُدمج كذلك
        if (localT > cloudT + 1500) await uploadBook(r.id, { silent: true }); // الميتا المحلية أحدث ⇒ ارفع الكل (مع الحالة والبطاقات المدموجة)
        else if (mSig !== stateSig(cloudState) || deckAhead) await pushStateNow(r.id); // الدمج أضاف ما ليس في السحابة
      }
      // ② محلي → سحابة: كتب لم تُرفع بعد، وإعادة رفع ملف PDF ناقص
      // نتحقّق من المخزن نفسه لا من العلَم وحده: كتاب «has_file» بلا ملف فعلي يُصلَح هنا
      let stored = await listStoredFiles(); // Map(id → size) أو null إن تعذّر
      // قائمة فارغة والسحابة تزعم ملفات؟ لا نثق بها (صلاحيات/خلل مؤقّت) كي لا نعيد رفع المكتبة كلها
      if (stored && !stored.size && (rows || []).some((r) => r.has_file && !r.deleted)) stored = null;
      let healed = 0; // إعادة الرفع الذاتية محدودة في كل دورة (الباقي في الدورة التالية)
      for (const b of localBooks) {
        const r = cloudById.get(b.id);
        if (!r) { await uploadBook(b.id, { silent: true }); continue; }
        if (r.deleted || b.type !== 'pdf') continue;
        const inStore = stored ? (stored.get(b.id) || 0) > 0 : !!r.has_file;
        if (inStore) {
          if (!r.has_file) await setHasFile(b.id, true); // الملف موجود لكن العلَم خاطئ
          continue;
        }
        const pl = await Store.getPayload(b.id);
        if (pl instanceof Blob) {
          // ملف أكبر من حدّ المخزن: لا نعيد محاولة رفعه كل مزامنة ما لم يتغيّر حجمه
          if (uploadBlocked(b.id, pl.size) || healed >= 5) continue;
          healed++;
          await uploadBook(b.id, { silent: true });
        } else if (r.has_file) await setHasFile(b.id, false); // لا ملف هنا ولا في المخزن: صحّح العلَم
      }
      await syncStats(); // سجلّ القراءة اليومي (السلسلة والهدف عبر الأجهزة)
      await syncSettings(); // تفضيلات القراءة وسمة المكتبة
      lastSyncAt = Date.now();
      setStatus('synced', syncedMsg());
      if (window.Library && (changed || !quiet)) Library.refresh();
    } catch (e) {
      console.error('syncAll', e);
      if (!quiet) setStatus('error', friendlyErr(e)); else emitStatus();
    } finally { syncing = false; }
    prefetchFiles(); // نزّل في الخلفية ملفات الكتب التي يُرجَّح فتحها قريباً
  }

  /* ── قائمة ملفات المستخدم في المخزن (للتحقّق من وجود الملفات فعلاً) ──
     تعيد Map(معرّف الكتاب ⇒ الحجم). الكتاب المقسّم أجزاءً يُعدّ موجوداً بوجود ملف بيانه «.parts». */
  async function listStoredFiles() {
    try {
      const raw = new Map();
      for (let offset = 0; offset < 20000; offset += 1000) {
        const { data, error } = await sb.storage.from(BUCKET).list(user.id, { limit: 1000, offset });
        if (error) throw error;
        for (const f of data || []) if (f && f.id) raw.set(f.name, (f.metadata && f.metadata.size) || 0); // f.id فارغ للمجلّدات (assets)
        if (!data || data.length < 1000) break;
      }
      const out = new Map(), partSum = new Map();
      for (const [n, sz] of raw) { const m = /^(.+)\.part\d+$/.exec(n); if (m) partSum.set(m[1], (partSum.get(m[1]) || 0) + sz); }
      for (const [n, sz] of raw) {
        if (/\.part\d+$/.test(n)) continue;
        const m = /^(.+)\.parts$/.exec(n);
        if (m) out.set(m[1], Math.max(out.get(m[1]) || 0, partSum.get(m[1]) || 1));
        else out.set(n, Math.max(out.get(n) || 0, sz));
      }
      return out;
    } catch (e) { console.warn('list storage', e); return null; }
  }

  /* رفع ملف الكتاب. في Supabase يُقسَّم ما يزيد على 20 م.ب إلى أجزاء (كلٌّ تحت حدّ حجم الملف
     في الخطة المجانية) مع ملف بيان «.parts» يُكتب أخيراً؛ الأجزاء المرفوعة سابقاً تُتخطّى
     فيُستأنف الرفع المنقطع من حيث توقّف. في Google Drive: رفع مستأنَف على قطع داخل drive.js. */
  const PART = 20 * 1048576;
  async function putBookFile(id, blob, onProgress) {
    const store = sb.storage.from(BUCKET);
    if (sb.isDrive || blob.size <= PART) {
      return store.upload(`${user.id}/${id}`, blob, { upsert: true, contentType: 'application/pdf', onProgress });
    }
    const n = Math.ceil(blob.size / PART);
    let have = new Map();
    try { const { data } = await store.list(user.id, { search: id, limit: 1000 }); for (const f of data || []) have.set(f.name, (f.metadata && f.metadata.size) || 0); } catch {}
    for (let i = 0; i < n; i++) {
      const part = blob.slice(i * PART, Math.min(blob.size, (i + 1) * PART));
      const name = `${id}.part${i}`;
      if (have.get(name) === part.size) { if (onProgress) onProgress((i + 1) / n); continue; } // رُفع سابقاً
      let err = null;
      for (let a = 0; a < 4; a++) {
        ({ error: err } = await store.upload(`${user.id}/${name}`, part, { upsert: true, contentType: 'application/octet-stream' }));
        if (!err) break;
        if (/size|large|exceed|maximum|413/i.test((err.message || '') + (err.statusCode || ''))) return { error: err };
        await sleep(900 * (a + 1));
      }
      if (err) return { error: err };
      if (onProgress) onProgress((i + 1) / n);
    }
    const manifest = new Blob([JSON.stringify({ n, size: blob.size, part: PART })], { type: 'application/json' });
    const r = await store.upload(`${user.id}/${id}.parts`, manifest, { upsert: true, contentType: 'application/json' });
    if (!r.error) store.remove([`${user.id}/${id}`]).catch(() => {}); // نسخة قديمة غير مقسّمة إن وُجدت
    return r;
  }

  // تنزيل ملف الكتاب كما رُفع (كامل، أو أجزاء)، مع نسبة التقدّم
  async function downloadBookFile(id, quiet) {
    const progress = (f) => { if (!quiet) setStatus('syncing', `جارٍ تنزيل الكتاب… ${Math.min(99, Math.round(f * 100))}٪`); };
    if (sb.isDrive) return sb.storage.from(BUCKET).downloadRanged(`${user.id}/${id}`, progress);
    try { return await downloadChunked(`${user.id}/${id}`, 0, progress); }
    catch (e) {
      if (!isNotFound(e)) throw e;
      // ليس ملفاً واحداً ⇒ ربما مقسّم أجزاءً
      const { data: mf, error: me } = await sb.storage.from(BUCKET).download(`${user.id}/${id}.parts`);
      if (me || !mf) throw e;
      const m = JSON.parse(await mf.text());
      lastSize = m.size;
      const blobs = [];
      for (let i = 0; i < m.n; i++) {
        const partSize = Math.min(m.part, m.size - i * m.part);
        blobs.push(await downloadChunked(`${user.id}/${id}.part${i}`, partSize, (f) => progress((i + f) / m.n)));
      }
      return new Blob(blobs, { type: 'application/pdf' });
    }
  }
  const isNotFound = (e) => { const st = Number((e && (e.status || e.statusCode)) || 0); return st === 400 || st === 404 || /not.?found|does not exist/i.test(String((e && e.message) || '')); };

  async function removeBookFiles(id) {
    const store = sb.storage.from(BUCKET);
    const paths = [`${user.id}/${id}`];
    if (!sb.isDrive) {
      try { const { data } = await store.list(user.id, { search: id, limit: 1000 }); for (const f of data || []) if (f.name.startsWith(id + '.part')) paths.push(`${user.id}/${f.name}`); } catch {}
    }
    await store.remove(paths).catch(() => {});
  }
  async function setHasFile(id, v) {
    try { await sb.from(TABLE).update({ has_file: v }).eq('id', id); } catch {}
    await Store.updateBook(id, { cloudHasFile: v });
  }
  // رفع فشل لأن الملف أكبر من حدّ المخزن ⇒ لا تُعِد المحاولة إلا إن تغيّر الملف
  const BLOCK_KEY = 'midad-upload-blocked';
  function readBlocked() { try { return JSON.parse(localStorage.getItem(BLOCK_KEY) || '{}') || {}; } catch { return {}; } }
  function uploadBlocked(id, size) { const b = readBlocked()[id]; return !!b && b === size; }
  function markBlocked(id, size) { try { const b = readBlocked(); if (size) b[id] = size; else delete b[id]; localStorage.setItem(BLOCK_KEY, JSON.stringify(b)); } catch {} }

  /* ── مزامنة خلفية تلقائية ──
     كل بضع دقائق ما دامت الصفحة ظاهرة والشبكة متاحة، وعند العودة للتطبيق، بلا أي إشعار.
     (التغييرات اللحظية تصل أصلاً عبر الاشتراك؛ هذه شبكة أمان لما يفوته.) */
  const AUTO_MS = 4 * 60 * 1000;
  let autoStarted = false;
  function startAutoSync() {
    if (autoStarted) return;
    autoStarted = true;
    const tick = () => { if (!document.hidden && user && Date.now() - lastSyncAt > 60 * 1000) syncAll({ quiet: true }); };
    setInterval(tick, AUTO_MS);
    // Drive بلا إشعارات لحظية ⇒ دورة إضافية بين الدورات
    setInterval(() => { if (sb && sb.isDrive) tick(); }, AUTO_MS / 2);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(tick, 1500); });
    window.addEventListener('online', () => setTimeout(tick, 3000));
  }

  /* ── تنزيل مسبق هادئ لملفات الكتب المرجَّح فتحها ──
     لا ننزّل المكتبة كلها (مساحة الجهاز وحصّة التنزيل): فقط الكتب قيد القراءة والمضافة حديثاً،
     بضعة كتب في كل دورة، وعلى اتصال غير مقتصِد. فيفتح الكتاب فوراً، وبلا إنترنت أيضاً. */
  let prefetching = false;
  async function prefetchFiles() {
    if (prefetching || !ready || !user || !navigator.onLine) return;
    const c = navigator.connection;
    if (c && (c.saveData || /2g/.test(c.effectiveType || ''))) return;
    prefetching = true;
    try {
      const books = (await Store.getBooks()).filter((b) => b.type === 'pdf' && b.cloudHasFile);
      const states = new Map(((await Store.getAllStates()) || []).map((s) => [s.bookId, s]));
      const now = Date.now(), DAY = 864e5;
      const want = [];
      const pin = offlinePrefs();
      for (const b of books) {
        const st = states.get(b.id) || {};
        const added = b.addedAt || b.createdAt || 0;
        const pinned = pin.all || pin.ids.includes(b.id);
        const reading = st.lastRead && !st.finished && now - st.lastRead < 90 * DAY;
        const fresh = added && now - added < 14 * DAY;
        if (!pinned && !reading && !fresh) continue;
        if ((await Store.getPayload(b.id)) != null) continue;
        want.push({ id: b.id, t: (pinned ? 1e15 : 0) + (st.lastRead || added) });
      }
      want.sort((a, b) => b.t - a.t);
      for (const w of want.slice(0, pin.all || pin.ids.length ? 8 : 3)) {
        if (document.hidden || !navigator.onLine) break;
        await ensurePayload(w.id, { quiet: true });
      }
    } catch (e) { console.warn('prefetch', e); }
    finally { prefetching = false; }
  }

  /* ── «متاح دون اتصال»: كتب تُبقى ملفاتها على هذا الجهاز دائماً (تفضيل محلي لكل جهاز) ── */
  const OFFLINE_KEY = 'midad-offline';
  function offlinePrefs() { try { const o = JSON.parse(localStorage.getItem(OFFLINE_KEY) || 'null'); return { all: !!(o && o.all), ids: (o && o.ids) || [] }; } catch { return { all: false, ids: [] }; } }
  function setOffline(patch) {
    const o = { ...offlinePrefs(), ...patch };
    try { localStorage.setItem(OFFLINE_KEY, JSON.stringify(o)); } catch {}
    // اطلب تخزيناً دائماً كي لا يمسح المتصفح الملفات عند ضيق المساحة
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch {}
    if (o.all || o.ids.length) setTimeout(prefetchFiles, 300);
    return o;
  }
  // تنزيل قائمة كتب الآن (زر «نزّل للقراءة دون اتصال»)، مع تقدّم إجمالي
  async function downloadBooks(ids, onProgress) {
    let done = 0, failed = 0;
    for (const id of ids) {
      if (!navigator.onLine) { failed += ids.length - done - failed; break; }
      const r = await ensurePayload(id, { quiet: true });
      if (r === 'ok') done++; else failed++;
      if (onProgress) onProgress(done + failed, ids.length);
    }
    emitStatus();
    return { done, failed };
  }

  /* ── تقرير حالة السحابة (للوحة «حالة السحابة») ── */
  async function storageReport() {
    if (initDone) { try { await initDone; } catch {} }
    if (!ready || !user) throw new Error('سجّل الدخول أولاً');
    const stored = await listStoredFiles();
    if (!stored) throw new Error('تعذّر قراءة محتوى السحابة — تحقّق من الاتصال');
    const books = (await Store.getBooks()).filter((b) => !b.guide);
    const pin = offlinePrefs();
    const out = [];
    let cloudBytes = 0;
    for (const sz of stored.values()) cloudBytes += sz > 1 ? sz : 0;
    for (const b of books) {
      const pl = await Store.getPayload(b.id);
      const localSize = pl instanceof Blob ? pl.size : (typeof pl === 'string' ? pl.length * 2 : 0);
      let cloud;
      if (b.type !== 'pdf') cloud = 'text';
      else if (stored.has(b.id)) cloud = 'ok';
      else if (b.fileError === 'size') cloud = 'toobig';
      else cloud = pl instanceof Blob ? 'pending' : 'missing';
      out.push({ id: b.id, title: b.title || '', type: b.type, local: pl != null, localSize, cloudSize: stored.get(b.id) || 0, cloud, pinned: pin.all || pin.ids.includes(b.id) });
    }
    let quota = null;
    if (sb.isDrive) { try { quota = await sb.quota(); } catch {} }
    let localBytes = 0, localQuota = 0;
    try { const e = await navigator.storage.estimate(); localBytes = e.usage || 0; localQuota = e.quota || 0; } catch {}
    return {
      provider: sb.isDrive ? 'drive' : 'supabase',
      cloudBytes, quota, // Drive: {used, limit} لحساب المستخدم كله
      supabaseLimit: sb.isDrive ? 0 : 1024 * 1048576, // الخطة المجانية (تقديري)
      localBytes, localQuota, books: out, offline: pin,
    };
  }
  // إعادة رفع ملفات «لم تُرفع بعد» من هذا الجهاز الآن (يتجاوز حدّ الخمسة في الدورة)
  async function uploadPending(ids, onProgress) {
    let done = 0;
    for (const id of ids) { markBlocked(id, 0); try { await uploadBook(id, { silent: true }); } catch (e) { console.warn('uploadPending', e); } done++; if (onProgress) onProgress(done, ids.length); }
    emitStatus();
  }

  /* ── مزامنة سجلّ القراءة اليومي (السلسلة + الهدف) ──
     كل جهاز يملك صفّه الخاص (owner, device) ويرفع ما قرأه هو فقط.
     المعروض = مجموع صفوف كل الأجهزة ليومٍ واحد. لو خزّنّا مجموعاً مدموجاً
     واحداً ورفعناه، لأعاد كل جهاز جمع ما جمعه الآخر فتضاعفت الأرقام. */
  async function syncStats() {
    if (!ready || !user || !statsSupported || !Store.deviceId) return;
    const me = Store.deviceId();
    try {
      const { data: rows, error } = await sb.from(STATS_TABLE).select('device, log, goal, goal_at, updated_at');
      if (error) {
        // الجدول غير مُنشأ بعد ⇒ تبقى الإحصاءات محلية بلا إزعاج
        if (/does not exist|schema cache|relation/i.test(error.message || '')) { statsSupported = false; return; }
        throw error;
      }
      // اجمع سجلّات بقية الأجهزة (لا سجلّ هذا الجهاز كي لا يُحتسب مرتين)
      const remote = {};
      let bestGoal = null, bestGoalAt = 0;
      for (const r of rows || []) {
        if ((r.goal_at || 0) > bestGoalAt && r.goal) { bestGoalAt = r.goal_at; bestGoal = r.goal; }
        if (r.device === me) continue;
        const lg = r.log || {};
        for (const k in lg) remote[k] = (remote[k] || 0) + (lg[k] || 0);
      }
      const statsChanged = JSON.stringify(remote) !== JSON.stringify(Store.getRemoteLog ? Store.getRemoteLog() : null);
      Store.setRemoteLog(remote);
      // الهدف اليومي: أحدث ضبط بين الأجهزة يفوز
      const goalAdopted = !!(bestGoal && bestGoalAt > (Store.getGoalAt ? Store.getGoalAt() : 0));
      if (goalAdopted) Store.adoptGoal(bestGoal, bestGoalAt);

      // ارفع سجلّ هذا الجهاز
      const up = {
        owner: user.id, device: me,
        log: Store.getLog(), goal: Store.getGoal(),
        goal_at: Store.getGoalAt ? Store.getGoalAt() : 0,
        updated_at: new Date().toISOString(),
      };
      const { error: upErr } = await sb.from(STATS_TABLE).upsert(up, { onConflict: 'owner,device' });
      if (upErr) {
        if (/does not exist|schema cache|relation/i.test(upErr.message || '')) { statsSupported = false; return; }
        throw upErr;
      }
      if ((statsChanged || goalAdopted) && window.Library && Library.refresh) Library.refresh(); // لا إعادة رسم بلا جديد
    } catch (e) { console.error('syncStats', e); }
  }

  /* ── مزامنة الإعدادات عبر بيانات الحساب نفسه (user_metadata) — بلا جداول جديدة ──
     آخر تعديل يفوز للحزمة كلها؛ الختم يتحرّك فقط عند تغيّر تفضيلة مُزامَنة فعلاً. */
  let settingsTimer = null;
  async function syncSettings() {
    if (!ready || !user || !Store.getSyncedSettings) return;
    try {
      const { data, error } = await sb.auth.getUser();
      if (error || !data || !data.user) return;
      const meta = data.user.user_metadata || {};
      const rAt = +meta.midad_settings_at || 0, lAt = Store.getSettingsAt();
      if (meta.midad_settings && rAt > lAt) {
        Store.adoptSyncedSettings(meta.midad_settings, rAt);
        window.dispatchEvent(new Event('midad-settings-adopted'));
      } else if (lAt > rAt) {
        const { error: upErr } = await sb.auth.updateUser({ data: { midad_settings: Store.getSyncedSettings(), midad_settings_at: lAt } });
        if (upErr) throw upErr;
      }
    } catch (e) { console.error('syncSettings', e); }
  }
  function pushSettings() {
    if (!ready || !user) return;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(syncSettings, 3000);
  }
  window.addEventListener('midad-settings-changed', pushSettings);

  // يُستدعى بينما تتراكم دقائق القراءة — مؤجَّل كي لا نرفع كل خمس ثوانٍ
  function pushStats() {
    if (!ready || !user || !statsSupported) return;
    clearTimeout(statsTimer);
    statsTimer = setTimeout(syncStats, 60000);
  }

  function friendlyErr(e) {
    const m = (e && e.message) || '';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'تعذّر الوصول للسحابة (تحقق من الاتصال أو أن المشروع غير موقوف)';
    if (/relation .*books.* does not exist|schema/i.test(m)) return 'الجداول غير مُعدّة — نفّذ خطوات الإعداد';
    if (/bucket/i.test(m)) return 'مخزن الملفات غير مُعدّ — نفّذ خطوات الإعداد';
    return m || 'خطأ في المزامنة';
  }

  /* ── دمج حالة القراءة على مستوى العنصر (منع فقدان البيانات عند التعارض) ──
     كل جهاز قد يضيف/يعدّل/يحذف تظليلات وملاحظات وعلامات بشكل مستقلّ. بدل «آخر
     كتابة تفوز» على الحالة كلّها (تدهس عمل جهاز آخر)، ندمج كل مجموعة بمفتاح id:
     • الإضافات من الطرفين تُحفظ جميعاً.
     • عند وجود العنصر في الطرفين نأخذ الأحدث (mt أو at).
     • الحذف يُحترم عبر شواهد state.deleted[list][id]=وقت (إن كان الحذف أحدث من التعديل).
     • الموضع/الصفحة/التمرير من الجهاز الأخير قراءةً (lastRead الأكبر).
     • الوقت المقروء = الأكبر، و«أُنهي» = إن أنهاه أي جهاز. */
  const LISTS = ['highlights', 'bookmarks', 'pageNotes', 'pdfHighlights'];
  const itemT = (it) => (it && (it.mt || it.at)) || 0;

  function mergeDelMap(a = {}, b = {}) {
    const out = {};
    for (const src of [a, b]) for (const k in src) out[k] = Math.max(out[k] || 0, src[k] || 0);
    const cutoff = Date.now() - 90 * 864e5; // قصّ الشواهد الأقدم من ٩٠ يوماً
    for (const k in out) if (out[k] < cutoff) delete out[k];
    return out;
  }
  function mergeList(aList, bList, delMap) {
    const byId = new Map();
    const put = (it) => { if (!it || it.id == null) return; const p = byId.get(it.id); if (!p || itemT(it) >= itemT(p)) byId.set(it.id, it); };
    (aList || []).forEach(put); (bList || []).forEach(put);
    const out = [];
    for (const it of byId.values()) { const d = (delMap && delMap[it.id]) || 0; if (d && d >= itemT(it)) continue; out.push(it); }
    out.sort((x, y) => (x.at || 0) - (y.at || 0));
    return out;
  }
  function mergeStates(a, b) {
    a = a || {}; b = b || {};
    const aDel = a.deleted || {}, bDel = b.deleted || {};
    const deleted = {};
    for (const l of LISTS) deleted[l] = mergeDelMap(aDel[l], bDel[l]);
    const posFromA = (a.lastRead || 0) >= (b.lastRead || 0);
    const pos = posFromA ? a : b;
    // ابدأ من اتحاد الحقول (الطرف a يرجّح) كي لا تسقط حقول لا يعرفها الدمج،
    // ثم اضبط الحقول المعروفة بقواعدها الصريحة.
    const m = {
      ...b, ...a,
      bookId: a.bookId || b.bookId,
      pct: pos.pct || 0, page: pos.page || 0, scrollTop: pos.scrollTop || 0,
      lastRead: Math.max(a.lastRead || 0, b.lastRead || 0),
      seconds: Math.max(a.seconds || 0, b.seconds || 0),
      finished: !!(a.finished || b.finished),
      deleted,
    };
    // تاريخ الإنهاء: أوّل جهاز سجّله هو الصحيح
    const fa = [a.finishedAt, b.finishedAt].filter((t) => t > 0);
    if (fa.length) m.finishedAt = Math.min(...fa); else delete m.finishedAt;
    for (const l of LISTS) m[l] = mergeList(a[l], b[l], deleted[l]);
    // الرسومات: اتحاد المفاتيح؛ الصفحة المشتركة تؤخذ من الجهاز الأخير قراءةً
    const ad = a.drawings || {}, bd = b.drawings || {}, dr = {};
    for (const k of new Set([...Object.keys(ad), ...Object.keys(bd)])) dr[k] = (ad[k] && bd[k]) ? (posFromA ? ad[k] : bd[k]) : (ad[k] || bd[k]);
    m.drawings = dr;
    return m;
  }
  // بصمة مختصرة للحالة لكشف ما إذا كان الدمج أضاف جديداً (فنحفظ/نرفع فقط عند الحاجة)
  function stateSig(s) {
    s = s || {};
    const ids = (l) => (s[l] || []).map((i) => i.id + ':' + itemT(i)).sort().join(',');
    const del = (l) => { const d = (s.deleted || {})[l] || {}; return Object.keys(d).map((id) => id + ':' + d[id]).sort().join(','); };
    return [s.page, Math.round((s.pct || 0) * 1e4), s.scrollTop, s.seconds, !!s.finished, s.finishedAt || 0, s.lastRead,
      ...LISTS.map(ids), ...LISTS.map(del), Object.keys(s.drawings || {}).sort().join(',')].join('|');
  }

  /* ── دمج مجموعة البطاقات (نفس منطق الحالة: اتحاد بالمعرّف + الأحدث يفوز) ──
     البطاقات لا تُحذف فرادى في الواجهة (تُحذف مع الكتاب)، فلا حاجة لشواهد حذف.
     المراجعة تغيّر box/due وتضع mt، فيفوز آخر جهاز راجع البطاقة. */
  function mergeDecks(a, b) {
    const aC = (a && a.cards) || [], bC = (b && b.cards) || [];
    if (!aC.length && !bC.length) return null;
    const byId = new Map();
    const put = (c) => { if (!c) return; const k = c.id || c.q; if (k == null) return; const p = byId.get(k); if (!p || (c.mt || 0) >= (p.mt || 0)) byId.set(k, c); };
    aC.forEach(put); bC.forEach(put);
    return { cards: [...byId.values()], updatedAt: Math.max((a && a.updatedAt) || 0, (b && b.updatedAt) || 0) };
  }
  const deckSig = (d) => ((d && d.cards) || []).map((c) => (c.id || c.q) + ':' + (c.mt || 0) + ':' + (c.box || 0) + ':' + (c.due || 0)).sort().join(',');

  // يدمج بطاقات صفٍّ سحابي مع المحلية ويحفظها؛ يعيد true إن بقي المحلي متقدّماً على السحابة
  async function mergeDeckInto(id, cloudDeck) {
    if (!Store.getDeck || !Store.saveDeck) return false;
    let local = null; try { local = await Store.getDeck(id); } catch {}
    const merged = mergeDecks(local, cloudDeck);
    if (!merged) return false;
    const mSig = deckSig(merged);
    if (mSig !== deckSig(local)) { try { await Store.saveDeck(id, merged.cards); } catch {} }
    return mSig !== deckSig(cloudDeck);
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
    // ادمج الحالة الواردة مع المحلية بدل دهسها (يحفظ تظليلات/ملاحظات هذا الجهاز)
    let mergedSig = null, incomingSig = null;
    if (r.state) {
      const local = existing ? await Store.getState(r.id) : null;
      const incoming = { ...r.state, bookId: r.id };
      const merged = mergeStates(local, incoming);
      incomingSig = stateSig(incoming);
      mergedSig = stateSig(merged);
      await Store.saveState(merged);
    }
    const deckAhead = await mergeDeckInto(r.id, r.deck);
    recentlyPushed.set(r.id, new Date(r.updated_at).getTime());
    // إن أضاف الدمج ما ليس في السحابة، ارفع الدمج كي تتقارب الأجهزة
    return { divergedFromCloud: (mergedSig != null && mergedSig !== incomingSig) || deckAhead };
  }

  // رفع عمودي الحالة والبطاقات فقط (أخفّ من رفع الصف كاملاً) — للتقارب بعد الدمج
  async function pushStateNow(id) {
    if (!ready || !user) return;
    try {
      await touch(id);
      const st = await Store.getState(id);
      const patch = { state: stripState(st), updated_at: new Date().toISOString() };
      if (deckSupported) patch.deck = await localDeck(id);
      let { error } = await sb.from(TABLE).update(patch).eq('id', id);
      // الجدول بلا عمود deck ⇒ أعِد المحاولة بالحالة وحدها ولا تحاول رفعه لاحقاً
      if (error && /deck|column .* does not exist/i.test(error.message || '')) {
        deckSupported = false; delete patch.deck;
        ({ error } = await sb.from(TABLE).update(patch).eq('id', id));
      }
      if (error) throw error;
      recentlyPushed.set(id, Date.now());
    } catch (e) { console.error('pushStateNow', e); }
  }

  // بطاقات الكتاب كما هي محلياً (أو null إن لم توجد)
  async function localDeck(id) {
    if (!Store.getDeck) return null;
    try { const d = await Store.getDeck(id); return (d && d.cards && d.cards.length) ? { cards: d.cards, updatedAt: d.updatedAt || Date.now() } : null; }
    catch { return null; }
  }

  // دفع البطاقات بعد تعديلها (توليد/مراجعة) — مؤجَّل قليلاً لتجميع المراجعات المتتابعة
  function pushDeck(id) {
    if (!ready || !user) return;
    clearTimeout(deckTimers[id]);
    deckTimers[id] = setTimeout(() => pushStateNow(id), 2000);
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
    if (deckSupported) row.deck = await localDeck(id); // بطاقات المراجعة تُرفع مع الكتاب
    if (b.type === 'pdf' && payload instanceof Blob) {
      // نتحقق من نجاح الرفع فعلاً؛ لا نزعم has_file إلا إذا نجح (يمنع «كتاب لا يفتح» على الأجهزة الأخرى)
      const big0 = payload.size > 3 * 1048576 && !opts.silent;
      const { error: upErr } = await putBookFile(id, payload, big0 ? (f) => setStatus('syncing', `جارٍ رفع «${(b.title || '').slice(0, 30)}»… ${Math.round(f * 100)}٪`) : null);
      if (upErr) {
        row.has_file = false;
        console.error('storage upload failed', upErr);
        const big = /size|large|exceed|maximum|payload|413/i.test((upErr.message || '') + ' ' + (upErr.statusCode || upErr.status || ''));
        if (big) { markBlocked(id, payload.size); const fm = { fileError: 'size', fileMB: Math.round(payload.size / 1048576) }; row.meta = { ...row.meta, ...fm }; await Store.updateBook(id, fm); }
        if (!opts.silent && window.Library) {
          Library.toast(`تعذّر رفع ملف «${b.title || ''}» للسحابة${big ? ' — الملف كبير جداً على حدّ المخزن' : ''}`);
        }
      } else { row.has_file = true; markBlocked(id, 0); if (b.fileError) { delete row.meta.fileError; delete row.meta.fileMB; await Store.updateBook(id, { fileError: undefined, fileMB: undefined }); } }
    } else if (typeof payload === 'string') {
      row.content = payload;
      if (b.assets && b.assets.length) await uploadAssets(id); // صور كتاب EPUB
    }
    // مزامنة نص الـOCR للكتب المصوّرة عبر عمود content (نص الكتاب المصوّر لا ملفه)
    if (b.type === 'pdf') {
      try { const ft = await Store.getFulltext(id); if (ft && ft.ocr && ft.text != null) row.content = JSON.stringify(ft); } catch {}
    }
    let { error } = await sb.from(TABLE).upsert(row);
    if (error && /deck|column .* does not exist/i.test(error.message || '')) {
      deckSupported = false; delete row.deck;
      ({ error } = await sb.from(TABLE).upsert(row));
    }
    if (error) throw error;
    recentlyPushed.set(id, Date.now());
  }

  const stripMeta = (b) => { const { updatedAt, cloudHasFile, id, ...m } = b; return m; };
  const stripState = (s) => { const { bookId, ...st } = s; return st; };

  /* ── دفع البيانات الوصفية وحدها ──
     التعديلات الخفيفة (السلسلة، المفضلة، الرفوف) لا تستدعي إعادة رفع ملف PDF كاملاً كما يفعل
     pushBook؛ نحدّث عمود meta فقط، ونرفع الكتاب كاملاً إن لم يكن في السحابة بعد. */
  async function pushMeta(id) {
    if (!ready || !user) return;
    try {
      await touch(id);
      const b = await Store.getBook(id);
      if (!b) return;
      const { data, error } = await sb.from(TABLE)
        .update({ meta: stripMeta(b), updated_at: new Date(b.updatedAt || Date.now()).toISOString() })
        .eq('id', id).select('id');
      if (error) throw error;
      if (!data || !data.length) { await uploadBook(id, { silent: true }); return; }
      recentlyPushed.set(id, Date.now());
    } catch (e) { console.error('pushMeta', e); }
  }

  /* ── دفع تزايدي ── */
  async function pushBook(id) {
    if (!ready || !user) return;
    await touch(id);
    try { await uploadBook(id); setStatus('synced', syncedMsg()); }
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
  /* ── صور كتب EPUB في المخزن: «المستخدم/assets/الكتاب/الاسم» ── */
  const assetDir = (id) => `${user.id}/assets/${id}`;
  // ترفع ما ليس في المخزن بعد فقط (لا إعادة رفع في كل مزامنة)
  async function uploadAssets(id) {
    try {
      const local = await Store.getAssets(id);
      if (!local.size) return;
      const { data: listed } = await sb.storage.from(BUCKET).list(assetDir(id), { limit: 1000 });
      const have = new Set((listed || []).map((f) => f.name));
      for (const [name, blob] of local) {
        if (have.has(name)) continue;
        const { error } = await sb.storage.from(BUCKET).upload(`${assetDir(id)}/${name}`, blob, { upsert: true, contentType: blob.type || 'image/jpeg' });
        if (error) console.warn('asset upload', name, error.message);
      }
    } catch (e) { console.warn('uploadAssets', e); }
  }
  // تنزيل صور الكتاب الغائبة عن هذا الجهاز (عند فتحه)
  async function ensureAssets(id) {
    if (!ready || !user) return;
    const b = await Store.getBook(id);
    if (!b || !b.assets || !b.assets.length) return;
    const local = await Store.getAssets(id);
    const missing = b.assets.filter((a) => !local.has(a.name));
    if (!missing.length) return;
    setStatus('syncing', 'جارٍ تنزيل صور الكتاب…');
    await Promise.all(missing.map(async (a) => {
      try {
        const { data, error } = await sb.storage.from(BUCKET).download(`${assetDir(id)}/${a.name}`);
        if (!error && data && data.size) await Store.putAsset(id, a.name, data);
      } catch {}
    }));
    emitStatus();
  }

  async function deleteBook(id) {
    if (!ready || !user) return;
    try {
      await removeBookFiles(id);
      // صور الكتاب (إن وُجدت)
      try {
        const { data: listed } = await sb.storage.from(BUCKET).list(assetDir(id), { limit: 1000 });
        if (listed && listed.length) await sb.storage.from(BUCKET).remove(listed.map((f) => `${assetDir(id)}/${f.name}`));
      } catch {}
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

  /* ── تنزيل المحتوى/الملف عند الحاجة (كسول) ──
     يُرجع سبباً محدّداً حين لا يتوفّر الملف كي يعرض القارئ رسالة صادقة:
     'ok' | 'off' (لا مزامنة) | 'signedout' | 'offline' | 'missing' (لم يُرفع) | 'toobig' | 'error' */
  let lastPayloadError = '';
  const httpErr = (r) => Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });

  /* تنزيل مجزّأ: رابط موقّع + طلبات Range بقطع 2 م.ب، لكلٍّ منها محاولاتها الخاصة.
     انقطاع عابر يعيد قطعة واحدة لا الملف كله، ويظهر التقدّم بالنسبة المئوية.
     الرابط الموقّع لا يحتاج ترويسة Authorization، فلا طلب تمهيدي (preflight) يُعرقل. */
  async function downloadChunked(path, knownSize, onProgress) {
    const { data: sg, error: se } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (se) throw se; // «Object not found» ⇒ يعالجه المستدعي كملف غير مرفوع
    const url = sg.signedUrl;
    let size = knownSize || 0;
    if (!size) {
      const dir = path.slice(0, path.lastIndexOf('/')), name = path.slice(path.lastIndexOf('/') + 1);
      try {
        const { data } = await sb.storage.from(BUCKET).list(dir, { search: name, limit: 10 });
        const f = (data || []).find((x) => x.name === name);
        size = (f && f.metadata && f.metadata.size) || 0;
      } catch {}
      lastSize = size;
    }
    if (!size) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw httpErr(r); return await r.blob(); }
    const CH = 2 * 1024 * 1024, parts = [];
    let got = 0;
    while (got < size) {
      const end = Math.min(size, got + CH) - 1;
      let part = null, err = null;
      for (let a = 0; a < 5 && !part; a++) {
        try {
          const r = await fetch(url, { headers: { Range: `bytes=${got}-${end}` }, cache: 'no-store' });
          if (r.status === 200) { const whole = await r.blob(); if (whole.size === size) return whole; throw new Error('range ignored'); }
          if (r.status !== 206) throw httpErr(r);
          part = await r.blob();
          if (!part.size) { part = null; throw new Error('empty chunk'); }
        } catch (e) { err = e; if (e && (e.status === 400 || e.status === 404)) throw e; if (!navigator.onLine) break; await sleep(600 * (a + 1)); }
      }
      if (!part) throw err || new Error('chunk failed');
      parts.push(part); got += part.size;
      if (onProgress) onProgress(got / size);
    }
    return new Blob(parts, { type: 'application/pdf' });
  }
  async function ensurePayload(id, opts = {}) {
    if (initDone) { try { await initDone; } catch {} }
    if (!ready) return 'off';
    if (!user) return 'signedout';
    const b = await Store.getBook(id);
    if (!b) return 'error';
    const have = await Store.getPayload(id);

    // كتاب نصي: المحتوى في عمود content (لم يعُد يُجلب في المزامنة) — اجلبه الآن
    if (b.type !== 'pdf') {
      if (have != null) return 'ok';
      const c = await fetchContent(id);
      if (typeof c === 'string') { await Store.updatePayload(id, c); return 'ok'; }
      return navigator.onLine ? 'missing' : 'offline';
    }

    // كتاب مصوّر: استعد نص الـOCR من content إن غاب (يُفعّل البحث/الذكاء/النسخة النصية)
    try { if (!(await Store.getFulltext(id))) { const c = await fetchContent(id); if (c) { const ft = JSON.parse(c); if (ft && ft.text != null) await Store.saveFulltext(id, ft); } } } catch {}

    if (have != null) return 'ok'; // الملف موجود محلياً
    if (!navigator.onLine) return 'offline';
    const quiet = !!opts.quiet;
    if (!quiet) setStatus('syncing', 'جارٍ تنزيل الكتاب…');
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // المحاولة الأولى بالتنزيل المجزّأ (يصمد أمام انقطاع الاتصال وبرامج اعتراض التنزيل)،
        // ثم بطريقة المكتبة العادية احتياطاً
        let data;
        if (sb.isDrive || attempt === 0 || attempt === 2) data = await downloadBookFile(id, quiet);
        else {
          const r = await sb.storage.from(BUCKET).download(`${user.id}/${id}`);
          if (r.error) throw r.error;
          data = r.data;
        }
        if (!data || data.size === 0) throw Object.assign(new Error('empty file'), { status: 404 });
        await Store.updatePayload(id, data); // Blob
        if (b.cloudHasFile === false) await Store.updateBook(id, { cloudHasFile: true });
        if (!quiet) setStatus('synced', syncedMsg());
        return 'ok';
      } catch (e) {
        lastErr = e;
        const st = Number((e && (e.status || e.statusCode)) || 0);
        const msg = String((e && e.message) || e || '');
        if (st === 400 || st === 404 || /not.?found|does not exist|empty file/i.test(msg)) {
          // الملف غير موجود في المخزن — علّم السحابة كي يعيد الجهاز الذي يملكه رفعه تلقائياً عند مزامنته
          console.warn('download payload: not in storage', id, msg);
          await setHasFile(id, false);
          if (!quiet) emitStatus();
          return b.fileError === 'size' ? 'toobig' : 'missing';
        }
        // الجلسة انتهت: جدّدها ثم أعد المحاولة
        if (st === 401 || st === 403 || /jwt|token|unauthori[sz]ed/i.test(msg)) { try { await sb.auth.refreshSession(); } catch {} }
        if (st === 401 && sb.isDrive && !user) break; // أُلغي إذن Google
        if (!navigator.onLine) break;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    console.error('download payload', lastErr);
    lastPayloadError = String((lastErr && (lastErr.message || lastErr.error)) || lastErr || '');
    if (lastSize) lastPayloadError += ` · ${(lastSize / 1048576).toFixed(1)} م.ب`;
    if (!quiet) emitStatus();
    return navigator.onLine ? 'error' : 'offline';
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
        const res = await applyCloudRow(row); // يعالج deleted والدمج داخلياً
        // إن كان لدى هذا الجهاز عناصر ليست في الوارد، ارفع الدمج ليتقارب الطرفان
        if (res && res.divergedFromCloud && !row.deleted) pushStateNow(row.id);
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { if (window.Library) Library.refresh(); }, 400);
      })
      .subscribe();
  }

  return {
    init, configure, disconnect, isConfigured, isSignedIn,
    signIn, signUp, signOut, syncAll, onStatus,
    pushBook, pushMeta, pushState, ensureAssets, pushDeck, pushStats, syncStats, syncSettings, deleteBook, ensurePayload,
    lastPayloadError: () => lastPayloadError,
    // Google Drive + حالة السحابة + دون اتصال
    googleAvailable, signInGoogle, provider: () => (sb && sb.isDrive ? 'drive' : (isConfigured() ? 'supabase' : 'none')),
    storageReport, uploadPending, downloadBooks, offlinePrefs, setOffline,
    getUserEmail: () => (user ? user.email : null),
    getLastSync: () => lastSyncAt,
    hasBuiltin,
    // المساعد متاح بمفتاح المستخدم الخاص، أو بحساب في مشروعٍ فيه دالة الذكاء
    aiReady: () => !!(window.AIDirect && AIDirect.hasKey()) || (ready && !!user && !(sb && sb.isDrive)),
    usingOwnAiKey: () => !!(window.AIDirect && AIDirect.hasKey()),
    useBuiltin,
    aiInvoke,
    // الدوال العامة (شبكة الفكر/نرجس/الجلب) تعمل لكل الزوار عبر المشروع المضمّن
    fnReady: () => !!fnBase(),
    invokeFn, invokeFnRaw,
  };

  /* ── نداء دالة طرفية عامة (JSON) — لا تتطلّب تسجيل دخول ── */
  /* ── نداء الدوال الطرفية ──
     الدوال العامة تُطلب من المشروع المضمّن (فتعمل للزائر بلا حساب). إن كان المستخدم مسجّلاً
     في المشروع نفسه نرسل رمز جلسته (فيُعامَل صاحبَ حساب: إضافة من أي رابط، والمساعد). */
  // دالة (لا const): هذا الجزء يقع بعد return الوحدة، فلا يُرفع إلا ما عُرّف بـ function
  function fnBase() { return builtinCfg() || cfg || getCfg(); }
  async function bearerFor(base) {
    try {
      if (sb && cfg && base && cfg.url === base.url) {
        const { data } = await sb.auth.getSession();
        if (data && data.session && data.session.access_token) return data.session.access_token;
      }
    } catch {}
    return base.anonKey;
  }
  async function callFn(name, body) {
    const base = fnBase();
    if (!base) throw new Error('هذا المصدر يحتاج خادم التطبيق، وهو غير مضبوط في هذه النسخة');
    return fetch(`${base.url}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await bearerFor(base)}`, 'apikey': base.anonKey },
      body: JSON.stringify(body),
    });
  }

  async function invokeFn(name, body) {
    // الصوت الطبيعي وغيره من نداءات «ai»: بمفتاح المستخدم الخاص إن وُجد
    if (name === 'ai' && window.AIDirect && AIDirect.hasKey()) return AIDirect.invoke(body);
    let r;
    try { r = await callFn(name, body); }
    catch (e) { throw new Error(/fetch/i.test(String(e && e.message)) ? 'تعذّر الوصول إلى الخادم — تحقّق من الاتصال' : (e.message || String(e))); }
    let data = null; try { data = await r.json(); } catch {}
    if (!r.ok || (data && data.error)) {
      let msg = (data && data.error) || `تعذّر الاتصال بالخادم (${r.status})`;
      if (r.status === 404 && !(data && data.error)) msg = `الدالة «${name}» غير منشورة بعد في المشروع — انشرها ثم أعد المحاولة`;
      throw new Error(msg);
    }
    return data;
  }

  /* ── نداء دالة طرفية وإرجاع الاستجابة الخام (للملفات الثنائية) ── */
  async function invokeFnRaw(name, body) { return callFn(name, body); }

  /* ── نداء دالة الذكاء الطرفية ── */
  async function aiInvoke(body) {
    if (window.AIDirect && AIDirect.hasKey()) { const r = await AIDirect.invoke(body); return (r && r.text) || ''; }
    if (!ready || !user || (sb && sb.isDrive)) throw new Error('المساعد الذكي يحتاج مفتاح Gemini الخاص بك — من القائمة ⋮ ← «🤖 الذكاء الاصطناعي»');
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
