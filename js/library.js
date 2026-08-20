/* ═══════ مِداد — واجهة المكتبة ═══════ */
const Library = (() => {
  const CATEGORIES = ['رواية', 'دين', 'تاريخ', 'علوم', 'تطوير ذات', 'أدب وشعر', 'أطفال', 'أخرى'];
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

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

  function renderChips() {
    const used = new Set(books.map((b) => b.category).filter(Boolean));
    const status = [];
    if (books.some((b) => b.fav)) status.push(STATUS_FAV);
    if (books.some((b) => states[b.id].pct > 0 && !states[b.id].finished)) status.push(STATUS_READING);
    if (books.some((b) => states[b.id].finished)) status.push(STATUS_DONE);
    const cats = ['الكل', ...status, ...CATEGORIES.filter((c) => used.has(c))];
    $('#cat-chips').innerHTML = cats
      .map((c) => `<button class="${c === activeCat ? 'active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`)
      .join('');
    $('#cat-chips').querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => { activeCat = btn.dataset.cat; render(); };
    });
  }

  function visibleBooks() {
    let list = books.slice();
    if (activeCat === STATUS_FAV) list = list.filter((b) => b.fav);
    else if (activeCat === STATUS_READING) list = list.filter((b) => states[b.id].pct > 0 && !states[b.id].finished);
    else if (activeCat === STATUS_DONE) list = list.filter((b) => states[b.id].finished);
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
    $('#grid-title').textContent = activeCat === 'الكل' ? 'كل الكتب' : activeCat;
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
      else if (act === 'edit') openAddModal(b);
      else if (act === 'export') exportNotes(id);
      else if (act === 'reset') {
        const st = await Store.getState(id);
        Object.assign(st, { pct: 0, page: 0, scrollTop: 0, finished: false, seconds: 0 });
        await Store.saveState(st); if (window.Cloud) Cloud.pushState(id); await refresh(); toast('تم تصفير التقدم');
      } else if (act === 'delete') {
        if (confirm(`حذف «${b.title}» نهائياً مع ملاحظاته؟`)) {
          await Store.deleteBook(id); if (window.Cloud) Cloud.deleteBook(id); await refresh(); toast('حُذف الكتاب');
        }
      }
    };
    setTimeout(() => document.addEventListener('pointerdown', onDocDown, { once: true }));
    function onDocDown(e) { if (!menu.contains(e.target)) closeCardMenu(); }
  }
  function closeCardMenu() { document.querySelectorAll('.bc-menu').forEach((m) => m.remove()); }

  async function exportNotes(id) {
    const b = books.find((x) => x.id === id);
    const st = await Store.getState(id);
    const items = [...(st.highlights || []), ...(st.pageNotes || [])];
    if (!items.length) return toast('لا توجد ملاحظات لهذا الكتاب بعد');
    let out = `ملاحظاتي على «${b.title}»${b.author ? ' — ' + b.author : ''}\n`;
    out += '─'.repeat(40) + '\n\n';
    for (const h of st.highlights || []) {
      out += `«${h.text.trim()}»\n`;
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

    $('#meta-title').oninput = updateCoverPreview;
    $('#meta-author').oninput = updateCoverPreview;
    $('#btn-save-book').onclick = saveBook;
    wireFmtToolbar();
  }

  /* ─── شريط أدوات تنسيق النص + معاينة + تنظيف ─── */
  function wireFmtToolbar() {
    const ta = $('#paste-text');
    const preview = $('#fmt-preview-pane');
    const refreshPreview = () => { if (!preview.hidden && window.Reader) preview.innerHTML = Reader.previewHTML(ta.value); };

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

    $('#fmt-toolbar').querySelectorAll('[data-fmt]').forEach((btn) => {
      btn.onclick = () => {
        switch (btn.dataset.fmt) {
          case 'h1': linePrefix('# '); break;
          case 'h2': linePrefix('## '); break;
          case 'bold': wrap('**', '**', 'نص عريض'); break;
          case 'italic': wrap('_', '_', 'نص مائل'); break;
          case 'mark': wrap('==', '==', 'نص مظلّل'); break;
          case 'quote': linePrefix('> '); break;
          case 'center': linePrefix('~ '); break;
          case 'list': linePrefix('- '); break;
          case 'hr': insert('\n---\n'); break;
          case 'verse': insert('\n/ صدر البيت | عجز البيت\n'); break;
          case 'clean': ta.value = autoCleanText(ta.value); ta.focus(); toast('نُظّف النص ✨'); break;
          case 'preview': {
            preview.hidden = !preview.hidden;
            btn.classList.toggle('on', !preview.hidden);
            refreshPreview();
            return;
          }
        }
        refreshPreview();
      };
    });
    ta.addEventListener('input', () => { if (!preview.hidden) refreshPreview(); });
  }

  // تنظيف تلقائي: يجمع الأسطر المكسورة في فقرات، ويزيل أرقام الصفحات والفراغات الزائدة
  function autoCleanText(t) {
    let text = t.replace(/\r/g, '');
    text = text.split('\n').filter((l) => !/^\s*\d{1,4}\s*$/.test(l)).join('\n'); // أرقام صفحات معزولة
    const blocks = text.split(/\n\s*\n/);
    const out = blocks.map((b) => {
      const lines = b.split('\n').map((x) => x.trim()).filter(Boolean);
      if (!lines.length) return '';
      const joined = []; let para = '';
      const isHeadingLine = (l) => /^(#{1,4}\s|>\s|~\s|[-•]\s|\d+[.)]\s|\/|[-*_]{3,}$)/.test(l)
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
    $('#url-chip').hidden = true;
    $('#url-input').value = '';
    $('#pane-url').hidden = true;
    $('#paste-text').value = '';
    $('#meta-title').value = book ? book.title : '';
    $('#meta-author').value = book ? book.author || '' : '';
    $('#meta-category').value = book ? book.category || 'أخرى' : 'رواية';
    // عند التعديل نخفي ألسنة المصدر؛ وللكتب النصية نعرض النص نفسه للتحرير
    $('#add-tabs').style.display = book ? 'none' : '';
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
  function closeAddModal() { $('#add-modal').hidden = true; }

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
    const title = $('#meta-title').value.trim();
    if (!title) return toast('اكتب عنوان الكتاب أولاً');
    const meta = {
      title,
      author: $('#meta-author').value.trim(),
      category: $('#meta-category').value,
    };
    if (pendingCover) meta.cover = pendingCover;

    if (editingId) {
      const b = books.find((x) => x.id === editingId);
      // تحديث نص الكتاب النصي إن عُدّل
      if (b && b.type === 'text' && origText !== null) {
        const newText = $('#paste-text').value;
        if (!newText.trim()) return toast('نص الكتاب لا يمكن أن يكون فارغاً');
        if (newText !== origText) {
          const st = await Store.getState(editingId);
          if ((st.highlights || []).length &&
              !confirm('تعديل النص قد يُزيح مواضع التظليلات والملاحظات الحالية عن أماكنها.\nهل تريد المتابعة؟')) return;
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

  return { init, refresh, toast, fmtDuration, coverHTML, esc, getBookText };
})();
window.Library = Library;
