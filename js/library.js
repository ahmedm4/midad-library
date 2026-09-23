/* ═══════ مِداد — واجهة المكتبة ═══════ */
const Library = (() => {
  const CATEGORIES = ['رواية', 'دين', 'تاريخ', 'علوم', 'تطوير ذات', 'أدب وشعر', 'أطفال', 'أخرى'];
  // خطوط الكتاب (تُطبَّق في المحرّر والمعاينة وتصدير PDF) — متوافقة مع خطوط القارئ
  const BOOK_FONTS = [
    { css: "'Noto Naskh Arabic', serif", label: 'نسخ' },
    { css: "'Amiri', serif", label: 'أميري' },
    { css: "'Scheherazade New', serif", label: 'شهرزاد' },
    { css: "'Markazi Text', serif", label: 'مركزي' },
    { css: "'Lateef', serif", label: 'لطيف' },
    { css: "'El Messiri', sans-serif", label: 'المسيري' },
    { css: "'IBM Plex Sans Arabic', sans-serif", label: 'IBM بلكس' },
    { css: "'Tajawal', sans-serif", label: 'تجوّل' },
    { css: "'Cairo', sans-serif", label: 'القاهرة' },
    { css: "'Almarai', sans-serif", label: 'المراعي' },
    { css: "'Reem Kufi', sans-serif", label: 'ريم كوفي' },
    { css: "'Aref Ruqaa', serif", label: 'رقعة' },
  ];
  const FONT_LINK = 'https://fonts.googleapis.com/css2?family=Almarai:wght@400;700;800&family=Amiri:ital,wght@0,400;0,700;1,400&family=Aref+Ruqaa:wght@400;700&family=Cairo:wght@400;600;700&family=El+Messiri:wght@400;600;700&family=IBM+Plex+Sans+Arabic:wght@400;600;700&family=Lateef:wght@400;700&family=Markazi+Text:wght@400;600;700&family=Noto+Naskh+Arabic:wght@400;600;700&family=Reem+Kufi:wght@400;600;700&family=Scheherazade+New:wght@400;700&family=Tajawal:wght@400;500;700&display=swap';
  // ألوان الورق الفاتحة لتصدير PDF (تطابق سمات القارئ) — [ورق، حبر]
  const PAPER_THEMES = {
    white: ['#fbfaf6', '#22201c'], cream: ['#f9f0dc', '#3c2f1d'], sepia: ['#f4e4c9', '#43301a'],
    aged: ['#ece0c2', '#3d2c15'], rose: ['#f6e6e0', '#4a2f2a'], mint: ['#e3efe6', '#26382e'],
    kraft: ['#e6d3b0', '#3a2a15'], azure: ['#e9eef4', '#26333f'],
  };
  const COVER_PALETTES = [
    ['#3b2a5e', '#1d1436', '#c9a35f'], ['#5e2a3b', '#361420', '#e0b070'],
    ['#1e4a4a', '#0e2626', '#8fd0c0'], ['#5e4a1e', '#33280d', '#f0d78c'],
    ['#2a3b5e', '#141d36', '#9fb8e8'], ['#4a1e5e', '#280d33', '#d79ce8'],
    ['#1e5e35', '#0d331c', '#9ce8b4'], ['#5e351e', '#33200d', '#e8b89c'],
  ];
  const ORNAMENTS = ['❁', '✦', '☙', '❖', '✤', '𓂃', '⁂', '✾'];

  let books = [];
  let states = {};
  let activeCat = 'الكل';
  let query = '';
  let sort = 'recent';
  let viewMode = (() => { try { return localStorage.getItem('midad-view') || 'grid'; } catch { return 'grid'; } })();
  let pairView = (() => { try { return localStorage.getItem('midad-pairview') || 'both'; } catch { return 'both'; } })(); // both | pdf | text
  const CHUNK = 40;           // عدد الكتب في كل دفعة عرض (تحميل تدريجي)
  let curList = [], renderCursor = 0, gridSentinel = null, gridObserver = null;
  let pendingFile = null;   // {kind:'pdf'|'text', blob?, text?, cover?}
  let pendingCover = null;  // غلاف مخصص اختاره المستخدم (dataURL)
  let editingId = null;
  let origText = null;      // النص الأصلي عند تحرير كتاب نصي (لكشف التغيير)
  const STATUS_FAV = '⭐ المفضلة', STATUS_READING = '📖 قيد القراءة', STATUS_DONE = '✅ مكتملة', STATUS_UNREAD = '🆕 لم تبدأ';
  const SHELF_PREFIX = 'shelf:'; // قيمة data-cat للرفوف المخصصة
  const SERIES_PREFIX = 'series:'; // قيمة activeCat لعرض أجزاء سلسلة واحدة

  /* ─── السلاسل: أجزاء الكتاب الواحد (مثل «الغدير» بأجزائه الـ11) تُعامَل ككتاب واحد ───
     مصدر الانتماء: meta.series (يُكتب عند الاستيراد من «شبكة الفكر»)، أو — للأجزاء المستوردة
     قبل ذلك — صيغة العنوان «الأصل — الجزء 3». لا تُعدّ سلسلةً إلا مجموعةٌ من جزأين فأكثر. */
  let seriesMap = new Map(); // key → { key, title, parts: [كتب مرتّبة] }
  let seriesOfBook = {};     // bookId → key
  const normKey = (x) => String(x || '').replace(/ـ/g, '').replace(/\s+/g, ' ').trim();
  const PART_TITLE_RE = /^(.+?)\s+—\s+((?:الجزء|الجزآن|الأجزاء)\s+\d{1,3}(?:\s*[–-]\s*\d{1,3})?(?:\s*·\s*القسم\s+\d{1,2})?)\s*$/;
  // ترتيب الجزء من تسميته: «الجزء 3 · القسم 2» ⇒ 302 ، «الجزآن 9–10» ⇒ 900
  const orderOfLabel = (label) => {
    const m = String(label || '').match(/(?:الجزء|الجزآن|الأجزاء)\s+(\d{1,3})(?:\s*[–-]\s*\d{1,3})?(?:\s*·\s*القسم\s+(\d{1,2}))?/);
    return m ? (+m[1]) * 100 + (m[2] ? +m[2] : 0) : -1;
  };
  function partOf(b) {
    if (b.series && b.series.none) return null; // أُخرج يدوياً من السلسلة
    if (b.series && b.series.key) {
      const o = orderOfLabel(b.series.label);
      return { key: normKey(b.series.key), title: b.series.title || '', label: b.series.label || '', order: o >= 0 ? o : (+b.series.order || 0) * 100 };
    }
    const m = String(b.title || '').match(PART_TITLE_RE);
    if (!m) return null;
    return { key: normKey(m[1]), title: m[1].trim(), label: m[2], order: orderOfLabel(m[2]) };
  }
  function buildSeries() {
    const groups = new Map();
    for (const b of books) {
      const pt = partOf(b); if (!pt) continue;
      if (!groups.has(pt.key)) groups.set(pt.key, { key: pt.key, title: pt.title, parts: [] });
      groups.get(pt.key).parts.push(b);
    }
    seriesMap = new Map(); seriesOfBook = {};
    for (const [k, g] of groups) {
      if (g.parts.length < 2) continue; // جزء وحيد ⇒ يبقى كتاباً عادياً
      g.parts.sort((a, b) => (partOf(a).order - partOf(b).order) || a.title.localeCompare(b.title, 'ar'));
      seriesMap.set(k, g);
      for (const b of g.parts) seriesOfBook[b.id] = k;
    }
  }
  // تقدّم السلسلة: متوسط تقدّم أجزائها (المكتمل = 1)
  function seriesStats(sr) {
    let sum = 0, done = 0, lastRead = 0, seconds = 0;
    for (const b of sr.parts) {
      const st = states[b.id] || {};
      sum += st.finished ? 1 : (st.pct || 0);
      if (st.finished) done++;
      lastRead = Math.max(lastRead, st.lastRead || 0);
      seconds += st.seconds || 0;
    }
    const total = sr.parts.length;
    return { pct: sum / total, done, total, lastRead, seconds, finished: done === total, started: lastRead > 0 || sum > 0 };
  }
  // الجزء الذي يُواصَل منه: آخر جزء قُرئ إن لم يكتمل، وإلا أول جزء غير مكتمل بعده
  function currentPart(sr) {
    const read = sr.parts.filter((b) => (states[b.id] || {}).lastRead).sort((a, b) => states[b.id].lastRead - states[a.id].lastRead);
    const unfinished = (b) => !(states[b.id] || {}).finished;
    if (!read.length) return sr.parts.find(unfinished) || sr.parts[0];
    const last = read[0];
    if (unfinished(last)) return last;
    const i = sr.parts.indexOf(last);
    return sr.parts.slice(i + 1).find(unfinished) || sr.parts.find(unfinished) || null;
  }
  const partLabelOf = (b) => { const pt = partOf(b); return (pt && pt.label) || b.title; };
  const partsWord = (n) => (n === 2 ? 'جزآن' : n <= 10 ? `${n} أجزاء` : `${n} جزءاً`);
  // للقارئ: معلومات الجزء والجزء التالي
  function partInfo(bookId) {
    const k = seriesOfBook[bookId]; if (!k) return null;
    const sr = seriesMap.get(k); const i = sr.parts.findIndex((b) => b.id === bookId);
    return { key: k, title: sr.title, label: partLabelOf(sr.parts[i]), index: i + 1, total: sr.parts.length };
  }
  function nextPartOf(bookId) {
    const k = seriesOfBook[bookId]; if (!k) return null;
    const sr = seriesMap.get(k); const i = sr.parts.findIndex((b) => b.id === bookId);
    const nx = sr.parts[i + 1]; if (!nx) return null;
    return { id: nx.id, label: partLabelOf(nx), title: sr.title, index: i + 2, total: sr.parts.length };
  }
  // عنصر الشبكة الممثّل للسلسلة كلها
  function seriesItem(sr) {
    const first = sr.parts[0];
    return { id: SERIES_PREFIX + sr.key, __series: sr.key, title: sr.title, author: first.author, category: first.category,
      type: first.type, cover: first.cover, fav: sr.parts.some((b) => b.fav), addedAt: Math.max(...sr.parts.map((b) => b.addedAt || 0)) };
  }
  function collapseSeries(list) {
    const out = [], seen = new Set();
    for (const b of list) {
      const k = seriesOfBook[b.id];
      if (!k) { out.push(b); continue; }
      if (seen.has(k)) continue;
      seen.add(k); out.push(seriesItem(seriesMap.get(k)));
    }
    return out;
  }

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ─── نافذة تأكيد أنيقة (بديل confirm) — تُعيد Promise<boolean> ─── */
  function uiConfirm(message, opts = {}) {
    return new Promise((resolve) => {
      document.querySelectorAll('.ui-dialog').forEach((m) => m.remove());
      const { title = 'تأكيد', okText = 'متابعة', cancelText = 'إلغاء', danger = false, icon = '' } = opts;
      const overlay = document.createElement('div');
      overlay.className = 'ui-dialog';
      overlay.innerHTML = `
        <div class="ud-box" role="dialog" aria-modal="true">
          <div class="ud-icon${danger ? ' danger' : ''}">${icon || (danger ? '🗑' : '❔')}</div>
          <h3>${esc(title)}</h3>
          <p>${esc(message).replace(/\n/g, '<br>')}</p>
          <div class="ud-actions">
            <button class="ud-cancel">${esc(cancelText)}</button>
            <button class="ud-ok ${danger ? 'danger' : 'btn-gold'}">${esc(okText)}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const onKey = (e) => { if (e.key === 'Escape') done(false); else if (e.key === 'Enter') done(true); };
      const done = (v) => { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      overlay.querySelector('.ud-ok').onclick = () => done(true);
      overlay.querySelector('.ud-cancel').onclick = () => done(false);
      overlay.onclick = (e) => { if (e.target === overlay) done(false); };
      document.addEventListener('keydown', onKey);
      setTimeout(() => overlay.querySelector('.ud-ok').focus(), 60);
    });
  }

  /* ─── تهيئة ─── */
  async function init() {
    fillCategorySelect();
    wireTopbar();
    wireAddModal();
    wireLibMenu();
    wireGlobalDrop();
    wireCloud();
    await refresh();
  }

  /* ─── واجهة المزامنة السحابية ─── */
  function wireCloud() {
    if (!window.Cloud) return;
    const modal = $('#cloud-modal');
    $('#btn-cloud').onclick = openCloudModal;
    modal.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => (modal.hidden = true)));
    modal.onclick = (e) => { if (e.target === modal) modal.hidden = true; };

    fillCloudSteps();

    Cloud.onStatus((state, msg) => {
      $('#cloud-dot').className = 'cloud-dot ' + state;
      const line = $('#cloud-status-line');
      if (line) line.textContent = msg;
      // اجعل الحالة مقروءة دون فتح النافذة (تلميح زر السحابة)
      const cb = $('#btn-cloud'); if (cb) cb.title = msg;
      // إظهار الشاشة المناسبة
      const configured = Cloud.isConfigured();
      const signedIn = Cloud.isSignedIn();
      $('#cloud-setup').hidden = configured;
      $('#cloud-auth').hidden = !configured || signedIn;
      $('#cloud-account').hidden = !signedIn;
      // عند وجود إعداد مضمّن في التطبيق، لا حاجة لرابط «تغيير المشروع»
      if (Cloud.hasBuiltin && Cloud.hasBuiltin()) $('#cloud-reconfig').hidden = true;
      if (signedIn) {
        $('#cloud-user-email').textContent = Cloud.getUserEmail() || '';
      }
    });

    $('#cloud-connect').onclick = async () => {
      const url = $('#cloud-url').value, key = $('#cloud-key').value;
      try {
        $('#cloud-connect').textContent = 'جارٍ الربط…';
        await Cloud.configure(url, key);
        toast('تم ربط المشروع ✓ — الآن سجّل الدخول', 'gold');
      } catch (e) { toast(e.message || 'تعذّر الربط'); }
      finally { $('#cloud-connect').textContent = 'ربط المشروع'; }
    };
    $('#cloud-reconfig').onclick = () => { Cloud.disconnect(); };

    $('#cloud-signin').onclick = () => doAuth('signin');
    $('#cloud-signup').onclick = () => doAuth('signup');
    $('#cloud-password').onkeydown = (e) => { if (e.key === 'Enter') doAuth('signin'); };
    $('#cloud-signout').onclick = async () => { await Cloud.signOut(); toast('سُجّل الخروج من هذا الجهاز'); };
    $('#cloud-syncnow').onclick = async () => { toast('جارٍ المزامنة…'); await Cloud.syncAll(); };
  }

  async function doAuth(kind) {
    const email = $('#cloud-email').value.trim();
    const pass = $('#cloud-password').value;
    if (!email || !pass) return toast('أدخل البريد وكلمة المرور');
    const btn = kind === 'signin' ? $('#cloud-signin') : $('#cloud-signup');
    const orig = btn.textContent;
    btn.textContent = '…';
    try {
      if (kind === 'signup') {
        const r = await Cloud.signUp(email, pass);
        if (r === 'confirm') toast('أُرسل رابط تأكيد إلى بريدك — افتحه ثم سجّل الدخول', 'gold');
        else toast('أُنشئ حسابك وسُجّل دخولك ✓', 'gold');
      } else {
        await Cloud.signIn(email, pass);
        toast('أهلاً بك 👋 — جارٍ مزامنة مكتبتك', 'gold');
      }
    } catch (e) { toast(e.message || 'تعذّر الدخول'); }
    finally { btn.textContent = orig; }
  }

  function openCloudModal() { $('#cloud-modal').hidden = false; }

  function fillCloudSteps() {
    const rls = `-- انسخ هذا كاملاً في SQL Editor واضغط Run
-- (أسماء خاصة بمِداد؛ آمن مع أي تطبيق آخر في نفس المشروع)
create table if not exists midad_books (
  id text primary key,
  owner uuid references auth.users not null default auth.uid(),
  meta jsonb, state jsonb, content text,
  has_file boolean default false,
  deleted boolean default false,
  updated_at timestamptz default now()
);
alter table midad_books add column if not exists deleted boolean default false;
alter table midad_books enable row level security;
drop policy if exists "midad_own_books" on midad_books;
create policy "midad_own_books" on midad_books for all
  using (auth.uid() = owner) with check (auth.uid() = owner);
do $$ begin
  alter publication supabase_realtime add table midad_books;
exception when others then null; end $$;
-- سجلّ القراءة اليومي: صفّ لكل جهاز (الجمع بين الأجهزة يتم عند العرض)
create table if not exists midad_stats (
  owner uuid references auth.users not null default auth.uid(),
  device text not null,
  log jsonb default '{}'::jsonb,
  goal int, goal_at bigint default 0,
  updated_at timestamptz default now(),
  primary key (owner, device)
);
alter table midad_stats enable row level security;
drop policy if exists "midad_own_stats" on midad_stats;
create policy "midad_own_stats" on midad_stats for all
  using (auth.uid() = owner) with check (auth.uid() = owner);
insert into storage.buckets (id, name) values ('midad-files','midad-files')
  on conflict do nothing;
drop policy if exists "midad_own_files" on storage.objects;
create policy "midad_own_files" on storage.objects for all
  using (bucket_id='midad-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id='midad-files' and (storage.foldername(name))[1] = auth.uid()::text);`;
    $('#cloud-steps').innerHTML = `
      <li>افتح <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a> وسجّل دخولاً مجانياً، ثم <b>New project</b> (اختر أي اسم وكلمة مرور لقاعدة البيانات، وانتظر دقيقة حتى يجهز).</li>
      <li>من القائمة الجانبية: <b>Project Settings → API</b>. انسخ <code>Project URL</code> و<code>anon public</code> والصقهما في الحقلين أدناه.</li>
      <li>من <b>SQL Editor → New query</b>، الصق الكود التالي واضغط <b>Run</b>:
        <button class="cloud-copy" id="cloud-copy-sql">📋 نسخ الكود</button>
        <pre id="cloud-sql-block">${esc(rls)}</pre>
      </li>
      <li>من <b>Authentication → Sign In / Providers → Email</b>: أبقِ <b>Email</b> مفعّلاً، ويُستحسن إيقاف <b>Confirm email</b> لتسجيل دخول فوري بلا بريد تأكيد.</li>
      <li>ارجع هنا، الصق الرابط والمفتاح، اضغط «ربط المشروع»، ثم أنشئ حساباً بالبريد نفسه على كل أجهزتك.</li>`;
    setTimeout(() => {
      const cp = $('#cloud-copy-sql');
      if (cp) cp.onclick = () => { navigator.clipboard.writeText(rls).then(() => toast('نُسخ الكود ✓')); };
    }, 50);
  }

  async function refresh() {
    books = await Store.getBooks();
    lastDeep = null; // تغيّرت المكتبة ⇒ لا تُضيّق البحث بنتائج قديمة
    states = {};
    if (Store.getAllStates) {
      // جولة واحدة على مخزن الحالات ثم حالة فارغة لما لم يُقرأ بعد (بلا أي قراءة إضافية)
      for (const st of await Store.getAllStates()) states[st.bookId] = st;
      for (const b of books) if (!states[b.id]) states[b.id] = Store.blankState(b.id);
    } else {
      for (const b of books) states[b.id] = await Store.getState(b.id);
    }
    buildSeries();
    // سلسلة معروضة حُذفت أجزاؤها ⇒ عُد للمكتبة كلها
    if (activeCat.startsWith(SERIES_PREFIX) && !seriesMap.has(activeCat.slice(SERIES_PREFIX.length))) activeCat = 'الكل';
    // ثبّت أسماء الرفوف المكتشفة من الكتب محلياً (تدعم استمرارها والمزامنة عبر الأجهزة)
    if (Store.saveShelves) Store.saveShelves(allShelves());
    // احسب عدد بطاقات المراجعة المستحقّة (لشارة القائمة)
    try {
      const now = Date.now();
      const decks = Store.getAllDecks ? await Store.getAllDecks() : [];
      reviewDueCount = decks.reduce((n, d) => n + (d.cards || []).filter((c) => (c.due || 0) <= now).length, 0);
    } catch { reviewDueCount = 0; }
    render();
  }

  /* ─── العرض ─── */
  function render() {
    renderStats();
    renderHero();
    renderChips();
    renderGrid();
  }

  function renderStats() {
    const reading = books.filter((b) => states[b.id].pct > 0 && !states[b.id].finished).length;
    const done = books.filter((b) => states[b.id].finished).length;
    $('#lib-stats').innerHTML = `
      <span><b>${books.length}</b>كتاب</span>
      <span><b>${reading}</b>قيد القراءة</span>
      <span><b>${done}</b>مكتمل</span>`;
    const streak = Store.getStreak ? Store.getStreak() : 0;
    const chip = $('#streak-chip');
    if (chip) {
      chip.hidden = false;
      chip.className = 'streak-chip' + (streak > 0 ? '' : ' zero');
      chip.innerHTML = `🔥 ${streak}`;
      chip.onclick = () => openStats();
    }
  }

  // اقتراح كتاب لم يُبدأ بعد، مع تفضيل تصنيف آخر ما قرأه المستخدم
  function pickSuggestion(excludeId) {
    const exKey = excludeId && seriesOfBook[excludeId];
    const eligible = (b) => {
      const k = seriesOfBook[b.id]; if (!k) return true;
      const sr = seriesMap.get(k);
      return k !== exKey && sr.parts[0].id === b.id && !seriesStats(sr).started; // أول جزء من سلسلة لم تُبدأ
    };
    const unread = books.filter((b) => b.id !== excludeId && eligible(b) && !states[b.id].finished && !(states[b.id].pct > 0));
    if (!unread.length) return null;
    const readBooks = books.filter((b) => states[b.id].lastRead).sort((a, b) => states[b.id].lastRead - states[a.id].lastRead);
    const favCat = readBooks[0] && readBooks[0].category;
    const sameCat = unread.filter((b) => b.category === favCat);
    return (sameCat.length ? sameCat : unread).sort((a, b) => b.addedAt - a.addedAt)[0];
  }

  function renderHero() {
    const hero = $('#hero-continue');
    // المرشّحون: كتب مفردة قيد القراءة + سلاسل بجزئها الحالي (ولو لم يُبدأ بعد: «الجزء التالي»)
    const cands = [];
    for (const b of books) {
      if (seriesOfBook[b.id]) continue;
      const st = states[b.id];
      if (st.lastRead && !st.finished && st.pct > 0) cands.push({ book: b, t: st.lastRead });
    }
    for (const sr of seriesMap.values()) {
      const ss = seriesStats(sr);
      if (!ss.lastRead || ss.finished) continue;
      const cur = currentPart(sr);
      if (cur) cands.push({ book: cur, t: ss.lastRead, sr, ss });
    }
    cands.sort((a, b) => b.t - a.t);
    const top = cands[0];
    const last = top ? top.book : null;
    const sug = pickSuggestion(last ? last.id : null);
    if (!last && !sug) { hero.hidden = true; return; }
    hero.hidden = false;
    let html = '';
    if (last && top.sr) {
      // سلسلة: الجزء الحالي + تقدّم السلسلة كلها
      const ss = top.ss, pct = Math.round(ss.pct * 100), pi = partInfo(last.id);
      const started = (states[last.id].pct || 0) > 0;
      html += `
      <div class="continue-card" data-id="${last.id}">
        ${coverHTML(last, 'cc-cover')}
        <div class="cc-info">
          <div class="cc-label">✦ ${started ? 'واصل القراءة' : 'الجزء التالي'} · ${esc(pi.label)}</div>
          <h3>${esc(top.sr.title)}</h3>
          <div class="cc-author">${esc(last.author || '')}</div>
          <div class="cc-bar"><i style="width:${pct}%"></i></div>
          <div class="cc-pct">أنجزت ${pct}٪ من السلسلة · ${ss.done} من ${ss.total} مكتمل${ss.seconds ? ' · ' + fmtDuration(ss.seconds) + ' قراءة' : ''}</div>
        </div>
        <button class="btn-gold cc-btn">${started ? 'استئناف القراءة' : 'ابدأ ' + esc(pi.label)} ←</button>
      </div>`;
    } else if (last) {
      const st = states[last.id], pct = Math.round(st.pct * 100);
      html += `
      <div class="continue-card" data-id="${last.id}">
        ${coverHTML(last, 'cc-cover')}
        <div class="cc-info">
          <div class="cc-label">✦ واصل القراءة</div>
          <h3>${esc(last.title)}</h3>
          <div class="cc-author">${esc(last.author || '')}</div>
          <div class="cc-bar"><i style="width:${pct}%"></i></div>
          <div class="cc-pct">أنجزت ${pct}٪ ${st.seconds ? '· ' + fmtDuration(st.seconds) + ' قراءة' : ''}</div>
        </div>
        <button class="btn-gold cc-btn">استئناف القراءة ←</button>
      </div>`;
    }
    if (sug) {
      html += `
      <div class="suggest-card" data-id="${sug.id}">
        ${coverHTML(sug, 'sc-cover')}
        <div class="sc-info">
          <div class="sc-label">💡 اقرأ التالي</div>
          <h4>${esc(sug.title)}</h4>
          <div class="sc-author">${esc(sug.author || sug.category || '')}</div>
        </div>
      </div>`;
    }
    hero.innerHTML = html;
    const asButton = (el, fn, label) => {
      if (!el) return;
      el.setAttribute('role', 'button'); el.tabIndex = 0; el.setAttribute('aria-label', label);
      el.onclick = fn;
      el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
    };
    if (last) asButton(hero.querySelector('.continue-card'), () => openBook(last.id), `واصل قراءة «${last.title}»`);
    if (sug) asButton(hero.querySelector('.suggest-card'), () => openBook(sug.id), `اقرأ التالي: «${sug.title}»`);
  }

  // فتح آمن: أي خطأ يُغلق القارئ ويُظهر رسالة بدل ترك شاشة فارغة فوق المكتبة
  async function openBook(id, target) {
    try { await Reader.open(id, target); }
    catch (e) {
      console.error('فتح الكتاب', e);
      try { Reader.close(); } catch {}
      toast('تعذّر فتح الكتاب: ' + ((e && e.message) || 'خطأ غير معروف'));
    }
  }

  // اتحاد أسماء الرفوف: المحفوظة محلياً + المكتشفة من عضوية الكتب (تدعم المزامنة عبر الأجهزة)
  function allShelves() {
    const set = new Set(Store.getShelves ? Store.getShelves() : []);
    for (const b of books) for (const s of (b.shelves || [])) set.add(s);
    return [...set];
  }

  function renderChips() {
    // ── تبويبات رئيسية بارزة: حالة القراءة ──
    const tabs = ['الكل'];
    const items = collapseSeries(books);
    if (items.some(itReading)) tabs.push(STATUS_READING);
    if (items.some((it) => it.fav)) tabs.push(STATUS_FAV);
    if (items.some(itDone)) tabs.push(STATUS_DONE);
    if (items.some(itUnread)) tabs.push(STATUS_UNREAD);
    $('#status-tabs').innerHTML = tabs.map((c) => {
      const n = countFor(c);
      return `<button class="stab ${c === activeCat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}${n ? ` <i>${n}</i>` : ''}</button>`;
    }).join('');

    // ── تصنيفات الأنواع + الرفوف (تصفية ثانوية) ──
    const used = new Set(books.map((b) => b.category).filter(Boolean));
    let html = CATEGORIES.filter((c) => used.has(c))
      .map((c) => { const n = countFor(c); return `<button class="${c === activeCat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}${n ? ` <i>${n}</i>` : ''}</button>`; })
      .join('');
    const shelves = allShelves();
    if (shelves.length) {
      if (html) html += '<span class="chip-sep"></span>';
      html += shelves.map((s) => {
        const val = SHELF_PREFIX + s;
        const n = books.filter((b) => (b.shelves || []).includes(s)).length;
        return `<button class="shelf-chip ${val === activeCat ? 'active' : ''}" data-cat="${esc(val)}">📚 ${esc(s)}${n ? ` <i>${n}</i>` : ''}</button>`;
      }).join('');
    }
    $('#cat-chips').innerHTML = html;
    $('#cat-chips').hidden = !html;

    [...$('#status-tabs').querySelectorAll('button'), ...$('#cat-chips').querySelectorAll('button')]
      .forEach((btn) => { btn.onclick = () => setCat(btn.dataset.cat); });
  }

  // تغيير العرض (تصنيف/رفّ/سلسلة) مع إعادة البحث داخل النطاق الجديد إن كان هناك بحث
  function setCat(cat) {
    activeCat = cat;
    render();
    if (query.length >= 2) { clearTimeout(deepTimer); deepSearch(query); notesSearch(query); }
  }

  // «قيد القراءة» = كتاب فُتِح لمتابعته (له موضع محفوظ أو تاريخ فتح) ولم يكتمل
  const isReading = (b) => { const s = states[b.id]; return !s.finished && (s.pct > 0 || !!s.lastRead); };
  const isUnread = (b) => { const s = states[b.id]; return !s.finished && !(s.pct > 0) && !s.lastRead; };

  // حالة العنصر (كتاب أو سلسلة) — السلسلة: قيد القراءة إن بدأت ولم تكتمل كلها
  const stOf = (it) => (it.__series ? seriesStats(seriesMap.get(it.__series)) : states[it.id]);
  const itReading = (it) => (it.__series ? (() => { const x = stOf(it); return x.started && !x.finished; })() : isReading(it));
  const itUnread = (it) => (it.__series ? !stOf(it).started : isUnread(it));
  const itDone = (it) => !!stOf(it).finished;
  const isStatusTab = (c) => c === STATUS_FAV || c === STATUS_READING || c === STATUS_DONE || c === STATUS_UNREAD;

  // عدد العناصر ضمن تصنيف/حالة (السلسلة تُعدّ عنصراً واحداً كما تظهر في الشبكة)
  function countFor(cat) {
    const items = collapseSeries(books);
    if (cat === 'الكل') return items.length;
    if (cat === STATUS_FAV) return items.filter((it) => it.fav).length;
    if (cat === STATUS_READING) return items.filter(itReading).length;
    if (cat === STATUS_UNREAD) return items.filter(itUnread).length;
    if (cat === STATUS_DONE) return items.filter(itDone).length;
    return items.filter((it) => it.category === cat).length;
  }

  // يربط كل نسخة نصّية مُستخرَجة (OCR) بأصلها PDF: بالمرجع sourceId أو بلاحقة «— نص» عند غيابه
  function twinMaps() {
    const textTwinOf = {}; // pdfId -> textId (لهذا الـPDF نسخة نصية)
    const pdfOf = {};      // textId -> pdfId (هذه النسخة النصية مشتقّة من PDF)
    const pdfIds = new Set(books.filter((b) => b.type === 'pdf').map((b) => b.id));
    const pdfByTitle = {}; books.forEach((b) => { if (b.type === 'pdf') pdfByTitle[b.title] = b.id; });
    for (const b of books) {
      if (b.type !== 'text') continue;
      let src = (b.sourceId && pdfIds.has(b.sourceId)) ? b.sourceId : null;
      if (!src && /\s*—\s*نص\s*$/.test(b.title)) { const base = b.title.replace(/\s*—\s*نص\s*$/, ''); if (pdfByTitle[base]) src = pdfByTitle[base]; }
      if (src) { pdfOf[b.id] = src; textTwinOf[src] = b.id; }
    }
    return { textTwinOf, pdfOf };
  }
  const hasPairs = () => { const m = twinMaps(); return Object.keys(m.pdfOf).length > 0; };

  function visibleBooks() {
    let list = books.slice();
    // فلتر PDF/نص: يخفي أحد طرفَي الكتاب المزدوج (الأصل PDF ونسخته النصية)
    if (pairView !== 'both') {
      const { textTwinOf, pdfOf } = twinMaps();
      if (pairView === 'pdf') list = list.filter((b) => !pdfOf[b.id]);        // أخفِ النسخ النصية المشتقّة
      else if (pairView === 'text') list = list.filter((b) => !textTwinOf[b.id]); // أخفِ الأصل PDF الذي له نسخة نصية
    }
    const matchQ = (b) => !query || (b.title + ' ' + (b.author || '')).toLowerCase().includes(query.toLowerCase());
    // داخل سلسلة: أجزاؤها بترتيبها الطبيعي
    if (activeCat.startsWith(SERIES_PREFIX)) {
      const sr = seriesMap.get(activeCat.slice(SERIES_PREFIX.length));
      return sr ? sr.parts.filter((b) => list.includes(b) && matchQ(b)) : [];
    }
    const inShelf = activeCat.startsWith(SHELF_PREFIX);
    if (inShelf) { const sh = activeCat.slice(SHELF_PREFIX.length); list = list.filter((b) => (b.shelves || []).includes(sh)); }
    else if (!isStatusTab(activeCat) && activeCat !== 'الكل') list = list.filter((b) => b.category === activeCat);
    list = list.filter(matchQ);
    // داخل رفّ تظهر الأجزاء منفردة؛ وفي غيره تُطوى كل سلسلة في بطاقة واحدة
    let items = inShelf ? list : collapseSeries(list);
    if (activeCat === STATUS_FAV) items = items.filter((it) => it.fav);
    else if (activeCat === STATUS_READING) items = items.filter(itReading);
    else if (activeCat === STATUS_DONE) items = items.filter(itDone);
    else if (activeCat === STATUS_UNREAD) items = items.filter(itUnread);
    // رفّ يضمّ سلسلة واحدة فقط ⇒ ترتيب الأجزاء أوضح من أي فرز
    if (inShelf && items.length > 1) {
      const k = seriesOfBook[items[0].id];
      if (k && items.every((b) => seriesOfBook[b.id] === k)) return seriesMap.get(k).parts.filter((b) => items.includes(b));
    }
    const st = stOf;
    if (sort === 'recent') items.sort((a, b) => (st(b).lastRead || 0) - (st(a).lastRead || 0) || b.addedAt - a.addedAt);
    else if (sort === 'added') items.sort((a, b) => b.addedAt - a.addedAt);
    else if (sort === 'oldest') items.sort((a, b) => a.addedAt - b.addedAt);
    else if (sort === 'title') items.sort((a, b) => a.title.localeCompare(b.title, 'ar'));
    else if (sort === 'author') items.sort((a, b) => (a.author || 'ﻯ').localeCompare(b.author || 'ﻯ', 'ar') || a.title.localeCompare(b.title, 'ar'));
    else if (sort === 'progress') items.sort((a, b) => st(b).pct - st(a).pct);
    return items;
  }

  // بطاقة كتاب واحدة (تصلح للشبكة والمضغوط والقائمة — التخطيط عبر CSS)
  function bookCardHTML(b) {
    const st = states[b.id];
    const pct = Math.round(st.pct * 100);
    return `
      <article class="book-card" data-id="${b.id}">
        <div class="bk" data-label="افتح «${esc(b.title)}»${st.finished ? ' — مكتمل' : pct > 0 ? ' — ' + pct + '٪' : ''}">
          ${coverHTML(b)}
          <button class="bc-fav ${b.fav ? 'on' : ''}" title="${b.fav ? 'إزالة من المفضلة' : 'أضف إلى المفضلة'}">${b.fav ? '★' : '☆'}</button>
          ${st.finished ? '<span class="done-badge">✓ مكتمل</span>' : ''}
          <span class="type-badge">${b.type === 'pdf' ? 'PDF' : 'نص'}</span>
          ${pct > 0 && !st.finished ? `<div class="prog-ring" title="${pct}٪">
            <svg viewBox="0 0 36 36"><circle class="pr-bg" cx="18" cy="18" r="15.5"/><circle class="pr-fg" cx="18" cy="18" r="15.5" stroke-dasharray="${(pct * 0.974).toFixed(1)} 100"/></svg>
            <span>${pct}<i>٪</i></span>
          </div>` : ''}
        </div>
        <div class="bc-meta">
          <b>${esc(b.title)}</b>
          <span class="bc-author">${esc(b.author || '—')}</span>
          <span class="bc-extra">${esc(b.category || '')}${st.finished ? ' · ✓ مكتمل' : pct > 0 ? ' · ' + pct + '٪' : ' · لم تبدأ'}</span>
          <button class="bc-menu-btn" title="خيارات">⋯</button>
        </div>
      </article>`;
  }

  // بطاقة سلسلة: غلاف مكدّس + عدد الأجزاء + تقدّم السلسلة + زرّ «واصل» للجزء الحالي
  function seriesCardHTML(it) {
    const sr = seriesMap.get(it.__series);
    const ss = seriesStats(sr), cur = currentPart(sr);
    const pct = Math.round(ss.pct * 100);
    const curLbl = cur ? partLabelOf(cur) : '';
    const extra = ss.finished ? '✓ أنهيت كل الأجزاء'
      : ss.started ? `${esc(curLbl)} · ${ss.done} من ${ss.total} مكتمل` : `${partsWord(ss.total)} · لم تبدأ`;
    return `
      <article class="book-card series-card" data-series="${esc(sr.key)}">
        <div class="bk" data-label="${esc(sr.title)} — ${partsWord(ss.total)}، اعرض الأجزاء">
          ${coverHTML({ ...sr.parts[0], title: sr.title })}
          <span class="series-badge">📚 ${partsWord(ss.total)}</span>
          ${ss.finished ? '<span class="done-badge">✓ مكتملة</span>' : ''}
          ${pct > 0 && !ss.finished ? `<div class="prog-ring" title="${pct}٪ من السلسلة">
            <svg viewBox="0 0 36 36"><circle class="pr-bg" cx="18" cy="18" r="15.5"/><circle class="pr-fg" cx="18" cy="18" r="15.5" stroke-dasharray="${(pct * 0.974).toFixed(1)} 100"/></svg>
            <span>${pct}<i>٪</i></span>
          </div>` : ''}
          ${cur && !ss.finished ? `<button class="series-go" title="${ss.started ? 'واصل' : 'ابدأ'}: ${esc(curLbl)}" aria-label="${ss.started ? 'واصل' : 'ابدأ'} ${esc(curLbl)}">▶</button>` : ''}
        </div>
        <div class="bc-meta">
          <b>${esc(sr.title)}</b>
          <span class="bc-author">${esc(it.author || '—')}</span>
          <span class="bc-extra">${extra}</span>
          <button class="bc-menu-btn" title="خيارات السلسلة" aria-label="خيارات السلسلة">⋯</button>
        </div>
      </article>`;
  }
  const itemCardHTML = (it) => (it.__series ? seriesCardHTML(it) : bookCardHTML(it));

  function openSeriesView(key) {
    setCat(SERIES_PREFIX + key);
    const gh = document.querySelector('.grid-head');
    if (gh) window.scrollTo({ top: gh.getBoundingClientRect().top + window.scrollY - 70, behavior: 'smooth' });
  }
  function continueSeries(key) {
    const sr = seriesMap.get(key); if (!sr) return;
    const cur = currentPart(sr) || sr.parts[0];
    openBook(cur.id);
  }
  function openSeriesMenu(x, y, key) {
    closeCardMenu();
    const sr = seriesMap.get(key); if (!sr) return;
    const ss = seriesStats(sr), cur = currentPart(sr);
    const menu = document.createElement('div');
    menu.className = 'bc-menu';
    menu.innerHTML = `
      ${cur ? `<button data-act="go">▶ ${ss.started ? 'واصل' : 'ابدأ'}: ${esc(partLabelOf(cur))}</button>` : ''}
      <button data-act="view">📚 اعرض الأجزاء (${ss.total})</button>
      <button data-act="first">↺ من الجزء الأول</button>
      <button data-act="edit">✏️ تعديل السلسلة…</button>
      <button data-act="dissolve" class="danger">↩ فكّ السلسلة</button>`;
    document.body.appendChild(menu);
    menu.style.top = Math.min(y, innerHeight - menu.offsetHeight - 12) + 'px';
    menu.style.left = Math.min(Math.max(10, x - menu.offsetWidth + 30), innerWidth - menu.offsetWidth - 10) + 'px';
    menu.onclick = (e) => {
      const act = e.target.dataset.act; if (!act) return;
      closeCardMenu();
      if (act === 'go') continueSeries(key);
      else if (act === 'view') openSeriesView(key);
      else if (act === 'first') openBook(sr.parts[0].id);
      else if (act === 'edit') openSeriesEditor({ seriesKey: key });
      else if (act === 'dissolve') dissolveSeries(key);
    };
    setTimeout(() => document.addEventListener('pointerdown', (ev) => { if (!menu.contains(ev.target)) closeCardMenu(); }, { once: true }));
  }
  function wireSeriesCard(card) {
    const key = card.dataset.series;
    const bk = card.querySelector('.bk');
    bk.onclick = () => openSeriesView(key);
    coverAsButton(bk, () => openSeriesView(key));
    const go = card.querySelector('.series-go');
    if (go) go.onclick = (e) => { e.stopPropagation(); continueSeries(key); };
    card.querySelector('.bc-menu-btn').onclick = (e) => {
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      openSeriesMenu(r.left, r.bottom + 6, key);
    };
    card.oncontextmenu = (e) => { e.preventDefault(); openSeriesMenu(e.clientX, e.clientY, key); };
  }

  // الغلاف زرٌّ للوحة المفاتيح وقارئ الشاشة. (لا نضع الدور على الحاوية .bk لأنها تضمّ
  // أزراراً أخرى — المفضّلة و▶ — وأبناء role="button" يُعامَلون زخرفةً فيختفون عن قارئ الشاشة.)
  function coverAsButton(bk, fn) {
    const cov = bk.querySelector('img, .gen-cover');
    if (!cov) return;
    cov.setAttribute('role', 'button');
    cov.tabIndex = 0;
    cov.setAttribute('aria-label', bk.dataset.label || '');
    if (cov.tagName === 'IMG') cov.alt = '';
    cov.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
  }

  function wireCards(cards) {
    cards.forEach((card) => {
      if (card.dataset.series) { wireSeriesCard(card); return; }
      const id = card.dataset.id;
      const bk = card.querySelector('.bk');
      bk.onclick = () => openBook(id);
      coverAsButton(bk, () => openBook(id));
      card.querySelector('.bc-menu-btn').onclick = (e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        openCardMenu(r.left, r.bottom + 6, id);
      };
      card.querySelector('.bc-fav').onclick = async (e) => {
        e.stopPropagation();
        const b = books.find((x) => x.id === id);
        await Store.updateBook(id, { fav: !b.fav });
        b.fav = !b.fav;
        render();
      };
      card.oncontextmenu = (e) => { e.preventDefault(); openCardMenu(e.clientX, e.clientY, id); };
    });
  }

  // يعرض الدفعة التالية من الكتب (تحميل تدريجي)
  function renderChunk() {
    const grid = $('#book-grid');
    const slice = curList.slice(renderCursor, renderCursor + CHUNK);
    const tmp = document.createElement('div');
    tmp.innerHTML = slice.map((b) => itemCardHTML(b)).join('');
    const nodes = [...tmp.children];
    nodes.forEach((n) => grid.appendChild(n));
    wireCards(nodes);
    renderCursor += slice.length;
    // حرّك الحارس إلى نهاية الشبكة أو أزله عند اكتمال العرض
    if (renderCursor < curList.length) { grid.appendChild(gridSentinel); gridSentinel.hidden = false; }
    else if (gridSentinel) gridSentinel.hidden = true;
  }

  function renderGrid() {
    curList = visibleBooks();
    renderCursor = 0;
    const grid = $('#book-grid');
    grid.className = 'book-grid view-' + viewMode;
    $('#empty-state').hidden = books.length > 0;
    const inSeries = activeCat.startsWith(SERIES_PREFIX);
    const sr = inSeries ? seriesMap.get(activeCat.slice(SERIES_PREFIX.length)) : null;
    $('#grid-title').textContent = activeCat === 'الكل' ? 'كل الكتب'
      : sr ? '📚 ' + sr.title
      : activeCat.startsWith(SHELF_PREFIX) ? '📚 ' + activeCat.slice(SHELF_PREFIX.length) : activeCat;
    { const gc = $('#grid-count'); if (gc) gc.textContent = !curList.length ? '' : sr ? partsWord(curList.length) : curList.length + ' كتاب'; }
    renderSeriesBar(sr);
    renderSeriesSuggestion();
    { const pf = $('#pair-filter'); if (pf) pf.hidden = !hasPairs(); }
    grid.innerHTML = '';
    // وضع القائمة: مجموعات قابلة للطي (بلا تحميل تدريجي — صفوف خفيفة)
    if (viewMode === 'list') { renderListGrouped(); return; }
    // حارس التحميل التدريجي: مراقب تقاطع (الأجهزة الحقيقية) + احتياطي بالتمرير
    if (!gridSentinel) { gridSentinel = document.createElement('div'); gridSentinel.id = 'grid-sentinel'; }
    if (!gridObserver) {
      gridObserver = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) maybeLoadMore();
      }, { rootMargin: '800px 0px' });
      gridObserver.observe(gridSentinel);
      window.addEventListener('scroll', maybeLoadMore, { passive: true });
    }
    renderChunk();
  }

  /* ─── جمع كتب في سلسلة يدوياً ───
     للكتب المضافة قبل دعم السلاسل أو بعناوين حرّة: رقم الجزء يُستخرج من العنوان إن أمكن
     («ج7»، «الجزء 7»، «٧»، «الجزء السابع»، «(7)»)، والباقي يكتبه المستخدم. */
  const pushMetaOf = (id) => { if (window.Cloud) (Cloud.pushMeta || Cloud.pushBook)(id); };
  const toLatinDigits = (x) => String(x || '')
    .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
  // الأعداد الترتيبية: المركّبة قبل المفردة («الثاني عشر» قبل «الثاني»)
  const ORD_UNITS = ['(?:الأول|الاول|الأولى|الاولى)', '(?:الثاني|الثانية)', '(?:الثالث|الثالثة)', '(?:الرابع|الرابعة)',
    '(?:الخامس|الخامسة)', '(?:السادس|السادسة)', '(?:السابع|السابعة)', '(?:الثامن|الثامنة)', '(?:التاسع|التاسعة)', '(?:العاشر|العاشرة)'];
  const ORD_LIST = (() => {
    const L = [];
    L.push([30, '(?:الثلاثون|الثلاثين)']);
    for (let u = 9; u >= 1; u--) L.push([20 + u, `(?:${u === 1 ? '(?:الحادي|الحادية)' : ORD_UNITS[u - 1]})\\s*و\\s*(?:العشرون|العشرين)`]);
    L.push([20, '(?:العشرون|العشرين)']);
    for (let u = 9; u >= 2; u--) L.push([10 + u, `${ORD_UNITS[u - 1]}\\s+عشرة?`]);
    L.push([11, '(?:الحادي|الحادية)\\s+عشرة?']);
    for (let u = 10; u >= 1; u--) L.push([u, ORD_UNITS[u - 1]]);
    return L.map(([n, src]) => [n, new RegExp('^' + src + '(?![\\p{L}])', 'u')]);
  })();
  const ORD_ANY = ORD_LIST.map(([, re]) => re.source.slice(1).replace('(?![\\p{L}])', '')).join('|');
  const PART_WORD = '(?:الجزء|جزء|ج|المجلد|مجلد)';

  function detectPartNo(title) {
    const t = toLatinDigits(title).replace(/ـ/g, '');
    let m = t.match(new RegExp(`(?:^|[^\\p{L}])${PART_WORD}\\s*[.:\\-–]?\\s*0*(\\d{1,3})(?!\\d)`, 'u'));
    if (m) return +m[1];
    m = t.match(new RegExp(`(?:^|[^\\p{L}])(?:الجزء|جزء|المجلد|مجلد)\\s+(.{2,30})`, 'u'));
    if (m) for (const [n, re] of ORD_LIST) if (re.test(m[1])) return n;
    m = t.match(/[(\[]\s*0*(\d{1,3})\s*[)\]]\s*$/) || t.match(/[-–—_:\s]0*(\d{1,3})\s*$/);
    return m ? +m[1] : 0;
  }
  // الأصل المشترك للعنوان: بلا «الجزء 7»/«الجزء السابع»/«(7)» وما بعدها
  function guessBase(title) {
    const t = toLatinDigits(title).replace(/ـ/g, '');
    let b = t
      .replace(new RegExp(`(?:^|[^\\p{L}])${PART_WORD}\\s*[.:\\-–]?\\s*\\d{1,3}(?!\\d).*$`, 'u'), '')
      .replace(new RegExp(`(?:^|[^\\p{L}])(?:الجزء|جزء|المجلد|مجلد)\\s+(?:${ORD_ANY})(?![\\p{L}]).*$`, 'u'), '')
      .replace(/[(\[]\s*\d{1,3}\s*[)\]]\s*$/, '')
      .replace(/[-–—_:\s]\d{1,3}\s*$/, '')
      .replace(/[\s\-–—_:،,.]+$/, '').trim();
    return b || t.trim();
  }
  // مقارنة متسامحة: بلا تشكيل، وتوحيد الهمزات والتاء المربوطة والألف المقصورة
  const loose = (x) => String(x || '').replace(/[ً-ْٰـ]/g, '').replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim().toLowerCase();
  const sameBase = (a, b) => {
    const x = loose(a), y = loose(b);
    if (!x || !y) return false;
    if (x === y) return true;
    const [s, l] = x.length <= y.length ? [x, y] : [y, x];
    return s.length >= 4 && l.startsWith(s);
  };

  function openSeriesEditor({ seedId, seriesKey, preset } = {}) {
    document.querySelectorAll('.shelf-modal').forEach((m) => m.remove());
    const editing = seriesKey ? seriesMap.get(seriesKey) : (seedId && seriesOfBook[seedId] ? seriesMap.get(seriesOfBook[seedId]) : null);
    const seed = seedId ? books.find((b) => b.id === seedId) : null;
    let name = editing ? editing.title : (seed ? guessBase(seed.title) : (preset && preset.name) || '');
    const rows = new Map(); // id → { on, n }
    if (editing) {
      // رقم الجزء من تسميته؛ فإن تكرّر (أقسام «الجزء 3 · القسم 1/2») نرقّم بالموضع.
      // التسمية الأصلية تُحفظ ما لم يغيّر المستخدم الرقم (فلا تضيع «· القسم 1»).
      let nums = editing.parts.map((b) => Math.floor(Math.max(0, partOf(b).order) / 100));
      if (nums.some((n) => !n) || new Set(nums).size !== nums.length) nums = editing.parts.map((_b, i) => i + 1);
      editing.parts.forEach((b, i) => rows.set(b.id, { on: true, n: nums[i], origN: nums[i], origLabel: partOf(b).label }));
    } else {
      const base = name;
      const ids = preset && preset.ids ? preset.ids : books.filter((b) => b.id === seedId || (!seriesOfBook[b.id] && sameBase(guessBase(b.title), base))).map((b) => b.id);
      for (const id of ids) { const b = books.find((x) => x.id === id); if (b) rows.set(id, { on: true, n: detectPartNo(b.title) || 0 }); }
    }
    const originalMembers = new Set(editing ? editing.parts.map((b) => b.id) : []);
    let filter = '';

    const overlay = document.createElement('div');
    overlay.className = 'shelf-modal series-modal';
    overlay.innerHTML = `
      <div class="sm-box" role="dialog" aria-modal="true" aria-labelledby="se-title">
        <div class="sm-head"><h3 id="se-title">📚 ${editing ? 'تعديل السلسلة' : 'اجمع في سلسلة'}</h3><button class="sm-close" title="إغلاق" aria-label="إغلاق">✕</button></div>
        <div class="se-top">
          <label class="se-name">اسم السلسلة<input type="text" class="sm-input se-name-in" maxlength="120" value="${esc(name)}" autocomplete="off"></label>
          <input type="search" class="sm-input se-filter" placeholder="🔎 ابحث عن كتاب لإضافته…" aria-label="ابحث عن كتاب لإضافته إلى السلسلة" autocomplete="off">
          <p class="se-hint">اختر الأجزاء واكتب رقم كل جزء. الرقم يُستخرج من العنوان تلقائياً إن وُجد، والفارغ يُرقَّم بالترتيب.</p>
        </div>
        <div class="sm-list se-list"></div>
        <div class="sm-add se-actions">
          ${editing ? '<button class="se-dissolve">↩ فكّ السلسلة</button>' : ''}
          <span class="se-count"></span>
          <button class="sm-add-btn btn-gold se-save">حفظ السلسلة</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const listEl = overlay.querySelector('.se-list');
    const countEl = overlay.querySelector('.se-count');
    const close = () => overlay.remove();
    overlay.querySelector('.sm-close').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };

    const renderRows = () => {
      const q = loose(filter);
      const chosen = books.filter((b) => rows.get(b.id)?.on)
        .sort((a, b) => ((rows.get(a.id).n || 9999) - (rows.get(b.id).n || 9999)) || a.title.localeCompare(b.title, 'ar'));
      // المرشّحون: عند البحث ما يطابقه، وإلا الكتب ذات العنوان المشابه للاسم (للإضافة السريعة)
      const others = books.filter((b) => !rows.get(b.id)?.on && (q ? loose(b.title + ' ' + (b.author || '')).includes(q) : sameBase(guessBase(b.title), name)))
        .slice(0, 60);
      const rowHTML = (b, on) => {
        const r = rows.get(b.id) || { n: detectPartNo(b.title) || 0 };
        const other = seriesOfBook[b.id] && (!editing || seriesOfBook[b.id] !== editing.key) ? seriesMap.get(seriesOfBook[b.id]).title : '';
        return `<div class="se-row${on ? ' on' : ''}" data-id="${b.id}">
          <input type="checkbox" ${on ? 'checked' : ''} aria-label="ضمّ «${esc(b.title)}» إلى السلسلة">
          <input type="number" class="se-no" min="1" max="999" inputmode="numeric" value="${r.n || ''}" placeholder="رقم" aria-label="رقم الجزء لـ «${esc(b.title)}»">
          <span class="se-t">${esc(b.title)}${other ? `<em>في سلسلة «${esc(other)}»</em>` : ''}</span>
        </div>`;
      };
      listEl.innerHTML = (chosen.length ? chosen.map((b) => rowHTML(b, true)).join('') : '<div class="sm-empty">لم تُختر أجزاء بعد — ابحث عن الكتب أعلاه.</div>')
        + (others.length ? `<div class="se-sep">${q ? 'نتائج البحث' : 'كتب بعناوين مشابهة'}</div>` + others.map((b) => rowHTML(b, false)).join('') : '');
      countEl.textContent = chosen.length ? `${chosen.length} ${chosen.length === 2 ? 'جزآن' : chosen.length <= 10 ? 'أجزاء' : 'جزءاً'}` : '';
      listEl.querySelectorAll('.se-row').forEach((row) => {
        const id = row.dataset.id;
        const b = books.find((x) => x.id === id);
        row.querySelector('input[type="checkbox"]').onchange = (e) => {
          const cur = rows.get(id) || { n: detectPartNo(b.title) || 0 };
          rows.set(id, { ...cur, on: e.target.checked });
          renderRows();
        };
        row.querySelector('.se-no').oninput = (e) => {
          const cur = rows.get(id) || { on: false, n: 0 };
          rows.set(id, { ...cur, n: Math.max(0, parseInt(toLatinDigits(e.target.value), 10) || 0) });
        };
      });
    };
    overlay.querySelector('.se-name-in').oninput = (e) => { name = e.target.value; if (!filter) renderRows(); };
    overlay.querySelector('.se-filter').oninput = (e) => { filter = e.target.value.trim(); renderRows(); };
    renderRows();
    setTimeout(() => overlay.querySelector(editing ? '.se-filter' : '.se-name-in').focus(), 60);

    overlay.querySelector('.se-save').onclick = async () => {
      const title = name.trim();
      const chosen = books.filter((b) => rows.get(b.id)?.on);
      if (!title) return toast('اكتب اسم السلسلة');
      if (chosen.length < 2) return toast('السلسلة تحتاج جزأين على الأقل');
      // الأرقام الفارغة تأخذ أول رقم متاح بترتيب العرض
      const used = new Set(chosen.map((b) => rows.get(b.id).n).filter((n) => n > 0));
      const dup = chosen.map((b) => rows.get(b.id).n).filter((n, i, a) => n > 0 && a.indexOf(n) !== i);
      if (dup.length) return toast(`رقم الجزء ${dup[0]} مكرّر — لكل جزء رقم مختلف`);
      let next = 1;
      for (const b of chosen) {
        const r = rows.get(b.id);
        if (!r.n) { while (used.has(next)) next++; r.n = next; used.add(next); }
      }
      const key = normKey(title);
      const btn = overlay.querySelector('.se-save');
      btn.disabled = true; btn.textContent = 'جارٍ الحفظ…';
      for (const b of chosen) {
        const r = rows.get(b.id), n = r.n;
        const label = (r.origLabel && r.n === r.origN) ? r.origLabel : `الجزء ${n}`;
        await Store.updateBook(b.id, { series: { key, title, label, order: n, total: chosen.length, src: 'manual' } });
        pushMetaOf(b.id);
      }
      // من أُزيل من السلسلة يُخرج صراحةً (كي لا تعيده صيغة عنوانه تلقائياً)
      for (const id of originalMembers) {
        if (!rows.get(id)?.on) { await Store.updateBook(id, { series: { none: true } }); pushMetaOf(id); }
      }
      close();
      await refresh();
      toast(`جُمعت ${chosen.length} ${chosen.length === 2 ? 'جزآن' : 'أجزاء'} في «${title}» 📚`, 'gold');
      if (seriesMap.has(key)) openSeriesView(key);
    };
    const dis = overlay.querySelector('.se-dissolve');
    if (dis) dis.onclick = async () => { close(); await dissolveSeries(editing.key); };
  }

  async function dissolveSeries(key) {
    const sr = seriesMap.get(key); if (!sr) return;
    if (!(await uiConfirm(`ستعود أجزاء «${sr.title}» (${sr.parts.length}) كتباً منفصلة. لن يُحذف أي كتاب ولا أي تقدّم.`, { title: 'فكّ السلسلة؟', okText: 'فكّ السلسلة', icon: '↩' }))) return;
    for (const b of sr.parts) { await Store.updateBook(b.id, { series: { none: true } }); pushMetaOf(b.id); }
    if (activeCat === SERIES_PREFIX + key) activeCat = 'الكل';
    await refresh();
    toast('فُكّت السلسلة — عادت أجزاؤها كتباً منفصلة');
  }
  async function removeFromSeries(id) {
    const b = books.find((x) => x.id === id); if (!b) return;
    await Store.updateBook(id, { series: { none: true } }); pushMetaOf(id);
    await refresh();
    toast(`أُخرج «${b.title}» من السلسلة`);
  }

  // اقتراح: كتب منفصلة تبدو أجزاءً من عمل واحد (أصل مشترك + رقمان مختلفان على الأقل)
  function seriesSuggestion() {
    let dismissed = {}; try { dismissed = JSON.parse(localStorage.getItem('midad-series-dismissed') || '{}'); } catch {}
    const groups = new Map();
    for (const b of books) {
      if (seriesOfBook[b.id] || (b.series && b.series.none)) continue;
      const n = detectPartNo(b.title); if (!n) continue;
      const base = guessBase(b.title); const k = loose(base);
      if (!k || k.length < 3 || dismissed[k]) continue;
      if (!groups.has(k)) groups.set(k, { key: k, name: base, items: [] });
      groups.get(k).items.push({ id: b.id, n });
    }
    const good = [...groups.values()].filter((g) => new Set(g.items.map((x) => x.n)).size >= 2);
    good.sort((a, b) => b.items.length - a.items.length);
    return good[0] || null;
  }
  function renderSeriesSuggestion() {
    const el = $('#series-suggest'); if (!el) return;
    const g = (activeCat === 'الكل' && !query) ? seriesSuggestion() : null;
    if (!g) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `
      <span class="ss-ico" aria-hidden="true">💡</span>
      <span class="ss-text">${g.items.length} كتب تبدو أجزاءً من «<b>${esc(g.name)}</b>»</span>
      <button class="btn-gold ss-go">اجمعها في سلسلة</button>
      <button class="ss-x" title="ليست سلسلة" aria-label="تجاهل هذا الاقتراح">✕</button>`;
    el.querySelector('.ss-go').onclick = () => openSeriesEditor({ preset: { name: g.name, ids: g.items.map((x) => x.id) } });
    el.querySelector('.ss-x').onclick = () => {
      let d = {}; try { d = JSON.parse(localStorage.getItem('midad-series-dismissed') || '{}'); } catch {}
      d[g.key] = 1; try { localStorage.setItem('midad-series-dismissed', JSON.stringify(d)); } catch {}
      renderSeriesSuggestion();
    };
  }

  // شريط أعلى عرض السلسلة: رجوع + تقدّم السلسلة + واصل من الجزء الحالي
  function renderSeriesBar(sr) {
    const bar = $('#series-bar');
    if (!bar) return;
    if (!sr) { bar.hidden = true; bar.innerHTML = ''; return; }
    const ss = seriesStats(sr), cur = currentPart(sr), pct = Math.round(ss.pct * 100);
    bar.hidden = false;
    bar.innerHTML = `
      <button class="sb-back" aria-label="رجوع إلى كل الكتب">→ كل الكتب</button>
      <div class="sb-prog">
        <div class="sb-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="تقدّم السلسلة"><i style="width:${pct}%"></i></div>
        <span>${ss.finished ? '✓ أنهيت كل الأجزاء' : `أنجزت ${pct}٪ · ${ss.done} من ${ss.total} مكتمل`}${ss.seconds ? ' · ' + fmtDuration(ss.seconds) : ''}</span>
      </div>
      <button class="sb-edit" aria-label="تعديل السلسلة">✏️ تعديل</button>
      ${cur ? `<button class="btn-gold sb-go">▶ ${ss.started ? 'واصل' : 'ابدأ'}: ${esc(partLabelOf(cur))}</button>` : ''}`;
    bar.querySelector('.sb-back').onclick = () => setCat('الكل');
    bar.querySelector('.sb-edit').onclick = () => openSeriesEditor({ seriesKey: sr.key });
    const go = bar.querySelector('.sb-go'); if (go) go.onclick = () => continueSeries(sr.key);
  }

  // يحمّل الدفعة التالية عند الاقتراب من نهاية القائمة (يعمل حتى لو تعذّر قياس الشاشة)
  function maybeLoadMore() {
    if (renderCursor >= curList.length) return;
    const se = document.scrollingElement || document.documentElement;
    const vh = window.innerHeight || document.documentElement.clientHeight || 800;
    if (se.scrollTop + vh >= se.scrollHeight - 800) renderChunk();
  }

  // حالة طيّ الأقسام (تُحفظ)
  function getCollapsed() { try { return JSON.parse(localStorage.getItem('midad-collapsed') || '{}'); } catch { return {}; } }
  function setCollapsed(c) { try { localStorage.setItem('midad-collapsed', JSON.stringify(c)); } catch {} }

  // وضع القائمة: يجمّع الكتب حسب التصنيف برؤوس أقسام قابلة للطي
  function renderListGrouped() {
    const grid = $('#book-grid');
    renderCursor = curList.length; // لا تحميل تدريجي هنا
    const groups = new Map();
    for (const b of curList) { const k = b.category || 'أخرى'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
    const collapsed = getCollapsed();
    grid.innerHTML = '';
    for (const [cat, arr] of groups) {
      const isC = !!collapsed[cat];
      const h = document.createElement('div');
      h.className = 'list-section-h' + (isC ? ' collapsed' : '');
      h.innerHTML = `<span class="ls-chev">▾</span><span class="ls-name">${esc(cat)}</span><span class="ls-count">${arr.length}</span>`;
      const body = document.createElement('div');
      body.className = 'list-section-body'; body.hidden = isC;
      body.innerHTML = arr.map((b) => itemCardHTML(b)).join('');
      grid.appendChild(h); grid.appendChild(body);
      wireCards([...body.querySelectorAll('.book-card')]);
      h.onclick = () => { const c = getCollapsed(); c[cat] = !c[cat]; setCollapsed(c); h.classList.toggle('collapsed', c[cat]); body.hidden = c[cat]; };
    }
  }

  function setView(mode) {
    viewMode = mode;
    try { localStorage.setItem('midad-view', mode); } catch {}
    const tg = $('#view-toggle');
    if (tg) tg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.view === mode));
    renderGrid();
  }

  /* ─── البحث الشامل داخل كل الكتب ─── */
  let deepTimer = null, deepToken = 0, notesToken = 0;
  let lastDeep = null; // {q, ids, scope} — لتضييق البحث عند إطالة نفس الكلمة

  // نطاق البحث داخل الكتب: السلسلة أو الرفّ المعروض، وإلا المكتبة كلها
  function searchScope() {
    if (activeCat.startsWith(SERIES_PREFIX)) {
      const sr = seriesMap.get(activeCat.slice(SERIES_PREFIX.length));
      if (sr) return { list: sr.parts, label: sr.title, id: activeCat };
    }
    if (activeCat.startsWith(SHELF_PREFIX)) {
      const sh = activeCat.slice(SHELF_PREFIX.length);
      return { list: books.filter((b) => (b.shelves || []).includes(sh)), label: sh, id: activeCat };
    }
    return { list: books, label: '', id: '' };
  }

  const normSpace = (s) => s.replace(/\s+/g, ' ').trim();
  // تنظيف مقتطف للعرض: يوحّد المسافات دون قصّ الحواف الملاصقة، ويزيل علامات #
  const snippetClean = (s) => s.replace(/\s+/g, ' ').replace(/#+\s?/g, '');

  // نص الكتاب القابل للبحث: نصي → المحتوى؛ PDF → نص مُستخرج ومُخزَّن ({text, pageStarts})
  async function searchableOf(b, allowIndex) {
    if (b.type === 'text') {
      const t = await Store.getPayload(b.id);
      return typeof t === 'string' ? { text: t } : null;
    }
    const cached = await Store.getFulltext(b.id);
    if (cached && cached.text != null) return cached;
    if (!allowIndex) return null;
    return await extractPdfText(b.id);
  }

  async function extractPdfText(id) {
    const b = books.find((x) => x.id === id);
    if (!b) return null;
    let blob = await Store.getPayload(id);
    if (!blob && window.Cloud) { await Cloud.ensurePayload(id); blob = await Store.getPayload(id); }
    if (!blob) return null;
    try {
      const buf = await blob.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      let text = ''; const pageStarts = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        pageStarts.push(text.length);
        const page = await pdf.getPage(n);
        const tc = await page.getTextContent();
        text += tc.items.map((i) => i.str).join(' ') + '\n';
      }
      try { await pdf.destroy(); } catch {}
      const rec = { text, pageStarts };
      await Store.saveFulltext(id, rec);
      return rec;
    } catch (e) { console.error('extract pdf', e); return null; }
  }

  /* ─── استخراج النص من الكتب المصوّرة (OCR عبر الذكاء الاصطناعي) ─── */
  async function ocrBook(id) {
    if (!window.Cloud || !Cloud.aiReady || !Cloud.aiReady()) {
      const cfg = window.Cloud && Cloud.isConfigured && Cloud.isConfigured();
      return toast(cfg ? 'سجّل الدخول (زر السحابة) لاستخدام استخراج النص' : 'استخراج النص يحتاج تفعيل المزامنة السحابية');
    }
    const b = books.find((x) => x.id === id) || (await Store.getBook(id));
    if (!b || b.type !== 'pdf') return;

    // اختيار مزوّد الاستخراج (يُحفظ آخر اختيار)
    const settings = Store.getSettings();
    const last = settings.ocrProvider || 'gemini';
    const provOpts = [
      { label: 'Gemini (جوجل)', value: 'gemini', hint: 'الافتراضي — طبقة مجانية', recommended: last === 'gemini' },
      { label: 'OpenAI — GPT-4o-mini', value: 'openai', hint: 'دقيق (يتطلب مفتاح OpenAI)', recommended: last === 'openai' },
      { label: 'OpenRouter', value: 'openrouter', hint: 'نماذج رؤية متعددة (بعضها مجاني)', recommended: last === 'openrouter' },
    ];
    // اجعل آخر اختيار أولاً
    provOpts.sort((a, b2) => (b2.recommended ? 1 : 0) - (a.recommended ? 1 : 0));
    const provider = await uiChoose('اختر مزوّد الذكاء لاستخراج النص من هذا الكتاب:', provOpts, { title: '🔎 مزوّد الاستخراج', icon: '🔎' });
    if (!provider) return;
    settings.ocrProvider = provider; Store.saveSettings(settings);

    let existing = await Store.getFulltext(id);
    const hasPrev = existing && existing.ocr && (existing.text || '').trim();
    let freshRestart = false;
    if (hasPrev) {
      // احسب كم صفحة اكتملت فعلاً من الإجمالي لإظهارها للمستخدم
      let filledPrev = 0;
      const ps = existing.pageStarts || [], tx = existing.text || '';
      for (let i = 0; i < ps.length; i++) { const a = ps[i] ?? 0, e = ps[i + 1] ?? tx.length; if ((tx.slice(a, e) || '').trim()) filledPrev++; }
      const total = b.pages || ps.length || 0;
      const done = total && filledPrev >= total;
      // استئناف: نُكمل الصفحات الناقصة فقط دون إعادة ما نجح (توفيراً للحصّة)
      const msg = done
        ? `اكتمل استخراج كل صفحات هذا الكتاب (${total}). هل تريد إعادة الاستخراج من جديد؟`
        : `المُستخرَج حتى الآن: ${filledPrev}${total ? ` من ${total}` : ''} صفحة. سنُكمل الصفحات الناقصة فقط دون إعادة ما اكتمل.`;
      if (!(await uiConfirm(msg, {
        title: done ? 'إعادة استخراج النص؟' : 'إكمال استخراج النص؟',
        okText: done ? 'أعد من جديد' : 'أكمِل الناقص', icon: '🔎',
      }))) return;
      if (done) { freshRestart = true; existing = null; } // إعادة كاملة: تجاهل السابق
    }
    let blob = await Store.getPayload(id);
    if (!blob && window.Cloud) { await Cloud.ensurePayload(id); blob = await Store.getPayload(id); }
    if (!blob) return toast('تعذّر تحميل ملف الكتاب');

    // نافذة التقدّم
    document.querySelectorAll('.ocr-modal').forEach((m) => m.remove());
    const overlay = document.createElement('div');
    overlay.className = 'ocr-modal';
    overlay.innerHTML = `
      <div class="om-box" role="dialog" aria-label="استخراج النص">
        <h3>🔎 استخراج نص «${esc(b.title)}»</h3>
        <p class="om-hint">عبر ${provider === 'openai' ? 'OpenAI — GPT-4o-mini' : provider === 'openrouter' ? 'OpenRouter' : 'Gemini'} — يُحوّل الصفحات المصوّرة إلى نص، فيعمل معه البحث والتلخيص والقاموس والقراءة الصوتية.</p>
        <div class="om-bar"><i id="om-fill" style="width:0%"></i></div>
        <div class="om-status" id="om-status">جارٍ التحضير…</div>
        <div class="om-actions"><button class="om-cancel">إيقاف</button></div>
      </div>`;
    document.body.appendChild(overlay);
    let cancelled = false;
    overlay.querySelector('.om-cancel').onclick = () => { cancelled = true; overlay.querySelector('.om-cancel').textContent = 'جارٍ الإيقاف…'; };

    const fill = overlay.querySelector('#om-fill');
    const status = overlay.querySelector('#om-status');
    try {
      const buf = await blob.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
      const N = pdf.numPages;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const isRateErr = (m) => /quota|rate.?limit|exceeded|RESOURCE_EXHAUSTED|429|retry in|too many/i.test(m || '');

      // ابنِ مصفوفة الصفحات من نتيجة سابقة (إن وُجدت) لاستئناف الناقص فقط
      const pages = new Array(N).fill('');
      if (existing && Array.isArray(existing.pageStarts) && existing.text != null) {
        const ps = existing.pageStarts, tx = existing.text;
        for (let i = 0; i < N && i < ps.length; i++) {
          const a = ps[i] ?? 0, e = (ps[i + 1] ?? tx.length);
          pages[i] = (tx.slice(a, e) || '').trim();
        }
      }
      const alreadyDone = pages.filter((p) => p).length;
      let newly = 0, stopError = null;

      for (let n = 1; n <= N; n++) {
        if (cancelled) break;
        if (pages[n - 1]) continue; // صفحة مكتملة سابقاً — تخطَّها (استئناف)
        const remaining = pages.filter((p) => !p).length;
        status.textContent = `استخراج الصفحة ${n} من ${N} (المتبقّي ${remaining})…`;
        let pageOk = false, attempt = 0;
        while (!pageOk && !cancelled) {
          try {
            const page = await pdf.getPage(n);
            const v1 = page.getViewport({ scale: 1 });
            const scale = Math.min(2.2, 1600 / Math.max(v1.width, v1.height)); // دقّة كافية للـOCR دون تضخيم
            const vp = page.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = vp.width; canvas.height = vp.height;
            await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, intent: 'print' }).promise;
            const base64 = canvas.toDataURL('image/jpeg', 0.82).split(',')[1];
            const pageText = await Cloud.aiInvoke({ action: 'ocr', image: base64, mimeType: 'image/jpeg', provider });
            pages[n - 1] = (pageText || '').trim();
            if (pages[n - 1]) newly++;
            pageOk = true;
          } catch (e) {
            const msg = (e && e.message) || 'خطأ في الاتصال';
            if (isRateErr(msg)) {
              // احترام حدّ المعدّل: انتظر الزمن المقترح ثم أعد المحاولة لنفس الصفحة
              attempt++;
              if (attempt > 8) { stopError = msg; break; } // غالباً الحصّة اليومية استُنفدت
              const mm = msg.match(/retry in ([\d.]+)\s*s/i);
              let wait = mm ? Math.ceil(parseFloat(mm[1])) + 2 : 35;
              wait = Math.max(5, Math.min(wait, 65));
              for (let s = wait; s > 0 && !cancelled; s--) {
                status.textContent = `تجاوزتَ حدّ الطلبات المؤقّت — إعادة المحاولة بعد ${s}ث (صفحة ${n}/${N})`;
                await sleep(1000);
              }
            } else {
              console.error('ocr page', n, e);
              stopError = msg; break; // خطأ حقيقي (اتصال/دالة) — أوقف
            }
          }
        }
        if (stopError || !pageOk) break;
        fill.style.width = Math.round((pages.filter((p) => p).length / N) * 100) + '%';
        await sleep(400); // تباعد لطيف يقلّل ملامسة حدّ المعدّل
      }
      try { await pdf.destroy(); } catch {}
      overlay.remove(); // أغلق نافذة التقدّم

      // أعد بناء النص والفهارس من كل الصفحات (المكتمِلة قديماً + الجديدة)
      let text = ''; const pageStarts = [];
      for (let i = 0; i < N; i++) { pageStarts.push(text.length); text += pages[i] + '\n\n'; }
      const filled = pages.filter((p) => p).length;

      // لا نحفظ نتيجة فارغة (كي لا يعلَق الكتاب في حالة «مُستخرَج لكن بلا نص»)
      if (!filled) {
        if (stopError && isRateErr(stopError)) {
          await uiConfirm(
            'تجاوزتَ حصّة Gemini المجانية (٢٠ طلباً في الدقيقة لكل مفتاح، وحدّ يومي محدود). كل صفحة تعادل طلباً واحداً.\nانتظر قليلاً ثم أعد المحاولة (سيُكمل الناقص)، أو أضِف عدة مفاتيح لمضاعفة الحصّة.',
            { title: 'تجاوزتَ حصّة الاستخراج', okText: 'حسناً', cancelText: 'إغلاق', icon: '⏳' });
        } else if (stopError) {
          await uiConfirm(
            `تعذّر استخراج النص: ${stopError}\n\nإن تكرّر، فتأكّد أن دالة الذكاء «ai» في Supabase محدّثة بإجراء الاستخراج (OCR).`,
            { title: 'فشل الاستخراج', okText: 'حسناً', cancelText: 'إغلاق', icon: '⚠️' });
        } else {
          toast('لم يُعثر على نص واضح في الصفحات — قد تكون جودة المسح منخفضة');
        }
        return;
      }
      // احفظ ما استُخرج (كامل أو جزئي)
      await Store.saveFulltext(id, { text, pageStarts, ocr: true });
      if (window.Cloud && Cloud.isSignedIn && Cloud.isSignedIn()) Cloud.pushBook(id); // زامِن نص الـOCR لبقية الأجهزة
      const missing = N - filled;
      // لم تُضَف أي صفحة بسبب خطأ (لا مجرّد تجاوز حصّة) → وضّح السبب بدل «حُفظ المستخرَج»
      if (newly === 0 && stopError && !isRateErr(stopError)) {
        await uiConfirm(
          `لم تُضَف صفحات جديدة بسبب خطأ من خدمة الذكاء:\n«${stopError}»\n\nإن كان بسبب مفتاح أضفته حديثاً، فتأكّد من صحّته وأن السرّ GEMINI_API_KEYS بصيغة: مفتاح1,مفتاح2 بلا مسافات، ثم أعد نشر دالة ai. (المُستخرَج سابقاً ${filled} صفحة محفوظ.)`,
          { title: 'تعذّرت إضافة صفحات', okText: 'حسناً', cancelText: 'إغلاق', icon: '⚠️' });
        return;
      }
      const okText = missing > 0
        ? `اكتمل ${filled} من ${N} صفحة (أُضيفت ${newly} هذه المرة). بقيت ${missing} صفحة ناقصة${stopError && isRateErr(stopError) ? ' — تجاوزتَ الحصّة' : ''}. أعد الاستخراج لاحقاً لإكمالها (سيُكمل الناقص فقط).`
        : `اكتمل استخراج كل الصفحات (${N}) ✓ صار متاحاً للبحث والتلخيص والقاموس والقراءة الصوتية.`;
      const make = await uiConfirm(
        `${okText}\nهل تنشئ منه نسخة نصّية مستقلّة تقرأها وتنسّقها بكامل المميزات؟`,
        { title: missing > 0 ? 'حُفظ المستخرَج' : 'اكتمل استخراج النص', okText: '📄 أنشئ نسخة نصية', cancelText: 'لاحقاً', icon: missing > 0 ? '⏳' : '✅' });
      if (make) createTextFromOcr(id, true);
    } catch (e) {
      console.error('ocr', e);
      toast('تعذّر الاستخراج: ' + ((e && e.message) || 'خطأ'));
    } finally { overlay.remove(); }
  }

  // بداية سطر حاشية مرقّمة مثل (١) أو (1) أو [٣]
  const FOOTNOTE_START = /^[(\[（]\s*[\d٠-٩۰-۹]{1,3}\s*[)\]）]/;

  // يفصل كتلة الحواشي/المراجع أسفل الصفحة عن المتن بفاصل زخرفي (يعوّض الخط المفقود في الـOCR)
  function markFootnotes(pageText) {
    const lines = pageText.split('\n');
    let idx = -1;
    // ابحث عن أول سطر حاشية في الجزء السفلي من الصفحة (تجنّباً للإشارات داخل المتن)
    for (let i = Math.max(1, Math.floor(lines.length * 0.4)); i < lines.length; i++) {
      if (FOOTNOTE_START.test(lines[i].trim())) { idx = i; break; }
    }
    if (idx > 0 && !/^[-*_]{3,}$/.test((lines[idx - 1] || '').trim())) lines.splice(idx, 0, '', '---', '');
    return lines.join('\n');
  }

  // يزيل ترويسة/تذييل الصفحة المتكرّر، ويفصل الحواشي عن المتن — اعتماداً على حدود الصفحات
  function stripRepeatedHeaders(text, pageStarts) {
    if (!Array.isArray(pageStarts) || pageStarts.length < 2) return text;
    const pages = [];
    for (let i = 0; i < pageStarts.length; i++) pages.push(text.slice(pageStarts[i] ?? 0, pageStarts[i + 1] ?? text.length));
    const norm = (s) => (s || '').trim();
    // اكتشف الترويسات المتكرّرة (تحتاج عدداً كافياً من الصفحات)
    let headers = new Set();
    if (pages.length >= 4) {
      const cand = (l) => l && l.length <= 45 && !/[.؟!،:»]$/.test(l);
      const count = {};
      for (const p of pages) {
        const lines = p.split('\n').map(norm).filter(Boolean);
        [...new Set([...lines.slice(0, 2), ...lines.slice(-2)])].forEach((l) => { if (cand(l)) count[l] = (count[l] || 0) + 1; });
      }
      const thr = Math.max(3, Math.floor(pages.length * 0.25));
      headers = new Set(Object.entries(count).filter(([, c]) => c >= thr).map(([l]) => l));
    }
    return pages.map((p) => {
      const noHeaders = p.split('\n').filter((l) => !headers.has(norm(l))).join('\n');
      return markFootnotes(noHeaders);
    }).join('\n\n');
  }

  /* ─── إنشاء كتاب نصي من النص المُستخرَج (OCR) ─── */
  async function createTextFromOcr(id, skipConfirm) {
    const b = books.find((x) => x.id === id) || (await Store.getBook(id));
    if (!b) return;
    const ft = await Store.getFulltext(id);
    if (!ft || !(ft.text || '').trim()) {
      return toast('لا يوجد نص مُستخرَج بعد — استخدم «🔎 استخراج النص (OCR)» أولاً');
    }
    const pages = (ft.pageStarts || []).length;
    if (!skipConfirm && !(await uiConfirm(`ستظهر ككتاب نصّي مستقل${pages ? ` (${pages} صفحة)` : ''} بكامل مميزات التنسيق والقراءة، مع بقاء الأصل كما هو.`, { title: 'إنشاء نسخة نصية؟', okText: 'أنشئ النسخة', icon: '📄' }))) return;
    // تنسيق ذكي: أزل الترويسات المتكرّرة، ادمج الأسطر المكسورة، واحتفظ بأرقام الصفحات معزولةً
    const text = autoCleanText(stripRepeatedHeaders(ft.text, ft.pageStarts), true);
    const meta = {
      title: b.title + ' — نص', author: b.author || '', category: b.category || 'أخرى',
      type: 'text', shelves: (b.shelves || []).slice(), sourceId: id,
    };
    if (b.cover) meta.cover = b.cover;
    const newId = await Store.addBook(meta, text);
    if (window.Cloud) Cloud.pushBook(newId);
    await refresh();
    toast('أُنشئت النسخة النصية ✓ يمكنك تنسيقها وتحريرها', 'gold');
    openBook(newId);
  }

  function findHits(text, q, max = 4) {
    const hay = text.toLowerCase(), needle = q.toLowerCase();
    const hits = []; let idx = 0;
    while (hits.length < max && (idx = hay.indexOf(needle, idx)) !== -1) {
      const a = Math.max(0, idx - 45), b2 = Math.min(text.length, idx + q.length + 55);
      hits.push({ off: idx, before: text.slice(a, idx), hit: text.slice(idx, idx + q.length), after: text.slice(idx + q.length, b2) });
      idx += q.length;
    }
    return hits;
  }

  async function deepSearch(q) {
    const token = ++deepToken;
    const panel = $('#deep-results'), list = $('#deep-list');
    const scopeInfo = searchScope(), pool = scopeInfo.list;
    { const h = panel.querySelector('h3'); if (h) h.textContent = scopeInfo.label ? `📖 داخل «${scopeInfo.label}»` : '📖 داخل الكتب'; }
    // فهرسة كسولة لملفات PDF غير المفهرسة
    const pdfsToIndex = [];
    for (const b of pool) {
      if (b.type === 'pdf' && !(await Store.getFulltext(b.id))) pdfsToIndex.push(b);
    }
    if (token !== deepToken) return;
    panel.hidden = false;
    if (pdfsToIndex.length) {
      list.innerHTML = `<div class="deep-indexing">⏳ تجهيز ${pdfsToIndex.length} كتاب PDF للبحث لأول مرة…<div class="di-bar"><i id="di-fill" style="width:0%"></i></div></div>`;
      $('#deep-count').textContent = '';
      let done = 0;
      for (const b of pdfsToIndex) {
        await extractPdfText(b.id);
        done++;
        if (token !== deepToken) return;
        const fill = $('#di-fill'); if (fill) fill.style.width = Math.round((done / pdfsToIndex.length) * 100) + '%';
      }
    }
    if (token !== deepToken) return;

    // نطاق البحث: عند إطالة نفس الكلمة («الجاح» ← «الجاحظ») لا يمكن أن يطابق
    // كتابٌ لم يطابق الأقصر، فنبحث في نتائج المرّة السابقة فقط.
    let scope = pool;
    if (lastDeep && lastDeep.scope === scopeInfo.id && q.toLowerCase().startsWith(lastDeep.q) && lastDeep.q.length >= 2) {
      const keep = new Set(lastDeep.ids);
      scope = pool.filter((b) => keep.has(b.id));
    }

    // اقرأ النصوص بالتوازي (بسقف تزامن) بدل قراءة متسلسلة لكل كتاب
    const slots = new Array(scope.length);
    let next = 0;
    const worker = async () => {
      while (next < scope.length) {
        const i = next++;
        const b = scope[i];
        if (token !== deepToken) return;
        let src = null;
        try { src = await searchableOf(b, false); } catch {}
        if (token !== deepToken) return;
        if (!src || !src.text) continue;
        const hits = findHits(src.text, q, 4);
        if (hits.length) slots[i] = { book: b, src, hits };
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, scope.length) }, worker));
    if (token !== deepToken) return;
    const results = slots.filter(Boolean); // الترتيب محفوظ حسب ترتيب المكتبة
    lastDeep = { q: q.toLowerCase(), ids: results.map((r) => r.book.id), scope: scopeInfo.id };

    const total = results.reduce((n, r) => n + r.hits.length, 0);
    $('#deep-count').textContent = total ? `${total} نتيجة في ${results.length} كتاب` : '';
    if (!results.length) {
      list.innerHTML = `<div class="deep-indexing">لا توجد نتائج داخل الكتب عن «${esc(q)}»</div>`;
      return;
    }
    list.innerHTML = results.map((r) => `
      <div class="deep-book">
        <div class="deep-book-title">${esc(r.book.title)}<span class="db-badge">${r.book.type === 'pdf' ? 'PDF' : 'نص'}${r.book.author ? ' · ' + esc(r.book.author) : ''}</span></div>
        ${r.hits.map((h, i) => {
          let loc = '';
          if (r.book.type === 'pdf' && r.src.pageStarts) {
            let pg = 1; for (let k = 0; k < r.src.pageStarts.length; k++) if (r.src.pageStarts[k] <= h.off) pg = k + 1;
            loc = `<span class="dh-loc">ص ${pg}</span>`;
          }
          return `<button class="deep-hit" data-bid="${r.book.id}" data-off="${h.off}">…${esc(snippetClean(h.before))}<b>${esc(h.hit)}</b>${esc(snippetClean(h.after))}…${loc}</button>`;
        }).join('')}
      </div>`).join('');

    list.querySelectorAll('.deep-hit').forEach((btn) => {
      btn.onclick = () => {
        const b = books.find((x) => x.id === btn.dataset.bid);
        const off = +btn.dataset.off;
        if (b.type === 'pdf') {
          const rec = results.find((r) => r.book.id === b.id).src;
          let pg = 1; for (let k = 0; k < rec.pageStarts.length; k++) if (rec.pageStarts[k] <= off) pg = k + 1;
          openBook(b.id, { page: pg });
        } else {
          const rec = results.find((r) => r.book.id === b.id).src;
          const phrase = normSpace(rec.text.substr(off, q.length + 30)).replace(/^#+\s*/, '');
          openBook(b.id, { find: phrase });
        }
      };
    });
  }

  /* ─── البحث في التظليلات والملاحظات عبر كل الكتب ───
     يغطّي ما لا يغطّيه البحث داخل النصّ: كلامك أنت — نصّ التظليل وتعليقك عليه
     وملاحظات صفحات الـPDF. كل نتيجة تقفز إلى موضعها بالضبط. */
  const NOTE_KINDS = {
    hl:   { icon: '🖍', label: 'تظليل' },
    phl:  { icon: '🖍', label: 'تظليل PDF' },
    note: { icon: '📝', label: 'ملاحظة صفحة' },
  };

  // يجمع عناصر قابلة للبحث من حالة كتاب واحد
  function annotationsOf(b, st) {
    const out = [];
    for (const h of (st.highlights || [])) out.push({ kind: 'hl', id: h.id, text: h.text || '', note: h.note || '', at: h.at || 0, jump: { find: normSpace(h.text || '').slice(0, 60) } });
    for (const h of (st.pdfHighlights || [])) out.push({ kind: 'phl', id: h.id, text: h.text || '', note: h.note || '', at: h.at || 0, page: h.page, jump: { page: h.page } });
    for (const n of (st.pageNotes || [])) out.push({ kind: 'note', id: n.id, text: '', note: n.note || '', at: n.at || 0, page: (n.page || 0) + 1, jump: { page: (n.page || 0) + 1 } });
    return out.map((a) => ({ ...a, book: b }));
  }

  async function notesSearch(q) {
    const token = ++notesToken;
    const panel = $('#notes-results'), list = $('#notes-list');
    const needle = q.toLowerCase();
    const found = [];
    // الحالات محمّلة أصلاً في الذاكرة من refresh() — لا داعي لقراءة القرص لكل كتاب
    const nScope = searchScope();
    { const h = panel.querySelector('h3'); if (h) h.textContent = nScope.label ? `✍️ تظليلاتك في «${nScope.label}»` : '✍️ تظليلاتك وملاحظاتك'; }
    for (const b of nScope.list) {
      const st = states[b.id];
      if (!st) continue;
      for (const a of annotationsOf(b, st)) {
        if ((a.text + ' ' + a.note).toLowerCase().includes(needle)) found.push(a);
      }
    }
    if (token !== notesToken) return;
    if (token !== notesToken) return;
    if (!found.length) { panel.hidden = true; return; }
    found.sort((x, y) => (y.at || 0) - (x.at || 0)); // الأحدث أولاً
    const shown = found.slice(0, 60);
    panel.hidden = false;
    $('#notes-count').textContent = `${found.length} نتيجة` + (found.length > shown.length ? ` (تُعرض ${shown.length})` : '');

    // يُبرز موضع الكلمة داخل مقتطف قصير
    const mark = (s2) => {
      const t = snippetClean(s2 || '');
      if (!t) return '';
      const i = t.toLowerCase().indexOf(needle);
      if (i < 0) return esc(t.slice(0, 120));
      const a = Math.max(0, i - 40), e = Math.min(t.length, i + q.length + 60);
      return (a > 0 ? '…' : '') + esc(t.slice(a, i)) + '<b>' + esc(t.slice(i, i + q.length)) + '</b>' + esc(t.slice(i + q.length, e)) + (e < t.length ? '…' : '');
    };

    list.innerHTML = shown.map((a, i) => {
      const k = NOTE_KINDS[a.kind];
      const loc = a.page ? `<span class="dh-loc">ص ${a.page}</span>` : '';
      const quote = a.text ? `<span class="nh-quote">«${mark(a.text)}»</span>` : '';
      const note = a.note ? `<span class="nh-note">📝 ${mark(a.note)}</span>` : '';
      return `<button class="deep-hit note-hit" data-i="${i}">
        <span class="nh-head">${k.icon} ${esc(a.book.title)}<span class="db-badge">${k.label}</span>${loc}</span>
        ${quote}${note}
      </button>`;
    }).join('');

    list.querySelectorAll('.note-hit').forEach((btn) => {
      btn.onclick = () => { const a = shown[+btn.dataset.i]; openBook(a.book.id, a.jump); };
    });
  }

  function coverHTML(b, extraClass = '') {
    if (b.cover) return `<img class="${extraClass}" src="${b.cover}" alt="">`;
    const pal = COVER_PALETTES[hashCode(b.id) % COVER_PALETTES.length];
    const orn = ORNAMENTS[hashCode(b.title) % ORNAMENTS.length];
    return `
      <div class="gen-cover ${extraClass}" style="background:
          radial-gradient(140% 100% at 50% 0%, ${pal[0]}, ${pal[1]});
          color:${pal[2]}; border:1px solid ${pal[2]}33">
        <div class="gc-orn">${orn}</div>
        <div class="gc-title">${esc(b.title)}</div>
        <div class="gc-author">${esc(b.author || '')}</div>
      </div>`;
  }

  function hashCode(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  /* ─── قائمة خيارات الكتاب ─── */
  function openCardMenu(x, y, id) {
    closeCardMenu();
    const b = books.find((x2) => x2.id === id);
    const menu = document.createElement('div');
    menu.className = 'bc-menu';
    menu.innerHTML = `
      <button data-act="read">📖 قراءة</button>
      <button data-act="fav">${b.fav ? '☆ إزالة من المفضلة' : '⭐ أضف إلى المفضلة'}</button>
      <button data-act="shelves">🗂 الرفوف…</button>
      <button data-act="series">📚 ${seriesOfBook[id] ? 'تعديل السلسلة…' : 'اجمع في سلسلة…'}</button>
      ${seriesOfBook[id] ? '<button data-act="unseries">↩ أخرِجه من السلسلة</button>' : ''}
      ${b.type === 'pdf' ? '<button data-act="ocr">🔎 استخراج النص (OCR)</button>' : ''}
      ${b.type === 'pdf' ? '<button data-act="totext">📄 أنشئ نسخة نصية</button>' : ''}
      ${b.type === 'text' ? '<button data-act="pdf">🖨 تصدير PDF</button>' : ''}
      <button data-act="cover">🖼 تغيير الغلاف</button>
      <button data-act="edit">✏️ تعديل البيانات</button>
      ${(states[id] && states[id].finished) ? '<button data-act="card">🎉 بطاقة الإنجاز</button>' : ''}
      <button data-act="export">⬇️ تصدير الملاحظات</button>
      <button data-act="reset">↺ تصفير التقدم</button>
      <button data-act="delete" class="danger">🗑 حذف الكتاب</button>`;
    document.body.appendChild(menu);
    menu.style.top = Math.min(y, innerHeight - menu.offsetHeight - 12) + 'px';
    menu.style.left = Math.min(Math.max(10, x - menu.offsetWidth + 30), innerWidth - menu.offsetWidth - 10) + 'px';
    menu.onclick = async (e) => {
      const act = e.target.dataset.act;
      closeCardMenu();
      if (act === 'read') openBook(id);
      else if (act === 'fav') { await Store.updateBook(id, { fav: !b.fav }); b.fav = !b.fav; pushMetaOf(id); render(); }
      else if (act === 'series') openSeriesEditor({ seedId: id });
      else if (act === 'unseries') removeFromSeries(id);
      else if (act === 'shelves') openShelvesModal(b);
      else if (act === 'ocr') ocrBook(id);
      else if (act === 'totext') createTextFromOcr(id);
      else if (act === 'pdf') exportPdf(id);
      else if (act === 'cover') changeCover(id);
      else if (act === 'edit') openAddModal(b);
      else if (act === 'card') openFinishCard(id);
      else if (act === 'export') exportNotes(id);
      else if (act === 'reset') {
        const st = await Store.getState(id);
        Object.assign(st, { pct: 0, page: 0, scrollTop: 0, finished: false, seconds: 0 });
        await Store.saveState(st); if (window.Cloud) Cloud.pushState(id); await refresh(); toast('تم تصفير التقدم');
      } else if (act === 'delete') {
        if (await uiConfirm(`سيُحذف «${b.title}» نهائياً مع كل ملاحظاته وتظليلاته.`, { title: 'حذف الكتاب؟', okText: 'احذف', cancelText: 'إلغاء', danger: true })) {
          await Store.deleteBook(id); if (window.Cloud) Cloud.deleteBook(id); await refresh(); toast('حُذف الكتاب');
        }
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', onDocDown, { once: true }));
    function onDocDown(e) { if (!menu.contains(e.target)) closeCardMenu(); }
  }
  function closeCardMenu() { document.querySelectorAll('.bc-menu').forEach((m) => m.remove()); }

  /* ─── إدارة رفوف الكتاب ─── */
  function openShelvesModal(b) {
    document.querySelectorAll('.shelf-modal').forEach((m) => m.remove());
    b.shelves = Array.isArray(b.shelves) ? b.shelves : [];
    const overlay = document.createElement('div');
    overlay.className = 'shelf-modal';
    overlay.innerHTML = `
      <div class="sm-box" role="dialog" aria-label="الرفوف">
        <div class="sm-head"><h3>📚 رفوف «${esc(b.title)}»</h3><button class="sm-close" title="إغلاق">✕</button></div>
        <div class="sm-list"></div>
        <div class="sm-add">
          <input type="text" class="sm-input" placeholder="اسم رفّ جديد…" maxlength="40" autocomplete="off">
          <button class="sm-add-btn btn-gold">➕ إنشاء</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const listEl = overlay.querySelector('.sm-list');
    const renderList = () => {
      const shelves = Store.getShelves();
      if (!shelves.length) { listEl.innerHTML = '<div class="sm-empty">لا رفوف بعد — أنشئ رفّك الأول أدناه.</div>'; return; }
      listEl.innerHTML = shelves.map((s) => {
        const on = b.shelves.includes(s);
        return `<label class="sm-row"><input type="checkbox" data-shelf="${esc(s)}" ${on ? 'checked' : ''}><span>${esc(s)}</span><button class="sm-del" data-del="${esc(s)}" title="حذف الرفّ">🗑</button></label>`;
      }).join('');
      listEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.onchange = async () => {
          const name = cb.dataset.shelf;
          if (cb.checked) { if (!b.shelves.includes(name)) b.shelves.push(name); }
          else b.shelves = b.shelves.filter((x) => x !== name);
          await Store.updateBook(b.id, { shelves: b.shelves });
          pushMetaOf(b.id);
          render();
        };
      });
      listEl.querySelectorAll('.sm-del').forEach((btn) => {
        btn.onclick = async (e) => {
          e.preventDefault();
          const name = btn.dataset.del;
          if (!(await uiConfirm(`سيُحذف الرفّ «${name}» فقط — لن تُحذف الكتب.`, { title: 'حذف الرفّ؟', okText: 'احذف الرفّ', danger: true }))) return;
          Store.saveShelves(Store.getShelves().filter((x) => x !== name));
          // أزل العضوية من كل الكتب
          for (const bk of books) {
            if ((bk.shelves || []).includes(name)) {
              bk.shelves = bk.shelves.filter((x) => x !== name);
              await Store.updateBook(bk.id, { shelves: bk.shelves });
              if (window.Cloud) Cloud.pushBook(bk.id);
            }
          }
          if (activeCat === SHELF_PREFIX + name) activeCat = 'الكل';
          renderList(); render();
        };
      });
    };
    renderList();

    const input = overlay.querySelector('.sm-input');
    const addShelf = async () => {
      const name = input.value.trim();
      if (!name) return;
      const shelves = Store.getShelves();
      if (!shelves.includes(name)) { shelves.push(name); Store.saveShelves(shelves); }
      if (!b.shelves.includes(name)) {
        b.shelves.push(name);
        await Store.updateBook(b.id, { shelves: b.shelves });
        if (window.Cloud) Cloud.pushBook(b.id);
      }
      input.value = '';
      renderList(); render();
    };
    overlay.querySelector('.sm-add-btn').onclick = addShelf;
    input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addShelf(); } };

    const close = () => overlay.remove();
    overlay.querySelector('.sm-close').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    setTimeout(() => input.focus(), 60);
  }

  async function exportNotes(id) {
    const b = books.find((x) => x.id === id);
    const st = await Store.getState(id);
    const items = [...(st.highlights || []), ...(st.pdfHighlights || []), ...(st.pageNotes || [])];
    if (!items.length) return toast('لا توجد ملاحظات لهذا الكتاب بعد');
    let out = `ملاحظاتي على «${b.title}»${b.author ? ' — ' + b.author : ''}\n`;
    out += '─'.repeat(40) + '\n\n';
    for (const h of st.highlights || []) {
      out += `«${h.text.trim()}»\n`;
      if (h.note) out += `📝 ${h.note}\n`;
      out += '\n';
    }
    for (const h of (st.pdfHighlights || []).slice().sort((a, b) => a.page - b.page)) {
      out += `«${h.text.trim()}» [صفحة ${h.page}]\n`;
      if (h.note) out += `📝 ${h.note}\n`;
      out += '\n';
    }
    for (const n of st.pageNotes || []) out += `[صفحة ${n.page + 1}] 📝 ${n.note}\n\n`;
    const blob = new Blob(['﻿' + out], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ملاحظات - ${b.title}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('صُدّرت الملاحظات 📄', 'gold');
  }

  /* ─── نافذة خيارات تصدير PDF ─── */
  function exportOptions() {
    return new Promise((resolve) => {
      document.querySelectorAll('.ui-dialog').forEach((m) => m.remove());
      const overlay = document.createElement('div');
      overlay.className = 'ui-dialog';
      overlay.innerHTML = `
        <div class="ud-box exp-box" role="dialog" aria-modal="true">
          <div class="ud-icon">🖨</div>
          <h3>خيارات تصدير PDF</h3>
          <div class="exp-row"><label>مقاس الصفحة</label>
            <div class="exp-seg" data-k="size"><button data-v="A4" class="on">A4</button><button data-v="A5">A5 (كتاب)</button><button data-v="Letter">Letter</button></div></div>
          <div class="exp-row"><label>حجم الخط</label>
            <div class="exp-seg" data-k="font"><button data-v="0.9">صغير</button><button data-v="1" class="on">متوسط</button><button data-v="1.12">كبير</button></div></div>
          <label class="exp-check"><input type="checkbox" id="exp-toc" checked><span>فهرس محتويات تلقائي (بأرقام الصفحات)</span></label>
          <label class="exp-check"><input type="checkbox" id="exp-info" checked><span>صفحة معلومات الكتاب</span></label>
          <label class="exp-check"><input type="checkbox" id="exp-pages" checked><span>ترقيم الصفحات</span></label>
          <label class="exp-check"><input type="checkbox" id="exp-drop" checked><span>حرف استهلالي للفصول</span></label>
          <div class="ud-actions"><button class="ud-cancel">إلغاء</button><button class="ud-ok btn-gold">🖨 تصدير</button></div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.querySelectorAll('.exp-seg').forEach((seg) => seg.querySelectorAll('button').forEach((btn) =>
        (btn.onclick = () => seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === btn)))));
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelector('.ud-cancel').onclick = () => done(null);
      overlay.onclick = (e) => { if (e.target === overlay) done(null); };
      overlay.querySelector('.ud-ok').onclick = () => {
        const seg = (k) => overlay.querySelector(`.exp-seg[data-k="${k}"] button.on`).dataset.v;
        done({ size: seg('size'), fontScale: parseFloat(seg('font')),
          toc: overlay.querySelector('#exp-toc').checked, info: overlay.querySelector('#exp-info').checked,
          pageNumbers: overlay.querySelector('#exp-pages').checked, dropcap: overlay.querySelector('#exp-drop').checked });
      };
    });
  }

  /* ─── تصدير الكتاب إلى PDF احترافي (عبر طباعة المتصفح — يدعم العربية بامتياز) ─── */
  async function exportPdf(id) {
    const b = books.find((x) => x.id === id) || (await Store.getBook(id));
    if (!b) return;
    let text = '';
    if (b.type === 'text') { const t = await Store.getPayload(id); text = typeof t === 'string' ? t : ''; }
    else { const ft = await Store.getFulltext(id); text = (ft && ft.text) || ''; }
    if (!text.trim()) return toast('لا يوجد نص للتصدير (لكتب PDF المصوّرة استخرج النص أولاً)');
    const opts = await exportOptions();
    if (!opts) return;

    let bodyHtml = (window.Reader && Reader.previewHTML) ? Reader.previewHTML(text) : `<p>${esc(text)}</p>`;
    // فهرس المحتويات: أضف مُعرّفات للعناوين وابنِ الفهرس بأرقام صفحات حقيقية (عبر target-counter)
    let tocHtml = '';
    if (opts.toc) {
      const dom = new DOMParser().parseFromString(bodyHtml, 'text/html');
      const heads = [...dom.body.querySelectorAll('h2, h3')];
      heads.forEach((h, i) => (h.id = 'toc' + i));
      if (heads.length) {
        tocHtml = `<div class="toc"><h2 class="toc-h">المحتويات</h2>` + heads.map((h) =>
          `<a class="toc-item ${h.tagName.toLowerCase()}" href="#${h.id}"><span class="toc-txt">${esc(h.textContent)}</span><span class="toc-dots"></span></a>`).join('') + `</div>`;
        bodyHtml = dom.body.innerHTML;
      }
    }
    const w = window.open('', '_blank');
    if (!w) return toast('اسمح بالنوافذ المنبثقة لتصدير PDF ثم أعد المحاولة');
    const title = esc((b.title || 'كتاب').replace(/\s*—\s*نص\s*$/, '')), author = esc(b.author || '');
    const bodyFont = b.font || "'Noto Naskh Arabic', serif";
    const s = Store.getSettings();
    let [paper, ink] = PAPER_THEMES[s.theme] || PAPER_THEMES.sepia;
    if (s.theme === 'custom' && s.customPaper) { paper = s.customPaper; ink = '#2a2114'; }
    const softInk = 'color-mix(in srgb, ' + ink + ' 72%, ' + paper + ')';
    const fs = (13.5 * opts.fontScale).toFixed(1);
    const margin = opts.size === 'A5' ? '15mm 14mm 16mm' : '22mm 20mm 20mm';
    const doc = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONT_LINK}" rel="stylesheet">
<style>
  @page { size: ${opts.size}; margin: ${margin}; }
  ${opts.pageNumbers ? `@page { @bottom-center { content: counter(page); font-family: 'Amiri', serif; color: ${softInk}; font-size: 10pt; } }` : ''}
  @page :first { @bottom-center { content: ''; } }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: ${paper}; }
  body { font-family: ${bodyFont}; color: ${ink}; font-size: ${fs}pt; line-height: 1.95; text-align: justify; direction: rtl; }
  @media screen { body { max-width: 820px; margin: 24px auto; padding: 40px 46px; border-radius: 6px; box-shadow: 0 10px 50px rgba(0,0,0,.25); } }
  .cover { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; min-height: 84vh; page-break-after: always; }
  .cover .orn { font-family: 'Amiri', serif; font-size: 42pt; color: ${softInk}; margin-bottom: 18pt; }
  .cover h1 { font-family: 'Amiri', serif; font-size: 30pt; font-weight: 700; margin: 0 0 14pt; color: ${ink}; line-height: 1.4; }
  .cover .author { font-size: 15pt; color: ${softInk}; }
  .cover .rule { width: 40%; height: 2px; background: ${softInk}; margin: 20pt auto; opacity: .55; }
  .info-page { min-height: 62vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; gap: 9pt; page-break-after: always; }
  .info-page .it { font-family: 'Amiri', serif; font-size: 20pt; color: ${ink}; margin-bottom: 6pt; }
  .info-page .il { font-size: 12pt; color: ${softInk}; }
  .toc { page-break-after: always; }
  .toc-h { font-family: 'Amiri', serif; font-size: 20pt; text-align: center; color: ${ink}; margin: 0 0 20pt; page-break-before: avoid; }
  .toc-item { display: flex; align-items: baseline; text-decoration: none; color: ${ink}; margin: 7pt 0; font-size: 12.5pt; }
  .toc-item.h3 { padding-inline-start: 20pt; font-size: 11pt; color: ${softInk}; }
  .toc-dots { flex: 1; border-bottom: 1px dotted ${softInk}; opacity: .5; margin: 0 6pt; transform: translateY(-3px); }
  .toc-item::after { content: target-counter(attr(href), page); font-variant-numeric: tabular-nums; color: ${softInk}; }
  h2 { font-family: 'Amiri', serif; font-size: 21pt; font-weight: 700; text-align: center; margin: 0 0 20pt; color: ${ink}; page-break-before: always; padding-top: 6pt; }
  .book > h2:first-child { page-break-before: avoid; }
  h3 { font-family: 'Amiri', serif; font-size: 15.5pt; margin: 16pt 0 8pt; color: ${ink}; }
  h4 { font-family: 'Amiri', serif; font-size: 13.5pt; margin: 14pt 0 6pt; color: ${ink}; }
  p { margin: 0 0 10pt; orphans: 2; widows: 2; }
  p.center { text-align: center; }
  p.footnote { font-size: .82em; color: ${softInk}; margin: 2pt 0; line-height: 1.6; }
  ${opts.dropcap ? `h2 + p::first-letter, h3 + p::first-letter { font-family: 'Amiri', serif; font-size: 3.1em; float: right; line-height: .78; margin: .04em .14em 0 .12em; color: ${softInk}; font-weight: 700; }` : ''}
  strong { font-weight: 700; } em { font-style: italic; }
  mark, mark.static-hl { background: color-mix(in srgb, ${ink} 18%, transparent); padding: 0 2px; border-radius: 2px; }
  blockquote { margin: 12pt 0; padding: 2pt 14pt; border-inline-start: 3px solid ${softInk}; color: ${softInk}; font-style: italic; }
  ul, ol { margin: 8pt 18pt 8pt 0; padding-inline-start: 12pt; }
  li { margin-bottom: 4pt; }
  hr, hr.orn { border: none; text-align: center; margin: 16pt 0; page-break-inside: avoid; }
  hr::before, hr.orn::before { content: '❦'; color: ${softInk}; font-size: 15pt; }
  .poem { text-align: center; margin: 12pt 0; page-break-inside: avoid; }
  .verse { display: flex; justify-content: center; gap: 8%; margin-bottom: 5pt; font-family: 'Amiri', serif; }
  .verse span { flex: 0 1 42%; } .verse span:first-child { text-align: left; } .verse span:last-child { text-align: right; }
</style></head><body>
  <div class="cover">
    <div class="orn">❁</div>
    <h1>${title}</h1>
    ${author ? `<div class="author">${author}</div>` : ''}
    <div class="rule"></div>
    <div class="author" style="font-size:11pt;opacity:.7">مِداد — مكتبتي الرقمية</div>
  </div>
  ${opts.info ? `<div class="info-page">
    <div class="it">${title}</div>
    ${author ? `<div class="il">تأليف: ${author}</div>` : ''}
    ${b.category ? `<div class="il">التصنيف: ${esc(b.category)}</div>` : ''}
    <div class="il">صُدِّر عبر تطبيق «مِداد»</div>
    <div class="il">${new Date().toLocaleDateString('ar')}</div>
  </div>` : ''}
  ${tocHtml}
  <div class="book">${bodyHtml}</div>
  <script>
    (function(){
      function go(){ setTimeout(function(){ window.focus(); window.print(); }, 350); }
      if (document.fonts && document.fonts.ready) { document.fonts.ready.then(go); setTimeout(go, 2500); }
      else window.onload = go;
    })();
  <\/script>
</body></html>`;
    w.document.open(); w.document.write(doc); w.document.close();
    toast('افتحت معاينة الطباعة — اختر «حفظ كـ PDF» 🖨', 'gold');
  }

  /* ─── الشريط العلوي ─── */
  function wireTopbar() {
    const si = $('#search-input');
    // منع الملء التلقائي للبريد في خانة البحث: تبقى readonly حتى يركّز المستخدم فعلاً
    si.setAttribute('readonly', '');
    const unlock = () => si.removeAttribute('readonly');
    si.addEventListener('focus', unlock);
    si.addEventListener('pointerdown', unlock);
    si.oninput = (e) => {
      query = e.target.value.trim();
      renderGrid();
      clearTimeout(deepTimer);
      if (query.length >= 2) deepTimer = setTimeout(() => { deepSearch(query); notesSearch(query); }, 350);
      else { $('#deep-results').hidden = true; $('#notes-results').hidden = true; notesToken++; lastDeep = null; }
    };
    $('#sort-select').onchange = (e) => { sort = e.target.value; renderGrid(); };
    { const tg = $('#view-toggle'); if (tg) { tg.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', b.dataset.view === viewMode); b.onclick = () => setView(b.dataset.view); }); } }
    { const pf = $('#pair-filter'); if (pf) { pf.value = pairView; pf.onchange = (e) => { pairView = e.target.value; try { localStorage.setItem('midad-pairview', pairView); } catch {} renderGrid(); }; } }
    $('#btn-add').onclick = () => openAddModal();
    $('#btn-add-empty').onclick = () => openAddModal();
    { const bd = $('#btn-discover'); if (bd) bd.onclick = () => { if (window.Discover) Discover.open(); }; }
  }

  function fillCategorySelect() {
    $('#meta-category').innerHTML = CATEGORIES.map((c) => `<option>${c}</option>`).join('');
    $('#meta-font').innerHTML = BOOK_FONTS.map((f) => `<option value="${esc(f.css)}">${esc(f.label)}</option>`).join('');
  }

  // طبّق خط الكتاب المختار على المحرّر المباشر والمعاينة (تنسيق حيّ بالخط)
  function applyEditorFont() {
    const f = $('#meta-font') ? $('#meta-font').value : '';
    if (!f) return;
    const rich = $('#fmt-rich'), prev = $('#fmt-preview-pane');
    if (rich) rich.style.fontFamily = f;
    if (prev) prev.style.fontFamily = f;
  }

  /* ─── نافذة اختيار من عدّة خيارات — تُعيد القيمة أو null ─── */
  function uiChoose(message, choices, opts = {}) {
    return new Promise((resolve) => {
      document.querySelectorAll('.ui-dialog').forEach((m) => m.remove());
      const { title = 'اختر', icon = '🔀' } = opts;
      const overlay = document.createElement('div');
      overlay.className = 'ui-dialog';
      overlay.innerHTML = `
        <div class="ud-box" role="dialog" aria-modal="true">
          <div class="ud-icon">${icon}</div>
          <h3>${esc(title)}</h3>
          ${message ? `<p>${esc(message)}</p>` : ''}
          <div class="ud-choices">${choices.map((c, i) =>
            `<button class="ud-choice ${c.recommended ? 'rec' : ''}" data-i="${i}"><b>${esc(c.label)}</b>${c.hint ? `<span>${esc(c.hint)}</span>` : ''}</button>`).join('')}</div>
          <div class="ud-actions"><button class="ud-cancel">إلغاء</button></div>
        </div>`;
      document.body.appendChild(overlay);
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.querySelectorAll('.ud-choice').forEach((btn) => (btn.onclick = () => done(choices[+btn.dataset.i].value)));
      overlay.querySelector('.ud-cancel').onclick = () => done(null);
      overlay.onclick = (e) => { if (e.target === overlay) done(null); };
    });
  }

  /* ─── نافذة الإضافة / التعديل ─── */
  function wireAddModal() {
    const modal = $('#add-modal');
    modal.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeAddModal));
    modal.onclick = (e) => { if (e.target === modal) closeAddModal(); };

    $('#add-tabs').querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => {
        $('#add-tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === btn));
        $('#pane-file').hidden = btn.dataset.tab !== 'file';
        $('#pane-paste').hidden = btn.dataset.tab !== 'paste';
        $('#pane-url').hidden = btn.dataset.tab !== 'url';
      };
    });
    $('#btn-fetch-url').onclick = fetchFromUrl;
    $('#url-input').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchFromUrl(); } };

    const dz = $('#dropzone');
    dz.onclick = () => $('#file-input').click();
    const takeFiles = (files) => {
      files = [...files].filter((f) => /\.(pdf|txt|md|epub)$/i.test(f.name) || f.type === 'application/pdf' || f.type === 'application/epub+zip' || f.type.startsWith('text/'));
      if (!files.length) return toast('الرجاء اختيار ملفات PDF أو TXT');
      if (files.length > 1) { closeAddModal(); bulkImport(files); }
      else handleFile(files[0]);
    };
    $('#file-input').onchange = (e) => { if (e.target.files.length) takeFiles(e.target.files); e.target.value = ''; };
    dz.ondragover = (e) => { e.preventDefault(); dz.classList.add('drag'); };
    dz.ondragleave = () => dz.classList.remove('drag');
    dz.ondrop = (e) => {
      e.preventDefault(); dz.classList.remove('drag');
      if (e.dataTransfer.files.length) takeFiles(e.dataTransfer.files);
    };

    // غلاف مخصص
    $('#btn-cover').onclick = () => $('#cover-input').click();
    $('#cover-input').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f || !f.type.startsWith('image/')) return;
      pendingCover = await imageToCover(f);
      updateCoverPreview();
      toast('اختير الغلاف ✓');
    };
    // غلاف من رابط
    $('#btn-cover-url').onclick = () => {
      const row = $('#cover-url-row');
      row.hidden = !row.hidden;
      if (!row.hidden) setTimeout(() => $('#cover-url-input').focus(), 60);
    };
    $('#cover-url-go').onclick = fetchCoverFromUrl;
    $('#cover-url-input').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); fetchCoverFromUrl(); } };

    $('#meta-title').oninput = updateCoverPreview;
    $('#meta-author').oninput = updateCoverPreview;
    $('#meta-font').onchange = applyEditorFont;
    $('#btn-save-book').onclick = saveBook;
    // استبدال ملف الكتاب في وضع التعديل
    $('#btn-replace-file').onclick = () => {
      $('#pane-file').hidden = false;
      $('#pane-paste').hidden = true;
      $('#replace-hint').hidden = false;
      $('#file-input').click();
    };
    wireFmtToolbar();
  }

  /* ─── تحويل محتوى المحرّر المباشر (HTML) إلى صيغة الكتاب النصية ─── */
  function richToMarkup(root) {
    const inlineOf = (node) => {
      let s = '';
      node.childNodes.forEach((n) => {
        if (n.nodeType === 3) { s += n.textContent; return; }
        if (n.nodeType !== 1) return;
        const tag = n.tagName.toLowerCase(), inner = inlineOf(n);
        if (tag === 'b' || tag === 'strong') s += inner.trim() ? '**' + inner.trim() + '**' : inner;
        else if (tag === 'i' || tag === 'em') s += inner.trim() ? '_' + inner.trim() + '_' : inner;
        else if (tag === 'mark') s += inner.trim() ? '==' + inner.trim() + '==' : inner;
        else if (tag === 'br') s += '\n';
        else s += inner;
      });
      return s;
    };
    const centered = (el) => (el.style && el.style.textAlign === 'center') || (el.classList && el.classList.contains('center'));
    const blocks = [];
    const walk = (parent) => {
      parent.childNodes.forEach((n) => {
        if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) blocks.push(t); return; }
        if (n.nodeType !== 1) return;
        const tag = n.tagName.toLowerCase();
        // محاذاة عكس buildHTML: h2←«# »، h3←«## »، h4←«### »
        if (tag === 'h1' || tag === 'h2') blocks.push('# ' + inlineOf(n).trim());
        else if (tag === 'h3') blocks.push('## ' + inlineOf(n).trim());
        else if (tag === 'h4') blocks.push('### ' + inlineOf(n).trim());
        else if (tag === 'blockquote') blocks.push('> ' + inlineOf(n).trim());
        else if (tag === 'ul' || tag === 'ol') {
          const p = tag === 'ol' ? '1. ' : '- ';
          const items = [...n.querySelectorAll(':scope > li')].map((li) => p + inlineOf(li).trim()).filter((x) => x.trim() !== p.trim());
          if (items.length) blocks.push(items.join('\n'));
        } else if (tag === 'hr') blocks.push('---');
        else if (n.classList && n.classList.contains('poem')) {
          const vs = [...n.querySelectorAll('.verse')].map((v) => {
            const sp = v.querySelectorAll('span');
            return '/ ' + (sp[0] ? inlineOf(sp[0]).trim() : '') + (sp[1] ? ' | ' + inlineOf(sp[1]).trim() : '');
          });
          if (vs.length) blocks.push(vs.join('\n'));
        } else if (tag === 'p' || tag === 'div') {
          const hasBlockChild = [...n.children].some((c) => /^(H[1-6]|P|DIV|UL|OL|BLOCKQUOTE|HR)$/.test(c.tagName));
          if (hasBlockChild) { walk(n); return; }
          const t = inlineOf(n).trim();
          if (t) blocks.push((centered(n) ? '~ ' : '') + t);
        } else { const t = inlineOf(n).trim(); if (t) blocks.push(t); }
      });
    };
    walk(root);
    return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // إن كان المحرّر المباشر مفعّلاً، انقل محتواه إلى مربّع النص (مصدر الحفظ)
  function syncRichEditor() {
    const rich = $('#fmt-rich');
    if (rich && !rich.hidden) $('#paste-text').value = richToMarkup(rich);
  }

  /* ─── شريط أدوات تنسيق النص + معاينة + تنظيف ─── */
  function wireFmtToolbar() {
    const ta = $('#paste-text');
    const preview = $('#fmt-preview-pane');
    const refreshPreview = () => { if (!preview.hidden && window.Reader) { preview.innerHTML = Reader.previewHTML(ta.value); applyEditorFont(); } };

    const linePrefix = (prefix) => {
      const val = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      const lineStart = val.lastIndexOf('\n', s - 1) + 1;
      let lineEnd = val.indexOf('\n', e); if (lineEnd === -1) lineEnd = val.length;
      const block = val.slice(lineStart, lineEnd)
        .split('\n').map((l) => prefix + l.replace(/^(#{1,4}\s+|>\s+|~\s+|[-•]\s+)/, '')).join('\n');
      ta.value = val.slice(0, lineStart) + block + val.slice(lineEnd);
      ta.focus(); ta.setSelectionRange(lineStart, lineStart + block.length);
    };
    const wrap = (a, b, ph) => {
      const val = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
      const sel = val.slice(s, e) || ph;
      ta.value = val.slice(0, s) + a + sel + b + val.slice(e);
      ta.focus(); ta.setSelectionRange(s + a.length, s + a.length + sel.length);
    };
    const insert = (txt) => {
      const val = ta.value, s = ta.selectionStart;
      ta.value = val.slice(0, s) + txt + val.slice(ta.selectionEnd);
      ta.focus(); ta.setSelectionRange(s + txt.length, s + txt.length);
    };

    const rich = $('#fmt-rich');
    const richActive = () => !rich.hidden;
    const setBtn = (name, on) => { const b = $('#fmt-toolbar').querySelector(`[data-fmt="${name}"]`); if (b) b.classList.toggle('on', on); };

    // ── وضع التنسيق المباشر (WYSIWYG) ──
    function enterRich() {
      if (!preview.hidden) doFmt('split'); // أغلق المعاينة الجانبية
      rich.innerHTML = (window.Reader ? Reader.previewHTML(ta.value) : '') || '<p><br></p>';
      ta.hidden = true; preview.hidden = true; rich.hidden = false;
      applyEditorFont();
      setBtn('rich', true);
      setTimeout(() => rich.focus(), 30);
    }
    function exitRich() {
      ta.value = richToMarkup(rich);
      rich.hidden = true; ta.hidden = false;
      setBtn('rich', false);
      ta.focus();
    }
    const markSelection = () => {
      const sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return;
      const r = sel.getRangeAt(0);
      const m = document.createElement('mark');
      try { r.surroundContents(m); } catch { m.appendChild(r.extractContents()); r.insertNode(m); }
      sel.removeAllRanges();
    };
    const richCmd = (fmt) => {
      const ex = (c, v) => document.execCommand(c, false, v);
      switch (fmt) {
        case 'bold': ex('bold'); break;
        case 'italic': ex('italic'); break;
        case 'mark': markSelection(); break;
        // نُحاذي مستويات القارئ: «عنوان»→h2 (فصل)، «فرعي»→h3، «صغير»→h4
        case 'h1': ex('formatBlock', 'h2'); break;
        case 'h2': ex('formatBlock', 'h3'); break;
        case 'h3': ex('formatBlock', 'h4'); break;
        case 'quote': ex('formatBlock', 'blockquote'); break;
        case 'center': ex('justifyCenter'); break;
        case 'list': ex('insertUnorderedList'); break;
        case 'numlist': ex('insertOrderedList'); break;
        case 'hr': ex('insertHorizontalRule'); break;
        case 'verse': ex('insertHTML', '<div class="poem"><div class="verse"><span>صدر البيت</span><span>عجز البيت</span></div></div><p><br></p>'); break;
        case 'clean': { const md = autoCleanText(richToMarkup(rich)); rich.innerHTML = (window.Reader ? Reader.previewHTML(md) : '') || '<p><br></p>'; toast('نُظّف النص ✨'); break; }
      }
      rich.focus();
    };

    const doFmt = (fmt) => {
      // زر التبديل بين الوضعين
      if (fmt === 'rich') { richActive() ? exitRich() : enterRich(); return; }
      // في وضع التنسيق المباشر توجَّه أوامر التنسيق للسطح الغني
      if (richActive() && !['split', 'full'].includes(fmt)) { richCmd(fmt); return; }
      switch (fmt) {
        case 'h1': linePrefix('# '); break;
        case 'h2': linePrefix('## '); break;
        case 'h3': linePrefix('### '); break;
        case 'bold': wrap('**', '**', 'نص عريض'); break;
        case 'italic': wrap('_', '_', 'نص مائل'); break;
        case 'mark': wrap('==', '==', 'نص مظلّل'); break;
        case 'quote': linePrefix('> '); break;
        case 'center': linePrefix('~ '); break;
        case 'list': linePrefix('- '); break;
        case 'numlist': linePrefix('1. '); break;
        case 'hr': insert('\n---\n'); break;
        case 'verse': insert('\n/ صدر البيت | عجز البيت\n'); break;
        case 'clean': ta.value = autoCleanText(ta.value); ta.focus(); toast('نُظّف النص ✨'); break;
        case 'split': {
          if (richActive()) exitRich();
          const on = preview.hidden;
          preview.hidden = !on;
          $('#fmt-editor').classList.toggle('split', on);
          setBtn('split', on);
          refreshPreview();
          return;
        }
        case 'full': {
          const modal = $('#add-modal');
          const on = !modal.classList.contains('editor-max');
          modal.classList.toggle('editor-max', on);
          setBtn('full', on);
          if (on && !richActive() && preview.hidden) doFmt('split');
          refreshPreview();
          return;
        }
      }
      refreshPreview();
    };

    $('#fmt-toolbar').querySelectorAll('[data-fmt]').forEach((btn) => {
      btn.onclick = () => doFmt(btn.dataset.fmt);
      // منع فقدان التحديد داخل السطح الغني عند الضغط على الزر
      btn.addEventListener('mousedown', (e) => e.preventDefault());
    });
    // اختصارات لوحة المفاتيح (تعمل في الوضعين)
    const shortcut = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const map = { b: 'bold', i: 'italic', '1': 'h1', '2': 'h2', '3': 'h3' };
      const f = map[e.key.toLowerCase()];
      if (f) { e.preventDefault(); doFmt(f); }
    };
    ta.addEventListener('keydown', shortcut);
    rich.addEventListener('keydown', shortcut);
    ta.addEventListener('input', () => { if (!preview.hidden) refreshPreview(); });
  }

  // تنظيف تلقائي: يجمع الأسطر المكسورة في فقرات، ويزيل أرقام الصفحات والفراغات الزائدة
  function autoCleanText(t, keepPageNumbers) {
    let text = t.replace(/\r/g, '');
    if (keepPageNumbers) text = text.replace(/(^|\n)[ \t]*(\d{1,4})[ \t]*(?=\n|$)/g, '$1\n$2\n'); // اعزل رقم الصفحة كفقرة مستقلّة (دون حذفه)
    else text = text.split('\n').filter((l) => !/^\s*\d{1,4}\s*$/.test(l)).join('\n'); // أرقام صفحات معزولة
    const blocks = text.split(/\n\s*\n/);
    const out = blocks.map((b) => {
      const lines = b.split('\n').map((x) => x.trim()).filter(Boolean);
      if (!lines.length) return '';
      const joined = []; let para = '';
      const isHeadingLine = (l) => /^(#{1,4}\s|>\s|~\s|[-•]\s|\d+[.)]\s|\/|[-*_]{3,}$)/.test(l)
        || FOOTNOTE_START.test(l) // كل حاشية مرقّمة تبقى في سطرها
        || (/^(الفصل|الباب|المقدمة|الخاتمة|القسم|الجزء|تمهيد|مدخل|الوصية|المبحث|الفَصل)\b/.test(l) && l.length < 50);
      for (const l of lines) {
        if (isHeadingLine(l)) { if (para) { joined.push(para); para = ''; } joined.push(l); }
        else para = para ? para + ' ' + l : l;
      }
      if (para) joined.push(para);
      return joined.join('\n');
    });
    return out.filter((x) => x !== '').join('\n\n').trim();
  }

  /* جلب رابط عبر سلسلة وسطاء: مباشر ← خادمك (Supabase) ← وسطاء عامّون — مع مهلة لكل محاولة
     يعيد {buf, ct} حيث buf هو ArrayBuffer و ct نوع المحتوى (قد يكون '') */
  async function fetchViaProxies(url, onStep) {
    const attempt = async (u, ms) => {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), ms);
      try {
        const r = await fetch(u, { signal: ctrl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const ct = r.headers.get('content-type') || '';
        return { buf: await r.arrayBuffer(), ct };
      } finally { clearTimeout(to); }
    };
    // 1) مباشر (يعمل مع المواقع المتيحة لـCORS)
    try { return await attempt(url, 20000); } catch {}
    // 2) عبر خادمك (الأوثق) إن كانت المزامنة السحابية مُفعّلة
    if (window.Cloud && Cloud.isConfigured && Cloud.isConfigured()) {
      try {
        onStep && onStep('⏳ الموقع يمنع الجلب المباشر — محاولة عبر خادمك…');
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 45000);
        try {
          const r = await Cloud.invokeFnRaw('alfeker', { action: 'fetch', url });
          const ct = r.headers.get('content-type') || '';
          if (r.ok && !/application\/json/i.test(ct)) return { buf: await r.arrayBuffer(), ct };
        } finally { clearTimeout(to); }
      } catch {}
    }
    // 3) وسطاء عامّون (لمن لا يستخدم المزامنة السحابية)
    const proxies = [
      (u) => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
      (u) => 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u),
      (u) => 'https://corsproxy.io/?url=' + encodeURIComponent(u),
    ];
    for (const p of proxies) {
      try { onStep && onStep('⏳ الموقع يمنع الجلب المباشر — محاولة عبر وسيط…'); return await attempt(p(url), 20000); } catch {}
    }
    throw new Error('تعذّر الجلب من كل المصادر');
  }

  /* جلب كتاب من رابط مباشر (PDF أو نص) */
  async function fetchFromUrl() {
    const url = $('#url-input').value.trim();
    if (!/^https?:\/\/.+/i.test(url)) return toast('أدخل رابطاً صحيحاً يبدأ بـ https://');
    const chip = $('#url-chip');
    chip.hidden = false;
    chip.textContent = '⏳ جارٍ جلب الملف…';
    pendingFile = null;

    let buf = null;
    try { ({ buf } = await fetchViaProxies(url, (m) => { chip.textContent = m; })); }
    catch {
      chip.textContent = '⚠ تعذّر الجلب: الموقع يمنع التحميل المباشر. نزّل الملف إلى جهازك ثم أضفه من لسان «ملف»، أو فعّل المزامنة السحابية (☁️) للجلب عبر خادمك';
      return;
    }

    const nameFromUrl = decodeURIComponent((url.split('/').pop() || '').split('?')[0]) || 'كتاب من الإنترنت';
    const head = new Uint8Array(buf.slice(0, 5));
    const isPdf = (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) || /\.pdf$/i.test(nameFromUrl);

    if (!$('#meta-title').value.trim()) {
      $('#meta-title').value = nameFromUrl.replace(/\.(pdf|txt|md)$/i, '').replace(/[_-]+/g, ' ').trim();
    }

    if (isPdf) {
      try {
        const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
        const cover = await renderPdfCover(pdf);
        try { await pdf.destroy(); } catch {}
        pendingFile = { kind: 'pdf', blob: new Blob([buf], { type: 'application/pdf' }), cover, pages: pdf.numPages };
        chip.textContent = `✓ ${nameFromUrl} — ${pdf.numPages} صفحة، جاهز للحفظ`;
      } catch (err) {
        console.error(err);
        chip.textContent = '⚠ جُلب الملف لكن تعذّرت قراءته كـ PDF صالح';
        return;
      }
    } else {
      const text = new TextDecoder('utf-8').decode(buf);
      // كشف الملفات الثنائية غير النصية (رموز التعويض)
      const junk = (text.slice(0, 2000).match(/�/g) || []).length;
      if (!text.trim() || junk > 40) {
        chip.textContent = '⚠ الرابط لا يشير إلى ملف PDF أو نص صالح';
        return;
      }
      pendingFile = { kind: 'text', text };
      chip.textContent = `✓ ${nameFromUrl} — ${Math.round(text.length / 1000)} ألف حرف، جاهز للحفظ`;
    }
    updateCoverPreview();
  }

  function imageToCover(file) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = 320, h = Math.round(w * img.height / img.width);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    });
  }

  async function fetchCoverFromUrl() {
    const url = $('#cover-url-input').value.trim();
    if (!/^https?:\/\/.+/i.test(url)) return toast('أدخل رابط صورة صحيحاً يبدأ بـ https://');
    const go = $('#cover-url-go'); const orig = go.textContent; go.textContent = '⏳';
    let blob = null;
    try { const { buf, ct } = await fetchViaProxies(url); blob = new Blob([buf], { type: ct || 'image/jpeg' }); } catch {}
    go.textContent = orig;
    if (!blob) return toast('تعذّر جلب الصورة — قد يمنع الموقع التحميل المباشر');
    const cover = await imageToCover(blob);
    if (!cover) return toast('الرابط لا يشير إلى صورة صالحة');
    pendingCover = cover;
    updateCoverPreview();
    $('#cover-url-row').hidden = true;
    $('#cover-url-input').value = '';
    toast('اختير الغلاف من الرابط ✓', 'gold');
  }

  // جلب صورة من رابط وتحويلها إلى غلاف (مع سلسلة وسطاء CORS احتياطية)
  async function coverFromUrl(url) {
    let blob = null;
    try { const { buf, ct } = await fetchViaProxies(url); blob = new Blob([buf], { type: ct || 'image/jpeg' }); } catch {}
    return blob ? imageToCover(blob) : null;
  }

  /* ─── تغيير غلاف كتاب (من ملف صورة أو رابط) — اختصار سريع من قائمة الكتاب ─── */
  async function changeCover(id) {
    const b = books.find((x) => x.id === id) || (await Store.getBook(id));
    if (!b) return;
    document.querySelectorAll('.ui-dialog').forEach((m) => m.remove());
    const overlay = document.createElement('div');
    overlay.className = 'ui-dialog';
    overlay.innerHTML = `<div class="ud-box" style="max-width:400px" role="dialog" aria-modal="true">
      <div class="ud-icon">🖼</div><h3>تغيير غلاف الكتاب</h3>
      <div class="cc-prev" id="cc-prev"></div>
      <div class="cc-actions">
        <button class="btn-ghost" id="cc-file">🖼 من ملف صورة</button>
        <button class="btn-ghost" id="cc-url">🔗 من رابط صورة</button>
      </div>
      <div class="cc-url-row" id="cc-url-row" hidden>
        <input id="cc-url-input" type="url" inputmode="url" placeholder="https://… رابط صورة الغلاف">
        <button class="btn-gold" id="cc-url-go">جلب</button>
      </div>
      <div class="ud-actions"><button class="ud-cancel">إغلاق</button>${b.cover ? '<button class="ud-ok" id="cc-reset">↺ غلاف تلقائي</button>' : ''}</div>
    </div>`;
    document.body.appendChild(overlay);
    let pending = b.cover || null;
    const prev = overlay.querySelector('#cc-prev');
    const renderPrev = () => { prev.innerHTML = pending ? `<img src="${pending}" alt="">` : coverHTML({ ...b, cover: null }); };
    renderPrev();
    const save = async (cover) => {
      await Store.updateBook(id, { cover: cover || undefined });
      b.cover = cover || undefined;
      if (window.Cloud) Cloud.pushBook(id);
      await refresh();
    };
    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.hidden = true;
    overlay.appendChild(fileInput);
    overlay.querySelector('#cc-file').onclick = () => fileInput.click();
    fileInput.onchange = async () => {
      const f = fileInput.files[0]; if (!f) return;
      const c = await imageToCover(f); if (!c) return toast('تعذّرت قراءة الصورة');
      pending = c; renderPrev(); await save(c); toast('تم تغيير الغلاف ✓', 'gold');
    };
    const urlRow = overlay.querySelector('#cc-url-row');
    overlay.querySelector('#cc-url').onclick = () => { urlRow.hidden = !urlRow.hidden; if (!urlRow.hidden) setTimeout(() => overlay.querySelector('#cc-url-input').focus(), 50); };
    const doUrl = async () => {
      const url = overlay.querySelector('#cc-url-input').value.trim();
      if (!/^https?:\/\/.+/i.test(url)) return toast('أدخل رابط صورة صحيحاً يبدأ بـ https://');
      const go = overlay.querySelector('#cc-url-go'); const o = go.textContent; go.textContent = '⏳';
      const c = await coverFromUrl(url); go.textContent = o;
      if (!c) return toast('تعذّر جلب الصورة — قد يمنع الموقع التحميل المباشر');
      pending = c; renderPrev(); urlRow.hidden = true; await save(c); toast('تم تغيير الغلاف ✓', 'gold');
    };
    overlay.querySelector('#cc-url-go').onclick = doUrl;
    overlay.querySelector('#cc-url-input').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doUrl(); } };
    overlay.querySelector('.ud-cancel').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    const reset = overlay.querySelector('#cc-reset');
    if (reset) reset.onclick = async () => { pending = null; renderPrev(); await save(null); toast('عاد الغلاف التلقائي ✓', 'gold'); };
  }

  /* استيراد عدة ملفات دفعة واحدة */
  async function bulkImport(files) {
    toast(`⏳ جارٍ استيراد ${files.length} ملفات…`);
    let n = 0;
    for (const f of files) {
      try {
        const isPdf = /\.pdf$/i.test(f.name) || f.type === 'application/pdf';
        const isEpub = /\.epub$/i.test(f.name) || f.type === 'application/epub+zip';
        const fname = f.name.replace(/\.(pdf|txt|md|epub)$/i, '').replace(/[_-]+/g, ' ').trim() || 'بدون عنوان';
        if (isEpub) {
          const p = await parseEpub(await f.arrayBuffer());
          const tid = await Store.addBook({ title: p.title || fname, author: p.author || '', category: 'أخرى', type: 'text', cover: p.cover || undefined }, p.text);
          if (window.Cloud) Cloud.pushBook(tid);
        } else if (isPdf) {
          const buf = await f.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
          const cover = await renderPdfCover(pdf);
          try { await pdf.destroy(); } catch {}
          const pid = await Store.addBook({ title: fname, author: '', category: 'أخرى', type: 'pdf', cover, pages: pdf.numPages },
            new Blob([buf], { type: 'application/pdf' }));
          if (window.Cloud) Cloud.pushBook(pid);
        } else {
          const text = await f.text();
          if (!text.trim()) continue;
          const tid = await Store.addBook({ title: fname, author: '', category: 'أخرى', type: 'text' }, text);
          if (window.Cloud) Cloud.pushBook(tid);
        }
        n++;
      } catch (err) { console.error('استيراد', f.name, err); }
    }
    await refresh();
    toast(`أُضيف ${n} من ${files.length} كتاباً إلى مكتبتك 📚`, 'gold');
  }

  /* إزالة تنويه أرشيف الإنترنت الإنجليزي المُضاف تلقائياً في مطلع كتب EPUB المولّدة آلياً.
     مُصان: يتوقّف عند أول حرف عربي أو سطر فارغ (لا يبتلع النص أبداً)، ولا يُفرّغ النص مطلقاً. */
  function stripIaPreamble(t) {
    t = String(t || '');
    const out = t
      // التنويه الإنجليزي في المطلع فقط، وحتى أول حرف عربي أو سطر فارغ
      .replace(/^\s*(?:---\s*)?This book was produced in EPUB format by the Internet Archive\.[\s\S]*?(?=[؀-ۿ]|\n\s*\n)/i, '')
      // ملاحظات دقّة المسح التي يحقنها الأرشيف في الصفحات ضعيفة الجودة (سطراً سطراً)
      .replace(/^.*The text on this page is estimated to be only[^\n]*$/gim, '')
      .replace(/^\s*(?:---\s*)+/, '')
      .trimStart();
    return out.trim() ? out : t; // أمان: لا تُرجِع نصاً فارغاً إن كان الأصل غير فارغ
  }

  /* تنظيف خفيف لنص مُستورد (OCR أرشيف الإنترنت): توحيد الأسطر وحذف الفراغات الزائدة */
  function cleanImportedText(t) {
    return stripIaPreamble(String(t || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n'))
      .trim();
  }

  /* استيراد كتاب من مصدر خارجي (مكتبة الاكتشاف): blob جاهز + بيانات وصفية غنية.
     expectedSize (اختياري) للتحقق من اكتمال التنزيل. */
  async function addRemoteBook({ blob, name, kind, title, author, category, cover, expectedSize, shelves, series }) {
    if (blob instanceof Blob && expectedSize && blob.size < expectedSize * 0.9) {
      throw new Error('التنزيل غير مكتمل — تحقّق من اتصالك وحاول مجدداً');
    }
    let id;
    if (kind === 'epub') {
      const p = await parseEpub(await blob.arrayBuffer());
      const etext = cleanImportedText(p.text);
      if (!etext.trim()) throw new Error('لم يُعثر على نص قابل للقراءة في هذه الصيغة — جرّب صيغة أخرى (PDF مثلاً)');
      id = await Store.addBook({ title: title || p.title || name, author: author || p.author || '', category: category || 'أخرى', type: 'text', cover: cover || p.cover || undefined }, etext);
    } else if (kind === 'pdf') {
      const buf = await blob.arrayBuffer();
      const head = new Uint8Array(buf.slice(0, 5));
      // %PDF- في مطلع الملف — يكشف صفحات الخطأ (HTML) التي قد يعيدها الوسيط بحالة 200
      if (!(head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)) {
        throw new Error('الملف المُنزَّل ليس PDF صالحاً — جرّب صيغة أخرى');
      }
      const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
      const pages = pdf.numPages;
      if (!pages) { try { await pdf.destroy(); } catch {} throw new Error('ملف PDF فارغ — جرّب صيغة أخرى'); }
      const c = cover || await renderPdfCover(pdf);
      try { await pdf.destroy(); } catch {}
      id = await Store.addBook({ title: title || name, author: author || '', category: category || 'أخرى', type: 'pdf', cover: c, pages,
        // أجزاء الكتاب الواحد تُجمع في رفّ باسمه كي تبقى متجاورة في المكتبة
        ...(Array.isArray(shelves) && shelves.length ? { shelves: shelves.slice() } : {}),
        // انتماء صريح لسلسلة (لا يعتمد على صيغة العنوان إن عُدِّل لاحقاً)
        ...(series && series.key ? { series: { ...series } } : {}) }, new Blob([buf], { type: 'application/pdf' }));
    } else {
      const text = cleanImportedText(typeof blob === 'string' ? blob : await blob.text());
      if (!text.trim()) throw new Error('لم يُعثر على نص قابل للقراءة في هذه الصيغة — جرّب صيغة أخرى');
      id = await Store.addBook({ title: title || name, author: author || '', category: category || 'أخرى', type: 'text', cover }, text);
    }
    if (window.Cloud) Cloud.pushBook(id);
    await refresh();
    return id;
  }

  /* سحب الملفات وإفلاتها في أي مكان بالمكتبة */
  function wireGlobalDrop() {
    const lv = $('#library-view');
    lv.addEventListener('dragover', (e) => { e.preventDefault(); });
    lv.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = [...e.dataTransfer.files].filter((f) => /\.(pdf|txt|md|epub)$/i.test(f.name) || f.type === 'application/pdf' || f.type === 'application/epub+zip' || f.type.startsWith('text/'));
      if (!files.length) return;
      if (files.length === 1) { openAddModal(); handleFile(files[0]); }
      else bulkImport(files);
    });
  }

  function openAddModal(book = null) {
    editingId = book ? book.id : null;
    pendingFile = null;
    pendingCover = null;
    origText = null;
    const isTextEdit = !!book && book.type === 'text';
    $('#add-modal-title').textContent = book ? 'تعديل الكتاب' : 'إضافة كتاب جديد';
    $('#file-chip').hidden = true;
    $('#cover-url-row').hidden = true; $('#cover-url-input').value = '';
    $('#url-chip').hidden = true;
    $('#url-input').value = '';
    $('#pane-url').hidden = true;
    $('#paste-text').value = '';
    $('#meta-title').value = book ? book.title : '';
    $('#meta-author').value = book ? book.author || '' : '';
    $('#meta-category').value = book ? book.category || 'أخرى' : 'رواية';
    $('#meta-font').value = (book && book.font) || BOOK_FONTS[0].css;
    applyEditorFont();
    // عند التعديل نخفي ألسنة المصدر؛ وللكتب النصية نعرض النص نفسه للتحرير
    $('#add-tabs').style.display = book ? 'none' : '';
    $('#replace-bar').hidden = !book;
    $('#replace-hint').hidden = true;
    $('#pane-file').hidden = !!book;
    $('#pane-paste').hidden = !isTextEdit;
    if (isTextEdit) {
      $('#paste-text').value = '⏳ جارٍ تحميل نص الكتاب…';
      Store.getPayload(book.id).then((t) => {
        origText = typeof t === 'string' ? t : '';
        $('#paste-text').value = origText;
      });
    }
    if (!book) $('#add-tabs').querySelector('[data-tab="file"]').click();
    updateCoverPreview(book);
    $('#add-modal').hidden = false;
    setTimeout(() => $('#meta-title').focus(), 80);
  }
  function closeAddModal() {
    $('#add-modal').hidden = true;
    $('#add-modal').classList.remove('editor-max');
    $('#fmt-editor').classList.remove('split');
    $('#fmt-preview-pane').hidden = true;
    const rich = $('#fmt-rich'); if (rich) { rich.hidden = true; rich.innerHTML = ''; }
    $('#paste-text').hidden = false;
    $('#fmt-toolbar').querySelectorAll('.on').forEach((b) => b.classList.remove('on'));
  }

  function updateCoverPreview(book) {
    const prev = $('#cover-preview');
    if (!book && editingId) book = books.find((x) => x.id === editingId);
    const existing = book && book.cover;
    if (pendingCover) { prev.innerHTML = `<img src="${pendingCover}">`; return; }
    if (pendingFile && pendingFile.cover) { prev.innerHTML = `<img src="${pendingFile.cover}">`; return; }
    if (existing) { prev.innerHTML = `<img src="${existing}">`; return; }
    const title = $('#meta-title').value.trim();
    if (!title) { prev.innerHTML = 'معاينة الغلاف'; return; }
    prev.innerHTML = coverHTML({ id: title, title, author: $('#meta-author').value.trim(), cover: null });
  }

  async function handleFile(file) {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    const isEpub = /\.epub$/i.test(file.name) || file.type === 'application/epub+zip';
    const isText = /\.(txt|md)$/i.test(file.name) || file.type.startsWith('text/');
    if (!isPdf && !isText && !isEpub) return toast('الرجاء اختيار ملف PDF أو EPUB أو TXT');
    const chip = $('#file-chip');
    chip.hidden = false;
    chip.textContent = `⏳ جارٍ تجهيز «${file.name}»…`;

    if (!$('#meta-title').value.trim()) {
      $('#meta-title').value = file.name.replace(/\.(pdf|txt|md|epub)$/i, '').replace(/[_-]+/g, ' ').trim();
    }

    if (isEpub) {
      try {
        const parsed = await parseEpub(await file.arrayBuffer());
        if (parsed.title) $('#meta-title').value = parsed.title;
        if (parsed.author && !$('#meta-author').value.trim()) $('#meta-author').value = parsed.author;
        pendingFile = { kind: 'text', text: parsed.text, cover: parsed.cover };
        const chapters = (parsed.text.match(/(^|\n)# /g) || []).length;
        chip.textContent = `✓ ${file.name} — كتاب EPUB${chapters ? ` · ${chapters} فصل` : ''} جاهز`;
      } catch (err) {
        console.error('epub', err);
        chip.textContent = '⚠ تعذّرت قراءة ملف EPUB';
        pendingFile = null; return;
      }
      updateCoverPreview();
      return;
    }

    if (isPdf) {
      try {
        const buf = await file.arrayBuffer();
        const blob = new Blob([buf], { type: 'application/pdf' });
        const pdf = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
        const cover = await renderPdfCover(pdf);
        try { await pdf.destroy(); } catch {}
        pendingFile = { kind: 'pdf', blob, cover, pages: pdf.numPages };
        chip.textContent = `✓ ${file.name} — ${pdf.numPages} صفحة`;
      } catch (err) {
        console.error(err);
        chip.textContent = '⚠ تعذّرت قراءة ملف الـ PDF';
        pendingFile = null;
        return;
      }
    } else {
      const text = await file.text();
      pendingFile = { kind: 'text', text };
      chip.textContent = `✓ ${file.name} — ${Math.round(text.length / 1000)} ألف حرف تقريباً`;
    }
    updateCoverPreview();
  }

  /* ─── تحويل كتاب EPUB إلى نص غني ─── */
  async function parseEpub(ab) {
    if (!window.fflate) throw new Error('fflate missing');
    const files = fflate.unzipSync(new Uint8Array(ab));
    const dec = (name) => (files[name] ? fflate.strFromU8(files[name]) : null);
    const norm = (p) => { const parts = []; p.split('/').forEach((s) => { if (s === '..') parts.pop(); else if (s !== '.' && s !== '') parts.push(s); }); return parts.join('/'); };

    // مسار OPF من container.xml
    const container = dec('META-INF/container.xml') || '';
    let opfPath = (container.match(/full-path="([^"]+)"/) || [])[1] || Object.keys(files).find((f) => /\.opf$/i.test(f));
    if (!opfPath) throw new Error('no opf');
    opfPath = norm(opfPath);
    const opfDir = opfPath.includes('/') ? opfPath.replace(/[^/]+$/, '') : '';
    const resolve = (href) => norm(opfDir + decodeURIComponent(href));

    const xml = new DOMParser().parseFromString(dec(opfPath) || '', 'application/xml');
    const byLocal = (ln) => { for (const e of xml.getElementsByTagName('*')) if (e.localName === ln) return e; return null; };
    const title = (byLocal('title') || {}).textContent ? byLocal('title').textContent.trim() : '';
    const author = (byLocal('creator') || {}).textContent ? byLocal('creator').textContent.trim() : '';

    const manifest = {};
    for (const it of xml.getElementsByTagName('item')) manifest[it.getAttribute('id')] = { href: it.getAttribute('href'), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' };
    const spine = [...xml.getElementsByTagName('itemref')].map((ir) => ir.getAttribute('idref'));

    // الغلاف
    let cover = null, coverItem = null;
    for (const m of xml.getElementsByTagName('meta')) if (m.getAttribute('name') === 'cover') coverItem = manifest[m.getAttribute('content')];
    if (!coverItem) for (const id in manifest) if (/cover-image/.test(manifest[id].props)) { coverItem = manifest[id]; break; }
    if (coverItem && /image/.test(coverItem.type)) {
      const p = resolve(coverItem.href);
      if (files[p]) { try { cover = await imageToCover(new Blob([files[p]], { type: coverItem.type })); } catch {} }
    }

    // الفصول بترتيب القراءة
    const chapters = [];
    for (const idref of spine) {
      const item = manifest[idref];
      if (!item || !/(html|xml)/i.test(item.type)) continue;
      const html = dec(resolve(item.href));
      if (!html) continue;
      const md = xhtmlToMarkup(html);
      if (md.trim()) chapters.push(md.trim());
    }
    return { title, author, cover, text: chapters.join('\n\n---\n\n') || '(كتاب فارغ)' };
  }

  function xhtmlToMarkup(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const body = doc.body;
    if (!body) return '';
    const lines = [];
    const inline = (el) => {
      let s = '';
      el.childNodes.forEach((n) => {
        if (n.nodeType === 3) s += n.textContent;
        else if (n.nodeType === 1) {
          const tag = n.tagName.toLowerCase(), inner = inline(n);
          if (tag === 'b' || tag === 'strong') s += inner.trim() ? '**' + inner.trim() + '**' : '';
          else if (tag === 'i' || tag === 'em') s += inner.trim() ? '_' + inner.trim() + '_' : '';
          else if (tag === 'br') s += ' ';
          else s += inner;
        }
      });
      return s.replace(/\s+/g, ' ');
    };
    const walk = (el) => {
      el.childNodes.forEach((n) => {
        if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) lines.push(t); return; }
        if (n.nodeType !== 1) return;
        const tag = n.tagName.toLowerCase();
        if (/^h[1-6]$/.test(tag)) { const t = inline(n).trim(); if (t) lines.push((tag === 'h1' ? '# ' : tag === 'h2' ? '## ' : '### ') + t); }
        else if (tag === 'p') { const t = inline(n).trim(); if (t) lines.push(t); }
        else if (tag === 'blockquote') { const t = inline(n).trim(); if (t) lines.push('> ' + t); }
        else if (tag === 'li') { const t = inline(n).trim(); if (t) lines.push('- ' + t); }
        else if (tag === 'hr') lines.push('---');
        else if (['script', 'style', 'head', 'nav'].includes(tag)) { /* تجاهل */ }
        else if (['div', 'section', 'article', 'ul', 'ol', 'main', 'header', 'footer', 'span', 'a', 'figure'].includes(tag)) walk(n);
        else { const t = inline(n).trim(); if (t) lines.push(t); }
      });
    };
    walk(body);
    return lines.join('\n');
  }

  async function renderPdfCover(pdf) {
    try {
      const page = await pdf.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const scale = 320 / vp.width;
      const v2 = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = v2.width; c.height = v2.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: v2, intent: 'print' }).promise;
      return c.toDataURL('image/jpeg', 0.82);
    } catch { return null; }
  }

  async function saveBook() {
    syncRichEditor(); // انقل تنسيق المحرّر المباشر إلى النص قبل الحفظ
    const title = $('#meta-title').value.trim();
    if (!title) return toast('اكتب عنوان الكتاب أولاً');
    const meta = {
      title,
      author: $('#meta-author').value.trim(),
      category: $('#meta-category').value,
      font: $('#meta-font').value,
    };
    if (pendingCover) meta.cover = pendingCover;

    if (editingId) {
      const b = books.find((x) => x.id === editingId);
      // (أ) استبدال ملف الكتاب بصيغة جديدة (PDF / EPUB / نص)
      if (pendingFile) {
        if (!(await uiConfirm('استبدال محتوى الكتاب بالملف الجديد سيصفّر موضع القراءة والتظليلات والملاحظات.', { title: 'استبدال المحتوى؟', okText: 'استبدل', danger: true }))) return;
        if (pendingFile.kind === 'pdf') {
          meta.type = 'pdf'; meta.pages = pendingFile.pages;
          if (!pendingCover) meta.cover = pendingFile.cover;
          await Store.updatePayload(editingId, pendingFile.blob);
        } else { // نص (يشمل EPUB المحوّل)
          meta.type = 'text'; meta.pages = undefined;
          if (pendingFile.cover && !pendingCover) meta.cover = pendingFile.cover;
          await Store.updatePayload(editingId, pendingFile.text);
        }
        // تصفير حالة القراءة لأن المحتوى تغيّر
        const st = await Store.getState(editingId);
        Object.assign(st, { pct: 0, page: 0, scrollTop: 0, finished: false, highlights: [], pageNotes: [], drawings: {}, bookmarks: [] });
        await Store.saveState(st);
        try { await Store.saveFulltext(editingId, undefined); } catch {}
        await Store.updateBook(editingId, meta);
        if (window.Cloud) { Cloud.pushBook(editingId); Cloud.pushState(editingId); }
        closeAddModal(); await refresh();
        return toast('استُبدل ملف الكتاب ✓', 'gold');
      }
      // (ب) تحديث نص الكتاب النصي إن عُدّل
      if (b && b.type === 'text' && origText !== null) {
        const newText = $('#paste-text').value;
        if (!newText.trim()) return toast('نص الكتاب لا يمكن أن يكون فارغاً');
        if (newText !== origText) {
          const st = await Store.getState(editingId);
          if ((st.highlights || []).length &&
              !(await uiConfirm('تعديل النص قد يُزيح مواضع التظليلات والملاحظات الحالية عن أماكنها.', { title: 'تعديل النص؟', okText: 'تابع التعديل' }))) return;
          await Store.updatePayload(editingId, newText);
        }
      }
      await Store.updateBook(editingId, meta);
      if (window.Cloud) Cloud.pushBook(editingId);
      closeAddModal(); await refresh();
      return toast('حُدّث الكتاب ✓', 'gold');
    }

    const pasted = $('#paste-text').value.trim();
    let payload = null;
    if (pendingFile && pendingFile.kind === 'pdf') {
      meta.type = 'pdf'; meta.cover = pendingCover || pendingFile.cover; meta.pages = pendingFile.pages;
      payload = pendingFile.blob;
    } else if (pendingFile && pendingFile.kind === 'text') {
      meta.type = 'text'; payload = pendingFile.text;
      if (pendingFile.cover && !pendingCover) meta.cover = pendingFile.cover; // غلاف EPUB
    } else if (pasted) {
      meta.type = 'text'; payload = pasted;
    } else {
      return toast('أضف ملفاً أو الصق نصاً أولاً');
    }

    const newId = await Store.addBook(meta, payload);
    if (window.Cloud) Cloud.pushBook(newId);
    closeAddModal(); await refresh();
    toast(`أُضيف «${title}» إلى مكتبتك 📚`, 'gold');
  }

  /* ─── سمات المكتبة ─── */
  const LIB_THEMES = [
    { id: 'purple', label: 'بنفسجي فاخر', bg: '#0e0b16', glow: '#4b2d7f', dot: '#d9a94f' },
    { id: 'blue', label: 'أزرق ليلي', bg: '#0a0f1e', glow: '#2d5a9f', dot: '#d9a94f' },
    { id: 'emerald', label: 'زمردي', bg: '#08130f', glow: '#2d7f5a', dot: '#e0b45a' },
    { id: 'wine', label: 'نبيذي', bg: '#160a0e', glow: '#7f2d4a', dot: '#d9a94f' },
    { id: 'charcoal', label: 'فحمي', bg: '#121316', glow: '#4a4f5a', dot: '#d9a94f' },
    { id: 'sepia', label: 'رملي دافئ', bg: '#17120b', glow: '#7f5a2d', dot: '#d9a94f' },
    { id: 'indigo', label: 'نيلي', bg: '#0c0a1e', glow: '#3d3da5', dot: '#d9a94f' },
    { id: 'teal', label: 'بحري', bg: '#071518', glow: '#2d7f7a', dot: '#e0b45a' },
    { id: 'rose', label: 'وردي', bg: '#1a0a12', glow: '#9f2d6a', dot: '#d9a94f' },
    { id: 'paper', label: 'ورقي فاتح', bg: '#efe7d4', glow: '#d8c49a', dot: '#a9782e' },
  ];
  function applyLibTheme(id) {
    if (id && id !== 'purple') document.documentElement.setAttribute('data-lib-theme', id);
    else document.documentElement.removeAttribute('data-lib-theme');
    try { localStorage.setItem('midad-lib-theme', id || 'purple'); } catch {}
  }
  // إعدادات وصلت من جهاز آخر: طبّق سمة المكتبة فوراً
  window.addEventListener('midad-settings-adopted', () => {
    let t = 'purple'; try { t = localStorage.getItem('midad-lib-theme') || 'purple'; } catch {}
    applyLibTheme(t);
  });
  function openThemePicker() {
    let cur = 'purple'; try { cur = localStorage.getItem('midad-lib-theme') || 'purple'; } catch {}
    document.querySelectorAll('.ui-dialog').forEach((m) => m.remove());
    const overlay = document.createElement('div');
    overlay.className = 'ui-dialog';
    overlay.innerHTML = `<div class="ud-box" style="max-width:460px" role="dialog" aria-modal="true">
      <div class="ud-icon">🎨</div><h3>سمة المكتبة</h3>
      <div class="theme-grid">${LIB_THEMES.map((t) => `
        <button class="theme-swatch ${t.id === cur ? 'on' : ''}" data-id="${t.id}" title="${esc(t.label)}">
          <span class="ts-fill" style="background:radial-gradient(130% 100% at 82% 0%, ${t.glow}, ${t.bg} 68%)"></span>
          <span class="ts-name">${esc(t.label)}</span>
          <span class="ts-dot" style="background:${t.dot}"></span>
          <span class="ts-check">✓</span>
        </button>`).join('')}</div>
      <div class="ud-actions"><button class="ud-cancel">تمّ</button></div></div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.ud-cancel').onclick = close;
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    overlay.querySelectorAll('.theme-swatch').forEach((sw) => sw.onclick = () => {
      applyLibTheme(sw.dataset.id);
      if (Store.markSettingsChanged) Store.markSettingsChanged();
      overlay.querySelectorAll('.theme-swatch').forEach((x) => x.classList.toggle('on', x === sw));
    });
  }

  /* ─── قائمة المكتبة: إحصائيات + نسخ احتياطي ─── */
  function wireLibMenu() {
    $('#btn-lib-menu').onclick = (e) => {
      closeCardMenu();
      const menu = document.createElement('div');
      menu.className = 'bc-menu';
      menu.innerHTML = `
        <button data-act="libai">🔍 اسأل مكتبتك</button>
        <button data-act="review">🃏 مراجعة البطاقات${reviewDueCount ? ` <i class="menu-badge">${reviewDueCount}</i>` : ''}</button>
        <button data-act="stats">📊 إحصائيات قراءتك</button>
        <button data-act="theme">🎨 سمة المكتبة</button>
        <button data-act="keys">🔑 فحص مفاتيح الذكاء</button>
        <button data-act="backup">📦 تصدير نسخة احتياطية</button>
        <button data-act="restore">📥 استيراد نسخة احتياطية</button>`;
      document.body.appendChild(menu);
      const r = e.currentTarget.getBoundingClientRect();
      menu.style.top = r.bottom + 8 + 'px';
      menu.style.left = Math.max(10, r.left - menu.offsetWidth + r.width) + 'px';
      menu.onclick = (ev) => {
        const act = ev.target.dataset.act;
        closeCardMenu();
        if (act === 'stats') openStats();
        else if (act === 'theme') openThemePicker();
        else if (act === 'review') openReview();
        else if (act === 'libai') openLibAI();
        else if (act === 'keys') checkAiKeys();
        else if (act === 'backup') exportBackup();
        else if (act === 'restore') $('#import-input').click();
      };
      setTimeout(() => document.addEventListener('pointerdown', (ev) => { if (!menu.contains(ev.target)) closeCardMenu(); }, { once: true }));
    };
    $('#import-input').onchange = (e) => {
      if (e.target.files[0]) importBackup(e.target.files[0]);
      e.target.value = '';
    };
    const sm = $('#stats-modal');
    sm.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => (sm.hidden = true)));
    sm.onclick = (e) => { if (e.target === sm) sm.hidden = true; };
  }

  // فحص مفاتيح الذكاء المُحمّلة في دالة الخادم (للتأكد من تعدّدها وتمايزها)
  async function checkAiKeys() {
    if (!window.Cloud || !Cloud.aiReady || !Cloud.aiReady()) {
      return toast('فعّل المزامنة وسجّل الدخول أولاً');
    }
    toast('⏳ جارٍ الفحص…');
    try {
      const res = await Cloud.aiInvoke({ action: 'diag' });
      await uiConfirm(
        `${res}\n\nملاحظة: تعدّد المفاتيح يفيد فقط إذا كان كل مفتاح من حساب Google مختلف (حصص منفصلة). المفاتيح من نفس الحساب تتشارك الحصّة.`,
        { title: '🔑 مفاتيح الذكاء', okText: 'حسناً', cancelText: 'إغلاق', icon: '🔑' });
    } catch (e) {
      toast('تعذّر الفحص: ' + ((e && e.message) || 'خطأ'));
    }
  }

  /* ─── اسأل مكتبتك: بحث ذكي عبر كل الكتب (RAG مبسّط) ─── */
  let reviewDueCount = 0;

  /* ─── مراجعة البطاقات بالتكرار المتباعد (نظام Leitner) ─── */
  const SRS_INTERVALS = [0, 6e5, 864e5, 2592e5, 6048e5, 1382e5 * 10]; // box0غير مستخدم:10د،1ي،3ي،7ي،16ي
  async function openReview() {
    const modal = $('#review-modal'), body = $('#review-body');
    modal.hidden = false;
    modal.querySelectorAll('[data-close]').forEach((btn) => (btn.onclick = () => { modal.hidden = true; refresh(); }));
    modal.onclick = (e) => { if (e.target === modal) { modal.hidden = true; refresh(); } };

    const now = Date.now();
    const decks = await Store.getAllDecks();
    // اجمع البطاقات المستحقّة مع مرجع كتابها
    const queue = [];
    const deckMap = {}; // bookId → cards (للتعديل والحفظ)
    for (const d of decks) {
      deckMap[d.bookId] = d.cards || [];
      const bk = books.find((x) => x.id === d.bookId);
      for (const c of (d.cards || [])) if ((c.due || 0) <= now) queue.push({ bookId: d.bookId, card: c, title: bk ? bk.title : '' });
    }
    if (!queue.length) {
      const total = decks.reduce((n, d) => n + (d.cards || []).length, 0);
      body.innerHTML = `<div class="rev-done">${total ? '🎉 أحسنت! لا بطاقات مستحقّة للمراجعة الآن.<br><span>عُد لاحقاً — ستُذكّرك البطاقات في وقتها.</span>' : '🃏 لا بطاقات محفوظة بعد.<br><span>وّلد بطاقات مراجعة من مساعد القراءة داخل أي كتاب، واضغط «احفظ للمراجعة».</span>'}</div>`;
      return;
    }
    // خلط
    for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }

    let idx = 0, reviewed = 0;
    const dirty = new Set();
    const saveDirty = async () => { for (const id of dirty) { await Store.saveDeck(id, deckMap[id]); if (window.Cloud) Cloud.pushDeck(id); } dirty.clear(); };

    const showCard = () => {
      if (idx >= queue.length) {
        body.innerHTML = `<div class="rev-done">🎉 أنهيت المراجعة! راجعتَ ${reviewed} بطاقة.<br><span>عُد غداً لتثبيت ما تعلّمت.</span></div>`;
        saveDirty();
        return;
      }
      const item = queue[idx];
      body.innerHTML = `
        <div class="rev-progress">بطاقة ${idx + 1} من ${queue.length}${item.title ? ` · <span>${esc(item.title)}</span>` : ''}</div>
        <div class="rev-card"><div class="rev-q">${esc(item.card.q)}</div><div class="rev-a" id="rev-a" hidden>${esc(item.card.a)}</div></div>
        <div class="rev-actions" id="rev-actions">
          <button class="btn-gold rev-show" id="rev-show">أظهر الجواب</button>
        </div>`;
      $('#rev-show').onclick = () => {
        $('#rev-a').hidden = false;
        $('#rev-actions').innerHTML = `
          <button class="rev-again" data-g="0">لم أتذكّر ✗</button>
          <button class="rev-good" data-g="1">أتذكّر ✓</button>`;
        $('#rev-actions').querySelectorAll('button').forEach((b) => (b.onclick = () => grade(+b.dataset.g)));
      };
    };
    const grade = (good) => {
      const c = queue[idx].card;
      if (good) { c.box = Math.min((c.box || 1) + 1, 5); c.due = Date.now() + SRS_INTERVALS[c.box]; }
      else { c.box = 1; c.due = Date.now() + 6e4; } // أعِدها بعد دقيقة ضمن الجلسة
      c.mt = Date.now(); // ختم المراجعة — يحسم التعارض عند المزامنة بين الأجهزة
      dirty.add(queue[idx].bookId);
      reviewed++; idx++;
      showCard();
    };
    showCard();
  }

  let libAiWired = false, libAiBusy = false;
  function openLibAI() {
    if (!window.Cloud || !Cloud.aiReady || !Cloud.aiReady()) {
      const cfg = window.Cloud && Cloud.isConfigured && Cloud.isConfigured();
      return toast(cfg ? 'سجّل الدخول (زر السحابة) لاستخدام «اسأل مكتبتك»' : '«اسأل مكتبتك» يحتاج تفعيل المزامنة السحابية');
    }
    const modal = $('#libai-modal');
    modal.hidden = false;
    if (!libAiWired) {
      libAiWired = true;
      modal.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => (modal.hidden = true)));
      modal.onclick = (e) => { if (e.target === modal) modal.hidden = true; };
      $('#libai-send').onclick = () => askLibrary();
      $('#libai-input').onkeydown = (e) => { if (e.key === 'Enter') askLibrary(); };
    }
    setTimeout(() => $('#libai-input').focus(), 80);
  }

  function libAiMsg(kind, html) {
    const el = document.createElement('div');
    el.className = 'ai-msg ' + kind; el.innerHTML = html;
    const hint = $('#libai-body').querySelector('.ai-hint'); if (hint) hint.remove();
    $('#libai-body').appendChild(el);
    $('#libai-body').scrollTop = $('#libai-body').scrollHeight;
    return el;
  }

  async function askLibrary() {
    if (libAiBusy) return;
    const q = $('#libai-input').value.trim();
    if (!q) return;
    $('#libai-input').value = '';
    libAiMsg('user', esc(q));
    const loading = libAiMsg('ai loading', '<span class="ai-typing"><i></i><i></i><i></i></span>');
    libAiBusy = true;
    try {
      // اجمع مقتطفات ذات صلة من نصوص الكتب المتاحة (نصية + PDF مفهرس/مُستخرَج)
      // نُبقي الحروف العربية واللاتينية والأرقام فقط (نحذف علامات الترقيم والتشكيل)
      const words = [...new Set(q.split(/\s+/).map((w) => w.replace(/[^ء-يa-zA-Z0-9]/g, '')).filter((w) => w.length >= 3))];
      const snippets = [];
      for (const b of books) {
        if (snippets.length >= 30) break;
        const s = await searchableOf(b, false); // المُخزَّن فقط (سرعة)
        if (!s || !s.text) continue;
        for (const w of words) {
          for (const h of findHits(s.text, w, 2)) {
            let page = '';
            if (b.type === 'pdf' && s.pageStarts) { let pg = 1; for (let k = 0; k < s.pageStarts.length; k++) if (s.pageStarts[k] <= h.off) pg = k + 1; page = ' ص ' + pg; }
            snippets.push(`من كتاب «${b.title}»${page}: …${snippetClean(h.before + h.hit + h.after)}…`);
          }
        }
      }
      const ctx = [...new Set(snippets)].slice(0, 18).join('\n\n');
      if (!ctx) {
        loading.classList.remove('loading');
        loading.innerHTML = 'لم أجد نصاً ذا صلة في مكتبتك. تأكّد من فهرسة كتبك: افتح الكتب المصوّرة مرّة (أو استخرج نصها)، ثم أعد المحاولة.';
        return;
      }
      const res = await Cloud.aiInvoke({ action: 'library', question: q, text: ctx });
      loading.classList.remove('loading');
      loading.innerHTML = (window.Reader && Reader.mdToHtml) ? Reader.mdToHtml(res) : esc(res).replace(/\n/g, '<br>');
    } catch (e) {
      loading.classList.remove('loading'); loading.classList.add('err');
      loading.innerHTML = '⚠ ' + esc((e && e.message) || 'تعذّر الحصول على رد');
    } finally { libAiBusy = false; $('#libai-body').scrollTop = $('#libai-body').scrollHeight; }
  }

  function openStats() {
    let totalSec = 0, notes = 0, marks = 0, fin = 0, reading = 0, drawings = 0;
    const rows = [];
    for (const b of books) {
      const s = states[b.id];
      totalSec += s.seconds || 0;
      notes += (s.highlights || []).length + (s.pageNotes || []).length;
      marks += (s.bookmarks || []).length;
      drawings += Object.values(s.drawings || {}).reduce((a, arr) => a + arr.length, 0);
      if (s.finished) fin++; else if (s.pct > 0) reading++;
      if ((s.seconds || 0) > 30) rows.push({ title: b.title, sec: s.seconds, pct: s.pct, fin: s.finished });
    }
    rows.sort((a, b) => b.sec - a.sec);

    // ── لوحة الإنجاز: السلسلة + الهدف اليومي + خريطة النشاط ──
    const log = Store.getCombinedLog ? Store.getCombinedLog() : Store.getLog(); // قراءتك على كل أجهزتك
    const goal = Store.getGoal();
    const streak = Store.getStreak();
    const todaySec = log[Store.todayKey()] || 0;
    const todayMin = Math.round(todaySec / 60);
    const goalPct = Math.min(100, Math.round((todayMin / goal) * 100));
    const daysRead = Object.values(log).filter((s) => s >= 1).length;
    // خريطة نشاط آخر ٣٥ يوماً
    const heat = [];
    const dref = new Date();
    for (let i = 34; i >= 0; i--) {
      const d = new Date(dref); d.setDate(d.getDate() - i);
      const sec = log[Store.todayKey(d)] || 0;
      const min = sec / 60;
      let lvl = 0;
      if (min >= 1) lvl = 1; if (min >= goal * 0.5) lvl = 2; if (min >= goal) lvl = 3; if (min >= goal * 2) lvl = 4;
      heat.push({ lvl, min: Math.round(min), label: Store.todayKey(d) });
    }
    // ── ملخّص أسبوعي/شهري: مجاميع من سجلّ الدقائق اليومي ──
    const sumRange = (fromDaysAgo, toDaysAgo) => { // [from..to] بالأيام قبل اليوم (0 = اليوم)
      let sec = 0;
      for (let i = toDaysAgo; i <= fromDaysAgo; i++) {
        const d = new Date(dref); d.setDate(d.getDate() - i);
        sec += log[Store.todayKey(d)] || 0;
      }
      return sec;
    };
    const weekSec = sumRange(6, 0), prevWeekSec = sumRange(13, 7), monthSec = sumRange(29, 0);
    const activeDays30 = (() => { let n = 0; for (let i = 0; i < 30; i++) { const d = new Date(dref); d.setDate(d.getDate() - i); if ((log[Store.todayKey(d)] || 0) >= 60) n++; } return n; })();
    const avgPerActive = activeDays30 ? Math.round(monthSec / activeDays30 / 60) : 0;
    // فرق الأسبوع عن سابقه (يُعرض كاتجاه واضح)
    let trend = '';
    if (prevWeekSec >= 60 || weekSec >= 60) {
      const diff = weekSec - prevWeekSec;
      const pct = prevWeekSec >= 60 ? Math.round((diff / prevWeekSec) * 100) : (weekSec >= 60 ? 100 : 0);
      const up = diff >= 0;
      trend = `<span class="wk-trend ${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(pct)}٪ عن الأسبوع الماضي</span>`;
    }
    // رسم أعمدة لآخر ١٤ يوماً (قراءة سريعة لإيقاعك)
    const bars = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(dref); d.setDate(d.getDate() - i);
      bars.push({ min: Math.round((log[Store.todayKey(d)] || 0) / 60), dow: d.toLocaleDateString('ar', { weekday: 'narrow' }), key: Store.todayKey(d), today: i === 0 });
    }
    const barMax = Math.max(goal, ...bars.map((b2) => b2.min), 1);

    const ring = (pct) => {
      const R = 34, C = 2 * Math.PI * R, off = C * (1 - pct / 100);
      return `<svg class="goal-ring" viewBox="0 0 80 80"><circle cx="40" cy="40" r="${R}" class="gr-bg"/><circle cx="40" cy="40" r="${R}" class="gr-fg" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg>`;
    };

    $('#stats-body').innerHTML = `
      <div class="dash-hero">
        <div class="dash-streak">
          <div class="ds-flame ${streak > 0 ? 'lit' : ''}">🔥</div>
          <div><b>${streak}</b><span>${streak === 1 ? 'يوم متتابع' : 'يوماً متتابعاً'}</span></div>
        </div>
        <div class="dash-goal">
          <div class="goal-ring-wrap">${ring(goalPct)}<div class="gr-label"><b>${todayMin}</b><span>من ${goal} د</span></div></div>
          <label class="goal-set">هدفي اليومي
            <span class="goal-stepper"><button id="goal-minus">−</button><i id="goal-val">${goal}</i><button id="goal-plus">+</button><em>دقيقة</em></span>
          </label>
        </div>
      </div>

      <div class="wk-summary">
        <div class="wk-card"><b>${Math.round(weekSec / 60)}<em>د</em></b><span>هذا الأسبوع</span>${trend}</div>
        <div class="wk-card"><b>${Math.round(monthSec / 60)}<em>د</em></b><span>آخر ٣٠ يوماً</span></div>
        <div class="wk-card"><b>${avgPerActive}<em>د</em></b><span>معدّل يوم القراءة</span></div>
      </div>

      <div class="bars-wrap">
        <h4>آخر ١٤ يوماً <small>الخطّ المتقطّع = هدفك (${goal} د)</small></h4>
        <div class="bars-grid" style="--goalr:${(goal / barMax).toFixed(3)}">
          ${bars.map((b2) => `<i class="bar-col${b2.today ? ' today' : ''}${b2.min >= goal ? ' hit' : ''}" title="${b2.key}: ${b2.min} د"><u style="height:${Math.round((b2.min / barMax) * 100)}%"></u><s>${b2.dow}</s></i>`).join('')}
        </div>
      </div>

      <div class="heat-wrap">
        <h4>نشاط آخر ٥ أسابيع <small>${daysRead} يوم قراءة إجمالاً</small></h4>
        <div class="heat-grid">${heat.map((h) => `<i class="heat-cell l${h.lvl}" title="${h.label}: ${h.min} د"></i>`).join('')}</div>
      </div>

      <div class="stats-grid">
        <div class="stat-card"><b>${books.length}</b><span>كتاب في المكتبة</span></div>
        <div class="stat-card"><b>${fin}</b><span>أنهيتها</span></div>
        <div class="stat-card"><b>${reading}</b><span>قيد القراءة</span></div>
        <div class="stat-card"><b>${fmtDuration(totalSec)}</b><span>إجمالي وقت القراءة</span></div>
        <div class="stat-card"><b>${notes}</b><span>تظليل وملاحظة</span></div>
        <div class="stat-card"><b>${marks}</b><span>علامة مرجعية</span></div>
      </div>
      ${rows.length ? `<div class="stats-list"><h4>أكثر الكتب قراءةً</h4>
        ${rows.slice(0, 6).map((r) => `
          <div class="stat-row">
            <span class="sr-title">${r.fin ? '✅ ' : ''}${esc(r.title)}</span>
            <span class="sr-time">${fmtDuration(r.sec)}</span>
            <span class="sr-pct">${Math.round(r.pct * 100)}٪</span>
          </div>`).join('')}</div>` : '<p style="color:#9a92ad;text-align:center">ابدأ القراءة لتتجمع إحصائياتك هنا ✨</p>'}`;

    const setG = (v) => { Store.setGoal(v); openStats(); };
    $('#goal-minus').onclick = () => setG(Math.max(1, goal - 5));
    $('#goal-plus').onclick = () => setG(goal + 5);
    $('#stats-modal').hidden = false;
  }

  // كل مفاتيح الإعدادات المحلية (midad-*) لتُحفظ وتُستعاد ضمن النسخة الاحتياطية
  function collectLocalSettings() {
    const s = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf('midad') === 0) s[k] = localStorage.getItem(k); } } catch {}
    return s;
  }

  // نسخة احتياطية كاملة كملف ZIP: بيان + ملفات الكتب + النص المفهرس (أخفّ بكثير من base64)
  async function exportBackup() {
    toast('⏳ جارٍ تجهيز النسخة الاحتياطية…');
    try {
      const zipObj = {};
      const items = [];
      for (const b of books) {
        const payload = await Store.getPayload(b.id);
        const state = await Store.getState(b.id);
        let deck = null; try { deck = await Store.getDeck(b.id); } catch {}
        let fulltext = null; try { fulltext = await Store.getFulltext(b.id); } catch {}
        const it = { meta: b, state, deck: deck || null };
        if (payload instanceof Blob) {
          it.payloadKind = 'pdf'; it.payloadFile = `files/${b.id}.pdf`;
          zipObj[it.payloadFile] = [new Uint8Array(await payload.arrayBuffer()), { level: 0 }]; // PDF مضغوط أصلاً
        } else {
          it.payloadKind = 'text'; it.payloadFile = `files/${b.id}.txt`;
          zipObj[it.payloadFile] = [fflate.strToU8(payload || ''), { level: 8 }];
        }
        if (fulltext != null) {
          it.fulltextFile = `fulltext/${b.id}.txt`;
          const ft = typeof fulltext === 'string' ? fulltext : JSON.stringify(fulltext);
          zipObj[it.fulltextFile] = [fflate.strToU8(ft), { level: 8 }];
          it.fulltextObj = typeof fulltext === 'string' ? 0 : 1; // 1 = كان كائناً (JSON)
        }
        items.push(it);
      }
      const manifest = { app: 'midad', version: 2, exportedAt: Date.now(), settings: collectLocalSettings(), books: items };
      zipObj['manifest.json'] = [fflate.strToU8(JSON.stringify(manifest)), { level: 8 }];
      const zipped = fflate.zipSync(zipObj);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([zipped], { type: 'application/zip' }));
      a.download = `مِداد - نسخة احتياطية ${new Date().toISOString().slice(0, 10)}.midad.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`صُدّرت مكتبتك كاملة (${items.length} كتاباً) 📦`, 'gold');
    } catch (err) { console.error(err); toast('تعذّر إنشاء النسخة الاحتياطية'); }
  }

  async function importBackup(file) {
    try {
      const ab = await file.arrayBuffer();
      const bytes = new Uint8Array(ab);
      if (bytes[0] === 0x50 && bytes[1] === 0x4B) { await importBackupZip(bytes); return; } // ZIP (PK)
      // نسق قديم (JSON مع base64)
      const data = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      if (data.app !== 'midad' || !Array.isArray(data.books)) throw new Error('bad format');
      toast(`⏳ جارٍ استيراد ${data.books.length} كتاباً…`);
      let n = 0;
      for (const it of data.books) {
        let payload = it.payload;
        if (it.payloadKind === 'pdf') payload = await (await fetch(it.payload)).blob();
        await Store.addBook(it.meta, payload);
        if (it.state) { it.state.bookId = it.meta.id; await Store.saveState(it.state); }
        if (window.Cloud) Cloud.pushBook(it.meta.id);
        n++;
      }
      await refresh();
      toast(`استُعيد ${n} كتاباً بكل ملاحظاتها وتقدمها ✓`, 'gold');
    } catch (err) { console.error(err); toast('ملف النسخة الاحتياطية غير صالح'); }
  }

  async function importBackupZip(bytes) {
    const files = fflate.unzipSync(bytes);
    if (!files['manifest.json']) throw new Error('no manifest');
    const manifest = JSON.parse(fflate.strFromU8(files['manifest.json']));
    if (manifest.app !== 'midad' || !Array.isArray(manifest.books)) throw new Error('bad format');
    toast(`⏳ جارٍ استيراد ${manifest.books.length} كتاباً…`);
    // استعد الإعدادات المحلية (سمة، عرض، أهداف…)
    if (manifest.settings) { try { for (const k in manifest.settings) localStorage.setItem(k, manifest.settings[k]); } catch {} }
    let n = 0;
    for (const it of manifest.books) {
      const raw = files[it.payloadFile];
      let payload;
      if (it.payloadKind === 'pdf') payload = raw ? new Blob([raw], { type: 'application/pdf' }) : null;
      else payload = raw ? fflate.strFromU8(raw) : '';
      await Store.addBook(it.meta, payload);
      if (it.state) { it.state.bookId = it.meta.id; await Store.saveState(it.state); }
      if (it.deck && it.deck.cards) { try { await Store.saveDeck(it.meta.id, it.deck.cards); } catch {} }
      if (it.fulltextFile && files[it.fulltextFile]) {
        try { const ft = fflate.strFromU8(files[it.fulltextFile]); await Store.saveFulltext(it.meta.id, it.fulltextObj ? JSON.parse(ft) : ft); } catch {}
      }
      if (window.Cloud) Cloud.pushBook(it.meta.id);
      n++;
    }
    await refresh();
    toast(`استُعيد ${n} كتاباً بملاحظاتها وبطاقاتها وإعداداتها ✓`, 'gold');
  }

  /* ─── أدوات عامة ─── */
  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    $('#toast-wrap').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }

  /* ─── بطاقة الإنجاز: صورة أنيقة تُحفظ أو تُشارك عند إنهاء كتاب ─── */
  const CARD_W = 1080, CARD_H = 1350;

  // يلفّ نصاً عربياً على أسطر بعرض محدّد (رسم الكانفا لا يلفّ تلقائياً)
  function wrapLines(ctx, text, maxW, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= maxW) cur = t;
      else { if (cur) lines.push(cur); cur = w; if (lines.length === maxLines) break; }
    }
    if (cur && lines.length < maxLines) lines.push(cur);
    if (lines.length === maxLines && lines.join(' ').length < String(text).trim().length) {
      lines[maxLines - 1] = lines[maxLines - 1].replace(/[\s،.]+$/, '') + '…';
    }
    return lines;
  }

  const loadImg = (src) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });

  async function buildFinishCard(b, st) {
    // حمّل الخطوط أولاً وإلا رُسمت البطاقة بخطّ بديل
    try { await document.fonts.load("700 64px 'Amiri'"); await document.fonts.load("400 30px 'Noto Naskh Arabic'"); await document.fonts.ready; } catch {}
    const cv = document.createElement('canvas');
    cv.width = CARD_W; cv.height = CARD_H;
    const x = cv.getContext('2d');
    x.direction = 'rtl'; x.textAlign = 'center';

    // خلفية ليلية + وهج ذهبي علوي
    const g = x.createLinearGradient(0, 0, 0, CARD_H);
    g.addColorStop(0, '#2a2140'); g.addColorStop(0.55, '#1d1730'); g.addColorStop(1, '#151122');
    x.fillStyle = g; x.fillRect(0, 0, CARD_W, CARD_H);
    const glow = x.createRadialGradient(CARD_W / 2, 150, 20, CARD_W / 2, 150, 620);
    glow.addColorStop(0, 'rgba(217,169,79,.22)'); glow.addColorStop(1, 'rgba(217,169,79,0)');
    x.fillStyle = glow; x.fillRect(0, 0, CARD_W, 780);

    x.strokeStyle = 'rgba(217,169,79,.34)'; x.lineWidth = 3;
    x.strokeRect(40, 40, CARD_W - 80, CARD_H - 80);

    x.fillStyle = '#d9a94f'; x.font = "400 34px 'Noto Naskh Arabic', serif";
    x.fillText('✦  أنهيتُ قراءة  ✦', CARD_W / 2, 140);

    // الغلاف (أو غلاف مولَّد إن لم يوجد)
    const coverW = 340, coverH = 480, coverX = (CARD_W - coverW) / 2, coverY = 190;
    x.save();
    x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 40; x.shadowOffsetY = 14;
    const img = b.cover ? await loadImg(b.cover) : null;
    if (img) x.drawImage(img, coverX, coverY, coverW, coverH);
    else {
      const cg = x.createLinearGradient(coverX, coverY, coverX, coverY + coverH);
      cg.addColorStop(0, '#4a4270'); cg.addColorStop(1, '#2d2748');
      x.fillStyle = cg; x.fillRect(coverX, coverY, coverW, coverH);
      x.shadowColor = 'transparent';
      x.fillStyle = '#e8dcc0'; x.font = "700 40px 'Amiri', serif";
      wrapLines(x, b.title, coverW - 50, 4).forEach((ln, i) => x.fillText(ln, CARD_W / 2, coverY + 150 + i * 54));
    }
    x.restore();
    x.strokeStyle = 'rgba(255,255,255,.14)'; x.lineWidth = 2;
    x.strokeRect(coverX, coverY, coverW, coverH);

    // العنوان والمؤلف
    let y = coverY + coverH + 92;
    x.fillStyle = '#f5efe2'; x.font = "700 60px 'Amiri', serif";
    const tl = wrapLines(x, b.title, CARD_W - 200, 2);
    tl.forEach((ln, i) => x.fillText(ln, CARD_W / 2, y + i * 74));
    y += tl.length * 74 + 8;
    if (b.author) { x.fillStyle = '#a99cc4'; x.font = "400 32px 'Noto Naskh Arabic', serif"; x.fillText(b.author, CARD_W / 2, y); y += 48; }

    // اقتباس مختار: أطول تظليل
    const hls = [...(st.highlights || []), ...(st.pdfHighlights || [])].filter((h) => (h.text || '').trim().length > 25);
    hls.sort((a, c) => (c.text || '').length - (a.text || '').length);
    if (hls[0]) {
      y += 22;
      x.fillStyle = '#cdbfe8'; x.font = "italic 400 31px 'Noto Naskh Arabic', serif";
      const q = wrapLines(x, '« ' + normSpace(hls[0].text) + ' »', CARD_W - 240, 3);
      q.forEach((ln, i) => x.fillText(ln, CARD_W / 2, y + i * 46));
      y += q.length * 46;
    }

    // شريط الإحصاءات
    const statsY = CARD_H - 210;
    x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 1.5;
    x.beginPath(); x.moveTo(150, statsY - 62); x.lineTo(CARD_W - 150, statsY - 62); x.stroke();
    const notesN = (st.highlights || []).length + (st.pdfHighlights || []).length + (st.pageNotes || []).length;
    const cells = [
      [fmtDuration(st.seconds || 0), 'وقت القراءة'],
      [String(b.pages || ''), b.pages ? 'صفحة' : ''],
      [String(notesN), 'تظليل وملاحظة'],
    ].filter((c) => c[0] && c[1]);
    const step = (CARD_W - 300) / cells.length;
    cells.forEach((c, i) => {
      const cx = 150 + step * (i + 0.5);
      x.fillStyle = '#d9a94f'; x.font = "700 40px 'Amiri', serif"; x.fillText(c[0], cx, statsY);
      x.fillStyle = '#8d84a6'; x.font = "400 24px 'Noto Naskh Arabic', serif"; x.fillText(c[1], cx, statsY + 38);
    });

    // التذييل: تاريخ الإنهاء + هوية التطبيق
    const when = new Date(st.finishedAt || Date.now()).toLocaleDateString('ar', { year: 'numeric', month: 'long', day: 'numeric' });
    x.fillStyle = '#6f6788'; x.font = "400 24px 'Noto Naskh Arabic', serif";
    x.fillText(when, CARD_W / 2, CARD_H - 112);
    x.fillStyle = '#d9a94f'; x.font = "700 34px 'Amiri', serif";
    x.fillText('مِداد', CARD_W / 2, CARD_H - 64);

    return await new Promise((res) => cv.toBlob(res, 'image/png'));
  }

  async function openFinishCard(id) {
    const b = books.find((x2) => x2.id === id) || (await Store.getBook(id));
    if (!b) return;
    const st = await Store.getState(id);
    toast('جارٍ تجهيز البطاقة…');
    let blob = null;
    try { blob = await buildFinishCard(b, st); } catch (e) { console.error('finish card', e); }
    if (!blob) return toast('تعذّر تجهيز البطاقة');
    const url = URL.createObjectURL(blob);
    const fname = 'midad-' + String(b.title || 'book').replace(/[\\/:*?"<>|]/g, '').slice(0, 40) + '.png';
    const m = $('#card-modal');
    $('#card-preview').innerHTML = '<img src="' + url + '" alt="بطاقة الإنجاز">';
    const canShare = !!(navigator.canShare && navigator.share);
    $('#card-share').hidden = !canShare;
    const close = () => { m.hidden = true; URL.revokeObjectURL(url); };
    $('#card-save').onclick = () => {
      const a = document.createElement('a'); a.href = url; a.download = fname; a.click();
      toast('حُفظت البطاقة ✓', 'gold');
    };
    $('#card-share').onclick = async () => {
      try {
        const file = new File([blob], fname, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: b.title });
        else await navigator.share({ title: b.title, text: 'أنهيتُ قراءة «' + b.title + '» 📖' });
      } catch {}
    };
    m.querySelectorAll('[data-close]').forEach((btn) => (btn.onclick = close));
    m.onclick = (e) => { if (e.target === m) close(); };
    m.hidden = false;
  }

  function fmtDuration(sec) {
    if (sec < 60) return 'أقل من دقيقة';
    const m = Math.round(sec / 60);
    if (m < 60) return m + ' دقيقة';
    const h = Math.floor(m / 60);
    return h + ' ساعة ' + (m % 60 ? (m % 60) + ' د' : '');
  }

  // نص الكتاب القابل للتحليل (يُستخدمه المساعد الذكي) — يفهرس PDF عند الحاجة
  async function getBookText(id) {
    const b = books.find((x) => x.id === id) || (await Store.getBook(id));
    if (!b) return '';
    if (b.type === 'text') { const t = await Store.getPayload(id); return typeof t === 'string' ? t : ''; }
    const s = await searchableOf(b, true);
    return (s && s.text) || '';
  }

  return { init, refresh, toast, fmtDuration, coverHTML, esc, getBookText, ocrBook, addRemoteBook, openBook, confirm: uiConfirm, partInfo, nextPartOf };
})();
window.Library = Library;
