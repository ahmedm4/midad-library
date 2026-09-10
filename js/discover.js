/* ═══════ مِداد — مكتبة الاكتشاف (كتب عربية مجانية من أرشيف الإنترنت) ═══════ */
/* بحثٌ وتصفّحٌ لآلاف الكتب العربية الحرّة واستيرادها بنقرة. عميلٌ بالكامل — لا خادم. */
const Discover = (() => {
  const IA = 'https://archive.org';
  const CORSHOST = 'https://cors.archive.org/cors'; // مضيف أرشيف الإنترنت الذي يسمح بـCORS للتنزيل
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cr = (c) => Array.isArray(c) ? c.join('، ') : (c || '');
  const fmtNum = (n) => { n = +n || 0; return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n); };
  const $ = (s, r = document) => r.querySelector(s);

  const CATS = [
    { label: '📖 روايات', q: 'رواية OR روايات' },
    { label: '✒️ أدب', q: 'أدب' },
    { label: '🏛 تاريخ', q: 'تاريخ' },
    { label: '🧠 فلسفة', q: 'فلسفة OR منطق' },
    { label: '🕌 إسلاميات', q: 'إسلام OR فقه OR تفسير' },
    { label: '🪶 شعر', q: 'شعر OR ديوان' },
    { label: '🔬 علوم', q: 'علوم OR فيزياء OR رياضيات' },
    { label: '👤 تراجم وسير', q: 'سيرة OR ترجمة OR مذكرات' },
    { label: '🧒 أطفال', q: 'أطفال OR ناشئة' },
    { label: '🌍 لغة', q: 'لغة OR نحو OR معجم' },
  ];

  let modal = null, grid = null, input = null, statusEl = null, sheet = null, curReq = 0, loaded = false;

  function ensureUI() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'modal-backdrop disc-backdrop';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="disc-modal" role="dialog" aria-modal="true">
        <div class="disc-top">
          <div class="disc-title"><span class="disc-logo">🧭</span>
            <div><h2>استكشف</h2><p>آلاف الكتب العربية المجانية — من أرشيف الإنترنت</p></div>
          </div>
          <button class="disc-x" title="إغلاق">✕</button>
        </div>
        <div class="disc-search">
          <svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>
          <input type="search" class="disc-input" placeholder="ابحث بعنوان كتاب أو اسم مؤلف…" autocomplete="off" spellcheck="false">
        </div>
        <div class="disc-chips">${CATS.map((c, i) => `<button class="disc-chip" data-q="${esc(c.q)}">${c.label}</button>`).join('')}</div>
        <div class="disc-status" id="disc-status"></div>
        <div class="disc-grid" id="disc-grid"></div>
        <div class="disc-sheet" id="disc-sheet" hidden></div>
      </div>`;
    document.body.appendChild(modal);
    grid = $('#disc-grid', modal);
    statusEl = $('#disc-status', modal);
    sheet = $('#disc-sheet', modal);
    input = $('.disc-input', modal);

    $('.disc-x', modal).onclick = close;
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    let deb;
    input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => search(input.value.trim()), 400); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(deb); search(input.value.trim()); } });
    modal.querySelectorAll('.disc-chip').forEach((ch) => ch.onclick = () => {
      modal.querySelectorAll('.disc-chip').forEach((x) => x.classList.remove('on'));
      ch.classList.add('on'); input.value = ''; search('', ch.dataset.q);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) { if (!sheet.hidden) closeSheet(); else close(); } });
  }

  function open() {
    ensureUI();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (!loaded) { loaded = true; modal.querySelector('.disc-chip').classList.add('on'); search('', CATS[0].q); }
    setTimeout(() => input.focus(), 60);
  }
  function close() { if (modal) { modal.hidden = true; document.body.style.overflow = ''; } }
  const status = (html) => { statusEl.innerHTML = html || ''; statusEl.hidden = !html; };

  async function search(q, catQ) {
    const my = ++curReq;
    closeSheet();
    status('<div class="disc-spin"></div> جارٍ البحث في أرشيف الإنترنت…');
    grid.innerHTML = '';
    const term = (q || catQ || '').trim();
    const scope = 'mediatype:texts AND language:(Arabic OR ara)';
    const query = term ? `(${term}) AND ${scope}` : scope;
    const url = `${IA}/advancedsearch.php?q=${encodeURIComponent(query)}` +
      `&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=downloads&fl[]=year` +
      `&sort[]=downloads+desc&rows=48&output=json`;
    try {
      const r = await fetch(url);
      const d = await r.json();
      if (my !== curReq) return;
      render(d.response && d.response.docs || []);
    } catch (e) {
      if (my === curReq) status('تعذّر الاتصال بأرشيف الإنترنت — تحقّق من اتصالك بالإنترنت وحاول مجدداً.');
    }
  }

  function render(docs) {
    if (!docs.length) { grid.innerHTML = ''; status('لا توجد نتائج مطابقة — جرّب كلمةً أخرى.'); return; }
    status('');
    grid.innerHTML = docs.map((d) => `
      <button class="disc-card" data-id="${esc(d.identifier)}" data-title="${esc(d.title || '')}" data-author="${esc(cr(d.creator))}">
        <div class="disc-cover">
          <img loading="lazy" src="${IA}/services/img/${encodeURIComponent(d.identifier)}" alt="" onerror="this.parentNode.classList.add('no-img')">
          <span class="disc-fallback">${esc((d.title || '؟').trim().slice(0, 1))}</span>
        </div>
        <div class="disc-info">
          <b title="${esc(d.title || '')}">${esc(d.title || 'بدون عنوان')}</b>
          <span>${esc(cr(d.creator) || '—')}</span>
          <i>⬇ ${fmtNum(d.downloads)}${d.year ? ' · ' + esc(d.year) : ''}</i>
        </div>
      </button>`).join('');
    grid.querySelectorAll('.disc-card').forEach((c) => c.onclick = () => openDetail(c.dataset));
  }

  async function openDetail(ds) {
    const id = ds.id;
    sheet.hidden = false;
    sheet.innerHTML = `<div class="disc-sheet-box"><div class="disc-spin big"></div><p>جارٍ جلب تفاصيل الكتاب…</p></div>`;
    let m;
    try { m = await (await fetch(`${IA}/metadata/${id}`)).json(); }
    catch { sheet.innerHTML = `<div class="disc-sheet-box"><p>تعذّر جلب التفاصيل.</p><button class="btn-ghost disc-back">رجوع</button></div>`; sheet.querySelector('.disc-back').onclick = closeSheet; return; }
    const files = m.files || [];
    const epub = files.find((f) => /\.epub$/i.test(f.name));
    const djvu = files.find((f) => f.format === 'DjVuTXT' || /_djvu\.txt$/i.test(f.name));
    const pdf = files.find((f) => /\.pdf$/i.test(f.name));
    const md = m.metadata || {};
    const title = ds.title || (Array.isArray(md.title) ? md.title[0] : md.title) || 'بدون عنوان';
    const author = ds.author || cr(md.creator) || '';
    let desc = (Array.isArray(md.description) ? md.description.join(' ') : md.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (desc.length > 500) desc = desc.slice(0, 500) + '…';

    const opts = [];
    if (epub) opts.push({ kind: 'epub', file: epub.name, label: '📗 نص منسّق (EPUB)', hint: 'الأفضل للقراءة — يدعم كل المزايا', size: +epub.size });
    if (djvu) opts.push({ kind: 'text', file: djvu.name, label: '📄 نص مُستخرَج', hint: 'خفيف — قد يحتاج تدقيقاً', size: +djvu.size });
    if (pdf) opts.push({ kind: 'pdf', file: pdf.name, label: '📕 نسخة مصوّرة (PDF)', hint: 'وفيّة للأصل — أثقل حجماً', size: +pdf.size });

    const fmtSize = (b) => b >= 1048576 ? (b / 1048576).toFixed(1) + ' م.ب' : Math.round(b / 1024) + ' ك.ب';
    sheet.innerHTML = `
      <div class="disc-sheet-box">
        <button class="disc-back" title="رجوع">→ رجوع</button>
        <div class="disc-detail">
          <div class="disc-detail-cover"><img src="${IA}/services/img/${encodeURIComponent(id)}" alt="" onerror="this.style.display='none'"></div>
          <div class="disc-detail-meta">
            <h3>${esc(title)}</h3>
            ${author ? `<p class="dd-author">${esc(author)}</p>` : ''}
            ${desc ? `<p class="dd-desc">${esc(desc)}</p>` : ''}
            <a class="dd-link" href="${IA}/details/${encodeURIComponent(id)}" target="_blank" rel="noopener">↗ افتح صفحة الكتاب في الأرشيف</a>
          </div>
        </div>
        <div class="disc-formats">
          ${opts.length ? '<h4>اختر الصيغة لإضافتها إلى مكتبتك:</h4>' : '<p>لا توجد صيغة قابلة للاستيراد لهذا العنصر.</p>'}
          ${opts.map((o, i) => `
            <button class="disc-import" data-i="${i}">
              <span class="di-label">${o.label}<em>${o.hint}</em></span>
              <span class="di-size">${fmtSize(o.size)}</span>
            </button>`).join('')}
        </div>
      </div>`;
    sheet.querySelector('.disc-back').onclick = closeSheet;
    sheet.querySelectorAll('.disc-import').forEach((btn) => btn.onclick = () => importBook(id, { title, author }, opts[+btn.dataset.i], btn));
  }

  async function importBook(id, meta, opt, btn) {
    if (!window.Library || !Library.addRemoteBook) return;
    if (opt.size > 26214400) {
      const ok = Library.confirm ? await Library.confirm(`حجم هذا الملف كبير (${(opt.size / 1048576).toFixed(1)} م.ب) وقد يستغرق تنزيله وقتاً. هل تريد المتابعة؟`, { title: 'ملف كبير', okText: 'نزّل', icon: '📥' }) : true;
      if (!ok) return;
    }
    const orig = btn.innerHTML;
    sheet.querySelectorAll('.disc-import').forEach((b) => b.disabled = true);
    btn.classList.add('loading');
    const big = opt.size > 5242880;
    btn.innerHTML = `<span class="di-label"><span class="disc-spin"></span> جارٍ التنزيل…${big ? ' (ملف كبير، قد يستغرق دقيقة)' : ''}</span>`;
    try {
      const url = `${CORSHOST}/${id}/${encodeURIComponent(opt.file)}`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('تعذّر تنزيل الملف (' + r.status + ')');
      const blob = await r.blob();
      btn.innerHTML = `<span class="di-label"><span class="disc-spin"></span> جارٍ الإضافة…</span>`;
      const cover = await fetchCover(id);
      await Library.addRemoteBook({
        blob, name: meta.title, kind: opt.kind,
        title: meta.title, author: meta.author, category: 'أخرى', cover,
        expectedSize: opt.size,
      });
      btn.classList.remove('loading'); btn.classList.add('done');
      btn.innerHTML = `<span class="di-label">✓ أُضيف إلى مكتبتك</span>`;
      Library.toast('أُضيف الكتاب إلى مكتبتك 📚 — تجده في «كل الكتب»', 'gold');
    } catch (e) {
      sheet.querySelectorAll('.disc-import').forEach((b) => b.disabled = false);
      btn.classList.remove('loading'); btn.innerHTML = orig;
      Library.toast('تعذّر إضافة الكتاب: ' + (e.message || e));
    }
  }

  // نزّل صورة الغلاف كـ dataURL (تعمل دون إنترنت وتُزامَن بخفّة)؛ عند التعذّر أعِد رابط الأرشيف
  async function fetchCover(id) {
    const fallback = `${IA}/services/img/${encodeURIComponent(id)}`;
    try {
      const r = await fetch(`${CORSHOST}/${id}/__ia_thumb.jpg`);
      if (!r.ok) return fallback;
      const blob = await r.blob();
      if (!blob.size || blob.size > 500000 || !/^image\//.test(blob.type)) return fallback;
      return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    } catch { return fallback; }
  }

  function closeSheet() { if (sheet) { sheet.hidden = true; sheet.innerHTML = ''; } }

  return { open, close };
})();
window.Discover = Discover;
