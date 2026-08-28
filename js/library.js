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
  let pendingFile = null;   // {kind:'pdf'|'text', blob?, text?, cover?}
  let pendingCover = null;  // غلاف مخصص اختاره المستخدم (dataURL)
  let editingId = null;
  let origText = null;      // النص الأصلي عند تحرير كتاب نصي (لكشف التغيير)
  const STATUS_FAV = '⭐ المفضلة', STATUS_READING = '📖 قيد القراءة', STATUS_DONE = '✅ مكتملة';
  const SHELF_PREFIX = 'shelf:'; // قيمة data-cat للرفوف المخصصة

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
    states = {};
    for (const b of books) states[b.id] = await Store.getState(b.id);
    // ثبّت أسماء الرفوف المكتشفة من الكتب محلياً (تدعم استمرارها والمزامنة عبر الأجهزة)
    if (Store.saveShelves) Store.saveShelves(allShelves());
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

  function renderHero() {
    const hero = $('#hero-continue');
    const last = books
      .filter((b) => states[b.id].lastRead && !states[b.id].finished && states[b.id].pct > 0)
      .sort((a, b) => states[b.id].lastRead - states[a.id].lastRead)[0];
    if (!last) { hero.hidden = true; return; }
    const st = states[last.id];
    const pct = Math.round(st.pct * 100);
    hero.hidden = false;
    hero.innerHTML = `
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
    hero.querySelector('.continue-card').onclick = () => openBook(last.id);
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
    const used = new Set(books.map((b) => b.category).filter(Boolean));
    const status = [];
    if (books.some((b) => b.fav)) status.push(STATUS_FAV);
    if (books.some((b) => states[b.id].pct > 0 && !states[b.id].finished)) status.push(STATUS_READING);
    if (books.some((b) => states[b.id].finished)) status.push(STATUS_DONE);
    const cats = ['الكل', ...status, ...CATEGORIES.filter((c) => used.has(c))];
    const shelves = allShelves();
    let html = cats
      .map((c) => `<button class="${c === activeCat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)
      .join('');
    // رفوف مخصّصة (تظهر مميّزة بأيقونة ولها فاصل بسيط قبلها)
    if (shelves.length) {
      html += '<span class="chip-sep"></span>';
      html += shelves.map((s) => {
        const val = SHELF_PREFIX + s;
        const n = books.filter((b) => (b.shelves || []).includes(s)).length;
        return `<button class="shelf-chip ${val === activeCat ? 'active' : ''}" data-cat="${esc(val)}">📚 ${esc(s)}${n ? ` <i>${n}</i>` : ''}</button>`;
      }).join('');
    }
    $('#cat-chips').innerHTML = html;
    $('#cat-chips').querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => { activeCat = btn.dataset.cat; render(); };
    });
  }

  function visibleBooks() {
    let list = books.slice();
    if (activeCat === STATUS_FAV) list = list.filter((b) => b.fav);
    else if (activeCat === STATUS_READING) list = list.filter((b) => states[b.id].pct > 0 && !states[b.id].finished);
    else if (activeCat === STATUS_DONE) list = list.filter((b) => states[b.id].finished);
    else if (activeCat.startsWith(SHELF_PREFIX)) { const sh = activeCat.slice(SHELF_PREFIX.length); list = list.filter((b) => (b.shelves || []).includes(sh)); }
    else if (activeCat !== 'الكل') list = list.filter((b) => b.category === activeCat);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((b) => (b.title + ' ' + (b.author || '')).toLowerCase().includes(q));
    }
    const st = (b) => states[b.id];
    if (sort === 'recent') list.sort((a, b) => (st(b).lastRead || 0) - (st(a).lastRead || 0) || b.addedAt - a.addedAt);
    else if (sort === 'added') list.sort((a, b) => b.addedAt - a.addedAt);
    else if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title, 'ar'));
    else if (sort === 'progress') list.sort((a, b) => st(b).pct - st(a).pct);
    return list;
  }

  function renderGrid() {
    const list = visibleBooks();
    const grid = $('#book-grid');
    $('#empty-state').hidden = books.length > 0;
    $('#grid-title').textContent = activeCat === 'الكل' ? 'كل الكتب'
      : activeCat.startsWith(SHELF_PREFIX) ? '📚 ' + activeCat.slice(SHELF_PREFIX.length) : activeCat;
    grid.innerHTML = list.map((b) => {
      const st = states[b.id];
      const pct = Math.round(st.pct * 100);
      return `
      <article class="book-card" data-id="${b.id}">
        <div class="bk">
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
          <span>${esc(b.author || '—')}</span>
          <button class="bc-menu-btn" title="خيارات">⋯</button>
        </div>
      </article>`;
    }).join('');

    grid.querySelectorAll('.book-card').forEach((card) => {
      const id = card.dataset.id;
      card.querySelector('.bk').onclick = () => openBook(id);
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
      // الزر الأيمن على البطاقة يفتح القائمة أيضاً
      card.oncontextmenu = (e) => { e.preventDefault(); openCardMenu(e.clientX, e.clientY, id); };
    });
  }

  /* ─── البحث الشامل داخل كل الكتب ─── */
  let deepTimer = null, deepToken = 0;

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
      type: 'text', shelves: (b.shelves || []).slice(),
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
    // فهرسة كسولة لملفات PDF غير المفهرسة
    const pdfsToIndex = [];
    for (const b of books) {
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

    // اجمع النتائج من كل الكتب
    const results = [];
    for (const b of books) {
      const s = await searchableOf(b, false);
      if (token !== deepToken) return;
      if (!s || !s.text) continue;
      const hits = findHits(s.text, q, 4);
      if (hits.length) results.push({ book: b, src: s, hits });
    }
    if (token !== deepToken) return;

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
      <button data-act="shelves">📚 الرفوف…</button>
      ${b.type === 'pdf' ? '<button data-act="ocr">🔎 استخراج النص (OCR)</button>' : ''}
      ${b.type === 'pdf' ? '<button data-act="totext">📄 أنشئ نسخة نصية</button>' : ''}
      ${b.type === 'text' ? '<button data-act="pdf">🖨 تصدير PDF</button>' : ''}
      <button data-act="edit">✏️ تعديل البيانات</button>
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
      else if (act === 'fav') { await Store.updateBook(id, { fav: !b.fav }); b.fav = !b.fav; if (window.Cloud) Cloud.pushBook(id); render(); }
      else if (act === 'shelves') openShelvesModal(b);
      else if (act === 'ocr') ocrBook(id);
      else if (act === 'totext') createTextFromOcr(id);
      else if (act === 'pdf') exportPdf(id);
      else if (act === 'edit') openAddModal(b);
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
          if (window.Cloud) Cloud.pushBook(b.id);
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

  /* ─── تصدير الكتاب إلى PDF احترافي (عبر طباعة المتصفح — يدعم العربية بامتياز) ─── */
  async function exportPdf(id) {
    const b = books.find((x) => x.id === id) || (await Store.getBook(id));
    if (!b) return;
    let text = '';
    if (b.type === 'text') { const t = await Store.getPayload(id); text = typeof t === 'string' ? t : ''; }
    else { const ft = await Store.getFulltext(id); text = (ft && ft.text) || ''; }
    if (!text.trim()) return toast('لا يوجد نص للتصدير (لكتب PDF المصوّرة استخرج النص أولاً)');
    const bodyHtml = (window.Reader && Reader.previewHTML) ? Reader.previewHTML(text) : `<p>${esc(text)}</p>`;
    const w = window.open('', '_blank');
    if (!w) return toast('اسمح بالنوافذ المنبثقة لتصدير PDF ثم أعد المحاولة');
    const title = esc(b.title || 'كتاب'), author = esc(b.author || '');
    const bodyFont = b.font || "'Noto Naskh Arabic', serif";
    const doc = `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONT_LINK}" rel="stylesheet">
<style>
  @page { size: A4; margin: 20mm 18mm 18mm; }
  @page { @bottom-center { content: counter(page); font-family: 'Amiri', serif; color: #7a6a4a; font-size: 10pt; } }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: ${bodyFont}; color: #1f1a12; font-size: 13.2pt; line-height: 1.95;
    text-align: justify; direction: rtl; }
  .cover { display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; height: 86vh; page-break-after: always; }
  .cover .orn { font-family: 'Amiri', serif; font-size: 40pt; color: #b08a3e; margin-bottom: 18pt; }
  .cover h1 { font-family: 'Amiri', serif; font-size: 30pt; font-weight: 700; margin: 0 0 14pt; color: #2a2114; line-height: 1.4; }
  .cover .author { font-size: 15pt; color: #6b5c3e; }
  .cover .rule { width: 40%; height: 2px; background: #c9a35f; margin: 20pt auto; opacity: .6; }
  .book { }
  h2 { font-family: 'Amiri', serif; font-size: 20pt; font-weight: 700; text-align: center;
    margin: 0 0 18pt; color: #2a2114; page-break-before: always; padding-top: 6pt; }
  .book > h2:first-child { page-break-before: avoid; }
  h3 { font-family: 'Amiri', serif; font-size: 15pt; margin: 16pt 0 8pt; color: #3a2f1d; }
  h4 { font-family: 'Amiri', serif; font-size: 13.5pt; margin: 14pt 0 6pt; color: #3a2f1d; }
  p { margin: 0 0 9pt; orphans: 2; widows: 2; }
  p.center { text-align: center; }
  p.footnote { font-size: .82em; opacity: .85; margin: 2pt 0; line-height: 1.6; }
  h2 + p::first-letter { font-family: 'Amiri', serif; font-size: 3em; float: right; line-height: .8;
    margin: .04em .12em 0 .1em; color: #7a5a2a; font-weight: 700; }
  strong { font-weight: 700; } em { font-style: italic; }
  mark, mark.static-hl { background: #faedb4; padding: 0 2px; border-radius: 2px; }
  blockquote { margin: 12pt 0; padding: 2pt 14pt; border-inline-start: 3px solid #c9a35f;
    color: #4a3d28; font-style: italic; }
  ul, ol { margin: 8pt 18pt 8pt 0; padding-inline-start: 12pt; }
  li { margin-bottom: 4pt; }
  hr.orn { border: none; text-align: center; margin: 16pt 0; page-break-inside: avoid; }
  hr.orn::before { content: '❦'; color: #b08a3e; font-size: 15pt; }
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
  <div class="book">${bodyHtml}</div>
  <script>
    (function(){
      function go(){ setTimeout(function(){ window.focus(); window.print(); }, 300); }
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
      if (query.length >= 2) deepTimer = setTimeout(() => deepSearch(query), 350);
      else { $('#deep-results').hidden = true; }
    };
    $('#sort-select').onchange = (e) => { sort = e.target.value; renderGrid(); };
    $('#btn-add').onclick = () => openAddModal();
    $('#btn-add-empty').onclick = () => openAddModal();
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

  /* جلب كتاب من رابط مباشر (PDF أو نص) */
  async function fetchFromUrl() {
    const url = $('#url-input').value.trim();
    if (!/^https?:\/\/.+/i.test(url)) return toast('أدخل رابطاً صحيحاً يبدأ بـ https://');
    const chip = $('#url-chip');
    chip.hidden = false;
    chip.textContent = '⏳ جارٍ جلب الملف…';
    pendingFile = null;

    const tryFetch = async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    };
    let buf = null;
    try { buf = await tryFetch(url); }
    catch {
      // كثير من المواقع تمنع الجلب المباشر (CORS) — نجرب عبر وسيط عام
      try {
        chip.textContent = '⏳ الموقع يمنع الجلب المباشر — محاولة عبر وسيط…';
        buf = await tryFetch('https://corsproxy.io/?url=' + encodeURIComponent(url));
      } catch {
        chip.textContent = '⚠ تعذّر الجلب: الموقع يمنع التحميل المباشر. نزّل الملف إلى جهازك ثم أضفه من لسان «ملف»';
        return;
      }
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
    const tryFetch = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); };
    let blob = null;
    try { blob = await tryFetch(url); }
    catch { try { blob = await tryFetch('https://corsproxy.io/?url=' + encodeURIComponent(url)); } catch {} }
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

  /* ─── قائمة المكتبة: إحصائيات + نسخ احتياطي ─── */
  function wireLibMenu() {
    $('#btn-lib-menu').onclick = (e) => {
      closeCardMenu();
      const menu = document.createElement('div');
      menu.className = 'bc-menu';
      menu.innerHTML = `
        <button data-act="stats">📊 إحصائيات قراءتك</button>
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
    const log = Store.getLog();
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

  const blobToDataURL = (blob) => new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });

  async function exportBackup() {
    toast('⏳ جارٍ تجهيز النسخة الاحتياطية…');
    try {
      const items = [];
      for (const b of books) {
        const payload = await Store.getPayload(b.id);
        const state = await Store.getState(b.id);
        if (payload instanceof Blob) items.push({ meta: b, state, payloadKind: 'pdf', payload: await blobToDataURL(payload) });
        else items.push({ meta: b, state, payloadKind: 'text', payload: payload || '' });
      }
      const json = JSON.stringify({ app: 'midad', version: 1, exportedAt: Date.now(), books: items });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `مِداد - نسخة احتياطية ${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast(`صُدّرت مكتبتك كاملة (${items.length} كتاباً) 📦`, 'gold');
    } catch (err) { console.error(err); toast('تعذّر إنشاء النسخة الاحتياطية'); }
  }

  async function importBackup(file) {
    try {
      const data = JSON.parse(await file.text());
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

  /* ─── أدوات عامة ─── */
  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    $('#toast-wrap').appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
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

  return { init, refresh, toast, fmtDuration, coverHTML, esc, getBookText, ocrBook, confirm: uiConfirm };
})();
window.Library = Library;
