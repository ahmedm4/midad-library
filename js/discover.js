/* ═══════ مِداد — مكتبة الاكتشاف (كتب عربية مجانية من أرشيف الإنترنت) ═══════ */
/* بحثٌ وتصفّحٌ لآلاف الكتب العربية الحرّة واستيرادها بنقرة. عميلٌ بالكامل — لا خادم. */
const Discover = (() => {
  const IA = 'https://archive.org';
  const CORSHOST = 'https://cors.archive.org/cors'; // مضيف أرشيف الإنترنت الذي يسمح بـCORS للتنزيل
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cr = (c) => Array.isArray(c) ? c.join('، ') : (c || '');
  const fmtNum = (n) => { n = +n || 0; return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n); };
  const $ = (s, r = document) => r.querySelector(s);
  // جلب بمهلة زمنية: يمنع تعليق الاستيراد إلى الأبد إذا تأخّر مضيف الأرشيف
  async function fetchTimeout(url, ms, opts = {}) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
    finally { clearTimeout(t); }
  }

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

  // تصنيفات «شبكة الفكر» (alfeker.net) — catid المُستخرجة من الموقع
  const ALFEKER_CATS = [
    { label: '📿 العقائد', catid: '22' },
    { label: '⚖️ الفقه', catid: '94' },
    { label: '📜 الأصول', catid: '93' },
    { label: '🕌 أهل البيت', catid: '30' },
    { label: '📖 الحديث والرواية', catid: '32' },
    { label: '🏛 السيرة', catid: '95' },
    { label: '🔎 دراسات', catid: '65' },
    { label: '🛡 رد الشبهات', catid: '56' },
    { label: '🧠 المنطق والفلسفة', catid: '25' },
    { label: '🌿 الأخلاق والعرفان', catid: '29' },
    { label: '🕋 القرآن ومتعلقاته', catid: '50' },
    { label: '🤲 الدعاء والزيارة', catid: '28' },
    { label: '👤 القصص والسير', catid: '59' },
    { label: '🗺 التاريخ', catid: '64' },
  ];

  const SOURCES = {
    archive: { name: 'أرشيف الإنترنت', sub: 'آلاف الكتب العربية المجانية — من أرشيف الإنترنت' },
    alfeker: { name: 'شبكة الفكر', sub: 'مكتبة إسلامية متخصّصة — alfeker.net (عبر خادمك)' },
  };

  let modal = null, grid = null, input = null, statusEl = null, sheet = null, subEl = null, chipsEl = null;
  let curReq = 0, loaded = false, source = 'archive';

  function ensureUI() {
    if (modal) return;
    modal = document.createElement('div');
    modal.className = 'modal-backdrop disc-backdrop';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="disc-modal" role="dialog" aria-modal="true">
        <div class="disc-top">
          <div class="disc-title"><span class="disc-logo">🧭</span>
            <div><h2>استكشف</h2><p class="disc-sub">${SOURCES.archive.sub}</p></div>
          </div>
          <button class="disc-x" title="إغلاق">✕</button>
        </div>
        <div class="disc-sources">
          <button class="disc-src on" data-src="archive">🌐 ${SOURCES.archive.name}</button>
          <button class="disc-src" data-src="alfeker">📗 ${SOURCES.alfeker.name}</button>
        </div>
        <div class="disc-search">
          <svg viewBox="0 0 24 24"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>
          <input type="search" class="disc-input" placeholder="ابحث بعنوان كتاب أو اسم مؤلف…" autocomplete="off" spellcheck="false">
        </div>
        <div class="disc-chips" id="disc-chips"></div>
        <div class="disc-status" id="disc-status"></div>
        <div class="disc-grid" id="disc-grid"></div>
        <div class="disc-sheet" id="disc-sheet" hidden></div>
      </div>`;
    document.body.appendChild(modal);
    grid = $('#disc-grid', modal);
    statusEl = $('#disc-status', modal);
    sheet = $('#disc-sheet', modal);
    input = $('.disc-input', modal);
    subEl = $('.disc-sub', modal);
    chipsEl = $('#disc-chips', modal);

    $('.disc-x', modal).onclick = close;
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    let deb;
    input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => search(input.value.trim()), 450); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(deb); search(input.value.trim()); } });
    modal.querySelectorAll('.disc-src').forEach((sb) => sb.onclick = () => switchSource(sb.dataset.src));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) { if (!sheet.hidden) closeSheet(); else close(); } });
    renderChips();
  }

  function renderChips() {
    const cats = source === 'alfeker' ? ALFEKER_CATS : CATS;
    chipsEl.innerHTML = cats.map((c) => `<button class="disc-chip" data-q="${esc(c.q || '')}" data-catid="${esc(c.catid || '')}">${c.label}</button>`).join('');
    chipsEl.querySelectorAll('.disc-chip').forEach((ch) => ch.onclick = () => {
      chipsEl.querySelectorAll('.disc-chip').forEach((x) => x.classList.remove('on'));
      ch.classList.add('on'); input.value = '';
      source === 'alfeker' ? search('', null, ch.dataset.catid) : search('', ch.dataset.q);
    });
  }

  function switchSource(src) {
    if (src === source) return;
    source = src;
    modal.querySelectorAll('.disc-src').forEach((b) => b.classList.toggle('on', b.dataset.src === src));
    subEl.textContent = SOURCES[src].sub;
    closeSheet();
    renderChips();
    const first = chipsEl.querySelector('.disc-chip');
    if (first) first.classList.add('on');
    if (source === 'alfeker') search('', null, ALFEKER_CATS[0].catid);
    else search('', CATS[0].q);
  }

  function open() {
    ensureUI();
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (!loaded) { loaded = true; const c = chipsEl.querySelector('.disc-chip'); if (c) c.classList.add('on'); search('', CATS[0].q); }
    setTimeout(() => input.focus(), 60);
  }
  function close() { if (modal) { modal.hidden = true; document.body.style.overflow = ''; } }
  const status = (html) => { statusEl.innerHTML = html || ''; statusEl.hidden = !html; };

  async function search(q, catQ, catid) {
    const my = ++curReq;
    closeSheet();
    status(`<div class="disc-spin"></div> جارٍ البحث في ${SOURCES[source].name}…`);
    grid.innerHTML = '';
    try {
      let cards;
      if (source === 'alfeker') {
        if (!window.Cloud || !Cloud.fnReady || !Cloud.fnReady()) { if (my === curReq) status('فعّل المزامنة السحابية أولاً (زر ☁️) لاستخدام مصدر «شبكة الفكر».'); return; }
        const term = (q || '').trim();
        const data = await Cloud.invokeFn('alfeker', term ? { action: 'list', q: term } : { action: 'list', catid: catid || '65' });
        if (my !== curReq) return;
        cards = (data.books || []).map((b) => ({ source: 'alfeker', id: b.id, title: b.title, author: b.author, cover: b.cover, meta: b.views ? ('👁 ' + fmtNum(b.views)) : '' }));
      } else {
        const term = (q || catQ || '').trim();
        const scope = 'mediatype:texts AND language:(Arabic OR ara)';
        const query = term ? `(${term}) AND ${scope}` : scope;
        const url = `${IA}/advancedsearch.php?q=${encodeURIComponent(query)}` +
          `&fl[]=identifier&fl[]=title&fl[]=creator&fl[]=downloads&fl[]=year&sort[]=downloads+desc&rows=48&output=json`;
        const d = await (await fetch(url)).json();
        if (my !== curReq) return;
        cards = (d.response && d.response.docs || []).map((x) => ({
          source: 'archive', id: x.identifier, title: x.title || 'بدون عنوان', author: cr(x.creator),
          cover: `${IA}/services/img/${encodeURIComponent(x.identifier)}`, meta: `⬇ ${fmtNum(x.downloads)}${x.year ? ' · ' + x.year : ''}`,
        }));
      }
      render(cards);
    } catch (e) {
      if (my === curReq) status('تعذّر الاتصال: ' + (e.message || e));
    }
  }

  function render(cards) {
    if (!cards.length) { grid.innerHTML = ''; status('لا توجد نتائج مطابقة — جرّب كلمةً أخرى.'); return; }
    status('');
    grid.innerHTML = cards.map((c) => `
      <button class="disc-card" data-src="${c.source}" data-id="${esc(c.id)}" data-title="${esc(c.title)}" data-author="${esc(c.author || '')}" data-cover="${esc(c.cover || '')}">
        <div class="disc-cover">
          <img loading="lazy" src="${esc(c.cover || '')}" alt="" onerror="this.parentNode.classList.add('no-img')">
          <span class="disc-fallback">${esc((c.title || '؟').trim().slice(0, 1))}</span>
        </div>
        <div class="disc-info">
          <b title="${esc(c.title)}">${esc(c.title)}</b>
          <span>${esc(c.author || '—')}</span>
          <i>${esc(c.meta || '')}</i>
        </div>
      </button>`).join('');
    grid.querySelectorAll('.disc-card').forEach((el) => el.onclick = () => openDetail(el.dataset));
  }

  async function openDetail(ds) {
    if (ds.src === 'alfeker') return openAlfekerDetail(ds);
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
        ${djvu ? `<div class="disc-preview-wrap">
          <button class="disc-preview-btn">👁 عايِن جودة النص قبل الإضافة</button>
          <div class="disc-preview" hidden></div>
        </div>` : ''}
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
    if (djvu) { const pb = sheet.querySelector('.disc-preview-btn'); pb.onclick = () => previewText(id, djvu.name, pb, sheet.querySelector('.disc-preview')); }
  }

  // معاينة عيّنة حقيقية من نصّ الكتاب (من داخل المتن لا الغلاف) ليحكم القارئ على الجودة بنفسه
  async function previewText(id, file, btn, box) {
    btn.disabled = true;
    btn.innerHTML = `<span class="disc-spin"></span> جارٍ جلب عيّنة…`;
    try {
      const r = await fetchTimeout(`${CORSHOST}/${id}/${encodeURIComponent(file)}`, 30000);
      const reader = r.body.getReader();
      let recv = new Uint8Array(0), total = 0;
      // تجاوز نحو ١٨٠ ك.ب (الغلاف والصفحات الأولى غالباً رديئة المسح) ثم التقط عيّنة
      const SKIP = 180000, GRAB = 220000;
      while (total < GRAB) { const { done, value } = await reader.read(); if (done) break; const m = new Uint8Array(recv.length + value.length); m.set(recv); m.set(value, recv.length); recv = m; total += value.length; }
      try { await reader.cancel(); } catch {}
      let text = new TextDecoder('utf-8').decode(recv);
      if (text.length > SKIP / 2) text = text.slice(Math.min(text.length - 1200, SKIP / 2));
      text = text.replace(/\s+/g, ' ').trim().slice(0, 700);
      box.hidden = false;
      box.textContent = text || 'تعذّرت قراءة عيّنة من النص.';
      btn.remove();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = '👁 عايِن جودة النص قبل الإضافة';
      box.hidden = false; box.textContent = 'تعذّر جلب عيّنة النص.';
    }
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
      // مهلة تتناسب مع الحجم (دقيقتان أساساً + ثانية لكل ٥٠ ك.ب، بحدّ ٦ دقائق)
      const timeout = Math.min(360000, 120000 + (opt.size / 51200) * 1000);
      let r;
      try { r = await fetchTimeout(url, timeout); }
      catch (err) { throw new Error(err.name === 'AbortError' ? 'استغرق التنزيل وقتاً طويلاً — حاول مجدداً أو اختر صيغة أخف' : 'تعذّر الوصول إلى الملف'); }
      if (!r.ok) throw new Error('تعذّر تنزيل الملف (' + r.status + ')');
      const blob = await r.blob();
      btn.innerHTML = `<span class="di-label"><span class="disc-spin"></span> جارٍ الإضافة…</span>`;
      const cover = await fetchCover(id);
      const bookId = await Library.addRemoteBook({
        blob, name: meta.title, kind: opt.kind,
        title: meta.title, author: meta.author, category: 'أخرى', cover,
        expectedSize: opt.size,
      });
      btn.classList.remove('loading'); btn.classList.add('done');
      btn.innerHTML = `<span class="di-label">✓ أُضيف إلى مكتبتك</span>`;
      Library.toast('أُضيف الكتاب إلى مكتبتك 📚', 'gold');
      // زر «اقرأ الآن»: يفتح الكتاب فور استيراده
      const fmts = sheet.querySelector('.disc-formats');
      if (fmts && bookId && !fmts.querySelector('.disc-readnow')) {
        const rn = document.createElement('button');
        rn.className = 'disc-readnow';
        rn.innerHTML = '📖 اقرأ الآن';
        rn.onclick = () => { close(); if (window.Library && Library.openBook) Library.openBook(bookId); else if (window.Reader) Reader.open(bookId); };
        fmts.prepend(rn);
      }
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
      const r = await fetchTimeout(`${CORSHOST}/${id}/__ia_thumb.jpg`, 15000);
      if (!r.ok) return fallback;
      const blob = await r.blob();
      if (!blob.size || blob.size > 500000 || !/^image\//.test(blob.type)) return fallback;
      return await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    } catch { return fallback; }
  }

  // ── تفاصيل كتاب «شبكة الفكر» (عبر الوسيط) ──
  async function openAlfekerDetail(ds) {
    sheet.hidden = false;
    sheet.innerHTML = `<div class="disc-sheet-box"><div class="disc-spin big"></div><p>جارٍ جلب تفاصيل الكتاب…</p></div>`;
    let d;
    try { d = await Cloud.invokeFn('alfeker', { action: 'detail', id: ds.id }); }
    catch (e) { sheet.innerHTML = `<div class="disc-sheet-box"><p>تعذّر جلب التفاصيل: ${esc(e.message || e)}</p><button class="btn-ghost disc-back">رجوع</button></div>`; sheet.querySelector('.disc-back').onclick = closeSheet; return; }
    const title = d.title || ds.title || 'بدون عنوان';
    const author = d.author || ds.author || '';
    const cover = d.cover || ds.cover || '';
    const hasFile = !!d.fileUrl;
    const hostName = { drive: 'Google Drive', mediafire: 'MediaFire', dropbox: 'Dropbox', direct: 'رابط مباشر' }[d.host] || 'المستضيف';
    // الاستيراد الآلي يعمل لـ Drive/الروابط المباشرة فقط؛ MediaFire يمنع التنزيل من الخادم → تنزيل يدوي
    const autoImport = hasFile && (d.host === 'drive' || d.host === 'direct');
    sheet.innerHTML = `
      <div class="disc-sheet-box">
        <button class="disc-back" title="رجوع">→ رجوع</button>
        <div class="disc-detail">
          <div class="disc-detail-cover"><img src="${esc(cover)}" alt="" onerror="this.style.display='none'"></div>
          <div class="disc-detail-meta">
            <h3>${esc(title)}</h3>
            ${author ? `<p class="dd-author">${esc(author)}</p>` : ''}
            <p class="dd-desc">${d.category ? 'القسم: ' + esc(d.category) + '<br>' : ''}${d.pages ? 'عدد الصفحات: ' + esc(d.pages) : ''}</p>
            <a class="dd-link" href="https://alfeker.net/library.php?id=${encodeURIComponent(ds.id)}" target="_blank" rel="noopener">↗ صفحة الكتاب في شبكة الفكر</a>
          </div>
        </div>
        <div class="disc-formats">
          ${!hasFile ? '<p>لا يوجد ملف قابل للتنزيل لهذا الكتاب.</p>' : ''}
          ${autoImport ? `<button class="disc-import">
            <span class="di-label">📕 أضِف إلى مكتبتي (PDF)<em>يُنزَّل من ${esc(hostName)} عبر خادمك</em></span>
          </button>` : ''}
          ${autoImport && d.altUrl ? `<a class="disc-alt" href="${esc(d.altUrl)}" target="_blank" rel="noopener">أو نزّله يدوياً من MediaFire ↗</a>` : ''}
          ${hasFile && !autoImport ? `
            <a class="disc-import disc-openfile" href="${esc(d.fileUrl)}" target="_blank" rel="noopener">
              <span class="di-label">⬇ افتح صفحة التنزيل (${esc(hostName)})<em>حمّل الملف ثم أضِفه عبر «أضف كتاباً»</em></span>
            </a>
            <p class="disc-note">يمنع ${esc(hostName)} التنزيل التلقائي عبر الخوادم، لذا يُنزَّل الملف يدوياً من متصفّحك ثم يُضاف عبر زر «أضف كتاباً ← من ملف».</p>
          ` : ''}
        </div>
      </div>`;
    sheet.querySelector('.disc-back').onclick = closeSheet;
    const ib = sheet.querySelector('.disc-import:not(.disc-openfile)');
    if (ib) ib.onclick = () => importAlfeker(ds, { title, author, cover, category: d.category, fileUrl: d.fileUrl, host: d.host }, ib);
  }

  async function importAlfeker(ds, meta, btn) {
    if (!window.Library || !Library.addRemoteBook) return;
    const orig = btn.innerHTML;
    btn.disabled = true; btn.classList.add('loading');
    btn.innerHTML = `<span class="di-label"><span class="disc-spin"></span> جارٍ التنزيل من Google Drive… (قد يستغرق دقيقة)</span>`;
    try {
      const r = await Cloud.invokeFnRaw('alfeker', { action: 'file', id: ds.id, fileUrl: meta.fileUrl, host: meta.host });
      const ct = r.headers.get('content-type') || '';
      if (!r.ok || /application\/json/i.test(ct)) {
        let msg = 'تعذّر تنزيل الملف';
        try { const j = await r.json(); if (j.error) msg = j.error; } catch {}
        throw new Error(msg);
      }
      const blob = await r.blob();
      btn.innerHTML = `<span class="di-label"><span class="disc-spin"></span> جارٍ الإضافة…</span>`;
      const bookId = await Library.addRemoteBook({
        blob, name: meta.title, kind: 'pdf',
        title: meta.title, author: meta.author, category: meta.category || 'أخرى', cover: meta.cover || '',
      });
      btn.classList.remove('loading'); btn.classList.add('done');
      btn.innerHTML = `<span class="di-label">✓ أُضيف إلى مكتبتك</span>`;
      Library.toast('أُضيف الكتاب إلى مكتبتك 📚', 'gold');
      const fmts = sheet.querySelector('.disc-formats');
      if (fmts && bookId && !fmts.querySelector('.disc-readnow')) {
        const rn = document.createElement('button');
        rn.className = 'disc-readnow'; rn.innerHTML = '📖 اقرأ الآن';
        rn.onclick = () => { close(); if (window.Library && Library.openBook) Library.openBook(bookId); else if (window.Reader) Reader.open(bookId); };
        fmts.prepend(rn);
      }
    } catch (e) {
      btn.disabled = false; btn.classList.remove('loading'); btn.innerHTML = orig;
      Library.toast('تعذّر إضافة الكتاب: ' + (e.message || e));
    }
  }

  function closeSheet() { if (sheet) { sheet.hidden = true; sheet.innerHTML = ''; } }

  return { open, close };
})();
window.Discover = Discover;
