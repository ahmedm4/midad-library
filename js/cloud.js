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
  const getCfg = () => {
    try { const ls = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); if (ls && ls.url) return ls; } catch {}
    return builtinCfg();
  };
  const isConfigured = () => !!getCfg();
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
        if (!lb) { await applyCloudRow(r); continue; } // كتاب جديد من السحابة (يدمج الحالة داخلياً)
        const cloudT = new Date(r.updated_at).getTime();
        const localT = lb.updatedAt || 0;
        if (cloudT > localT + 1500) {
          // ميتا السحابة أحدث ⇒ اعتمدها + ادمج الحالة والبطاقات؛ إن أضاف الدمج جديداً ارفعه
          const res = await applyCloudRow(r);
          const deckAhead = await mergeDeckInto(r.id, r.deck);
          if ((res && res.divergedFromCloud) || deckAhead) await pushStateNow(r.id);
          continue;
        }
        // الطرفان موجودان والميتا المحلية ليست أقدم: ادمج الحالة دون تبديل الميتا
        const localState = await Store.getState(r.id);
        const cloudState = { ...(r.state || {}), bookId: r.id };
        const merged = mergeStates(localState, cloudState);
        const mSig = stateSig(merged);
        if (mSig !== stateSig(localState)) await Store.saveState(merged);
        const deckAhead = await mergeDeckInto(r.id, r.deck); // بطاقات المراجعة تُدمج كذلك
        if (localT > cloudT + 1500) await uploadBook(r.id, { silent: true }); // الميتا المحلية أحدث ⇒ ارفع الكل (مع الحالة والبطاقات المدموجة)
        else if (mSig !== stateSig(cloudState) || deckAhead) await pushStateNow(r.id); // الدمج أضاف ما ليس في السحابة
      }
      // ② محلي → سحابة: كتب لم تُرفع بعد، وإعادة رفع ملف PDF ناقص
      for (const b of localBooks) {
        const r = cloudById.get(b.id);
        if (!r) { await uploadBook(b.id, { silent: true }); continue; }
        if (!r.deleted && b.type === 'pdf' && !r.has_file) {
          const pl = await Store.getPayload(b.id);
          if (pl instanceof Blob) await uploadBook(b.id, { silent: true });
        }
      }
      await syncStats(); // سجلّ القراءة اليومي (السلسلة والهدف عبر الأجهزة)
      await syncSettings(); // تفضيلات القراءة وسمة المكتبة
      lastSyncAt = Date.now();
      setStatus('synced', syncedMsg());
      if (window.Library) Library.refresh();
    } catch (e) {
      console.error('syncAll', e);
      setStatus('error', friendlyErr(e));
    } finally { syncing = false; }
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
      Store.setRemoteLog(remote);
      // الهدف اليومي: أحدث ضبط بين الأجهزة يفوز
      if (bestGoal && bestGoalAt > (Store.getGoalAt ? Store.getGoalAt() : 0)) Store.adoptGoal(bestGoal, bestGoalAt);

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
      if (window.Library && Library.refresh) Library.refresh();
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
      setStatus('synced', syncedMsg());
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
    pushBook, pushState, pushDeck, pushStats, syncStats, syncSettings, deleteBook, ensurePayload,
    getUserEmail: () => (user ? user.email : null),
    getLastSync: () => lastSyncAt,
    hasBuiltin,
    aiReady: () => ready && !!user,
    aiInvoke,
    fnReady: () => ready,
    invokeFn, invokeFnRaw,
  };

  /* ── نداء دالة طرفية عامة (JSON) — لا تتطلّب تسجيل دخول ── */
  async function invokeFn(name, body) {
    if (!ready) throw new Error('فعّل المزامنة السحابية أولاً (زر ☁️) لاستخدام هذا المصدر');
    const { data, error } = await sb.functions.invoke(name, { body });
    if (error) {
      let msg = error.message || 'تعذّر الاتصال بالخادم';
      try { const ctx = await error.context.json(); if (ctx && ctx.error) msg = ctx.error; } catch {}
      if (/not found|404|failed to send|failed to fetch|non-2xx/i.test(msg)) msg = `الدالة «${name}» غير منشورة بعد في مشروعك — انشرها ثم أعد المحاولة`;
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  /* ── نداء دالة طرفية وإرجاع الاستجابة الخام (للملفات الثنائية) ── */
  async function invokeFnRaw(name, body) {
    if (!cfg) throw new Error('فعّل المزامنة السحابية أولاً (زر ☁️)');
    return fetch(`${cfg.url}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.anonKey}`, 'apikey': cfg.anonKey },
      body: JSON.stringify(body),
    });
  }

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
