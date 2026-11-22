/* ═══════ مِداد — محرّك القراءة ═══════ */
const Reader = (() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const THEMES = {
    white: { paper: '#fbfaf6', ink: '#22201c', label: 'ناصع' },
    cream: { paper: '#f9f0dc', ink: '#3c2f1d', label: 'كريمي' },
    sepia: { paper: '#f4e4c9', ink: '#43301a', label: 'سيبيا' },
    aged:  { paper: '#e6d2aa', ink: '#3d2c15', label: 'عتيق' },
    rose:  { paper: '#f6e6e0', ink: '#4a2f2a', label: 'وردي' },
    mint:  { paper: '#e3efe6', ink: '#26382e', label: 'نعناعي' },
    kraft: { paper: '#dcc4a0', ink: '#3a2a15', label: 'كرافت' },
    azure: { paper: '#e5ecf3', ink: '#26333f', label: 'لازوردي' },
    gray:  { paper: '#2e3036', ink: '#d5d8de', label: 'رمادي' },
    night: { paper: '#171920', ink: '#c6cad2', label: 'ليلي' },
    ocean: { paper: '#122029', ink: '#bcd0da', label: 'بحري' },
    black: { paper: '#0a0a0c', ink: '#b7bbc3', label: 'أسود' },
  };
  const DARK_THEMES = ['gray', 'night', 'ocean', 'black'];
  const FONTS = [
    { css: "'Noto Naskh Arabic', serif", label: 'نسخ' },
    { css: "'Amiri', serif", label: 'أميري' },
    { css: "'Scheherazade New', serif", label: 'شهرزاد' },
    { css: "'Markazi Text', serif", label: 'مركزي' },
    { css: "'Lateef', serif", label: 'لطيف' },
    { css: "'El Messiri', sans-serif", label: 'المسيري' },
    { css: "'IBM Plex Sans Arabic', sans-serif", label: 'بلكس' },
    { css: "'Tajawal', sans-serif", label: 'تجوّل' },
    { css: "'Cairo', sans-serif", label: 'القاهرة' },
    { css: "'Almarai', sans-serif", label: 'المراعي' },
    { css: "'Reem Kufi', sans-serif", label: 'ريم كوفي' },
    { css: "'Aref Ruqaa', serif", label: 'رقعة' },
  ];
  const GAP = 64;

  let book = null, state = null, settings = null;
  let isPdf = false, isOpen = false;
  // نصي
  let contentEl, viewportEl, pristineHTML = '', pageW = 0, colW = 0, pageCount = 1, curPage = 0, totalChars = 0;
  // PDF
  let pdfDoc = null, pdfPage = 1, renderToken = 0, pdfZoom = 1;
  let ocrFull = null; // نص مُستخرج بالـOCR للكتب المصوّرة {text, pageStarts, ocr}
  // مؤقتات
  let saveTimer = null, uiTimer = null, tickTimer = null, lastActivity = 0, repagTimer = null;
  let flipping = false, pendingMarkId = null, pendingSel = null;
  let pendingPdfSel = null, pendingPdfMark = null; // تحديد/تظليل نص الـ PDF
  let celebrated = false;

  /* ═══════ فتح وإغلاق ═══════ */
  async function open(id, target) {
    book = await Store.getBook(id);
    if (!book) return;
    state = await Store.getState(id);
    settings = Store.getSettings();
    isPdf = book.type === 'pdf';
    celebrated = state.finished;
    chapNow = null; { const cc = $('#ck-chip'); if (cc) cc.hidden = true; }
    abReset(); // عناصر النص تُبنى من جديد مع كل فتح
    loReset();
    lastActivity = Date.now();

    contentEl = $('#r-content');
    viewportEl = $('#r-viewport');
    $('#r-book-title').textContent = book.title;
    $('#r-book-author').textContent = book.author || '';
    $('#reader').hidden = false;
    document.body.style.overflow = 'hidden';
    isOpen = true;
    // إيماءة الرجوع (أندرويد) والسحب من الحافّة (آيفون) وزر «رجوع» في المتصفح: تُغلق الكتاب
    try { if (!(history.state && history.state.midadReader)) history.pushState({ midadReader: true }, ''); } catch {}
    startWakeLock(); // إبقاء الشاشة مضاءة أثناء القراءة

    const reader = $('#reader');
    reader.classList.toggle('mode-pdf', isPdf);
    teardownPageFlip();               // أزل كتاب التقليب (StPageFlip) من الكتاب السابق حتى لا تظهر صفحته فوق الكتاب الجديد
    teardownPdfScroll();              // أوقف مراقب التمرير السابق
    $('#r-pdf-scroll').innerHTML = ''; // أفرغ شرائح التمرير من الكتاب السابق
    $('#r-canvas-wrap').hidden = !isPdf;
    $('#r-canvas-wrap2').hidden = true;
    $('#r-btn-search').style.display = isPdf ? 'none' : '';
    $('#typo-section').style.display = isPdf ? 'none' : '';
    { const ps = $('#pdf-section'); if (ps) ps.style.display = isPdf ? '' : 'none'; }
    $('#flip-scroll-btn').style.display = ''; // التمرير المتصل متاح للنصوص و PDF
    $('#r-btn-draw').style.display = isPdf ? '' : 'none';
    state.drawings = state.drawings || {};
    state.pdfHighlights = state.pdfHighlights || []; // تظليلات نص الـ PDF
    setDrawMode(false);
    // تصفير محادثة المساعد الذكي لكل كتاب (آمن ضد عدم تطابق النسخ)
    const aiModalEl = $('#ai-modal');
    if (aiModalEl) {
      aiModalEl.hidden = true;
      const aiBtnEl = $('#r-btn-ai'); if (aiBtnEl) aiBtnEl.classList.remove('on');
      const aiBodyEl = $('#ai-body'); if (aiBodyEl) aiBodyEl.innerHTML = '<div class="ai-hint">اطلب تلخيصاً، أو اسأل أي سؤال عن الكتاب — أو ظلّل مقطعاً ثم اضغط «✨ اشرح».</div>';
    }
    pdfZoom = 1;
    $('#zoom-pill').hidden = !isPdf;
    $('#zoom-val').textContent = '100٪';
    if (isPdf) updateZoomUI();
    reader.classList.remove('zoomed');

    buildSettingsUI();
    applySettings(false);

    if (isPdf) {
      let blob = await Store.getPayload(id);
      let why = 'off';
      if (!blob && window.Cloud) { why = await Cloud.ensurePayload(id); blob = await Store.getPayload(id); }
      if (!blob) {
        // رسالة صادقة بحسب السبب الفعلي، لا «تحقّق من الاتصال» لكل شيء
        const fresh = (await Store.getBook(id)) || book;
        if (fresh.fileError === 'size') why = 'toobig';
        const detail = window.Cloud && Cloud.lastPayloadError ? Cloud.lastPayloadError() : '';
        const MSG = {
          off: 'ملف هذا الكتاب ليس على هذا الجهاز، والمزامنة غير مفعّلة هنا',
          signedout: 'ملف هذا الكتاب في السحابة — سجّل الدخول (زر السحابة) ليُنزَّل',
          offline: 'ملف هذا الكتاب لم يُنزَّل بعد إلى هذا الجهاز — اتصل بالإنترنت ثم افتحه',
          missing: 'ملف هذا الكتاب غير موجود في السحابة بعد — افتح التطبيق على الجهاز الذي أضفته منه، وسيُرفع تلقائياً في الخلفية',
          toobig: `ملف هذا الكتاب${fresh.fileMB ? ` (${fresh.fileMB} م.ب)` : ''} أكبر من الحدّ الذي يقبله مخزن السحابة، فبقي على الجهاز الذي أضفته منه`,
          error: 'تعذّر تنزيل ملف الكتاب من السحابة' + (detail ? ` (${detail.slice(0, 80)})` : '') +
            (/fetch|network/i.test(detail) ? ' — انقطع الاتصال أثناء التنزيل؛ إن تكرّر على هذا الجهاز وحده فقد يقطعه برنامج تنزيل (مثل IDM) أو مانع إعلانات/مضاد فيروسات — استثنِ موقع التطبيق منه' : ' — أعد المحاولة بعد قليل'),
        };
        Library.toast(MSG[why] || MSG.error);
        close(); return;
      }
      const buf = await blob.arrayBuffer();
      if (pdfDoc) { try { await pdfDoc.destroy(); } catch {} pdfDoc = null; } // تنظيف أي مستند سابق
      // disableFontFace: يرسم الخطوط المضمّنة مباشرةً على الكنفا (أضمن للنصوص العربية)
      pdfDoc = await pdfjsLib.getDocument({ data: buf, disableFontFace: true }).promise;
      pageCount = pdfDoc.numPages;
      try { const ft = await Store.getFulltext(id); ocrFull = (ft && ft.ocr) ? ft : null; } catch { ocrFull = null; }
      pdfPage = (target && target.page) ? Math.min(Math.max(target.page, 1), pageCount)
                                        : Math.min(Math.max(state.page + 1, 1), pageCount);
      if (pdfScrollActive()) await buildPdfScroll();
      else await showPdfPage(pdfPage);
      buildPdfToc();
      if (target && target.page) { state.pct = pageCount > 1 ? (pdfPage - 1) / (pageCount - 1) : 1; afterNavigate(); }
    } else {
      let text = await Store.getPayload(id);
      if (text == null && window.Cloud) { await Cloud.ensurePayload(id); text = await Store.getPayload(id); }
      text = text || '';
      await loadAssetUrls(book); // صور EPUB (تُنزَّل من السحابة إن غابت عن هذا الجهاز)
      pristineHTML = buildHTML(text);
      renderContent();
      setTimeout(() => {
        paginate();
        buildTextToc();
        if (target && target.find) { jumpToPhrase(target.find); }
        else {
          const startPage = state.pct ? Math.round(state.pct * (pageCount - 1)) : 0;
          if (settings.flip === 'scroll') viewportEl.scrollTop = state.pct * (viewportEl.scrollHeight - viewportEl.clientHeight);
          else setPage(startPage, false);
        }
        updateHUD();
      }, 30);
    }

    renderDrawerPanes();
    updateHUD();
    startTimers();
    // عند الفتح: تظهر الأدوات لحظةً ليعرف القارئ مكانها، ثم تتنحّى (أياً كانت وسيلة الإدخال)
    $('#reader').classList.remove('ui-hidden'); resetUiTimer();
  }

  async function close(fromHistory) {
    if (!isOpen) return;
    isOpen = false;
    // أُغلق بزرّ التطبيق ⇒ أزِل مدخل السجلّ الذي أضفناه عند الفتح (كي لا يحتاج «رجوع» ضغطتين)
    if (fromHistory !== true) { try { if (history.state && history.state.midadReader) history.back(); } catch {} }
    await persist(true);
    clearInterval(tickTimer); clearTimeout(uiTimer); clearTimeout(saveTimer);
    stopWakeLock();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    $('#reader').hidden = true;
    document.body.style.overflow = '';
    closeDrawers(); hideHlPopup(); $('#r-search').hidden = true;
    { const m = $('#ai-modal'); if (m) m.hidden = true; }
    { const d = $('#define-bubble'); if (d) d.hidden = true; }
    setDrawMode(false);
    ttsStop();
    abStop();
    podStop();
    await loFlush(); loReset();
    stopAuto();
    teardownPdfScroll();
    teardownPageFlip();
    $('#r-pdf-scroll').innerHTML = '';
    // إتلاف مستند PDF لتحرير الخطوط والذاكرة (يمنع تبعثر الخطوط عند إعادة الفتح)
    if (pdfDoc) { try { await pdfDoc.destroy(); } catch {} }
    pdfDoc = null; ocrFull = null; pristineHTML = ''; contentEl.innerHTML = '';
    revokeAssets();
    Library.refresh();
  }

  /* ═══════ بناء نص الكتاب ═══════ */
  // تنسيق داخل السطر: **عريض** و_مائل_ و==تظليل==
  function inlineFmt(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/_(\S[^_\n]*?\S|\S)_/g, '<em>$1</em>')
      .replace(/==(.+?)==/g, '<mark class="static-hl">$1</mark>');
  }

  /* صور الكتاب (EPUB): روابط محلية مؤقتة لكل صورة مخزّنة، تُحرَّر عند الإغلاق */
  let assetUrls = new Map(), assetDims = new Map();
  function revokeAssets() { for (const u of assetUrls.values()) URL.revokeObjectURL(u); assetUrls = new Map(); assetDims = new Map(); }
  async function loadAssetUrls(b) {
    revokeAssets();
    if (!b || !b.assets || !b.assets.length) return;
    for (const a of b.assets) assetDims.set(a.name, a);
    let m = new Map();
    try { m = await Store.getAssets(b.id); } catch {}
    if (m.size < b.assets.length && window.Cloud && Cloud.ensureAssets) {
      try { await Cloud.ensureAssets(b.id); m = await Store.getAssets(b.id); } catch {}
    }
    for (const [name, blob] of m) assetUrls.set(name, URL.createObjectURL(blob));
  }

  function buildHTML(text) {
    const lines = text.split(/\r?\n/);
    let html = '', para = [], list = null, quote = [], poem = [];
    const flushPara = () => { if (para.length) { html += '<p>' + inlineFmt(para.join(' ')) + '</p>'; para = []; } };
    const flushList = () => { if (list) { html += `<${list.tag}>` + list.items.map((i) => '<li>' + inlineFmt(i) + '</li>').join('') + `</${list.tag}>`; list = null; } };
    const flushQuote = () => { if (quote.length) { html += '<blockquote>' + inlineFmt(quote.join(' ')) + '</blockquote>'; quote = []; } };
    const flushPoem = () => {
      if (poem.length) {
        html += '<div class="poem">' + poem.map((v) => `<div class="verse"><span>${inlineFmt(v[0] || '')}</span><span>${inlineFmt(v[1] || '')}</span></div>`).join('') + '</div>';
        poem = [];
      }
    };
    const flushAll = () => { flushPara(); flushList(); flushQuote(); flushPoem(); };

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flushAll(); continue; }
      let m;
      // صورة من الكتاب:  ![وصف](img:اسم)  — أبعادها معروفة مسبقاً فلا يتغيّر الترقيم بعد تحميلها
      if ((m = line.match(/^!\[([^\]]*)\]\(img:([^)\s]+)\)$/))) {
        flushAll();
        const url = assetUrls.get(m[2]), dim = assetDims.get(m[2]);
        if (url) html += `<figure class="bk-img"><img src="${url}" alt="${esc(m[1])}"${dim ? ` width="${dim.w}" height="${dim.h}"` : ''} decoding="async"></figure>`;
        continue;
      }
      // فاصل زخرفي
      if (/^([-*_]\s?){3,}$/.test(line)) { flushAll(); html += '<hr class="orn">'; continue; }
      // عناوين
      if ((m = line.match(/^#\s+(.+)/))) { flushAll(); html += '<h2>' + inlineFmt(m[1]) + '</h2>'; continue; }
      if ((m = line.match(/^##\s+(.+)/))) { flushAll(); html += '<h3>' + inlineFmt(m[1]) + '</h3>'; continue; }
      if ((m = line.match(/^#{3,4}\s+(.+)/))) { flushAll(); html += '<h4>' + inlineFmt(m[1]) + '</h4>'; continue; }
      // توسيط:  ~ نص
      if ((m = line.match(/^~\s+(.+)/))) { flushAll(); html += '<p class="center">' + inlineFmt(m[1]) + '</p>'; continue; }
      // بيت شعر:  / شطر | شطر   (أو مفصولان بتاب/عدة مسافات)
      if ((m = line.match(/^\/\s*(.+)/))) {
        flushPara(); flushList(); flushQuote();
        const parts = m[1].split(/\s*\|\s*|\t+|\s{3,}/);
        poem.push([parts[0] || '', parts[1] || '']); continue;
      } else flushPoem();
      // اقتباس:  > نص
      if ((m = line.match(/^>\s+(.+)/))) { flushPara(); flushList(); quote.push(m[1]); continue; } else flushQuote();
      // قوائم
      if ((m = line.match(/^[-•*]\s+(.+)/))) { flushPara(); if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; } list.items.push(m[1]); continue; }
      if ((m = line.match(/^\d+[.)]\s+(.+)/))) { flushPara(); if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [] }; } list.items.push(m[1]); continue; }
      flushList();
      // حاشية مرقّمة مثل (١)…  → فقرة حاشية أصغر
      if (/^[(\[（]\s*[\d٠-٩۰-۹]{1,3}\s*[)\]）]/.test(line)) { flushAll(); html += '<p class="footnote">' + inlineFmt(line) + '</p>'; continue; }
      // كشف تلقائي لعناوين الفصول
      if (/^(الفصل|الباب|المقدمة|الخاتمة|القسم|الجزء|تمهيد|مدخل)\b/.test(line) && line.length < 60) { flushAll(); html += '<h2>' + inlineFmt(line) + '</h2>'; continue; }
      para.push(line);
    }
    flushAll();
    return html || '<p>(كتاب فارغ)</p>';
  }

  function renderContent() {
    contentEl.innerHTML = pristineHTML;
    totalChars = contentEl.textContent.length;
    for (const h of (state.highlights || []).slice().sort((a, b) => a.start - b.start)) applyHighlightToDOM(h);
  }

  function paginate() {
    if (isPdf) return;
    const reader = $('#reader');
    const spreadOn = settings.spread && settings.flip !== 'scroll' && spreadFits();
    reader.classList.toggle('spread', spreadOn);

    // الورقة تتمدد بنسب كتاب حقيقي على الشاشات الكبيرة، والخط يكبر تناسبياً
    const stageH = $('#r-stage').clientHeight;
    const idealW = stageH * 0.97 * 0.72;               // نسبة صفحة كتاب ≈ 1 : 1.4
    const maxW = window.innerWidth - (spreadOn ? 110 : 96);
    let paperW;
    if (spreadOn) paperW = Math.min(Math.max(settings.width * 1.85, idealW * 1.35), maxW);
    else paperW = Math.min(Math.max(settings.width, Math.min(idealW, maxW)), maxW);
    const perPageW = spreadOn ? paperW / 2 : paperW;
    const fontScale = Math.max(1, Math.min(perPageW / settings.width, 1.8));
    reader.style.setProperty('--paper-w', Math.round(paperW) + 'px');
    reader.style.setProperty('--font-scale', fontScale.toFixed(3));
    if (settings.flip === 'scroll') { pageCount = 1; return; }
    pageW = viewportEl.clientWidth;
    { // الصورة لا تتجاوز الصفحة — ولا نضبط قياساً غير صالح (تخطيط لم يكتمل) كي لا تنطوي الصور إلى صفر
      const ph = contentEl.clientHeight || viewportEl.clientHeight;
      if (ph > 120) reader.style.setProperty('--page-h', ph + 'px'); else reader.style.removeProperty('--page-h');
    }
    colW = spreadOn ? (pageW - GAP) / 2 : pageW; // عمودان متقابلان = صفحة واحدة منطقياً
    contentEl.style.columnWidth = colW + 'px';
    contentEl.style.transform = 'translateX(0)';
    pageCount = Math.max(1, Math.round((contentEl.scrollWidth + GAP) / (pageW + GAP)));
  }

  function setPage(n, animate = true) {
    n = Math.max(0, Math.min(n, pageCount - 1));
    const reader = $('#reader');
    if (!animate || settings.flip === 'flip') reader.classList.add('no-anim');
    contentEl.style.transform = `translateX(${n * (pageW + GAP)}px)`;
    if (!animate || settings.flip === 'flip') {
      void contentEl.offsetWidth;
      reader.classList.remove('no-anim');
    }
    curPage = n;
    state.pct = pageCount > 1 ? n / (pageCount - 1) : 1;
    afterNavigate();
  }

  function afterNavigate() {
    state.page = isPdf ? pdfPage - 1 : curPage;
    state.lastRead = Date.now();
    if (state.pct >= 0.995 && !state.finished) {
      state.finished = true; state.finishedAt = state.finishedAt || Date.now();
      celebrate();
    }
    updateHUD();
    schedulePersist();
    bump();
    trackChapter();
    // القلب الواقعي بلا طبقة نص: نقرأ نص الصفحة المصوّرة في الخلفية للصوت والبحث
    if (isPdf && pdfFlipBookActive() && liveOcrOn()) { clearTimeout(LO.navT); LO.navT = setTimeout(() => { loWant(pdfPage, true); loWant(pdfPage + 1, false); }, 900); }
  }

  // تهنئة الإنهاء: جزء من سلسلة يُشير إلى الجزء التالي بدل «أنهيت الكتاب»
  function celebrate() {
    if (celebrated) return;
    celebrated = true;
    const pi = Library.partInfo ? Library.partInfo(book.id) : null;
    const np = Library.nextPartOf ? Library.nextPartOf(book.id) : null;
    if (pi && np) Library.toast(`🎉 أنهيت ${pi.label} — ${np.label} في انتظارك (الزرّ أسفل الصفحة)`, 'gold');
    else if (pi) Library.toast(`🎉 وصلت إلى آخر أجزاء «${pi.title}»`, 'gold');
    else Library.toast('🎉 مبارك! أنهيت الكتاب — بطاقة الإنجاز في قائمة الكتاب', 'gold');
  }

  // زرّ «الجزء التالي» يظهر في آخر صفحات جزءٍ من سلسلة
  function updateNextPart() {
    const el = $('#r-nextpart');
    if (!el || !book) return;
    const np = (window.Library && Library.nextPartOf) ? Library.nextPartOf(book.id) : null;
    if (!np || !(state.pct >= 0.99)) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `الجزء التالي: <b>${esc(np.label)}</b> <span aria-hidden="true">←</span>`;
    el.setAttribute('aria-label', `افتح ${np.label} من ${np.title}`);
    el.onclick = async () => { el.hidden = true; await close(); Library.openBook(np.id); };
  }

  /* ═══════ التنقّل ═══════ */
  function next() { go(+1); }
  function prev() { go(-1); }

  function go(dir) {
    if (!isOpen || flipping) return;
    if (pdfScrollActive()) {
      const cont = $('#r-pdf-scroll');
      cont.scrollBy({ top: dir * cont.clientHeight * 0.9, behavior: 'smooth' });
      return;
    }
    if (!isPdf && settings.flip === 'scroll') {
      viewportEl.scrollBy({ top: dir * viewportEl.clientHeight * 0.9, behavior: 'smooth' });
      return;
    }
    if (isPdf) {
      if (pdfFlipBookActive() && pageFlip) { dir > 0 ? pageFlip.flipNext() : pageFlip.flipPrev(); return; }
      if (pdfSpreadActive()) {
        const target = spreadStart(pdfPage) + dir * 2;
        if (target < 1 || target > pageCount) return;
        if (settings.flip === 'flip') { flipSpread(dir); return; }
        pdfPage = target; renderPdfSpread(target, true);
        state.pct = pageCount > 1 ? (target - 1) / (pageCount - 1) : 1; afterNavigate();
        return;
      }
      const target = pdfPage + dir;
      if (target < 1 || target > pageCount) return;
      if (settings.flip === 'flip' && pdfZoom <= 1.001) flipPdf(target, dir);
      else { pdfPage = target; renderPdf(target, true); state.pct = pageCount > 1 ? (target - 1) / (pageCount - 1) : 1; afterNavigate(); }
    } else {
      const target = curPage + dir;
      if (target < 0 || target > pageCount - 1) return;
      // في العرض المزدوج نستخدم انزلاقاً نظيفاً بدل انحناء الورقة (الذي يقلب الصفحتين معاً)
      const textSpread = $('#reader').classList.contains('spread');
      if (settings.flip === 'flip' && !textSpread) flipText(target, dir);
      else slidePage(target);
    }
  }

  // انزلاق مُتحرّك لصفحة نصية (وضع الانزلاق وللعرض المزدوج)
  function slidePage(n) {
    n = Math.max(0, Math.min(n, pageCount - 1));
    $('#reader').classList.remove('no-anim');
    flipping = true;
    contentEl.style.transform = `translateX(${n * (pageW + GAP)}px)`;
    curPage = n;
    state.pct = pageCount > 1 ? n / (pageCount - 1) : 1;
    afterNavigate();
    setTimeout(() => { flipping = false; }, 470);
  }

  function jumpTo(n) { // فهرس الصفحات (نصي: رقم صفحة، PDF: رقم صفحة 1-based)
    // التمرير المتصل يحدّث pdfPage بعد انتهاء التمرير؛ نثبّته فوراً كي لا تعيد القراءة الصوتية الصفحة نفسها
    if (pdfScrollActive()) { pdfPage = Math.max(1, Math.min(n, pageCount)); pdfScrollTo(pdfPage); }
    else if (isPdf) { pdfPage = Math.max(1, Math.min(n, pageCount)); showPdfPage(pdfPage, true); state.pct = pageCount > 1 ? (pdfPage - 1) / (pageCount - 1) : 1; afterNavigate(); }
    else if (settings.flip === 'scroll') { /* يُعالَج خارجياً */ }
    else setPage(n, false);
  }

  /* ─── تقليب ورقي (نصي) ─── */
  function flipText(target, dir) {
    flipping = true;
    const layer = $('#r-flip-layer');
    const leaf = makeTextLeaf(dir > 0 ? curPage : target);
    layer.appendChild(leaf);
    if (dir > 0) {
      setPage(target, false);
      leaf.classList.add('turning');
      setTimeout(() => { leaf.remove(); flipping = false; }, 570);
    } else {
      leaf.classList.add('turning-back');
      setTimeout(() => { setPage(target, false); leaf.remove(); flipping = false; }, 570);
    }
  }

  function makeTextLeaf(pageIdx) {
    const leaf = document.createElement('div');
    leaf.className = 'r-leaf';
    leaf.style.borderRadius = getComputedStyle($('#r-paper')).borderRadius;
    const inner = document.createElement('div');
    inner.style.cssText = `position:absolute; overflow:hidden;
      top:${viewportEl.offsetTop}px; left:${viewportEl.offsetLeft}px;
      width:${viewportEl.offsetWidth}px; height:${viewportEl.offsetHeight}px;`;
    const clone = contentEl.cloneNode(true);
    clone.style.transition = 'none';
    clone.style.transform = `translateX(${pageIdx * (pageW + GAP)}px)`;
    clone.style.columnWidth = colW + 'px';
    clone.style.height = '100%';
    inner.appendChild(clone);
    leaf.appendChild(inner);
    const shade = document.createElement('div');
    shade.className = 'leaf-shade';
    leaf.appendChild(shade);
    return leaf;
  }

  /* ─── تقليب ورقي (PDF) ─── */
  async function flipPdf(target, dir) {
    flipping = true;
    const layer = $('#r-flip-layer');
    const main = $('#r-canvas');
    const leaf = document.createElement('div');
    leaf.className = 'r-leaf';
    leaf.style.borderRadius = '6px';
    const img = document.createElement('canvas');
    img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    leaf.appendChild(img);
    const shade = document.createElement('div');
    shade.className = 'leaf-shade';
    leaf.appendChild(shade);

    const setLeafFrom = (srcCanvas, strokesPage) => {
      img.width = srcCanvas.width; img.height = srcCanvas.height;
      const c = img.getContext('2d');
      c.drawImage(srcCanvas, 0, 0);
      // تضمين كتابات الصفحة في لقطة التقليب
      drawStrokesTo(c, state.drawings[strokesPage] || [], img.width, img.height);
    };

    if (dir > 0) {
      setLeafFrom(main, pdfPage);       // الورقة المتحركة تحمل الصفحة الحالية وتغطّي الكنفا تماماً
      layer.appendChild(leaf);
      pdfPage = target;
      state.pct = pageCount > 1 ? (target - 1) / (pageCount - 1) : 1;
      afterNavigate();
      // ارسم الصفحة الجديدة في الكنفا الرئيسي بينما الورقة تغطّيه (غير مرئي)،
      // ثم ابدأ الدوران لتكشف الصفحة الجاهزة — متماثل مع التقليب للخلف
      await renderPdf(target);
      leaf.classList.add('turning');
      setTimeout(() => { leaf.remove(); flipping = false; }, 560);
    } else {
      const off = document.createElement('canvas');
      await renderPdf(target, false, off);
      setLeafFrom(off, target);
      layer.appendChild(leaf);
      leaf.classList.add('turning-back');
      setTimeout(() => {
        pdfPage = target;
        const ctx = main.getContext('2d');
        main.width = off.width; main.height = off.height;
        main.style.width = off.style.width; main.style.height = off.style.height;
        ctx.drawImage(off, 0, 0);
        syncDrawLayer();
        state.pct = pageCount > 1 ? (target - 1) / (pageCount - 1) : 1;
        afterNavigate();
        leaf.remove(); flipping = false;
      }, 570);
    }
  }

  // تنقية صفحة مصوّرة: تسوية المستويات فتصير الخلفية بيضاء موحّدة (تزيل الشرائط الفاتحة) والنص أوضح
  function cleanScan(ctx, W, H) {
    try {
      const img = ctx.getImageData(0, 0, W, H), d = img.data;
      const black = 34, white = 202, range = white - black; // نقطتا الأسود والأبيض
      // جدول بحث للسرعة
      const lut = new Uint8ClampedArray(256);
      for (let v = 0; v < 256; v++) { let o = ((v - black) / range) * 255; lut[v] = o < 0 ? 0 : o > 255 ? 255 : o; }
      for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
      ctx.putImageData(img, 0, 0);
    } catch { /* قد يمنع بعض المتصفحات قراءة الكنفا */ }
  }

  /* ═══════ عرض PDF ═══════ */
  // العرض المزدوج: صفحتان متقابلتان في الوضع الأفقي (paged، بلا تكبير)
  // الشرط: وضع أفقي (العرض ≥ الارتفاع) وعرض كافٍ — مقاوم لتكبير المتصفح (يعتمد النسبة لا رقماً ثابتاً)
  const spreadFits = () => window.innerWidth >= 680 && window.innerWidth >= window.innerHeight;
  const pdfSpreadActive = () => isPdf && settings.spread && settings.flip !== 'scroll' && pdfZoom <= 1.001 && spreadFits();
  // بداية الزوج: الصفحة اليمنى (الفردية) — يمين = الأدنى في RTL
  const spreadStart = (n) => { n = Math.max(1, Math.min(n, pageCount)); return n % 2 === 0 ? n - 1 : n; };

  // ═══ قلب واقعي (StPageFlip) لوضع «تقليب ورقي» في PDF ═══
  let pageFlip = null, pfAspect = 1.414, pfBuilding = false;
  // تحميل بنافذة متحركة: نبني كل الصفحات كإطارات فارغة (خفيفة)، ونرسم صور نافذة حول الموضع فقط
  const PF_MAX_PAGES = 1500; // سقف أمان لعدد صفحات القلب الواقعي
  const PF_CWIN = 6;         // نصف عرض النافذة (صفحات تُرسم صوراً حقيقية حول الموضع)
  const PF_CKEEP = 14;       // أبعد من هذا المدى تُفرَّغ إلى صفحة بيضاء لتحرير الذاكرة
  let pfUrls = [];           // روابط صور كل الصفحات (حقيقية داخل النافذة، بيضاء مؤقتة خارجها)
  let pfReal = new Set();    // فهارس الصفحات ذات الصورة الحقيقية حالياً
  let pfPlaceholder = '';    // صفحة بيضاء مؤقتة مشتركة
  let pfWinToken = 0;        // لإلغاء تحديث نافذة قديم عند تغيّر الموضع
  let pfWinTid = null;       // مؤقّت تأجيل تحديث النافذة بعد التقليب
  // نستخدم StPageFlip للعرض المزدوج (أفقي) — القلب المفرد (رأسي/جوال) يستخدم محرّكنا
  const pdfFlipBookActive = () => isPdf && settings.flip === 'flip' && settings.realFlip !== false && pdfZoom <= 1.001 && pageCount <= PF_MAX_PAGES && spreadFits() && !!(window.St && St.PageFlip);

  // موجّه العرض: StPageFlip (تقليب ورقي) أو المزدوج أو المفرد
  function showPdfPage(n, fade = false) {
    if (pdfFlipBookActive()) { buildPageFlip(n); return; }
    teardownPageFlip();
    if (pdfSpreadActive()) { pdfPage = spreadStart(n); renderPdfSpread(pdfPage, fade); }
    else renderPdf(n, fade);
  }

  function teardownPageFlip() {
    pfWinToken++; pfUrls = []; pfReal = new Set(); clearTimeout(pfWinTid); // ألغِ أي تحديث نافذة جارٍ وحرّر التتبّع
    if (pageFlip) { try { pageFlip.destroy(); } catch {} pageFlip = null; }
    const c = $('#r-pageflip'); if (c) { c.hidden = true; c.innerHTML = ''; c.classList.remove('rtl'); }
    $('#reader').classList.remove('pageflip-on');
  }

  // يرسم صفحة PDF إلى صورة dataURL. mirror=true يعكسها أفقياً (لوضع الكانفاس مع مرآة الحاوية RTL)
  async function renderPfImage(idx, mirror = false) {
    const page = await pdfDoc.getPage(idx + 1);
    const v1 = page.getViewport({ scale: 1 });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = page.getViewport({ scale: (900 / v1.height) * dpr });
    const cv = document.createElement('canvas');
    cv.width = vp.width; cv.height = vp.height;
    await page.render({ canvasContext: cv.getContext('2d', { willReadFrequently: !!settings.enhanceScan }), viewport: vp, intent: 'print' }).promise;
    if (settings.enhanceScan) cleanScan(cv.getContext('2d'), cv.width, cv.height);
    if (!mirror) return cv.toDataURL('image/jpeg', 0.82);
    const m = document.createElement('canvas'); m.width = cv.width; m.height = cv.height;
    const mx = m.getContext('2d'); mx.translate(cv.width, 0); mx.scale(-1, 1); mx.drawImage(cv, 0, 0);
    return m.toDataURL('image/jpeg', 0.82);
  }

  // سحب الورقة بالماوس/اللمس مع تعويض العكس الأفقي (RTL): x داخلي = يمين المستطيل − clientX
  function wirePfDrag(el) {
    let down = false, moved = false, sx = 0, sy = 0;
    let pending = null, rafId = 0; // آخر موضع + إطار مُجدوَل (خنق التحديث لإطار واحد لكل رسمة)
    const toPos = (e) => { const r = el.getBoundingClientRect(); return { x: r.right - e.clientX, y: e.clientY - r.top }; };
    el.style.touchAction = 'none';
    const clearSel = () => { try { const s = window.getSelection && window.getSelection(); if (s && s.rangeCount) s.removeAllRanges(); } catch {} };
    // خنق userMove إلى معدّل الإطارات: أحداث اللمس تصل بتردّد أعلى من الرسم فتُسبّب اهتزازاً/وميضاً
    const flushMove = () => { rafId = 0; if (pageFlip && down && pending) { try { pageFlip.userMove(pending, false); } catch {} } };
    // امنع سحب الصورة الأصليّ (شبح الصورة) الذي يعطّل الطي
    el.addEventListener('dragstart', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (!pageFlip || (e.pointerType === 'mouse' && e.button !== 0)) return;
      e.preventDefault(); // يمنع بدء تحديد النص/سحب الصورة (كان يُبقي الصفحة ملوّنة)
      clearSel();
      down = true; moved = false; sx = e.clientX; sy = e.clientY;
      try { el.setPointerCapture(e.pointerId); } catch {}
      pageFlip.startUserTouch(toPos(e));
    });
    el.addEventListener('pointermove', (e) => {
      if (!pageFlip || !down) return; // لا انحناء عند مجرد مرور الماوس — فقط أثناء ضغط الزر
      if (Math.abs(e.clientX - sx) > 4 || Math.abs(e.clientY - sy) > 4) moved = true;
      pending = toPos(e);
      if (!rafId) rafId = requestAnimationFrame(flushMove); // تحديث واحد لكل إطار
    });
    const end = (e) => { if (!pageFlip || !down) return; down = false; if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } pending = null; clearSel(); try { pageFlip.userStop(toPos(e)); } catch {} if (moved) e.stopPropagation(); };
    el.addEventListener('pointerup', end);
    // عند إلغاء المؤشّر (فقدان الالتقاط): أوقف الطيّ ليستقرّ ولا يعلق منتصف الحركة
    el.addEventListener('pointercancel', (e) => { if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } pending = null; if (!pageFlip || !down) { down = false; return; } down = false; try { pageFlip.userStop(toPos(e)); } catch {} });
    // امنع «نقرة» منطقة التقليب من القفز بعد سحب فعلي
    el.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
  }

  // يحسب صندوق الكتاب ليلائم المسرح (مفرد أو مزدوج حسب العرض)
  function sizePfBox(box) {
    const stage = $('#r-stage');
    const sW = stage.clientWidth * 0.98, sH = stage.clientHeight * 0.97;
    let boxH, boxW;
    if (spreadFits()) { boxH = Math.min(sH, (sW / 2) / pfAspect); boxW = Math.round(boxH * pfAspect * 2); }
    else { boxH = Math.min(sH, sW / pfAspect); boxW = Math.round(boxH * pfAspect); }
    box.style.width = boxW + 'px'; box.style.height = Math.round(boxH) + 'px';
  }

  // صفحة بيضاء مؤقتة (تُعرَض للصفحات خارج النافذة قبل رسمها الحقيقي)
  function makePfPlaceholder() {
    const h = 800, w = Math.max(1, Math.round(h * (pfAspect || 0.707)));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = ($('#reader').classList.contains('pdf-dark')) ? '#1a1c22' : '#ffffff';
    x.fillRect(0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.5);
  }

  // يجدّد نافذة الصور الحقيقية حول المركز؛ free=true يُفرّغ البعيدة. يعيد true إن تغيّرت المصفوفة
  async function pfRenderWindow(center, tok, free = true) {
    let changed = false;
    if (free) for (const idx of Array.from(pfReal)) {
      if (idx < center - PF_CKEEP || idx > center + PF_CKEEP) { pfUrls[idx] = pfPlaceholder; pfReal.delete(idx); changed = true; }
    }
    const order = [center]; for (let d = 1; d <= PF_CWIN; d++) { order.push(center + d); order.push(center - d); }
    for (const idx of order) {
      if (tok !== pfWinToken) return changed;
      if (idx < 0 || idx >= pageCount || pfReal.has(idx)) continue;
      try { pfUrls[idx] = await renderPfImage(idx, true); pfReal.add(idx); changed = true; } catch {}
    }
    return changed;
  }

  // موجّه: القلب الواقعي دائماً بمحرّك الكانفاس (ظلّ سلس) مع نافذة متحركة (فتح سريع لأي حجم)
  function buildPageFlip(gotoPage) {
    if (pageFlip) {
      const t = Math.max(0, Math.min((gotoPage || pdfPage) - 1, pageCount - 1));
      const tok = ++pfWinToken;
      // اجلب نافذة الوجهة (دون تفريغ الحالي) قبل القفز كي لا تظهر الوجهة بيضاء
      pfRenderWindow(t, tok, false).then((changed) => {
        if (!pageFlip || tok !== pfWinToken) return;
        if (changed) { try { pageFlip.updateFromImages(pfUrls); } catch {} }
        pageFlip.turnToPage(t);
      });
      return;
    }
    buildPageFlipCanvas(gotoPage);
  }

  // ═══ محرّك الكانفاس بنافذة متحركة (StPageFlip/loadFromImages — ظلّ يُرسم على الكانفا) ═══
  async function buildPageFlipCanvas(gotoPage) {
    if (pfBuilding) return;
    pfBuilding = true;
    const cont = $('#r-pageflip');
    const targetIdx = Math.max(0, Math.min((gotoPage || pdfPage) - 1, pageCount - 1));
    $('#reader').classList.add('pageflip-on');
    $('#r-canvas-wrap').hidden = true; $('#r-canvas-wrap2').hidden = true;
    $('#reader').classList.remove('pdf-spread');
    cont.hidden = false;
    cont.innerHTML = '<div class="pf-loading"><div class="disc-spin big"></div><p>جارٍ فتح الكتاب…</p></div>';
    const myTok = ++renderToken;
    try {
      const p1 = await pdfDoc.getPage(1); const v = p1.getViewport({ scale: 1 }); pfAspect = v.width / v.height;
      if (myTok !== renderToken) { pfBuilding = false; return; }
      pfPlaceholder = makePfPlaceholder();
      pfUrls = new Array(pageCount).fill(pfPlaceholder); pfReal = new Set();
      const wtok = ++pfWinToken;
      await pfRenderWindow(targetIdx, wtok); // نافذة الموضع فقط → فتح سريع لأي حجم
      if (myTok !== renderToken) { pfBuilding = false; return; }
      cont.innerHTML = '';
      const box = document.createElement('div'); box.className = 'pf-box rtl';
      const inner = document.createElement('div'); inner.className = 'pf-inner';
      box.appendChild(inner); cont.appendChild(box);
      sizePfBox(box);
      const bookH = box.clientHeight, pageW = Math.round(bookH * pfAspect);
      pageFlip = new St.PageFlip(inner, {
        width: pageW, height: Math.round(bookH), size: 'stretch',
        minWidth: 160, maxWidth: 3000, minHeight: 160, maxHeight: 2000,
        drawShadow: true, flippingTime: 650, usePortrait: true, maxShadowOpacity: 0.7,
        showCover: false, useMouseEvents: false, showPageCorners: false, mobileScrollSupport: false, startPage: targetIdx,
      });
      pageFlip.loadFromImages(pfUrls);
      pageFlip.on('flip', (e) => {
        pdfPage = (e.data || 0) + 1;
        state.pct = pageCount > 1 ? (pdfPage - 1) / (pageCount - 1) : 1;
        // بعد استقرار التقليب: جدّد النافذة وحدّث الصور إن لزم (updateFromImages يحفظ الموضع)
        clearTimeout(pfWinTid); pfWinTid = setTimeout(async () => {
          const tok = ++pfWinToken; const changed = await pfRenderWindow(pdfPage - 1, tok);
          if (changed && pageFlip && tok === pfWinToken) { try { pageFlip.updateFromImages(pfUrls); } catch {} }
        }, 320);
        afterNavigate();
      });
      wirePfDrag(inner);
      pdfPage = targetIdx + 1;
    } catch (e) { console.error('pageflip canvas', e); teardownPageFlip(); renderPdf(gotoPage || pdfPage); }
    pfBuilding = false;
  }

  // يرسم صفحة PDF داخل كنفا مع ملاءمتها لصندوق (عرض×ارتفاع)
  async function drawPageInto(canvas, n, maxW, maxH) {
    const page = await pdfDoc.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(maxH / vp1.height, maxW / vp1.width);
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const vp = page.getViewport({ scale: scale * dpr });
    canvas.width = vp.width; canvas.height = vp.height;
    canvas.style.width = (vp.width / dpr) + 'px';
    canvas.style.height = (vp.height / dpr) + 'px';
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, intent: 'print' }).promise;
    if (settings.enhanceScan) cleanScan(canvas.getContext('2d'), canvas.width, canvas.height);
  }

  // العرض المزدوج: يرسم الصفحة اليمنى (start) واليسرى (start+1) جنباً إلى جنب
  async function renderPdfSpread(start, fade = false) {
    const reader = $('#reader');
    reader.classList.add('pdf-spread');
    $('#r-canvas-wrap').hidden = false;
    const wrap2 = $('#r-canvas-wrap2');
    // طبقات التحديد/الرسم معطّلة في العرض المزدوج
    { const tl = $('#r-textlayer'), hl = $('#r-hltextlayer'); if (tl) tl.innerHTML = ''; if (hl) hl.innerHTML = ''; }
    const stage = $('#r-stage');
    const availH = stage.clientHeight * 0.96;
    const availW = Math.min(stage.clientWidth - 40, 1700);
    const perW = (availW - 6) / 2;
    const wrap = $('#r-canvas-wrap');
    if (fade) { wrap.style.opacity = '0'; wrap2.style.opacity = '0'; }
    try {
      await drawPageInto($('#r-canvas'), start, perW, availH);
      if (start + 1 <= pageCount) { wrap2.hidden = false; await drawPageInto($('#r-canvas2'), start + 1, perW, availH); }
      else { wrap2.hidden = true; }
    } catch (e) { console.error('pdf spread', e); }
    if (fade) setTimeout(() => { wrap.style.opacity = '1'; wrap2.style.opacity = '1'; }, 30);
  }

  // تأثير قلب الورقة عبر العرض المزدوج (ورقة ثنائية الوجه تدور حول الطيّة الوسطى)
  async function flipSpread(dir) {
    const start = spreadStart(pdfPage);
    const newStart = start + dir * 2;
    if (newStart < 1 || newStart > pageCount) return;
    flipping = true;
    const layer = $('#r-flip-layer');
    const over = dir > 0 ? $('#r-canvas-wrap2') : $('#r-canvas-wrap'); // النصف الذي تُقلب ورقته
    const box = { l: over.offsetLeft, t: over.offsetTop, w: over.offsetWidth, h: over.offsetHeight };
    const frontN = dir > 0 ? start + 1 : start;        // الوجه الظاهر بداية (يطابق الصفحة الحالية)
    const backN = dir > 0 ? start + 2 : start - 1;     // الوجه الخلفي (الصفحة الجديدة)
    const leaf = document.createElement('div');
    leaf.className = 'r-spread-leaf';
    leaf.style.cssText = `left:${box.l}px;top:${box.t}px;width:${box.w}px;height:${box.h}px;` +
      `transform-origin:${dir > 0 ? 'right' : 'left'} center;border-radius:${dir > 0 ? '2px 8px 8px 2px' : '8px 2px 2px 8px'};`;
    const mkFace = (cls) => { const f = document.createElement('div'); f.className = 'sl-face ' + cls; const cv = document.createElement('canvas'); cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'; f.appendChild(cv); leaf.appendChild(f); return cv; };
    const fc = mkFace('sl-front'), bc = mkFace('sl-back');
    try {
      await drawPageInto(fc, frontN, box.w, box.h);
      if (backN >= 1 && backN <= pageCount) await drawPageInto(bc, backN, box.w, box.h);
      layer.appendChild(leaf);
      // اكشف الصفحة الجديدة أسفل النصف المُصدر (مخفيّة تحت الورقة عند البداية)
      if (dir > 0) { const ln = start + 3; if (ln <= pageCount) { await drawPageInto($('#r-canvas2'), ln, box.w, box.h); $('#r-canvas-wrap2').hidden = false; } }
      else { await drawPageInto($('#r-canvas'), newStart, box.w, box.h); }
      requestAnimationFrame(() => leaf.classList.add(dir > 0 ? 'turn-next' : 'turn-prev'));
    } catch (e) { console.error('spread flip', e); }
    setTimeout(() => {
      pdfPage = newStart;
      renderPdfSpread(newStart);
      leaf.remove();
      flipping = false;
      state.pct = pageCount > 1 ? (newStart - 1) / (pageCount - 1) : 1;
      afterNavigate();
    }, 640);
  }

  async function renderPdf(n, fade = false, targetCanvas = null) {
    const canvas = targetCanvas || $('#r-canvas');
    // اخرج من وضع العرض المزدوج عند الرسم المفرد
    if (!targetCanvas) { $('#reader').classList.remove('pdf-spread'); $('#r-canvas-wrap2').hidden = true; }
    const token = targetCanvas ? -1 : ++renderToken;
    try {
      const page = await pdfDoc.getPage(n);
      const stage = $('#r-stage');
      const availH = stage.clientHeight * 0.96;
      const fitW = settings.pdfFit === 'width';
      const availW = fitW ? (stage.clientWidth - 24) : Math.min(stage.clientWidth - 130, 1500);
      const vp1 = page.getViewport({ scale: 1 });
      // «ملء العرض»: القياس بعرض الصفحة فقط (تُمرَّر عمودياً)؛ «احتواء»: الصفحة كاملة داخل الشاشة
      const base = fitW ? (availW / vp1.width) : Math.min(availH / vp1.height, availW / vp1.width);
      const scale = base * pdfZoom;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const vp = page.getViewport({ scale: scale * dpr });
      if (token !== -1 && token !== renderToken) return;
      canvas.width = vp.width; canvas.height = vp.height;
      canvas.style.width = (vp.width / dpr) + 'px';
      canvas.style.height = (vp.height / dpr) + 'px';
      if (fade && !targetCanvas) { canvas.style.opacity = '0'; }
      // intent:'print' يتجنب requestAnimationFrame فيكتمل الرسم حتى في التبويبات الخلفية
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, intent: 'print' }).promise;
      if (settings.enhanceScan) cleanScan(canvas.getContext('2d'), canvas.width, canvas.height);
      if (fade && !targetCanvas) setTimeout(() => (canvas.style.opacity = '1'), 30);
      if (!targetCanvas) { syncDrawLayer(); await buildPdfTextLayer(page, scale); renderPdfHighlights(); }
    } catch (e) { console.error('pdf render', e); }
  }

  /* ═══════ تظليل نص الـ PDF ═══════ */
  // طبقة نص شفّافة قابلة للتحديد فوق كنفا الصفحة (paged)
  async function buildPdfTextLayer(page, cssScale) {
    const tl = $('#r-textlayer');
    if (!tl || pdfScrollActive()) return;
    const myToken = renderToken;
    const cssVp = page.getViewport({ scale: cssScale });
    tl.innerHTML = '';
    tl.style.width = cssVp.width + 'px';
    tl.style.height = cssVp.height + 'px';
    tl.style.setProperty('--scale-factor', cssScale);
    tl.classList.remove('lo'); delete tl.dataset.lo;
    let hasText = false;
    try {
      const tc = await page.getTextContent();
      if (myToken !== renderToken) return; // انتقلت الصفحة أثناء الجلب
      hasText = tc.items.map((i) => i.str).join('').replace(/\s+/g, '').length > 15;
      await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: cssVp, textDivs: [] }).promise;
    } catch (e) { /* بعض الصفحات بلا نص */ }
    if (myToken === renderToken) loAttach(tl, page.pageNumber, cssVp.width, cssVp.height, hasText);
  }

  // رسم مستطيلات التظليل المحفوظة للصفحة الحالية فوق الكنفا
  function renderPdfHighlights() {
    const layer = $('#r-hltextlayer');
    if (!layer) return;
    layer.innerHTML = '';
    if (pdfScrollActive()) return; // للتمرير تُرسم داخل الشرائح
    const canvas = $('#r-canvas');
    const w = parseFloat(canvas.style.width) || canvas.clientWidth;
    const h = parseFloat(canvas.style.height) || canvas.clientHeight;
    layer.style.width = w + 'px'; layer.style.height = h + 'px';
    for (const hl of (state.pdfHighlights || [])) {
      if (hl.page !== pdfPage) continue;
      for (const r of hl.rects) {
        const d = document.createElement('div');
        d.className = 'pdf-hl';
        d.dataset.id = hl.id;
        d.style.left = (r[0] * w) + 'px'; d.style.top = (r[1] * h) + 'px';
        d.style.width = (r[2] * w) + 'px'; d.style.height = (r[3] * h) + 'px';
        d.style.background = hl.color;
        if (hl.note) d.title = hl.note;
        layer.appendChild(d);
      }
    }
  }

  // تحديث التظليلات بعد أي تعديل — يخدم وضعَي الصفحات والتمرير
  function refreshPdfHighlights() {
    if (pdfScrollActive()) {
      for (const s of pdfSlots) {
        if (!s.rendered) continue;
        renderSlotHighlights(s.el, s.page, parseFloat(s.el.style.width), parseFloat(s.el.style.height));
      }
    } else renderPdfHighlights();
  }

  // التقاط تحديد نص PDF → تخزين مؤقت + إظهار المنبثقة (يعمل في وضعَي الصفحات والتمرير)
  function onPdfSelection() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed) return false;
    const host = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    const tl = host && host.closest ? host.closest('.pdf-textlayer') : null;
    if (!tl) return false;
    const text = sel.toString().trim();
    if (!text || text.length > 2000) return false;
    // الكنفا والصفحة المرجعية تختلفان حسب الوضع
    const slot = tl.closest('.pdf-slot');
    const canvas = slot ? slot.querySelector('canvas') : $('#r-canvas');
    const pageNum = slot ? +slot.dataset.page : pdfPage;
    if (!canvas) return false;
    const cRect = canvas.getBoundingClientRect();
    const rects = [];
    for (const r of sel.getRangeAt(0).getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      rects.push([
        (r.left - cRect.left) / cRect.width,
        (r.top - cRect.top) / cRect.height,
        r.width / cRect.width,
        r.height / cRect.height,
      ]);
    }
    if (!rects.length) return false;
    pendingPdfSel = { page: pageNum, text, rects };
    pendingSel = null; pendingMarkId = null; pendingPdfMark = null;
    showHlPopup(sel.getRangeAt(0).getBoundingClientRect(), false);
    return true;
  }

  function addPdfHighlight(color, withNote) {
    if (!pendingPdfSel) return;
    const h = { id: 'p' + Date.now(), page: pendingPdfSel.page, color, note: '', text: pendingPdfSel.text, rects: pendingPdfSel.rects, at: Date.now() };
    state.pdfHighlights.push(h);
    getSelection().removeAllRanges();
    hideHlPopup();
    refreshPdfHighlights();
    renderDrawerPanes();
    schedulePersist();
    if (withNote) openNoteModal(h);
    else Library.toast('ظُلّل النص ✓');
  }

  /* ═══════ التمرير العمودي المتصل لـ PDF ═══════ */
  let pdfObserver = null, pdfSlots = [], pdfAspect = 1.414, pdfScrollRAF = 0;
  const pdfScrollActive = () => isPdf && settings.flip === 'scroll';

  async function buildPdfScroll() {
    const cont = $('#r-pdf-scroll');
    teardownPdfScroll();
    cont.innerHTML = '';
    // نسبة أبعاد الصفحة الأولى (افتراض موحّد، ويُصحَّح عند رسم كل صفحة)
    try {
      const p1 = await pdfDoc.getPage(1);
      const v = p1.getViewport({ scale: 1 });
      pdfAspect = v.width / v.height;
    } catch {}
    const baseW = pdfSlotWidth();
    for (let n = 1; n <= pageCount; n++) {
      const slot = document.createElement('div');
      slot.className = 'pdf-slot';
      slot.dataset.page = n;
      slot.style.width = baseW + 'px';
      slot.style.height = Math.round(baseW / pdfAspect) + 'px';
      slot.innerHTML = `<div class="slot-tint"></div><div class="slot-loading">…</div><div class="slot-num">${n} / ${pageCount}</div>`;
      cont.appendChild(slot);
      pdfSlots.push({ el: slot, page: n, rendered: false, rendering: false });
    }
    pdfObserver = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const s = pdfSlots[+e.target.dataset.page - 1];
        if (!s) continue;
        if (e.isIntersecting) renderSlot(s);
        else clearSlot(s); // تفريغ البعيدة لتوفير الذاكرة
      }
    }, { root: cont, rootMargin: '900px 0px' });
    pdfSlots.forEach((s) => pdfObserver.observe(s.el));

    cont.onscroll = () => {
      if (pdfScrollRAF) return;
      pdfScrollRAF = requestAnimationFrame(() => {
        pdfScrollRAF = 0;
        updatePdfScrollPage();
      });
    };
    // اذهب لموضع القراءة المحفوظ
    requestAnimationFrame(() => { pdfScrollTo(pdfPage, false); renderVisibleSlots(); });
  }

  function pdfSlotWidth() {
    const stageW = $('#r-stage').clientWidth;
    // «ملء العرض»: تملأ الصفحة عرض الشاشة كاملاً؛ «احتواء»: عرض قراءة مريح
    const cap = settings.pdfFit === 'width' ? stageW - 16 : Math.min(stageW - 40, 860);
    return Math.round(cap * pdfZoom);
  }

  function teardownPdfScroll() {
    if (pdfObserver) { pdfObserver.disconnect(); pdfObserver = null; }
    const cont = $('#r-pdf-scroll');
    if (cont) cont.onscroll = null;
    pdfSlots = [];
  }

  async function renderSlot(s) {
    if (s.rendered || s.rendering) return;
    s.rendering = true;
    try {
      const page = await pdfDoc.getPage(s.page);
      const v1 = page.getViewport({ scale: 1 });
      const aspect = v1.width / v1.height;
      const cssW = parseFloat(s.el.style.width);
      const cssH = Math.round(cssW / aspect);
      s.el.style.height = cssH + 'px';
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const vp = page.getViewport({ scale: (cssW / v1.width) * dpr });
      const canvas = document.createElement('canvas');
      canvas.width = vp.width; canvas.height = vp.height;
      // willReadFrequently عند التحسين: القراءة المتكرّرة للبكسل أسرع ودون تحذير
      const sctx = canvas.getContext('2d', { willReadFrequently: !!settings.enhanceScan });
      await page.render({ canvasContext: sctx, viewport: vp, intent: 'print' }).promise;
      if (settings.enhanceScan) cleanScan(sctx, canvas.width, canvas.height);
      // رسم الكتابات المحفوظة (عرض فقط في وضع التمرير)
      drawStrokesTo(sctx, state.drawings[s.page] || [], canvas.width, canvas.height);
      const old = s.el.querySelector('canvas'); if (old) old.remove();
      const ld = s.el.querySelector('.slot-loading'); if (ld) ld.remove();
      s.el.insertBefore(canvas, s.el.firstChild);
      // طبقة تظليل النص (عرض) + طبقة نص شفّافة (تحديد)
      renderSlotHighlights(s.el, s.page, cssW, cssH);
      buildSlotTextLayer(s.el, page, cssW / v1.width, cssW, cssH);
      s.rendered = true;
    } catch (e) { console.error('slot render', e); }
    finally { s.rendering = false; }
  }

  function renderSlotHighlights(slotEl, pageNum, w, h) {
    let layer = slotEl.querySelector('.pdf-hl-layer');
    if (!layer) { layer = document.createElement('div'); layer.className = 'pdf-hl-layer'; slotEl.appendChild(layer); }
    layer.innerHTML = '';
    for (const hl of (state.pdfHighlights || [])) {
      if (hl.page !== pageNum) continue;
      for (const r of hl.rects) {
        const d = document.createElement('div');
        d.className = 'pdf-hl'; d.dataset.id = hl.id;
        d.style.left = (r[0] * w) + 'px'; d.style.top = (r[1] * h) + 'px';
        d.style.width = (r[2] * w) + 'px'; d.style.height = (r[3] * h) + 'px';
        d.style.background = hl.color;
        if (hl.note) d.title = hl.note;
        layer.appendChild(d);
      }
    }
  }

  async function buildSlotTextLayer(slotEl, page, cssScale, w, h) {
    let tl = slotEl.querySelector('.pdf-textlayer');
    if (!tl) { tl = document.createElement('div'); tl.className = 'pdf-textlayer'; slotEl.appendChild(tl); }
    tl.innerHTML = '';
    tl.style.width = w + 'px'; tl.style.height = h + 'px';
    tl.style.setProperty('--scale-factor', cssScale);
    let hasText = false;
    try {
      const tc = await page.getTextContent();
      hasText = tc.items.map((i) => i.str).join('').replace(/\s+/g, '').length > 15;
      await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: page.getViewport({ scale: cssScale }), textDivs: [] }).promise;
    } catch (e) { /* صفحة بلا نص */ }
    loAttach(tl, page.pageNumber, w, h, hasText);
  }

  function renderVisibleSlots() {
    const cont = $('#r-pdf-scroll');
    const top = cont.scrollTop - 900, bot = cont.scrollTop + cont.clientHeight + 900;
    for (const s of pdfSlots) {
      const sTop = s.el.offsetTop, sBot = sTop + s.el.offsetHeight;
      if (sBot >= top && sTop <= bot) renderSlot(s);
    }
  }

  function clearSlot(s) {
    if (!s.rendered) return;
    const c = s.el.querySelector('canvas');
    if (c) c.remove();
    if (!s.el.querySelector('.slot-loading')) {
      const ld = document.createElement('div'); ld.className = 'slot-loading'; ld.textContent = '…';
      s.el.insertBefore(ld, s.el.firstChild);
    }
    s.rendered = false;
  }

  function pdfScrollTo(pageNum, smooth = true) {
    const s = pdfSlots[Math.max(0, Math.min(pageNum, pageCount) - 1)];
    if (!s) return;
    const cont = $('#r-pdf-scroll');
    // في الخلفية (شاشة مقفلة مع القراءة الصوتية) لا يتحرّك التمرير الناعم ⇒ قفزة فورية
    cont.scrollTo({ top: s.el.offsetTop - 12, behavior: smooth && !document.hidden ? 'smooth' : 'auto' });
  }

  function updatePdfScrollPage() {
    const cont = $('#r-pdf-scroll');
    const mid = cont.scrollTop + cont.clientHeight * 0.35;
    let cur = pdfPage;
    for (const s of pdfSlots) {
      if (s.el.offsetTop <= mid && s.el.offsetTop + s.el.offsetHeight > mid) { cur = s.page; break; }
    }
    pdfPage = cur;
    const max = cont.scrollHeight - cont.clientHeight;
    state.pct = max > 0 ? cont.scrollTop / max : 1;
    state.page = pdfPage - 1;
    state.lastRead = Date.now();
    if (state.pct >= 0.995 && !state.finished) { state.finished = true; state.finishedAt = state.finishedAt || Date.now(); celebrate(); }
    updateHUD();
    schedulePersist();
  }

  /* ═══════ الكتابة على الصفحة (PDF) ═══════ */
  let drawMode = false, drawTool = 'pen', drawColor = '#e03131';
  let curStroke = null;

  function setDrawMode(on) {
    drawMode = on;
    $('#reader').classList.toggle('draw-on', on);
    $('#r-btn-draw').classList.toggle('on', on);
    $('#draw-bar').hidden = !on;
    if (on) showUI();
  }

  function pageStrokes() {
    return state.drawings[pdfPage] = state.drawings[pdfPage] || [];
  }

  /* مزامنة أبعاد طبقة الرسم مع كنفا الصفحة وإعادة رسم خطوطها */
  function syncDrawLayer() {
    if (!isPdf) return;
    const main = $('#r-canvas'), dc = $('#r-draw');
    if (dc.width !== main.width || dc.height !== main.height) {
      dc.width = main.width; dc.height = main.height;
    }
    redrawStrokes();
  }

  function redrawStrokes() {
    const dc = $('#r-draw');
    const ctx = dc.getContext('2d');
    ctx.clearRect(0, 0, dc.width, dc.height);
    drawStrokesTo(ctx, state.drawings[pdfPage] || [], dc.width, dc.height);
  }

  function drawStrokesTo(ctx, strokes, W, H) {
    for (const s of strokes) drawOneStroke(ctx, s, W, H);
  }

  function drawOneStroke(ctx, s, W, H, fromIdx = 0) {
    if (s.pts.length < 2) return;
    ctx.save();
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.strokeStyle = s.color;
    if (s.tool === 'hl') { ctx.globalAlpha = 0.35; ctx.lineWidth = 0.024 * W; }
    else { ctx.globalAlpha = 1; ctx.lineWidth = Math.max(1.5, 0.0032 * W); }
    ctx.beginPath();
    const i0 = Math.max(0, fromIdx - 1);
    ctx.moveTo(s.pts[i0][0] * W, s.pts[i0][1] * H);
    for (let i = i0 + 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i][0] * W, s.pts[i][1] * H);
    ctx.stroke();
    ctx.restore();
  }

  function eraseAt(nx, ny) {
    const dc = $('#r-draw');
    const rad = 16 / dc.clientWidth; // نصف قطر الممحاة بوحدات الصفحة
    const strokes = state.drawings[pdfPage] || [];
    const keep = strokes.filter((s) => !s.pts.some((p) => {
      const dx = p[0] - nx, dy = p[1] - ny;
      return dx * dx + dy * dy < rad * rad;
    }));
    if (keep.length !== strokes.length) {
      state.drawings[pdfPage] = keep;
      redrawStrokes();
      schedulePersist();
    }
  }

  function wireDraw() {
    const dc = $('#r-draw');
    $('#r-btn-draw').onclick = () => setDrawMode(!drawMode);

    $('#draw-bar').querySelectorAll('[data-tool]').forEach((b) => {
      b.onclick = () => {
        drawTool = b.dataset.tool;
        $('#draw-bar').querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('active', x === b));
      };
    });
    $('#draw-bar').querySelectorAll('.db-color').forEach((b) => {
      b.onclick = () => {
        drawColor = b.dataset.color;
        $('#draw-bar').querySelectorAll('.db-color').forEach((x) => x.classList.toggle('active', x === b));
        if (drawTool === 'eraser') $('#draw-bar').querySelector('[data-tool="pen"]').click();
      };
    });
    $('#draw-undo').onclick = () => {
      const strokes = state.drawings[pdfPage];
      if (strokes && strokes.length) { strokes.pop(); redrawStrokes(); schedulePersist(); }
    };
    $('#draw-clear').onclick = async () => {
      if ((state.drawings[pdfPage] || []).length &&
          await Library.confirm('سيُمسح كل ما رسمته على هذه الصفحة.', { title: 'مسح كتابات الصفحة؟', okText: 'امسح', danger: true })) {
        delete state.drawings[pdfPage];
        redrawStrokes(); schedulePersist();
      }
    };

    const norm = (e) => {
      const r = dc.getBoundingClientRect();
      return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    };

    dc.addEventListener('pointerdown', (e) => {
      if (!drawMode) return;
      e.preventDefault(); e.stopPropagation();
      dc.setPointerCapture(e.pointerId);
      const [nx, ny] = norm(e);
      if (drawTool === 'eraser') { eraseAt(nx, ny); return; }
      curStroke = { tool: drawTool, color: drawColor, pts: [[nx, ny]] };
    });
    dc.addEventListener('pointermove', (e) => {
      if (!drawMode) return;
      const [nx, ny] = norm(e);
      if (drawTool === 'eraser') { if (e.buttons) eraseAt(nx, ny); return; }
      if (!curStroke) return;
      const last = curStroke.pts[curStroke.pts.length - 1];
      if (Math.abs(nx - last[0]) + Math.abs(ny - last[1]) < 0.0025) return;
      curStroke.pts.push([nx, ny]);
      drawOneStroke(dc.getContext('2d'), curStroke, dc.width, dc.height, curStroke.pts.length - 1);
    });
    const finish = (e) => {
      if (!curStroke) return;
      e && e.stopPropagation();
      if (curStroke.pts.length > 1) {
        pageStrokes().push(curStroke);
        redrawStrokes(); // إعادة رسم نظيفة (خصوصاً للتظليل المتراكم)
        schedulePersist();
      }
      curStroke = null;
    };
    dc.addEventListener('pointerup', finish);
    dc.addEventListener('pointercancel', finish);
    dc.addEventListener('touchstart', (e) => { if (drawMode) e.stopPropagation(); }, { passive: true });
    dc.addEventListener('touchend', (e) => { if (drawMode) e.stopPropagation(); }, { passive: true });
  }

  /* ═══════ تكبير PDF ═══════ */
  // إعادة تخطيط صفحات PDF بالعرض/التكبير الحالي (يُستدعى عند التكبير أو تغيير ملء العرض)
  function relayoutPdf() {
    if (!isPdf) return;
    if (pdfScrollActive()) {
      const anchorPage = pdfPage;
      const w = pdfSlotWidth();
      for (const s of pdfSlots) {
        s.el.style.width = w + 'px';
        s.el.style.height = Math.round(w / pdfAspect) + 'px';
        clearSlot(s);
      }
      requestAnimationFrame(() => { pdfScrollTo(anchorPage, false); renderVisibleSlots(); });
    } else showPdfPage(pdfPage);
  }

  // حدود التكبير: في التمرير المتصل يمكن التصغير دون 100٪ (صفحات أضيق وأكثر على الشاشة)؛
  // أما في أوضاع الصفحات فـ100٪ تعني «الصفحة كاملة على الشاشة» فلا معنى للنزول تحتها.
  const ZOOM_MAX = 2.4;
  const minZoom = () => (pdfScrollActive() ? 0.4 : 1);
  function updateZoomUI() {
    $('#zoom-val').textContent = Math.round(pdfZoom * 100) + '٪';
    $('#reader').classList.toggle('zoomed', pdfZoom > 1.001);
    const zo = $('#zoom-out'), zi = $('#zoom-in');
    if (zo) zo.disabled = pdfZoom <= minZoom() + 0.001;
    if (zi) zi.disabled = pdfZoom >= ZOOM_MAX - 0.001;
  }
  function setZoom(z) {
    if (!isPdf) return;
    pdfZoom = Math.min(ZOOM_MAX, Math.max(minZoom(), Math.round(z * 10) / 10));
    updateZoomUI();
    relayoutPdf();
  }

  /* ═══════ القراءة الصوتية (صوت الجهاز + صوت طبيعي سحابي) ═══════ */
  let ttsOn = false, ttsIdx = 0, ttsEls = [], ttsPaused = false;
  let ttsEngine = 'device';        // المحرّك الفعّال في الجلسة
  let ttsAudio = null;             // مشغّل الصوت الطبيعي (Audio)
  const ttsCache = new Map();      // نص → WAV dataURL (تخزين مؤقت + جلب مسبق)
  const ttsInflight = new Map();   // نص → وعد جلب جارٍ (منع الازدواج)
  let ttsGapResolve = null;        // لإنهاء انتظار المقطع فوراً عند الإيقاف/التخطّي
  let ttsSleepTid = null;

  // أفضل صوت عربي متاح على الجهاز (يفضّل الطبيعي/الشبكي على الآلي المحلّي)
  function pickVoice() {
    const vs = speechSynthesis.getVoices().filter((v) => /^ar/i.test(v.lang));
    if (!vs.length) return null;
    // صوت اختاره القارئ (يُطابَق بالمعرّف ثم بالاسم، فقد يتغيّر المعرّف بين الأجهزة)
    const want = (settings || Store.getSettings()).ttsDeviceVoice; // settings تُحمَّل عند فتح أول كتاب
    if (want) {
      const chosen = vs.find((v) => v.voiceURI === want) || vs.find((v) => v.name === want);
      if (chosen) return chosen;
    }
    const score = (v) => (/(natural|online|neural|premium|enhanced)/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
    return vs.slice().sort((a, b) => score(b) - score(a))[0];
  }

  async function pdfHasReadableText() {
    if (ocrFull && ocrFull.text && ocrFull.text.trim().length > 15) return true; // نص مُستخرَج متاح
    if (liveOcrOn()) return true; // الصفحات المصوّرة تُقرأ على الجهاز عند الحاجة
    for (let p = pdfPage; p <= Math.min(pageCount, pdfPage + 4); p++) {
      try {
        const page = await pdfDoc.getPage(p);
        const tc = await page.getTextContent();
        if (tc.items.map((i) => i.str).join('').trim().length > 15) return true;
      } catch {}
    }
    return false;
  }

  /* ═══════ 🔎 القراءة الحيّة للصفحات المصوّرة (Tesseract على الجهاز) ═══════
     الصفحة المصوّرة التي أمامك (بلا طبقة نص) يُتعرّف على نصّها في الخلفية، ثم الصفحتان التاليتان.
     مواضع الكلمات ⇒ طبقة نص شفّافة قابلة للتحديد (تظليل، نسخ، معجم)؛ والنص يُضاف إلى نص الكتاب
     المحفوظ صفحةً صفحة (بحث، قراءة صوتية، كتاب مسموع، ملخّص). كل صفحة تُقرأ مرة واحدة فقط. */
  const LO = { bookId: null, words: null, q: [], busy: false, waiters: new Map(), ft: null, saveT: 0, dirtyW: false, dirtyT: false };
  function liveOcrOn() { try { return !!window.LocalOCR && localStorage.getItem('midad-live-ocr') !== '0'; } catch { return !!window.LocalOCR; } }
  async function loLoad() {
    if (LO.bookId === book.id && LO.words) return;
    LO.bookId = book.id; LO.q = []; LO.ft = null;
    LO.words = (await Store.getMisc(book.id, 'ocrw').catch(() => null)) || {};
  }
  async function loFlush() {
    clearTimeout(LO.saveT);
    const bid = LO.bookId; if (!bid || !LO.words) return;
    try {
      if (LO.dirtyW) { LO.dirtyW = false; await Store.putMisc(bid, 'ocrw', LO.words); }
      if (LO.dirtyT && LO.ft) { LO.dirtyT = false; await Store.saveFulltext(bid, LO.ft); }
    } catch (e) { console.warn('live ocr save', e); }
  }
  function loReset() {
    loFlush();
    LO.waiters.forEach((ws) => ws.forEach((w) => w(null))); LO.waiters.clear();
    LO.bookId = null; LO.words = null; LO.q = []; LO.ft = null; loPill('');
  }
  function loPill(msg) {
    let p0 = $('#lo-pill');
    if (!msg) { if (p0) p0.hidden = true; return; }
    if (!p0) { p0 = document.createElement('div'); p0.id = 'lo-pill'; p0.className = 'lo-pill'; p0.setAttribute('role', 'status'); $('#reader').appendChild(p0); }
    p0.textContent = msg; p0.hidden = false;
  }
  // نص الصفحة n إلى نص الكتاب المحفوظ (لا يمسّ صفحة لها نص سابق: أصلي أو من Gemini)
  async function loMergeText(n, text) {
    if (!text || !book) return;
    if (!LO.ft) LO.ft = (await Store.getFulltext(book.id).catch(() => null)) || null;
    const ft = LO.ft, N = pageCount;
    const pages = new Array(N).fill('');
    if (ft && ft.text != null && Array.isArray(ft.pageStarts)) {
      const ps = ft.pageStarts;
      for (let i = 0; i < N && i < ps.length; i++) pages[i] = (ft.text.slice(ps[i] ?? 0, ps[i + 1] ?? ft.text.length) || '').trim();
    }
    if ((pages[n - 1] || '').replace(/\s+/g, '').length > 15) return;
    pages[n - 1] = text;
    let t = ''; const pageStarts = [];
    for (let i = 0; i < N; i++) { pageStarts.push(t.length); t += pages[i] + '\n\n'; }
    LO.ft = { ...(ft || {}), text: t, pageStarts, ocr: true, engine: (ft && ft.ocr && ft.engine) || 'tesseract', live: !(ft && ft.ocr && !ft.live) };
    ocrFull = LO.ft; // القراءة الصوتية والملخّص يجدان النص فوراً
    LO.dirtyT = true;
  }
  // اطلب نص صفحة (prio: الصفحة المعروضة الآن ⇒ أول الطابور). يعيد بياناتها أو null
  function loWant(n, prio) {
    if (!book || !isPdf || !liveOcrOn() || n < 1 || n > pageCount) return Promise.resolve(null);
    if (LO.words && LO.words[n]) return Promise.resolve(LO.words[n]);
    const pr = new Promise((res) => { const ws = LO.waiters.get(n) || []; ws.push(res); LO.waiters.set(n, ws); });
    LO.q = LO.q.filter((x) => x !== n);
    if (prio) { LO.q.unshift(n); LO.q = LO.q.filter((x) => x === n || Math.abs(x - n) <= 4); } // قفزة بعيدة ⇒ أسقط القديم
    else LO.q.push(n);
    loPump();
    return pr;
  }
  async function loPump() {
    if (LO.busy) return;
    LO.busy = true; const bid = book && book.id, doc = pdfDoc;
    try {
      await loLoad();
      while (LO.q.length && book && book.id === bid && pdfDoc === doc && liveOcrOn()) {
        const n = LO.q.shift();
        if (LO.words[n]) { loDone(n, LO.words[n]); continue; }
        // صفحة لها طبقة نص أصلية ⇒ لا حاجة (قد تصل هنا من الجلب المسبق)
        let has = false;
        try { const pg = await doc.getPage(n); const tc = await pg.getTextContent(); has = tc.items.map((i) => i.str).join('').replace(/\s+/g, '').length > 15; } catch {}
        if (has) { loDone(n, null); continue; }
        const first = !LocalOCR.workers || !localStorage.getItem('midad-lo-ready');
        loPill(first ? '🔎 تجهيز التعرّف على النص (أول مرة فقط)…' : `🔎 قراءة نص الصفحة ${n}…`);
        let d = null;
        try {
          const r = await LocalOCR.recognizePageWords(doc, n);
          d = { lines: r.lines, c: Math.round(r.conf) };
          try { localStorage.setItem('midad-lo-ready', '1'); } catch {}
          if (!book || book.id !== bid) return;
          LO.words[n] = d; LO.dirtyW = true;
          await loMergeText(n, r.text);
          clearTimeout(LO.saveT); LO.saveT = setTimeout(loFlush, 3000);
        } catch (e) { console.warn('live ocr', n, e); if (/تحميل/.test((e && e.message) || '')) { loPill(''); LO.q = []; Library.toast(e.message); } }
        loDone(n, d);
      }
    } finally { LO.busy = false; loPill(''); try { LocalOCR.release(); } catch {} }
  }
  function loDone(n, d) { const ws = LO.waiters.get(n); LO.waiters.delete(n); if (ws) ws.forEach((w) => w(d)); }
  // طبقة النص الشفّافة من مواضع الكلمات (كما تفعل pdf.js مع النص الأصلي)
  let loCtx = null;
  function loRender(tl, d, w, h) {
    if (!d || !d.lines || !d.lines.length || !tl.isConnected) return;
    loCtx = loCtx || document.createElement('canvas').getContext('2d');
    const frag = document.createDocumentFragment();
    for (const line of d.lines) {
      for (const wd of line) {
        const [x0, y0, x1, y1] = wd.b;
        const bw = Math.max(1, (x1 - x0) * w), bh = Math.max(4, (y1 - y0) * h);
        const fs = bh * 0.92;
        loCtx.font = `${fs}px sans-serif`;
        const mw = loCtx.measureText(wd.t).width || bw;
        const s = document.createElement('span');
        s.textContent = wd.t + ' ';
        s.dir = 'auto';
        s.style.cssText = `left:${(x0 * w).toFixed(1)}px;top:${(y0 * h).toFixed(1)}px;font-size:${fs.toFixed(1)}px;font-family:sans-serif;transform:scaleX(${(bw / mw).toFixed(3)});transform-origin:0 0`;
        frag.appendChild(s);
      }
      frag.appendChild(document.createElement('br'));
    }
    tl.innerHTML = '';
    tl.appendChild(frag);
    tl.classList.add('lo');
  }
  // يُستدعى بعد بناء طبقة النص: صفحة بلا نص ⇒ القراءة الحيّة
  async function loAttach(tl, n, w, h, hasText) {
    if (hasText || !liveOcrOn() || !book || !isPdf) return;
    await loLoad();
    tl.dataset.lo = n;
    if (LO.words[n]) loRender(tl, LO.words[n], w, h);
    else {
      if (!localStorage.getItem('midad-lo-intro')) { try { localStorage.setItem('midad-lo-intro', '1'); } catch {} Library.toast('🔎 صفحة مصوّرة: يُقرأ نصّها على جهازك لتحدّده وتسمعه وتبحث فيه — يمكنك إيقاف ذلك من إعدادات القراءة «ع»'); }
      loWant(n, true).then((d) => { if (d && tl.isConnected && +tl.dataset.lo === n) loRender(tl, d, w, h); });
    }
    for (let k = 1; k <= 2; k++) if (!LO.words[n + k]) loWant(n + k, false);
  }

  // نص صفحة من نتيجة الـOCR (1-based) عند غياب النص الأصلي
  function ocrPageText(n) {
    if (!ocrFull || !ocrFull.pageStarts) return '';
    const ps = ocrFull.pageStarts;
    const a = ps[n - 1] ?? 0, b = ps[n] ?? ocrFull.text.length;
    return ocrFull.text.slice(a, b).replace(/\s+/g, ' ').trim();
  }

  // المحرّك المختار في الإعدادات (الطبيعي افتراضياً)؛ يُستعمل فعلاً متى توفّر الذكاء، وإلا صوت الجهاز
  const engineSetting = () => settings.ttsEngine || 'natural';
  const aiOk = () => !!(window.Cloud && Cloud.aiReady && Cloud.aiReady());

  /* ── قائمة أصوات الجهاز العربية + التجربة ── */
  const AR_REGION = { SA: 'السعودية', EG: 'مصر', AE: 'الإمارات', JO: 'الأردن', KW: 'الكويت', LB: 'لبنان', MA: 'المغرب', QA: 'قطر',
    SY: 'سوريا', TN: 'تونس', IQ: 'العراق', DZ: 'الجزائر', BH: 'البحرين', LY: 'ليبيا', OM: 'عُمان', YE: 'اليمن', '001': 'فصحى' };
  function deviceVoiceLabel(v) {
    const reg = AR_REGION[(v.lang.split(/[-_]/)[1] || '').toUpperCase()] || '';
    const natural = /(natural|online|neural|premium|enhanced)/i.test(v.name);
    const name = v.name.replace(/^(Microsoft|Google|Apple)\s+/i, '').replace(/\s*\((Natural|Online)[^)]*\)/gi, '').replace(/\s*-\s*Arabic.*$/i, '').replace(/\s+Online/i, '').trim();
    return `${name}${reg ? ' — ' + reg : ''}${natural ? ' ✨' : ''}`;
  }
  function fillDeviceVoices() {
    const sel = $('#set-ttsdevice'); if (!sel || !('speechSynthesis' in window)) return;
    const vs = speechSynthesis.getVoices().filter((v) => /^ar/i.test(v.lang))
      .sort((a, b) => (/(natural|online|neural)/i.test(b.name) ? 1 : 0) - (/(natural|online|neural)/i.test(a.name) ? 1 : 0) || a.lang.localeCompare(b.lang));
    sel.innerHTML = '<option value="">تلقائي (أفضل صوت عربي)</option>' + vs.map((v) => `<option value="${esc(v.voiceURI)}">${esc(deviceVoiceLabel(v))}</option>`).join('');
    // قد يصل حدث voiceschanged قبل فتح أي كتاب (settings ما زالت null)
    const cur = (settings || Store.getSettings()).ttsDeviceVoice || '';
    sel.value = vs.some((v) => v.voiceURI === cur) ? cur : (vs.find((v) => v.name === cur) || {}).voiceURI || '';
    const hint = $('#tts-device-hint');
    if (hint) {
      const nat = vs.filter((v) => /(natural|online|neural)/i.test(v.name)).length;
      hint.textContent = !vs.length ? 'لا توجد أصوات عربية مثبّتة على هذا الجهاز — جرّب «صوت طبيعي»، أو أضف اللغة العربية للنطق من إعدادات النظام.'
        : `على هذا الجهاز ${vs.length} ${vs.length > 2 && vs.length < 11 ? 'أصوات' : 'صوت'} عربي${nat ? `، منها ${nat} طبيعي ✨` : ''}.` + (nat ? '' : ' متصفح Edge يوفّر أصواتاً عربية طبيعية مجاناً (سعودية، مصرية، إماراتية…).');
    }
  }
  if ('speechSynthesis' in window) { try { speechSynthesis.addEventListener('voiceschanged', fillDeviceVoices); } catch {} }
  const TTS_SAMPLE = 'مرحباً بك. هذا صوت القراءة في مِداد: الكتاب هو الجليس الذي لا يطريك، والصديق الذي لا يقليك.';
  function tryDeviceVoice() {
    if (!('speechSynthesis' in window)) return Library.toast('صوت الجهاز غير مدعوم في هذا المتصفح');
    if (ttsOn) ttsStop();
    try { speechSynthesis.cancel(); } catch {}
    const u = new SpeechSynthesisUtterance(TTS_SAMPLE);
    const v = pickVoice(); if (v) u.voice = v;
    u.lang = v ? v.lang : 'ar-SA';
    u.rate = (settings.ttsRate || 100) / 100;
    speechSynthesis.speak(u);
  }
  async function tryNaturalVoice(btn) {
    if (Library.needAI && Library.needAI('الصوت الطبيعي')) return;
    if (ttsOn) ttsStop();
    const orig = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    try {
      const url = await synthChunk(TTS_SAMPLE);
      if (!ttsAudio) ttsAudio = new Audio();
      ttsAudio.onended = null; ttsAudio.src = url;
      ttsAudio.playbackRate = Math.max(0.5, Math.min(2, (settings.ttsRate || 100) / 100));
      await ttsAudio.play();
    } catch (e) { Library.toast('تعذّرت تجربة الصوت: ' + ((e && e.message) || '')); }
    finally { if (btn) { btn.disabled = false; btn.textContent = orig; } }
  }
  function syncVoiceRows() {
    const nat = engineSetting() === 'natural', ai = aiOk();
    const vl = $('#tts-voice-label'); if (vl) vl.hidden = !nat;
    // الطبيعي مختار بلا مفتاح ⇒ صوت الجهاز هو ما يُقرأ فعلاً، فاعرض قائمته أيضاً مع تنبيه واضح
    const dl = $('#tts-device-label'); if (dl) dl.hidden = nat && ai;
    let warn = $('#tts-nat-warn');
    if (vl && !warn) { warn = document.createElement('p'); warn.id = 'tts-nat-warn'; warn.className = 'fld-hint tts-warn'; vl.appendChild(warn); }
    if (warn) { warn.hidden = !(nat && !ai); warn.innerHTML = 'يحتاج مفتاح Gemini — <button type="button" class="tts-link">أضِفه</button>. حتى ذلك يُقرأ بصوت الجهاز أدناه.'; const l = warn.querySelector('.tts-link'); if (l) l.onclick = () => Library.openAiKeyDialog && Library.openAiKeyDialog(); }
    if (!(nat && ai)) fillDeviceVoices();
  }

  async function ttsToggle() {
    if (ttsOn) return ttsStop();
    if (!('speechSynthesis' in window) && !(window.Cloud && Cloud.aiReady && Cloud.aiReady())) return Library.toast('القراءة الصوتية غير مدعومة في متصفحك');
    if (isPdf && !(await pdfHasReadableText())) {
      if (window.Cloud && Cloud.aiReady && Cloud.aiReady() && Library.ocrBook) {
        const bid = book.id;
        if (await Library.confirm('صفحات هذا الكتاب مصوّرة (بلا نص). استخراج النص عبر الذكاء الاصطناعي يُفعّل القراءة الصوتية والبحث والتلخيص.', { title: 'استخراج النص (OCR)؟', okText: 'استخرج النص', icon: '🔎' })) {
          close(); Library.ocrBook(bid);
        }
      } else {
        if (Library.needAI) Library.needAI('قراءة الكتب المصوّرة صوتياً (استخراج نصها أولاً)');
      }
      return;
    }
    if (!isPdf) {
      ttsEls = [...contentEl.querySelectorAll('p, h2, h3')].filter((el) => el.textContent.trim());
      if (!ttsEls.length) return Library.toast('لا يوجد نص للقراءة');
      if (settings.flip === 'scroll') {
        const vr = viewportEl.getBoundingClientRect();
        ttsIdx = ttsEls.findIndex((el) => el.getBoundingClientRect().bottom > vr.top + 10);
      } else {
        ttsIdx = ttsEls.findIndex((el) => elementPage(el) >= curPage);
      }
      if (ttsIdx < 0) ttsIdx = 0;
    }
    // اختر المحرّك: طبيعي (سحابي) إن طُلب وكان متاحاً، وإلا صوت الجهاز
    const wantNatural = engineSetting() === 'natural' && window.Cloud && Cloud.aiReady && Cloud.aiReady();
    ttsEngine = wantNatural ? 'natural' : 'device';
    if (AB.play) abStop(); // لا صوتان معاً
    podStop();
    ttsOn = true; ttsPaused = false;
    $('#r-btn-tts').classList.add('on');
    setupMediaSession();
    startSleepTimer();
    Library.toast(ttsEngine === 'natural' ? 'بدأ الاستماع بصوت طبيعي 🔊' : 'بدأت القراءة الصوتية 🔊 — اضغط الزر ذاته للإيقاف');
    if (ttsEngine === 'natural') speakNatural(); else speakNext();
  }

  /* ── شريط الجملة المقروءة (للـPDF: الصفحة مرسومة صورةً فلا يمكن تظليل نصها في مكانه) ── */
  let ttsSents = null; // {page, list:[جمل], i}
  /* صفحة القراءة الصوتية مستقلّة عن pdfPage: في عرض الصفحتين يبقى pdfPage أولَ الصفحتين،
     فلو قرأنا pdfPage لما تجاوزت القراءة الصفحة اليسرى أبداً. نتبع القارئ إن قلّب بنفسه. */
  let ttsPage = 0, ttsTurnAt = 0;
  // الصفحات الظاهرة الآن: صفحتان في العرض المزدوج وفي التقليب الواقعي الأفقي، وإلا صفحة واحدة
  function visiblePdfPages() {
    let two = pdfSpreadActive();
    if (!two && pdfFlipBookActive() && pageFlip) { try { two = pageFlip.getOrientation() === 'landscape'; } catch {} }
    return two ? [pdfPage, pdfPage + 1] : [pdfPage];
  }
  function readingPage() {
    // بعد تقليب أمرت به القراءة نفسها، تتأخّر pdfPage حتى تنتهي حركة الورقة ⇒ لا تحسبه تقليباً يدوياً
    const turning = Date.now() - ttsTurnAt < 2500;
    if (!ttsPage || (!turning && !visiblePdfPages().includes(ttsPage))) ttsPage = pdfPage;
    return ttsPage;
  }
  function gotoReadingPage(n) { ttsPage = n; if (!visiblePdfPages().includes(n)) { ttsTurnAt = Date.now(); jumpTo(n); } }
  function splitSentences(text) {
    const raw = String(text || '').replace(/\s+/g, ' ').trim();
    if (!raw) return [];
    const parts = raw.split(/(?<=[.!؟?۔:؛])\s+/);
    const out = []; let cur = '';
    for (const p of parts) {
      cur = cur ? cur + ' ' + p : p;
      if (cur.length >= 40) { out.push(cur); cur = ''; } // ادمج الجمل القصيرة جداً مع تاليتها
    }
    if (cur) { if (out.length && cur.length < 25) out[out.length - 1] += ' ' + cur; else out.push(cur); }
    // جملة طويلة بلا ترقيم (شائع في نص الـOCR) ⇒ قسّمها عند الفواصل أو كل ~220 حرفاً
    return out.flatMap((x) => (x.length <= 260 ? [x] : x.split(/(?<=[،,])\s+/).reduce((a, w) => { const l = a[a.length - 1]; if (l && (l + ' ' + w).length <= 240) a[a.length - 1] = l + ' ' + w; else a.push(w); return a; }, [])));
  }
  function captionEl() {
    let c = $('#tts-caption');
    if (!c) {
      c = document.createElement('div');
      c.id = 'tts-caption'; c.className = 'tts-caption'; c.hidden = true;
      c.setAttribute('role', 'status'); c.setAttribute('aria-live', 'off');
      c.innerHTML = `<div class="tc-meta"><span class="tc-page"></span><span class="tc-prog"></span></div>
        <div class="tc-text"><span class="tc-prev"></span> <mark class="tc-now"></mark> <span class="tc-next"></span></div>
        <div class="tc-btns"><button class="tc-back" aria-label="الجملة السابقة">⏮</button><button class="tc-play" aria-label="إيقاف مؤقّت">⏸</button><button class="tc-fwd" aria-label="الجملة التالية">⏭</button><button class="tc-x" aria-label="إيقاف القراءة">✕</button></div>`;
      $('#reader').appendChild(c);
      c.querySelector('.tc-play').onclick = () => { if (ttsPaused) ttsResume(); else ttsPause(); syncCaptionBtn(); };
      c.querySelector('.tc-x').onclick = () => ttsStop();
      c.querySelector('.tc-back').onclick = () => ttsSentSkip(-1);
      c.querySelector('.tc-fwd').onclick = () => ttsSentSkip(1);
    }
    return c;
  }
  function syncCaptionBtn() { const b = $('#tts-caption .tc-play'); if (b) { b.textContent = ttsPaused ? '▶' : '⏸'; b.setAttribute('aria-label', ttsPaused ? 'استئناف' : 'إيقاف مؤقّت'); } }
  function showCaption(list, i, page) {
    const c = captionEl();
    c.querySelector('.tc-page').textContent = 'صفحة ' + page + (pageCount ? ' من ' + pageCount : '');
    c.querySelector('.tc-prog').textContent = list.length > 1 ? (i + 1) + '/' + list.length : '';
    const clip = (t, n, end) => (t.length > n ? (end ? '…' + t.slice(-n) : t.slice(0, n) + '…') : t);
    c.querySelector('.tc-prev').textContent = i > 0 ? clip(list[i - 1], 90, true) : '';
    c.querySelector('.tc-now').textContent = list[i] || '';
    c.querySelector('.tc-next').textContent = list[i + 1] ? clip(list[i + 1], 90) : '';
    c.hidden = false; syncCaptionBtn();
  }
  function hideCaption() { const c = $('#tts-caption'); if (c) c.hidden = true; ttsSents = null; }
  // تخطّي جملة للأمام/للخلف (صوت الجهاز) أو مقطع (الصوت الطبيعي)
  function ttsSentSkip(dir) {
    if (!ttsOn || !isPdf || !ttsSents) return ttsSkip(dir);
    const ni = ttsSents.i + dir, rp = ttsSents.page;
    if (ni < 0) { if (rp > 1) { ttsSents = null; gotoReadingPage(rp - 1); } else ttsSents.i = 0; }
    else if (ni >= ttsSents.list.length) { if (rp < pageCount) { ttsSents = null; gotoReadingPage(rp + 1); } else return ttsStop(true); }
    else ttsSents.i = ni;
    ttsPaused = false;
    if (ttsEngine === 'natural') { if (ttsSents) ttsSents.jump = true; try { ttsAudio && ttsAudio.pause(); } catch {} if (ttsGapResolve) { const r = ttsGapResolve; ttsGapResolve = null; r(); } }
    else { ttsSents.skipping = true; try { speechSynthesis.cancel(); } catch {} setTimeout(() => { if (ttsSents) ttsSents.skipping = false; speakNext(); }, 60); }
  }
  // جمل الصفحة الحالية (تُبنى مرة لكل صفحة؛ تتبع تقليب القارئ اليدوي)
  async function pdfSentences() {
    const rp = readingPage();
    if (ttsSents && ttsSents.page === rp) return ttsSents;
    const unit = await currentUnit(false);
    ttsSents = { page: rp, list: splitSentences(unit && unit.text), i: 0 };
    return ttsSents;
  }

  // نصّ الوحدة الحالية (فقرة نصية أو صفحة PDF) + تمييزها وتمرير الصفحة إليها
  async function currentUnit(highlight = true) {
    if (isPdf) {
      let text = '';
      const rp = readingPage();
      try { const page = await pdfDoc.getPage(rp); const tc = await page.getTextContent(); text = tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim(); } catch {}
      if (!text) text = ocrPageText(rp);
      if (!text && liveOcrOn()) { const d = await loWant(rp, true); if (d) text = ocrPageText(rp); } // صفحة مصوّرة: اقرأها الآن
      return { text, el: null };
    }
    if (ttsIdx >= ttsEls.length) return null;
    const el = ttsEls[ttsIdx];
    if (highlight) {
      if (settings.flip === 'scroll') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else { const pg = elementPage(el); if (pg !== curPage) setPage(pg, false); }
      el.classList.add('tts-now');
    }
    return { text: el.textContent, el };
  }

  // انتقل للوحدة التالية؛ يعيد false عند النهاية
  function ttsAdvance() {
    if (isPdf) { const rp = readingPage(); if (rp >= pageCount) return false; gotoReadingPage(rp + 1); return true; }
    ttsIdx++; return ttsIdx < ttsEls.length;
  }

  /* ── محرّك صوت الجهاز (speechSynthesis) ── */
  async function speakNext() {
    if (!ttsOn || ttsPaused) return;
    if (isPdf) return speakPdfSentence();
    const unit = await currentUnit();
    if (!unit) return ttsStop(true);
    if (!unit.text) { if (ttsAdvance()) return speakNext(); return ttsStop(true); }
    const u = new SpeechSynthesisUtterance(unit.text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v ? v.lang : 'ar-SA';
    u.rate = (settings.ttsRate || 100) / 100;
    u.onend = () => {
      if (unit.el) unit.el.classList.remove('tts-now');
      if (!ttsOn || ttsPaused) return;
      if (ttsAdvance()) speakNext(); else ttsStop(true);
    };
    u.onerror = () => { if (unit.el) unit.el.classList.remove('tts-now'); if (ttsOn) ttsStop(); };
    speechSynthesis.speak(u);
  }

  async function speakPdfSentence() {
    if (!ttsOn || ttsPaused) return;
    const ss = await pdfSentences();
    if (!ss.list.length || ss.i >= ss.list.length) { // صفحة بلا نص أو انتهت جملها
      ttsSents = null;
      if (ttsAdvance()) return speakPdfSentence();
      return ttsStop(true);
    }
    showCaption(ss.list, ss.i, ss.page);
    const u = new SpeechSynthesisUtterance(ss.list[ss.i]);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v ? v.lang : 'ar-SA';
    u.rate = (settings.ttsRate || 100) / 100;
    u.onend = () => {
      if (!ttsOn || ttsPaused || (ttsSents && ttsSents.skipping)) return;
      if (ttsSents === ss) ss.i++;
      speakPdfSentence();
    };
    u.onerror = (ev) => { if (ev && /interrupted|canceled/.test(ev.error || '')) return; if (ttsOn) ttsStop(); };
    speechSynthesis.speak(u);
  }

  /* ── محرّك الصوت الطبيعي (Gemini TTS عبر خادمك) ── */
  // قسّم نصاً طويلاً إلى مقاطع ≤ maxLen عند حدود الجُمَل
  function splitChunks(text, maxLen = 1400) {
    text = (text || '').trim(); if (text.length <= maxLen) return text ? [text] : [];
    const parts = text.split(/(?<=[.!؟?۔\n])\s+/); const out = []; let cur = '';
    for (const p of parts) {
      if ((cur + ' ' + p).length > maxLen && cur) { out.push(cur.trim()); cur = p; }
      else cur = cur ? cur + ' ' + p : p;
      while (cur.length > maxLen) { out.push(cur.slice(0, maxLen)); cur = cur.slice(maxLen); }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  // ركّب مقطعاً إلى WAV dataURL (مع تخزين مؤقت ومنع الازدواج)
  async function synthChunk(text) {
    if (ttsCache.has(text)) return ttsCache.get(text);
    if (ttsInflight.has(text)) return ttsInflight.get(text);
    const pr = (async () => {
      const voice = settings.ttsVoice || 'Kore';
    const data = await Cloud.invokeFn('ai', { action: 'tts', text, voice });
      if (!data || !data.audio) throw new Error('لم يصل صوت');
      const url = 'data:' + (data.mime || 'audio/wav') + ';base64,' + data.audio;
      ttsCache.set(text, url); if (ttsCache.size > 40) ttsCache.delete(ttsCache.keys().next().value);
      return url;
    })();
    ttsInflight.set(text, pr);
    try { return await pr; } finally { ttsInflight.delete(text); }
  }
  // شغّل dataURL وانتظر انتهاءه (يحترم الإيقاف/الإيقاف المؤقّت)
  function playUrl(url) {
    return new Promise((resolve) => {
      ttsGapResolve = resolve;
      if (!ttsAudio) ttsAudio = new Audio();
      ttsAudio.src = url;
      ttsAudio.playbackRate = Math.max(0.5, Math.min(2, (settings.ttsRate || 100) / 100));
      ttsAudio.onended = () => { ttsGapResolve = null; resolve(); };
      ttsAudio.onerror = () => { ttsGapResolve = null; resolve(); };
      ttsAudio.play().catch(() => { ttsGapResolve = null; resolve(); });
    });
  }
  async function speakNatural() {
    if (isPdf) return speakNaturalPdf();
    while (ttsOn) {
      const unit = await currentUnit();
      if (!unit) { ttsStop(true); return; }
      if (!unit.text) { if (!ttsAdvance()) { ttsStop(true); return; } continue; }
      const chunks = splitChunks(unit.text);
      for (let ci = 0; ci < chunks.length; ci++) {
        if (!ttsOn) { if (unit.el) unit.el.classList.remove('tts-now'); return; }
        let url;
        try { url = await synthChunk(chunks[ci]); }
        catch (e) {
          // فشل الصوت الطبيعي → تحوّل لصوت الجهاز لبقية الجلسة
          if (unit.el) unit.el.classList.remove('tts-now');
          if (!ttsOn) return;
          ttsEngine = 'device';
          Library.toast('تعذّر الصوت الطبيعي — تحوّلت لصوت الجهاز' + (/(quota|429|حصة)/i.test(e.message || '') ? ' (تجاوز الحصّة)' : ''));
          return speakNext();
        }
        if (!ttsOn) return;
        if (chunks[ci + 1]) synthChunk(chunks[ci + 1]).catch(() => {}); // جلب مسبق للمقطع التالي
        await playUrl(url);
        if (!ttsOn) { if (unit.el) unit.el.classList.remove('tts-now'); return; }
      }
      if (unit.el) unit.el.classList.remove('tts-now');
      if (!ttsAdvance()) { ttsStop(true); return; }
    }
  }

  // كتب PDF بالصوت الطبيعي: جملة/جملتان لكل مقطع، فيتبع الشريط القراءة بدقّة
  async function speakNaturalPdf() {
    while (ttsOn) {
      const ss = await pdfSentences();
      if (!ss.list.length || ss.i >= ss.list.length) { ttsSents = null; if (!ttsAdvance()) { ttsStop(true); return; } continue; }
      showCaption(ss.list, ss.i, ss.page);
      let url;
      try { url = await synthChunk(ss.list[ss.i]); }
      catch (e) {
        if (!ttsOn) return;
        ttsEngine = 'device';
        Library.toast('تعذّر الصوت الطبيعي — تحوّلت لصوت الجهاز' + (/(quota|429|حصة)/i.test(e.message || '') ? ' (تجاوز الحصّة)' : ''));
        return speakNext();
      }
      if (!ttsOn) return;
      // جلب مسبق للجملة التالية (أو أول جملة في الصفحة التالية لا نعرفها بعد)
      if (ss.list[ss.i + 1]) synthChunk(ss.list[ss.i + 1]).catch(() => {});
      await playUrl(url);
      if (!ttsOn) return;
      if (ttsSents === ss && !ss.jump) ss.i++;
      if (ttsSents) ttsSents.jump = false;
    }
  }

  /* ── إيقاف مؤقّت/استئناف/تخطّي (يعملان مع المحرّكين وأزرار شاشة القفل) ── */
  function ttsPause() {
    if (!ttsOn || ttsPaused) return;
    ttsPaused = true;
    if (ttsEngine === 'natural') { try { ttsAudio && ttsAudio.pause(); } catch {} }
    else { try { speechSynthesis.pause(); } catch {} }
    if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = 'paused'; } catch {}
    syncCaptionBtn();
  }
  function ttsResume() {
    if (!ttsOn || !ttsPaused) return;
    ttsPaused = false;
    if (ttsEngine === 'natural') { try { ttsAudio && ttsAudio.play(); } catch {} }
    else { try { speechSynthesis.resume(); } catch {} }
    if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = 'playing'; } catch {}
    syncCaptionBtn();
    // صوت الجهاز قد يتجاهل resume بعد إيقاف طويل (كروم) ⇒ أعد الجملة الحالية
    if (ttsEngine !== 'natural' && isPdf) setTimeout(() => { if (ttsOn && !ttsPaused && !speechSynthesis.speaking) speakNext(); }, 400);
  }
  function ttsSkip(dir) {
    if (!ttsOn) return;
    if (contentEl) contentEl.querySelectorAll('.tts-now').forEach((e) => e.classList.remove('tts-now'));
    if (isPdf) { const t = readingPage() + dir; ttsSents = null; if (t >= 1 && t <= pageCount) gotoReadingPage(t); }
    else { ttsIdx = Math.max(0, Math.min(ttsIdx + dir, ttsEls.length - 1)); }
    ttsPaused = false;
    if (ttsEngine === 'natural') { try { ttsAudio && ttsAudio.pause(); } catch {} if (ttsGapResolve) { const r = ttsGapResolve; ttsGapResolve = null; r(); } }
    else { try { speechSynthesis.cancel(); } catch {} speakNext(); }
  }

  function startSleepTimer() {
    clearTimeout(ttsSleepTid); ttsSleepTid = null;
    const min = +settings.ttsSleep || 0;
    if (min > 0) ttsSleepTid = setTimeout(() => { if (ttsOn) { ttsStop(); Library.toast('انتهى مؤقّت النوم — أُوقف الاستماع 😴'); } }, min * 60000);
  }

  function setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: book.title || 'كتاب', artist: book.author || 'مِداد', album: 'مِداد' });
      navigator.mediaSession.setActionHandler('play', ttsResume);
      navigator.mediaSession.setActionHandler('pause', ttsPause);
      navigator.mediaSession.setActionHandler('previoustrack', () => (isPdf ? ttsSentSkip(-1) : ttsSkip(-1)));
      navigator.mediaSession.setActionHandler('nexttrack', () => (isPdf ? ttsSentSkip(1) : ttsSkip(1)));
      try { navigator.mediaSession.setActionHandler('stop', () => ttsStop()); } catch {}
      navigator.mediaSession.playbackState = 'playing';
    } catch {}
  }

  function ttsStop(finished = false) {
    ttsOn = false; ttsPaused = false;
    try { speechSynthesis.cancel(); } catch {}
    if (ttsAudio) { try { ttsAudio.pause(); ttsAudio.src = ''; } catch {} }
    if (ttsGapResolve) { const r = ttsGapResolve; ttsGapResolve = null; r(); }
    clearTimeout(ttsSleepTid); ttsSleepTid = null;
    if (contentEl) contentEl.querySelectorAll('.tts-now').forEach((e) => e.classList.remove('tts-now'));
    hideCaption(); ttsPage = 0;
    $('#r-btn-tts').classList.remove('on');
    if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = 'none'; ['play', 'pause', 'previoustrack', 'nexttrack', 'stop'].forEach((a) => navigator.mediaSession.setActionHandler(a, null)); } catch {}
    if (finished) Library.toast('انتهت القراءة الصوتية ✓');
  }

  /* ═══════ مساعد القراءة الذكي ═══════ */
  let aiBusy = false;

  function openAI() {
    if (Library.needAI && Library.needAI('المساعد الذكي')) return;
    $('#ai-modal').hidden = false;
    $('#r-btn-ai').classList.add('on');
    setTimeout(() => $('#ai-input').focus(), 80);
  }

  function addAiMsg(kind, html) {
    const el = document.createElement('div');
    el.className = 'ai-msg ' + kind;
    el.innerHTML = html;
    const hint = $('#ai-body').querySelector('.ai-hint'); if (hint) hint.remove();
    $('#ai-body').appendChild(el);
    $('#ai-body').scrollTop = $('#ai-body').scrollHeight;
    return el;
  }

  // تحويل ماركداون مبسّط إلى HTML آمن
  function mdToHtml(md) {
    const esc2 = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const lines = esc2(md).split(/\r?\n/);
    let html = '', inList = false;
    const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<em>$1</em>');
    for (let ln of lines) {
      const t = ln.trim();
      if (/^#{1,4}\s+/.test(t)) { if (inList) { html += '</ul>'; inList = false; } html += '<h4>' + inline(t.replace(/^#{1,4}\s+/, '')) + '</h4>'; }
      else if (/^([-*•]|\d+\.)\s+/.test(t)) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(t.replace(/^([-*•]|\d+\.)\s+/, '')) + '</li>'; }
      else if (!t) { if (inList) { html += '</ul>'; inList = false; } }
      else { if (inList) { html += '</ul>'; inList = false; } html += '<p>' + inline(t) + '</p>'; }
    }
    if (inList) html += '</ul>';
    return html || '<p></p>';
  }

  const parseJsonArray = (s) => { try { const m = String(s).match(/\[[\s\S]*\]/); return m ? JSON.parse(m[0]) : []; } catch { return []; } };

  /* ═══════ ملخّص الفصل + خريطته الذهنية + بطاقاته (نداء واحد، صيغة مخطّط لا JSON:
     الرد المقطوع عند حدّ الطول يبقى قابلاً للعرض) ═══════ */
  function chapterKitPrompt(ch) {
    return `أنت «مساعد القراءة» في تطبيق مِداد. اقرأ القسم${ch.label ? ` «${ch.label}»` : ''} من كتاب «${book.title}» ثم أعد ثلاثة أجزاء بهذه الصيغة حرفياً، بالعربية الفصحى، دون أي مقدمة:
## الملخص
(ملخّص مركّز في ١٢٠–١٨٠ كلمة: الفكرة العامة ثم أهم ما فيه، فقرة أو فقرتان)
## الخريطة
(خريطة ذهنية للقسم: من ٤ إلى ٦ أفكار رئيسية، كلٌّ في سطر يبدأ بـ «- » ولا يتجاوز خمس كلمات، وتحت كلٍّ من فكرتين إلى أربع أفكار فرعية في أسطر تبدأ بـ «  - » ولا يتجاوز كلٌّ منها ست كلمات)
## البطاقات
(من ٥ إلى ٨ بطاقات مراجعة، كل بطاقة سطران: «س: سؤال موجز» ثم «ج: جواب موجز»)

=== نص القسم ===
${ch.text.slice(0, 120000)}`;
  }
  function parseChapterKit(res) {
    const t = String(res || '').replace(/\r/g, '');
    const sec = (name) => { const m = t.match(new RegExp(`##\\s*${name}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`)); return m ? m[1].trim() : ''; };
    const summary = sec('الملخص') || (/##/.test(t) ? '' : t.trim());
    const branches = [];
    for (const line of sec('الخريطة').split('\n')) {
      const m = line.match(/^(\s*)[-*•]\s+(.+)/); if (!m) continue;
      const label = m[2].replace(/\*\*/g, '').trim(); if (!label) continue;
      if (m[1].length >= 2 && branches.length) branches[branches.length - 1].kids.push(label);
      else branches.push({ label, kids: [] });
    }
    const cards = []; let q = null;
    for (const line of sec('البطاقات').split('\n')) {
      const s = line.replace(/^\s*[-*•\d.)]+\s*/, '').trim();
      let m;
      if ((m = s.match(/^س\s*[:：]\s*(.+)/))) q = m[1];
      else if ((m = s.match(/^ج\s*[:：]\s*(.+)/)) && q) { cards.push({ q, a: m[1] }); q = null; }
    }
    return { summary, branches: branches.slice(0, 7).map((b) => ({ label: b.label, kids: b.kids.slice(0, 5) })), cards };
  }
  const CHKIT_KEY = 'midad-chkit';
  function chKitGet(k) { try { return (JSON.parse(localStorage.getItem(CHKIT_KEY) || '{}') || {})[k] || null; } catch { return null; } }
  function chKitPut(k, v) {
    try {
      const all = JSON.parse(localStorage.getItem(CHKIT_KEY) || '{}') || {};
      all[k] = v; const ks = Object.keys(all); if (ks.length > 60) ks.slice(0, ks.length - 60).forEach((x) => delete all[x]);
      localStorage.setItem(CHKIT_KEY, JSON.stringify(all));
    } catch {}
  }

  // خريطة ذهنية: الفصل في الوسط، والأفكار الرئيسية على الجانبين (يبدأ الأيمن)، وفروعها أبعد
  function mindMapSVG(center, branches) {
    const PAL = ['#e9a23b', '#4fb3a9', '#c2649a', '#6c8fe0', '#8bbf5a', '#d9734f', '#9a7fd1'];
    const ROW = 44, GAPB = 16;
    const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    const tw = (s, fs) => Math.ceil(s.length * fs * 0.56) + 26; // عرض تقديري للنص العربي
    const leafMax = Math.max(80, ...branches.flatMap((b) => b.kids.map((k) => tw(clip(k, 30), 14))));
    const W = Math.max(900, 2 * (360 + leafMax + 24)), cx = W / 2;
    const sides = { r: [], l: [] }; let wr = 0, wl = 0;
    branches.forEach((b, i) => { const w = Math.max(1, b.kids.length); if (wr <= wl) { sides.r.push({ ...b, i }); wr += w; } else { sides.l.push({ ...b, i }); wl += w; } });
    const blockH = (b) => Math.max(1, b.kids.length) * ROW;
    const sideH = (arr) => arr.reduce((h, b) => h + blockH(b), 0) + Math.max(0, arr.length - 1) * GAPB;
    const H = Math.max(sideH(sides.r), sideH(sides.l), 120) + 60, cy = H / 2;
    let out = '';
    const node = (x, y, text, fs, fill, stroke, color, anchor, bold) => {
      const w = tw(text, fs), h = fs + 18;
      const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
      return `<rect x="${x0.toFixed(1)}" y="${(y - h / 2).toFixed(1)}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>
        <text x="${(x0 + w / 2).toFixed(1)}" y="${(y + fs * 0.36).toFixed(1)}" font-size="${fs}" fill="${color}" text-anchor="middle"${bold ? ' font-weight="700"' : ''}>${esc(text)}</text>`;
    };
    for (const side of ['r', 'l']) {
      const dir = side === 'r' ? 1 : -1;
      let y = cy - sideH(sides[side]) / 2;
      for (const b of sides[side]) {
        const col = PAL[b.i % PAL.length], bh = blockH(b), by = y + bh / 2;
        const bx = cx + dir * 215, lbl = clip(b.label, 26);
        out += `<path d="M${cx + dir * 70},${cy} C${cx + dir * 150},${cy} ${bx - dir * 90},${by} ${bx},${by}" stroke="${col}" stroke-width="3.2" fill="none" opacity=".85"/>`;
        const bw = tw(lbl, 17);
        b.kids.forEach((k, j) => {
          const ky = y + j * ROW + ROW / 2, kx = cx + dir * 360;
          out += `<path d="M${bx + dir * bw / 2},${by} C${bx + dir * (bw / 2 + 40)},${by} ${kx - dir * 50},${ky} ${kx},${ky}" stroke="${col}" stroke-width="1.8" fill="none" opacity=".6"/>`;
          out += node(kx, ky, clip(k, 30), 14, 'rgba(255,255,255,.04)', col + '88', '#ece5f5', side === 'r' ? 'start' : 'end');
        });
        out += node(bx, by, lbl, 17, col + '2e', col, '#fff6e6', 'middle', true);
        y += bh + GAPB;
      }
    }
    out += node(cx, cy, clip(center || book.title, 28), 20, '#3a2a5c', '#e9c887', '#ffe9bd', 'middle', true);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" direction="rtl" font-family="Tajawal, 'Segoe UI', Tahoma, sans-serif"><rect width="${W}" height="${H}" fill="#161126"/>${out}</svg>`;
  }
  async function saveMapImage(svg, label) {
    try {
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      await img.decode();
      const c = document.createElement('canvas'); c.width = img.width * 2; c.height = img.height * 2;
      const x = c.getContext('2d'); x.scale(2, 2); x.drawImage(img, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const file = new File([blob], `خريطة - ${label || book.title}.png`, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: label || book.title }); return; } catch {} }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      Library.toast('حُفظت الخريطة صورةً 🖼', 'gold');
    } catch { Library.toast('تعذّر حفظ الصورة'); }
  }
  function renderChapterKit(el, res, label) {
    const kit = parseChapterKit(res);
    if (!kit.summary && !kit.branches.length) { el.innerHTML = mdToHtml(res); return; }
    const svg = kit.branches.length ? mindMapSVG(label || book.title, kit.branches) : '';
    el.innerHTML = `<div class="ck">
      ${label ? `<div class="ck-label">📑 ${esc(label)}</div>` : ''}
      <div class="ck-sum">${mdToHtml(kit.summary)}</div>
      ${svg ? `<div class="ck-h">🧠 الخريطة الذهنية</div><div class="ck-map" dir="ltr">${svg}</div>
        <div class="ck-btns"><button class="ck-full">⛶ ملء الشاشة</button><button class="ck-img">🖼 احفظها صورة</button></div>` : ''}
      ${kit.cards.length ? '<div class="ck-h">🃏 بطاقات الفصل</div><div class="ck-cards"></div>' : ''}
    </div>`;
    const map = el.querySelector('.ck-map');
    if (map) {
      requestAnimationFrame(() => { map.scrollLeft = (map.scrollWidth - map.clientWidth) / 2; });
      el.querySelector('.ck-img').onclick = () => saveMapImage(svg, label);
      el.querySelector('.ck-full').onclick = () => {
        const o = document.createElement('div');
        o.className = 'ck-overlay';
        o.innerHTML = `<div class="ck-map ck-map-full" dir="ltr">${svg}</div><button class="ck-x" aria-label="إغلاق">✕</button>`;
        document.body.appendChild(o);
        o.querySelector('.ck-x').onclick = () => o.remove();
        const m = o.querySelector('.ck-map'); requestAnimationFrame(() => { m.scrollLeft = (m.scrollWidth - m.clientWidth) / 2; });
      };
    }
    if (kit.cards.length) renderFlashcards(el.querySelector('.ck-cards'), JSON.stringify(kit.cards));
  }

  /* ── «أنهيت فصلاً»: عند الانتقال للفصل التالي بعد قراءة حقيقية فيه، اقتراح لطيف بملخّصه وخريطته ── */
  let chapNow = null, chapSince = 0, chapChipTimer = 0;
  function trackChapter() {
    if (!isOpen || !tocItems.length) return;
    const idx = tocIndexNow();
    if (chapNow === null) { chapNow = idx; chapSince = Date.now(); return; }
    if (idx === chapNow) return;
    const prev = chapNow, spent = Date.now() - chapSince;
    chapNow = idx; chapSince = Date.now();
    // تقدّمٌ إلى ما بعد نهاية الفصل السابق، بعد ٣ دقائق فيه على الأقل
    if (prev < 0 || idx < tocEndIdx(prev) || spent < 180000) return;
    try { if (localStorage.getItem('midad-chkit-chip') === 'off') return; } catch {}
    if (!(window.Cloud && Cloud.aiReady && Cloud.aiReady())) return;
    showChapterChip(prev);
  }
  function showChapterChip(prevIdx) {
    let c = $('#ck-chip');
    if (!c) {
      c = document.createElement('div'); c.id = 'ck-chip'; c.className = 'ck-chip'; c.setAttribute('role', 'status');
      $('#reader').appendChild(c);
    }
    const label = tocItems[prevIdx].label || '';
    c.innerHTML = `<span>✅ أنهيت «${esc(label.length > 34 ? label.slice(0, 33) + '…' : label)}»</span>
      <button class="ck-go">🧠 ملخّصه وخريطته</button><button class="ck-no" title="لا تقترح هذا مجدداً">✕</button>`;
    c.hidden = false;
    clearTimeout(chapChipTimer); chapChipTimer = setTimeout(() => { c.hidden = true; }, 14000);
    c.querySelector('.ck-go').onclick = () => { c.hidden = true; openAI(); runAI('chapter', { chapterIdx: prevIdx }); };
    c.querySelector('.ck-no').onclick = () => {
      c.hidden = true;
      if (c.dataset.once) { try { localStorage.setItem('midad-chkit-chip', 'off'); } catch {} Library.toast('لن يُقترح ملخّص الفصل تلقائياً — يبقى متاحاً في ✨ المساعد'); }
      c.dataset.once = '1';
    };
  }

  function renderFlashcards(el, res) {
    const cards = parseJsonArray(res).filter((c) => c && (c.q || c.a));
    if (!cards.length) { el.innerHTML = mdToHtml(res); return; }
    el.innerHTML = '<div class="fc-hint">اضغط البطاقة لقلبها 🔄</div><div class="fc-deck">' + cards.map((c) =>
      `<button class="fc-card"><div class="fc-inner"><div class="fc-face fc-front">${esc(c.q || '')}</div><div class="fc-face fc-back">${esc(c.a || '')}</div></div></button>`).join('') +
      `</div><button class="fc-save btn-gold" style="margin-top:12px">💾 احفظ للمراجعة (${cards.length})</button>`;
    el.querySelectorAll('.fc-card').forEach((b) => (b.onclick = () => b.classList.toggle('flipped')));
    const saveBtn = el.querySelector('.fc-save');
    saveBtn.onclick = async () => {
      try {
        const existing = (await Store.getDeck(book.id)) || { cards: [] };
        const have = new Set((existing.cards || []).filter((c) => !c.del).map((c) => c.q));
        const now = Date.now();
        const fresh = cards.filter((c) => !have.has(c.q)).map((c) => ({ id: 'fc' + now + Math.random().toString(36).slice(2, 6), q: c.q || '', a: c.a || '', box: 1, due: now, mt: now }));
        const merged = [...(existing.cards || []), ...fresh];
        await Store.saveDeck(book.id, merged);
        if (window.Cloud) Cloud.pushDeck(book.id);
        saveBtn.textContent = `✓ حُفظت — ${merged.length} بطاقة في «${book.title}»`;
        saveBtn.disabled = true;
        Library.toast('حُفظت البطاقات للمراجعة 🃏', 'gold');
      } catch (e) { Library.toast('تعذّر الحفظ'); }
    };
  }
  function renderQuiz(el, res) {
    const qs = parseJsonArray(res);
    if (!qs.length) { el.innerHTML = mdToHtml(res); return; }
    el.innerHTML = '<div class="quiz">' + qs.map((q, qi) =>
      `<div class="quiz-q" data-correct="${q.correct | 0}"><div class="qq-text">${qi + 1}. ${esc(q.q || '')}</div><div class="qq-opts">${(q.options || []).map((o, oi) =>
        `<button class="qq-opt" data-oi="${oi}">${esc(o)}</button>`).join('')}</div><div class="qq-why" hidden>${esc(q.why || '')}</div></div>`).join('') + '</div>';
    el.querySelectorAll('.quiz-q').forEach((qEl) => {
      const correct = +qEl.dataset.correct;
      qEl.querySelectorAll('.qq-opt').forEach((opt) => (opt.onclick = () => {
        if (qEl.classList.contains('answered')) return;
        qEl.classList.add('answered');
        const chosen = +opt.dataset.oi;
        qEl.querySelectorAll('.qq-opt').forEach((o, i) => { if (i === correct) o.classList.add('correct'); else if (i === chosen) o.classList.add('wrong'); });
        const why = qEl.querySelector('.qq-why'); if (why) why.hidden = false;
      }));
    });
  }

  // نصّ الفصل/القسم الحالي (نصي: من عنوان لعنوان؛ PDF: نطاق صفحات الفصل أو نافذة حوله)
  // فهرس العنصر الذي يقرؤه القارئ الآن (كل أوضاع العرض)؛ -1 إن كان قبل أول عنوان
  function tocIndexNow() {
    let idx = -1;
    if (isPdf) { tocItems.forEach((t, i) => { if (t.page && t.page <= pdfPage) idx = i; }); return idx; }
    if (settings.flip === 'scroll') {
      const top = viewportEl.getBoundingClientRect().top + 60;
      tocItems.forEach((t, i) => { if (t.el && t.el.getBoundingClientRect().top <= top) idx = i; });
      return idx;
    }
    // تقليب: عنوان في صفحة سابقة، أو في أعلى الصفحة الحالية (ما تحته هو ما يُقرأ الآن)
    const vpTop = viewportEl.getBoundingClientRect().top;
    tocItems.forEach((t, i) => { if (!t.el) return; const pg = elementPage(t.el); if (pg < curPage || (pg === curPage && t.el.getBoundingClientRect().top - vpTop < 140)) idx = i; });
    return idx;
  }
  // نهاية الفصل: أول عنصر تالٍ في مستواه أو أعلى (الفصل يشمل أقسامه الفرعية)
  const tocEndIdx = (idx) => { const lv = tocItems[idx].lvl || 1; for (let j = idx + 1; j < tocItems.length; j++) if ((tocItems[j].lvl || 1) <= lv) return j; return tocItems.length; };

  async function currentChapterText(forceIdx) {
    if (!isPdf && tocItems.length) {
      const idx = forceIdx != null ? forceIdx : Math.max(0, tocIndexNow());
      const startEl = tocItems[idx] && tocItems[idx].el, endEl = tocItems[tocEndIdx(idx)] && tocItems[tocEndIdx(idx)].el;
      if (startEl) {
        let txt = '', node = startEl;
        while (node && node !== endEl) { txt += (node.textContent || '') + '\n'; node = node.nextElementSibling; }
        return { label: tocItems[idx].label, text: txt };
      }
    }
    if (isPdf) {
      try { await Library.getBookText(book.id); } catch {} // يضمن فهرسة النص + pageStarts
      const s = await Store.getFulltext(book.id);
      if (s && s.text) {
        const ps = s.pageStarts || [];
        if (ps.length && tocItems.length) {
          const idx = forceIdx != null ? forceIdx : Math.max(0, tocIndexNow());
          const ei = tocEndIdx(idx);
          const sp = tocItems[idx].page || 1, ep = (tocItems[ei] && tocItems[ei].page) || (ps.length + 1);
          const a = ps[sp - 1] || 0, e = ps[ep - 1] != null ? ps[ep - 1] : s.text.length;
          return { label: tocItems[idx].label, text: s.text.slice(a, e) };
        }
        if (ps.length) { // بلا فهرس: نافذة صفحات حول الموضع
          const lo = Math.max(0, pdfPage - 11), hi = Math.min(ps.length - 1, pdfPage + 9);
          const a = ps[lo] || 0, e = ps[hi + 1] != null ? ps[hi + 1] : s.text.length;
          return { label: `صفحات ${lo + 1}–${hi + 1}`, text: s.text.slice(a, e) };
        }
        return { label: '', text: s.text };
      }
    }
    // نصي بلا فهرس
    try { const all = await Library.getBookText(book.id); if (all) return { label: '', text: all }; } catch {}
    return null;
  }

  // نصّ تظليلات القارئ (نصية + PDF) مع ملاحظاته — لتوليد بطاقات منها
  function highlightsText() {
    const hs = [...(state.highlights || []), ...(state.pdfHighlights || [])];
    return hs.map((h) => { let s = (h.text || '').trim(); if (h.note) s += `\n(ملاحظتي: ${h.note})`; return s; }).filter(Boolean).join('\n\n---\n\n');
  }

  async function runAI(action, extra = {}) {
    if (aiBusy) return;
    const labels = { summarize: '📄 لخّص الكتاب', chapter: '🧠 ملخّص الفصل وخريطته', keypoints: '💡 أبرز نقاط الكتاب', flashcards: '🃏 بطاقات من الكتاب', hlcards: '🖍 بطاقات من تظليلاتي', quiz: '📝 اختبرني', podcast: '🎙 بودكاست الفصل', timeline: '🗺 الأعلام والخط الزمني' };
    if (action === 'ask') {
      const q = $('#ai-input').value.trim();
      if (!q) return;
      $('#ai-input').value = '';
      addAiMsg('user', esc(q));
      extra.question = q;
    } else if (labels[action]) addAiMsg('user', labels[action]);
    else if (action === 'explain') addAiMsg('user', '✨ اشرح: «' + esc((extra.selection || '').slice(0, 120)) + (extra.selection && extra.selection.length > 120 ? '…' : '') + '»');

    const loading = addAiMsg('ai loading', '<span class="ai-typing"><i></i><i></i><i></i></span>');
    aiBusy = true;
    try {
      let body;
      if (action === 'explain') body = { action, title: book.title, text: extra.selection || '' };
      else if (action === 'podcast' || action === 'timeline') {
        loading.classList.remove('loading');
        if (action === 'podcast') await runPodcast(loading, extra.chapterIdx);
        else await runTimeline(loading);
        return;
      } else if (action === 'chapter') {
        const ch = await currentChapterText(extra.chapterIdx);
        if (!ch || !ch.text.trim()) { loading.classList.remove('loading'); loading.innerHTML = 'تعذّر تحديد نصّ الفصل الحالي — إن كان الكتاب مصوّراً فاستخرج نصّه أولاً.'; return; }
        // ملخّص + خريطة ذهنية + بطاقات في نداء واحد؛ النتيجة تُحفظ فلا يُعاد طلبها للفصل نفسه
        const ck = `${book.id}|${ch.label}|${ch.text.length}`;
        const cached = chKitGet(ck);
        if (cached) { loading.classList.remove('loading'); renderChapterKit(loading, cached, ch.label); return; }
        body = { action: 'sumtext', title: book.title, text: chapterKitPrompt(ch) };
        const res = await Cloud.aiInvoke(body);
        loading.classList.remove('loading');
        if (parseChapterKit(res).summary) chKitPut(ck, res);
        renderChapterKit(loading, res, ch.label);
        return;
      } else if (action === 'hlcards') {
        const t = highlightsText();
        if (!t) { loading.classList.remove('loading'); loading.innerHTML = 'لا توجد تظليلات بعد. ظلّل مقاطع مهمّة أثناء القراءة ثم أنشئ منها بطاقات.'; return; }
        body = { action: 'flashcards', title: book.title, text: t };
      } else if (action === 'ask') body = { action, title: book.title, question: extra.question || '', text: await Library.getBookText(book.id) };
      else body = { action, title: book.title, text: await Library.getBookText(book.id) };
      const res = await Cloud.aiInvoke(body);
      loading.classList.remove('loading');
      if (action === 'flashcards' || action === 'hlcards') renderFlashcards(loading, res);
      else if (action === 'quiz') renderQuiz(loading, res);
      else loading.innerHTML = mdToHtml(res);
    } catch (e) {
      loading.classList.remove('loading');
      loading.classList.add('err');
      loading.innerHTML = '⚠ ' + esc((e && e.message) || 'تعذّر الحصول على رد');
    } finally { aiBusy = false; $('#ai-body').scrollTop = $('#ai-body').scrollHeight; }
  }

  /* ═══════ أدوات مشتركة للاستوديو ═══════ */
  const hashS = (s) => { let h = 5381; s = String(s); for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const arDigits = (s) => String(s || '').replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660).replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0);
  const lsMap = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}'); } catch { return {}; } };
  function lsMapPut(k, key, val, max = 40) {
    const m = lsMap(k); m[key] = { v: val, at: Date.now() };
    const ks = Object.keys(m).sort((a, b) => (m[b].at || 0) - (m[a].at || 0));
    for (const x of ks.slice(max)) delete m[x];
    try { localStorage.setItem(k, JSON.stringify(m)); } catch {}
  }
  const lsMapGet = (k, key) => { const e = lsMap(k)[key]; return e ? e.v : null; };
  // أقسام الرد بصيغة «## عنوان» (أصمد من JSON حين يُقطع الرد عند حدّ الطول)
  function mdSections(res) {
    const out = {}; let cur = '_';
    for (const ln of String(res || '').split(/\r?\n/)) {
      const m = ln.match(/^\s*#{1,4}\s*(.+?)\s*$/);
      if (m) { cur = m[1].replace(/[*:：]/g, '').trim(); out[cur] = out[cur] || []; continue; }
      (out[cur] = out[cur] || []).push(ln);
    }
    return out;
  }
  const secGet = (S, ...names) => { for (const n of names) for (const k of Object.keys(S)) if (k.includes(n)) return S[k]; return []; };
  const bullets = (lines) => lines.map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\*\*/g, '').trim()).filter((l) => l && !/^لا يوجد/.test(l));
  // الانتقال إلى موضع: صفحة PDF إن عُرفت، وإلا بحث في الكتاب
  // أفضل عبارة للبحث: النص كاملاً إن وُجد، وإلا أطول كلماته التي ترد فعلاً في الكتاب
  function bestQuery(hay, q) {
    q = String(q || '').trim(); if (!q || !hay) return q;
    if (ArSearch.find(hay, q, 0)) return q;
    const ws = q.split(/\s+/), pairs = ws.slice(0, -1).map((w, i) => w + ' ' + ws[i + 1]);
    const STOP = /^(في|من|على|إلى|عن|مع|بين|ثم|بعد|قبل|التي|الذي|هذا|هذه|كان|بدء|بداية)$/;
    for (const c of [...pairs, ...ws.filter((w) => w.length >= 3 && !STOP.test(w)).sort((a, b2) => b2.length - a.length)]) if (ArSearch.find(hay, c, 0)) return c;
    return q;
  }
  async function goToMention(q, page) {
    $('#ai-modal').hidden = true; $('#r-btn-ai').classList.remove('on');
    document.querySelectorAll('.st-ov').forEach((o) => o.remove());
    if (isPdf) {
      let p = parseInt(page, 10);
      if (!(p > 0) && q) { // ابحث في النص المفهرس عن أول ورود
        try {
          const s = await Store.getFulltext(book.id);
          if (s && s.text) { const m = ArSearch.find(s.text, bestQuery(s.text, q), 0); if (m && s.pageStarts) { let lo = 0; while (lo + 1 < s.pageStarts.length && s.pageStarts[lo + 1] <= m.index) lo++; p = lo + 1; } }
        } catch {}
      }
      if (p > 0) { jumpTo(Math.min(p, pageCount)); return; }
      Library.toast('لم أجد موضعه في الكتاب');
      return;
    }
    q = bestQuery(contentEl.textContent, q);
    const s = $('#r-search'); s.hidden = false;
    $('#r-search-input').value = q; doSearch(q);
  }

  /* ═══════ 🎙 بودكاست الفصل: حوار بصوتين (مقدّم وضيفة) يُولَّد ويُحفظ على الجهاز ═══════ */
  const POD_SPK = [{ id: 'Samer', ar: 'سامر', voice: 'Charon' }, { id: 'Layla', ar: 'ليلى', voice: 'Aoede' }];
  const POD = { audio: null, url: null, el: null, tok: 0 };
  function podPrompt(ch) {
    return `اكتب نصّ حلقة بودكاست صوتية قصيرة بالعربية الفصحى السلسة القريبة من لغة الحديث، عن القسم${ch.label ? ` «${ch.label}»` : ''} من كتاب «${book.title}»${book.author ? ` لـ${book.author}` : ''}.
المتحدّثان:
- سامر: المقدّم، فضوليّ ودود، يطرح الأسئلة التي تخطر للمستمع ويلخّص ما قيل.
- ليلى: ضيفة قرأت القسم بعمق، تشرح بوضوح وتضرب أمثلة من الحياة، وتقتبس من النص عبارة أو اثنتين.
القواعد:
- ابدأ بترحيب قصير وتعريف بالموضوع، ثم ناقشا أهم ٣ إلى ٥ أفكار في حوار طبيعي حيّ فيه تساؤل وتعقيب واختلاف لطيف، واختما بخلاصة وسؤال يتأمّله المستمع.
- الطول بين ٦٠٠ و٨٥٠ كلمة. الجمل قصيرة سهلة النطق، والأرقام مكتوبة بالحروف.
- كل سطر يبدأ باسم المتحدّث ثم نقطتين: «سامر: …» أو «ليلى: …». لا عناوين ولا شرح ولا رموز تنسيق ولا وصف للأصوات.
- التزم بما في النص، ولا تنسب إلى الكتاب ما ليس فيه.

=== نص القسم ===
${ch.text.slice(0, 100000)}`;
  }
  function parsePod(res) {
    const turns = [];
    for (let ln of String(res || '').split(/\r?\n/)) {
      ln = ln.replace(/\*\*/g, '').trim(); if (!ln || /^#/.test(ln)) continue;
      const m = ln.match(/^[«"]?\s*(سامر|ليلى|المقدم|المقدّم|الضيفة)\s*[:：]\s*(.+)$/);
      if (m) turns.push({ s: /ليلى|الضيفة/.test(m[1]) ? 1 : 0, t: m[2].replace(/^[«"]|[»"]$/g, '').trim() });
      else if (turns.length) turns[turns.length - 1].t += ' ' + ln;
    }
    return turns.filter((x) => x.t);
  }
  function podChunks(turns) { // مجموعات أدوار ≤ ١٨٠٠ حرف لكل نداء صوت
    const out = []; let cur = null;
    turns.forEach((tu, i) => {
      if (!cur || cur.len + tu.t.length > 1800) { cur = { from: i, to: i, len: 0 }; out.push(cur); }
      cur.to = i; cur.len += tu.t.length + 8;
    });
    return out.map(({ from, to }) => ({ from, to }));
  }
  async function podTts(turns, c) {
    const part = turns.slice(c.from, c.to + 1);
    const two = new Set(part.map((x) => x.s)).size === 2;
    if (two) {
      const text = 'Read this Arabic podcast conversation between Samer (host) and Layla (guest) in a warm, lively, natural tone:\n' + part.map((x) => `${POD_SPK[x.s].id}: ${x.t}`).join('\n');
      const data = await Cloud.invokeFn('ai', { action: 'tts', text, speakers: POD_SPK.map((x) => ({ speaker: x.id, voice: x.voice })) });
      if (data && data.audio) return [wavToPcm(data.audio)];
      throw new Error('لم يصل صوت');
    }
    const out = []; // متحدّث واحد في هذه المجموعة ⇒ صوته وحده
    for (const x of part) { const d = await Cloud.invokeFn('ai', { action: 'tts', text: x.t, voice: POD_SPK[x.s].voice }); if (!d || !d.audio) throw new Error('لم يصل صوت'); out.push(wavToPcm(d.audio)); }
    return out;
  }
  const joinPcm = (arr) => { const n = arr.reduce((a, x) => a + x.pcm.length, 0), o = new Int16Array(n); let k = 0; for (const x of arr) { o.set(x.pcm, k); k += x.pcm.length; } return { pcm: o, sr: arr[0].sr }; };
  async function podPlayable(blob) { return blob && blob.type === 'application/x-midad-opus' ? opusDecodeToWav(blob) : blob; }
  function podStop() {
    POD.tok++;
    if (POD.audio) { try { POD.audio.pause(); } catch {} POD.audio.removeAttribute('src'); }
    if (POD.url) { URL.revokeObjectURL(POD.url); POD.url = null; }
    if (POD.el) POD.el.classList.remove('playing');
  }

  async function runPodcast(el, forceIdx) {
    const ch = await currentChapterText(forceIdx);
    if (!ch || ch.text.trim().length < 400) { el.innerHTML = 'تعذّر تحديد نصّ الفصل الحالي — إن كان الكتاب مصوّراً فاستخرج نصّه أولاً.'; return; }
    const pk = 'pod' + hashS(`${ch.label}|${ch.text.length}`);
    const bid = book.id;
    let meta = await Store.getAudio(bid, pk + '::meta');
    if (!meta || !meta.turns || !meta.turns.length) {
      el.innerHTML = `<div class="pod-gen"><span class="ai-typing"><i></i><i></i><i></i></span> يُكتب حوار الحلقة…</div>`;
      const res = await Cloud.aiInvoke({ action: 'sumtext', title: book.title, text: podPrompt(ch) });
      const turns = parsePod(res);
      if (turns.length < 4) { el.innerHTML = mdToHtml(res); return; }
      meta = { label: ch.label || book.title, turns, chunks: podChunks(turns), durs: [], at: Date.now() };
      await Store.putAudio(bid, pk + '::meta', meta);
    }
    podUI(el, meta, pk, bid);
  }

  function podUI(el, meta, pk, bid) {
    const N = meta.chunks.length;
    el.classList.add('pod');
    el.innerHTML = `<div class="pod-card">
        <div class="pod-head"><div class="pod-art" aria-hidden="true">🎙</div><div><b>بودكاست الفصل</b><small>${esc(meta.label)}</small><small class="pod-who">🎤 ${POD_SPK[0].ar} · ${POD_SPK[1].ar}</small></div></div>
        <div class="pod-ctrl" dir="ltr"><button class="pod-play" aria-label="تشغيل">▶</button>
          <div class="pod-bar" role="slider" aria-label="موضع الاستماع" tabindex="0"><i></i></div>
          <span class="pod-time">0:00</span><button class="pod-rate" title="السرعة">1×</button></div>
        <div class="pod-status" role="status"></div>
        <details class="pod-tr"><summary>📜 نصّ الحوار</summary><div class="pod-lines">${meta.turns.map((x, i) => `<p data-i="${i}" class="s${x.s}"><b>${POD_SPK[x.s].ar}:</b> ${esc(x.t)}</p>`).join('')}</div></details>
        <div class="pod-acts"><button class="pod-dl">⬇ احفظ الحلقة صوتاً</button><button class="pod-redo">↻ حلقة جديدة</button></div>
      </div>`;
    const $e = (s) => el.querySelector(s);
    const st = $e('.pod-status'), playB = $e('.pod-play'), bar = $e('.pod-bar'), fill = bar.firstChild, tm = $e('.pod-time');
    const chars = meta.chunks.map((c) => meta.turns.slice(c.from, c.to + 1).reduce((a, x) => a + x.t.length, 0));
    const estDur = (i) => meta.durs[i] || chars[i] * 0.075; // تقدير قبل التوليد
    const total = () => meta.chunks.reduce((a, _, i) => a + estDur(i), 0);
    const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    let cur = 0, gen = false, rate = 1, want = null;
    const has = (i) => !!meta.durs[i];
    // ── التوليد: مجموعة بعد مجموعة، مع إعادة المحاولة عند حدّ الحصّة ──
    async function generate() {
      if (gen) return; gen = true;
      try {
        for (let i = 0; i < N; i++) {
          if (has(i)) continue;
          if (!book || book.id !== bid) return;
          st.textContent = `🎧 يُسجَّل الصوت… ${i + 1} من ${N}`;
          let tries = 0, pcm = null;
          while (!pcm) {
            try { pcm = joinPcm(await podTts(meta.turns, meta.chunks[i])); }
            catch (e) {
              const msg = (e && e.message) || '', quota = /quota|429|حصّ?ة|exhausted|rate/i.test(msg);
              if (quota && tries < 5) { tries++; st.textContent = `⏳ بلغتَ حدّ الصوت المؤقّت — إعادة المحاولة بعد ${20 * tries} ث`; await sleepMs(20000 * tries); continue; }
              if (!quota && tries < 2) { tries++; await sleepMs(2500); continue; }
              st.textContent = quota ? '⚠ نفدت حصّة الصوت الطبيعي اليوم — افتح الحلقة لاحقاً فيكمل التسجيل من حيث وقف' : '⚠ ' + (msg || 'تعذّر توليد الصوت');
              return;
            }
          }
          const blob = abCanCompress() ? await opusEncode(pcm.pcm, pcm.sr) : wavBlob(pcm.pcm, pcm.sr);
          await Store.putAudio(bid, `${pk}::${i}`, blob);
          meta.durs[i] = Math.round(pcm.pcm.length / pcm.sr * 10) / 10;
          await Store.putAudio(bid, pk + '::meta', meta);
          paint();
          if (want === i) { want = null; playChunk(i, 0); }
        }
        st.textContent = '';
      } finally { gen = false; }
    }
    function paint() {
      const a = POD.el === el && POD.audio ? POD.audio : null;
      let t = 0; for (let i = 0; i < cur; i++) t += estDur(i);
      if (a && a.duration) t += a.currentTime;
      const T = total();
      fill.style.width = (T ? Math.min(100, t * 100 / T) : 0) + '%';
      tm.textContent = `${fmt(t)} / ${fmt(T)}${meta.durs.filter(Boolean).length < N ? '~' : ''}`;
      // السطر الحالي (تقدير بنسبة الحروف داخل المجموعة)
      if (a && a.duration) {
        const c = meta.chunks[cur], p = a.currentTime / a.duration;
        let acc = 0, now = c.from;
        for (let k = c.from; k <= c.to; k++) { acc += meta.turns[k].t.length; if (acc / chars[cur] >= p) { now = k; break; } now = k; }
        el.querySelectorAll('.pod-lines p').forEach((p2) => p2.classList.toggle('now', +p2.dataset.i === now));
      }
    }
    async function playChunk(i, off) {
      if (i >= N) { podStop(); playB.textContent = '▶'; cur = 0; paint(); return; }
      cur = i;
      if (!has(i)) { want = i; st.textContent = '⏳ يُجهَّز هذا الجزء…'; generate(); return; }
      const tok = ++POD.tok;
      const blob = await Store.getAudio(bid, `${pk}::${i}`);
      const wav = await podPlayable(blob);
      if (tok !== POD.tok) return;
      if (!POD.audio) POD.audio = new Audio();
      if (POD.url) URL.revokeObjectURL(POD.url);
      POD.url = URL.createObjectURL(wav);
      const a = POD.audio; POD.el = el; el.classList.add('playing');
      a.src = POD.url; a.playbackRate = rate;
      a.onloadedmetadata = () => { if (off) a.currentTime = Math.min(off, a.duration - 0.2); };
      a.ontimeupdate = () => { if (POD.el === el) paint(); };
      a.onended = () => { if (POD.el === el) playChunk(cur + 1, 0); };
      a.onplay = () => { playB.textContent = '⏸'; };
      a.onpause = () => { playB.textContent = '▶'; };
      try { await a.play(); } catch {}
      if ('mediaSession' in navigator) try { navigator.mediaSession.metadata = new MediaMetadata({ title: 'بودكاست: ' + meta.label, artist: book.title, album: 'مِداد' }); } catch {}
      st.textContent = gen ? st.textContent : '';
      if (!has(i + 1) && i + 1 < N) generate();
    }
    playB.onclick = () => {
      if (POD.el === el && POD.audio && POD.audio.src) { if (POD.audio.paused) POD.audio.play().catch(() => {}); else POD.audio.pause(); return; }
      if (ttsOn) ttsStop(); if (AB.play) abStop();
      if (POD.el && POD.el !== el) podStop();
      playChunk(cur, 0);
    };
    const seek = (ev) => {
      const r = bar.getBoundingClientRect(), p = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      let t = p * total(), i = 0;
      while (i < N - 1 && t > estDur(i)) { t -= estDur(i); i++; }
      if (ttsOn) ttsStop(); if (AB.play) abStop();
      playChunk(i, t);
    };
    bar.onclick = seek;
    bar.onkeydown = (e) => { if (POD.el === el && POD.audio && /Arrow(Left|Right)/.test(e.key)) POD.audio.currentTime += e.key === 'ArrowRight' ? 10 : -10; };
    $e('.pod-rate').onclick = (e) => { const R = [1, 1.15, 1.3, 1.5, 0.9]; rate = R[(R.indexOf(rate) + 1) % R.length]; e.target.textContent = rate + '×'; if (POD.el === el && POD.audio) POD.audio.playbackRate = rate; };
    el.querySelectorAll('.pod-lines p').forEach((p) => (p.onclick = () => { const k = +p.dataset.i, i = meta.chunks.findIndex((c) => k >= c.from && k <= c.to); if (i >= 0) { if (ttsOn) ttsStop(); if (AB.play) abStop(); playChunk(i, 0); } }));
    $e('.pod-dl').onclick = async () => {
      if (meta.durs.filter(Boolean).length < N) { Library.toast('انتظر حتى يكتمل تسجيل الحلقة'); generate(); return; }
      Library.toast('⬇ تُجهَّز الحلقة…');
      try {
        const parts = [];
        for (let i = 0; i < N; i++) {
          const w = await podPlayable(await Store.getAudio(bid, `${pk}::${i}`));
          const u8 = new Uint8Array(await w.arrayBuffer()); let bin = ''; for (let k = 0; k < u8.length; k += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000));
          parts.push(wavToPcm(btoa(bin)));
        }
        const all = joinPcm(parts), blob = wavBlob(all.pcm, all.sr);
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `بودكاست - ${meta.label}.wav`; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } catch { Library.toast('تعذّر حفظ الحلقة'); }
    };
    $e('.pod-redo').onclick = async () => {
      if (!confirm('أُنشئ حلقة جديدة بحوار مختلف؟ ستُحذف الحالية من الجهاز.')) return;
      if (POD.el === el) podStop();
      for (let i = 0; i < N; i++) await Store.deleteAudio(bid, `${pk}::${i}`).catch(() => {});
      await Store.deleteAudio(bid, pk + '::meta').catch(() => {});
      el.classList.remove('pod');
      runPodcast(el).catch((e) => { el.innerHTML = '⚠ ' + esc((e && e.message) || 'تعذّر'); });
    };
    paint();
    generate();
  }

  /* ═══════ ✒️ الإعراب والتشكيل عند الطلب ═══════ */
  const AR_HARAKAT = /[ً-ٰٟـ]/g;
  const skel = (s) => String(s || '').replace(AR_HARAKAT, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[^ء-يa-zA-Z0-9]/g, '');
  function irabPrompt(text, full) {
    return `أنت أستاذ متمكّن من النحو والصرف والبلاغة العربية. النص التالي من كتاب «${book.title}». أعد الأقسام الأربعة بهذه الصيغة حرفياً، دون أي مقدمة:
## التشكيل
(النص نفسه بكلماته وترتيبه دون أي تغيير أو حذف، مشكولاً شكلاً تاماً صحيحاً: حركات أواخر الكلمات وما يلزم في أوساطها)
## المفردات
(من ٠ إلى ٥ كلمات غريبة أو مهمّة، كل واحدة في سطر: «- الكلمة | معناها في هذا السياق»)
## لفتة
(سطر واحد عن ظاهرة نحوية أو بلاغية لافتة في النص)
## الإعراب
(${full ? 'كل كلمة' : 'كل كلمة من أول ثلاثين كلمة فقط'} في سطر بترتيب ورودها: «- الكلمة مشكولة | إعرابها الموجز الدقيق في سطر واحد: الموقع، وعلامة الإعراب أو البناء». حرف العطف أو الجر المتصل يُعرب مع كلمته في السطر نفسه. لا تُعرب علامات الترقيم)

=== النص ===
${text}`;
  }
  async function openIrab(text) {
    text = String(text || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (!/[ء-ي]/.test(text)) { Library.toast('الإعراب للنصوص العربية'); return; }
    if (Library.needAI && Library.needAI('الإعراب والتشكيل')) return;
    if (text.length > 1400) text = text.slice(0, 1400).replace(/\s+\S*$/, '') + '…';
    const full = text.split(' ').length <= 30;
    document.querySelectorAll('.ir-dialog').forEach((o) => o.remove());
    const o = document.createElement('div');
    o.className = 'ui-dialog ir-dialog';
    o.innerHTML = `<div class="ud-box ir-box" role="dialog" aria-modal="true" aria-label="الإعراب والتشكيل">
      <h3>✒️ الإعراب والتشكيل</h3><div class="ir-body"><div class="ir-orig">${esc(text)}</div><p class="ir-wait"><span class="ai-typing"><i></i><i></i><i></i></span> يُشكَّل النص ويُعرَب…</p></div>
      <div class="ud-actions"><button class="ud-cancel">إغلاق</button></div></div>`;
    document.body.appendChild(o);
    const close = () => { o.remove(); };
    o.querySelector('.ud-cancel').onclick = close;
    o.onclick = (e) => { if (e.target === o) close(); };
    const key = hashS(text);
    let res = lsMapGet('midad-irab', key);
    try {
      if (!res) {
        res = await Cloud.aiInvoke({ action: 'sumtext', title: book.title, text: irabPrompt(text, full) });
        if (/##\s*التشكيل/.test(res)) lsMapPut('midad-irab', key, res, 60);
      }
    } catch (e) { o.querySelector('.ir-body').innerHTML = `<p class="ir-err">⚠ ${esc((e && e.message) || 'تعذّر الحصول على رد')}</p>`; return; }
    if (!document.body.contains(o)) return;
    renderIrab(o, res, full);
  }
  function renderIrab(o, res, full) {
    const S = mdSections(res);
    const tash = secGet(S, 'التشكيل').join(' ').replace(/^[(«]|[)»]$/g, '').replace(/\s+/g, ' ').trim();
    const ent = bullets(secGet(S, 'الإعراب')).map((l) => { const i = l.indexOf('|'); return i > 0 ? { w: l.slice(0, i).trim(), r: l.slice(i + 1).trim() } : null; }).filter(Boolean);
    const voc = bullets(secGet(S, 'المفردات')).map((l) => { const i = l.indexOf('|'); return i > 0 ? { w: l.slice(0, i).trim(), r: l.slice(i + 1).trim() } : null; }).filter(Boolean);
    const lafta = bullets(secGet(S, 'لفتة')).join(' ').replace(/^[(]|[)]$/g, '');
    const body = o.querySelector('.ir-body');
    if (!tash) { body.innerHTML = mdToHtml(res); return; }
    // اربط كلمات النص المشكول بأسطر الإعراب بالترتيب (بمقارنة الهيكل دون حركات)
    const toks = tash.split(' '), map = new Array(toks.length).fill(-1);
    let j = 0;
    toks.forEach((tk, ti) => {
      const k = skel(tk); if (!k) return;
      for (let look = 0; look < 4 && j + look < ent.length; look++) {
        const e = skel(ent[j + look].w);
        if (e === k) { map[ti] = j + look; j = j + look + 1; return; }
        if (e.length > k.length && e.includes(k)) { map[ti] = j + look; if (e.endsWith(k)) j = j + look + 1; else j = j + look; return; }
      }
    });
    body.innerHTML = `<div class="ir-tash" dir="rtl">${toks.map((tk, i) => map[i] >= 0 ? `<button class="ir-w" data-e="${map[i]}">${esc(tk)}</button>` : `<span>${esc(tk)}</span>`).join(' ')}</div>
      <div class="ir-acts"><button class="ir-copy">📋 انسخ المشكول</button><button class="ir-say">🔊 استمع</button>${voc.length ? '<button class="ir-vocab">📒 المفردات إلى كلماتي</button>' : ''}</div>
      ${ent.length ? `<div class="ir-detail" role="status"><span class="ir-hint">اضغط أي كلمة لترى إعرابها 👆</span></div>` : ''}
      ${voc.length ? `<div class="ir-h">📖 المفردات</div><dl class="ir-voc">${voc.map((v) => `<dt>${esc(v.w)}</dt><dd>${esc(v.r)}</dd>`).join('')}</dl>` : ''}
      ${lafta ? `<div class="ir-h">✨ لفتة</div><p class="ir-lafta">${esc(lafta)}</p>` : ''}
      ${ent.length ? `<details class="ir-all"><summary>الإعراب كاملاً (${ent.length})${full ? '' : ' — لأول ثلاثين كلمة'}</summary><ol>${ent.map((e, i) => `<li data-e="${i}"><b>${esc(e.w)}</b>: ${esc(e.r)}</li>`).join('')}</ol></details>` : ''}`;
    const det = body.querySelector('.ir-detail');
    const pick = (ei) => {
      body.querySelectorAll('.ir-w').forEach((b) => b.classList.toggle('on', +b.dataset.e === ei));
      body.querySelectorAll('.ir-all li').forEach((li) => li.classList.toggle('on', +li.dataset.e === ei));
      const e = ent[ei]; if (det && e) det.innerHTML = `<b class="ir-dw">${esc(e.w)}</b><span>${esc(e.r)}</span>`;
    };
    body.querySelectorAll('.ir-w').forEach((b) => (b.onclick = () => pick(+b.dataset.e)));
    body.querySelectorAll('.ir-all li').forEach((li) => (li.onclick = () => pick(+li.dataset.e)));
    body.querySelector('.ir-copy').onclick = async () => { try { await navigator.clipboard.writeText(tash); Library.toast('✓ نُسخ النص المشكول', 'gold'); } catch { Library.toast('تعذّر النسخ'); } };
    body.querySelector('.ir-say').onclick = async (ev) => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = '⏳';
      try {
        const d = await Cloud.invokeFn('ai', { action: 'tts', text: tash.slice(0, 2500), voice: settings.ttsVoice || 'Kore' });
        if (!d || !d.audio) throw 0;
        const a = new Audio('data:audio/wav;base64,' + d.audio); await a.play();
      } catch { sayWord(tash); }
      finally { b.disabled = false; b.textContent = '🔊 استمع'; }
    };
    const vb = body.querySelector('.ir-vocab');
    if (vb) vb.onclick = async () => {
      try {
        const existing = (await Store.getDeck(book.id)) || { cards: [] };
        const now = Date.now(), cards = (existing.cards || []).slice(); let n = 0;
        for (const v of voc) {
          const ex = cards.find((c) => skel(c.q) === skel(v.w));
          if (ex && !ex.del) continue;
          if (ex) { Object.assign(ex, { del: false, kind: 'word', box: 1, due: now, mt: now }); n++; continue; }
          cards.push({ id: 'fc' + (now + n) + Math.random().toString(36).slice(2, 6), q: v.w, a: v.r, kind: 'word', ctx: tash.slice(0, 220), box: 1, due: now, mt: now }); n++;
        }
        await Store.saveDeck(book.id, cards);
        if (window.Cloud) Cloud.pushDeck(book.id);
        vb.disabled = true; vb.textContent = n ? `✓ أُضيفت ${n === 1 ? 'كلمة' : n === 2 ? 'كلمتان' : n + ' كلمات'} إلى كلماتي` : '✓ كلها في كلماتي';
      } catch { Library.toast('تعذّر الحفظ'); }
    };
  }

  /* ═══════ 🗺 خط الزمن والأعلام والأماكن ═══════ */
  async function bookTextPaged(max = 260000) {
    if (isPdf) {
      try { await Library.getBookText(book.id); } catch {}
      const s = await Store.getFulltext(book.id);
      if (s && s.text) {
        const ps = s.pageStarts || [];
        if (!ps.length) return s.text.slice(0, max);
        const pages = ps.map((a, i) => ({ n: i + 1, t: s.text.slice(a, ps[i + 1] != null ? ps[i + 1] : s.text.length) }));
        const tot = pages.reduce((a, p) => a + p.t.length + 10, 0);
        // كتاب طويل ⇒ عيّنات موزّعة على الكتاب كله (لا أوله فقط)
        const keep = tot <= max ? pages : pages.filter((_, i) => i % Math.ceil(tot / max) === 0);
        return keep.map((p) => `⟦ص ${p.n}⟧\n${p.t}`).join('\n').slice(0, max + 20000);
      }
    }
    const t = (await Library.getBookText(book.id)) || '';
    if (t.length <= max) return t;
    const k = Math.ceil(t.length / max), step = 4000; let out = '';
    for (let i = 0; i < t.length; i += step * k) out += t.slice(i, i + step) + '\n…\n';
    return out;
  }
  function timelinePrompt(text) {
    return `أنت باحث يستخرج من كتاب «${book.title}»${book.author ? ` لـ${book.author}` : ''} مادةً لخط زمني ودليل أعلام وخريطة. أعد الأقسام الثلاثة بهذه الصيغة حرفياً، دون أي مقدمة، كل عنصر في سطر يبدأ بـ «- » والحقول مفصولة بـ « | »:
## الأحداث
- السنة الميلادية رقماً (سالبة لما قبل الميلاد، تقريبية إن لزم) | التاريخ كما يُكتب للقارئ (مثل: ٦٢٢م / ١هـ) | الحدث في جملة قصيرة | رقم الصفحة أو -
## الأعلام
- الاسم | تعريف موجز ودوره في الكتاب في جملة | سنة الوفاة الميلادية رقماً أو - | رقم الصفحة أو -
## الأماكن
- اسم المكان | دوره في الكتاب في جملة قصيرة | خط العرض | خط الطول | رقم الصفحة أو -
القواعد: من ١٠ إلى ٢٥ حدثاً مرتّبة زمنياً، ومن ٦ إلى ١٨ علماً بحسب أهميتهم في الكتاب، ومن ٠ إلى ١٢ مكاناً حقيقياً بإحداثيات صحيحة. أرقام الصفحات من العلامات ⟦ص N⟧ في النص إن وُجدت، وإلا فاكتب -. إن لم يكن في الكتاب أحداث تاريخية فاكتب تحت «الأحداث» سطراً واحداً: - لا يوجد. لا تضف ما ليس في الكتاب.

=== نص الكتاب ===
${text}`;
  }
  function parseTimeline(res) {
    const S = mdSections(arDigits(res));
    const split = (l) => l.split('|').map((x) => x.trim());
    const num = (x) => { const m = String(x || '').replace(/[٫,]/g, '.').match(/-?\d+(?:\.\d+)?/); return m ? +m[0] : null; };
    const pg = (x) => { const n = num(x); return n > 0 ? Math.round(n) : null; };
    const ev = bullets(secGet(S, 'الأحداث')).map(split).filter((f) => f.length >= 3).map((f) => ({ y: num(f[0]), d: f[1], t: f[2], p: pg(f[3]) })).filter((e) => e.t && e.y != null).sort((a, b) => a.y - b.y);
    const pe = bullets(secGet(S, 'الأعلام')).map(split).filter((f) => f.length >= 2).map((f) => ({ n: f[0], d: f[1], y: num(f[2]), p: pg(f[3]) })).filter((x) => x.n);
    const pl = bullets(secGet(S, 'الأماكن')).map(split).filter((f) => f.length >= 4).map((f) => ({ n: f[0], d: f[1], lat: num(f[2]), lng: num(f[3]), p: pg(f[4]) })).filter((x) => x.n && x.lat != null && x.lng != null && Math.abs(x.lat) <= 90 && Math.abs(x.lng) <= 180);
    return { ev, pe, pl };
  }
  async function runTimeline(el) {
    let res = lsMapGet('midad-tl', book.id);
    if (!res) {
      const text = await bookTextPaged();
      if (!text || text.trim().length < 800) { el.innerHTML = 'لا يوجد نص كافٍ — إن كان الكتاب مصوّراً فاستخرج نصّه أولاً.'; return; }
      el.innerHTML = '<span class="ai-typing"><i></i><i></i><i></i></span> يُقرأ الكتاب وتُستخرج أحداثه وأعلامه…';
      res = await Cloud.aiInvoke({ action: 'sumtext', title: book.title, text: timelinePrompt(text) });
      const d0 = parseTimeline(res);
      if (d0.ev.length + d0.pe.length + d0.pl.length >= 3) lsMapPut('midad-tl', book.id, res, 30);
    }
    const d = parseTimeline(res);
    if (d.ev.length + d.pe.length + d.pl.length < 2) { el.innerHTML = mdToHtml(res); return; }
    renderTimeline(el, d, false);
  }
  const avatarCol = (s) => `hsl(${parseInt(hashS(s), 36) % 360} 45% 42%)`;
  const yLabel = (y) => (y < 0 ? `${-y} ق.م` : `${y}م`);
  function renderTimeline(el, d, big) {
    const tabs = [d.ev.length && ['ev', `⏳ الخط الزمني (${d.ev.length})`], d.pe.length && ['pe', `👤 الأعلام (${d.pe.length})`], d.pl.length && ['pl', `📍 الخريطة (${d.pl.length})`]].filter(Boolean);
    el.innerHTML = `<div class="tl${big ? ' tl-big' : ''}">
      <div class="tl-tabs" role="tablist">${tabs.map(([k, l], i) => `<button role="tab" data-t="${k}" class="${i ? '' : 'on'}">${l}</button>`).join('')}${big ? '' : '<button class="tl-full" title="ملء الشاشة">⛶</button>'}</div>
      <div class="tl-pane"></div><div class="tl-note">مستخرج بالذكاء الاصطناعي — اضغط أي عنصر لتنتقل إلى موضعه في الكتاب.</div></div>`;
    const pane = el.querySelector('.tl-pane');
    const pgBtn = (x, q) => `<button class="tl-go" data-q="${esc(q)}" data-p="${x.p || ''}">${x.p ? 'ص ' + x.p + ' ←' : '🔍'}</button>`;
    const wire = () => pane.querySelectorAll('.tl-go').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); goToMention(b.dataset.q, b.dataset.p); }));
    const show = async (k) => {
      el.querySelectorAll('.tl-tabs [data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === k));
      if (k === 'ev') {
        let prev = null, html = '<ol class="tl-line">';
        for (const e of d.ev) {
          if (prev != null && e.y - prev >= 150) { const c = Math.round((e.y - prev) / 100); html += `<li class="tl-gap">⋯ ${c === 1 ? 'قرن' : c === 2 ? 'قرنان' : c <= 10 ? c + ' قرون' : c + ' قرناً'} ⋯</li>`; }
          html += `<li class="tl-ev"><span class="tl-d">${esc(e.d || yLabel(e.y))}</span><p>${esc(e.t)}</p>${pgBtn(e, e.t)}</li>`;
          prev = e.y;
        }
        pane.innerHTML = html + '</ol>';
      } else if (k === 'pe') {
        pane.innerHTML = `<div class="tl-people">${d.pe.map((x) => `<div class="tl-p"><span class="tl-av" style="background:${avatarCol(x.n)}">${esc(x.n.replace(/^(ال|أبو |ابن )/, '').trim().charAt(0))}</span>
          <div><b>${esc(x.n)}</b>${x.y ? `<small> · ت ${esc(yLabel(x.y))}</small>` : ''}<p>${esc(x.d)}</p></div>${pgBtn(x, x.n)}</div>`).join('')}</div>`;
      } else if (k === 'pl') {
        pane.innerHTML = '<div class="tl-map" dir="ltr"><p class="tl-load">🗺 تُحمَّل الخريطة…</p></div><ul class="tl-places"></ul>';
        pane.querySelector('.tl-places').innerHTML = d.pl.map((x, i) => `<li data-i="${i}"><b>📍 ${esc(x.n)}</b> — ${esc(x.d)} ${pgBtn(x, x.n)}</li>`).join('');
        try {
          const L = await loadLeaflet();
          const box = pane.querySelector('.tl-map'); box.innerHTML = '';
          const map = L.map(box, { zoomControl: true, attributionControl: true });
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '© OpenStreetMap' }).addTo(map);
          const ms = d.pl.map((x) => L.circleMarker([x.lat, x.lng], { radius: 8, color: '#d9a94f', weight: 2, fillColor: '#4b2d7f', fillOpacity: 0.85 }).addTo(map)
            .bindPopup(`<div dir="rtl" style="font-family:Tajawal,sans-serif"><b>${esc(x.n)}</b><br>${esc(x.d)}</div>`));
          map.fitBounds(L.latLngBounds(d.pl.map((x) => [x.lat, x.lng])).pad(0.3), { maxZoom: 7 });
          pane.querySelectorAll('.tl-places li').forEach((li) => (li.onclick = () => { const x = d.pl[+li.dataset.i]; map.setView([x.lat, x.lng], 7); ms[+li.dataset.i].openPopup(); box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }));
          setTimeout(() => map.invalidateSize(), 200);
        } catch { pane.querySelector('.tl-map').innerHTML = '<p class="tl-load">تعذّر تحميل الخريطة — تحقّق من الاتصال. الأماكن مدرجة أدناه.</p>'; }
      }
      wire();
    };
    el.querySelectorAll('.tl-tabs [data-t]').forEach((b) => (b.onclick = () => show(b.dataset.t)));
    const fb = el.querySelector('.tl-full');
    if (fb) fb.onclick = () => {
      const o = document.createElement('div'); o.className = 'st-ov';
      o.innerHTML = `<div class="st-ov-box"><button class="st-x" aria-label="إغلاق">✕</button><h3>🗺 ${esc(book.title)}</h3><div class="st-ov-body"></div></div>`;
      document.body.appendChild(o);
      o.querySelector('.st-x').onclick = () => o.remove();
      renderTimeline(o.querySelector('.st-ov-body'), d, true);
    };
    if (tabs.length) show(tabs[0][0]);
  }
  let leafletP = null;
  function loadLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (!leafletP) leafletP = new Promise((res, rej) => {
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
      const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js';
      s.onload = () => res(window.L); s.onerror = () => { leafletP = null; rej(new Error('leaflet')); };
      document.head.appendChild(s);
    });
    return leafletP;
  }

  /* ═══════ مشاركة الاقتباس كبطاقة صورة ═══════ */
  async function shareQuote(text, page) {
    text = (text || '').trim();
    if (!text) return;
    // مصمّم البطاقات (js/studio.js): قوالب وخطوط ومقاسات مع معاينة حيّة
    if (window.Studio) return Studio.quoteCard({ text, title: book.title, author: book.author, cover: book.cover, page: page || (isPdf ? pdfPage : '') });
    Library.toast('تعذّر فتح مصمّم البطاقات');
  }

  /* ═══════ القاموس الفوري (معنى بالذكاء الاصطناعي) ═══════ */
  function hideDefineBubble() { $('#define-bubble').hidden = true; }

  // فقاعة ذكاء مشتركة (المعنى/الترجمة): تعرض العنوان وتنتظر نتيجة الاستدعاء
  async function aiBubble(title, rect, invokeBody, opts = {}) {
    const cached = opts.cacheKey ? dictGet(opts.cacheKey) : null;
    if (!cached && Library.needAI && Library.needAI('معنى الكلمات والترجمة')) return;
    const bubble = $('#define-bubble');
    $('#db-word').hidden = false;
    $('#db-word').textContent = title.length > 60 ? title.slice(0, 60) + '…' : title;
    $('#db-body').innerHTML = '<span class="ai-typing"><i></i><i></i><i></i></span>';
    bubble.hidden = false;
    // ضع الفقاعة تحت التحديد أو فوقه، داخل الشاشة دائماً (يُعاد بعد وصول المحتوى لأن طوله يتغيّر)
    const place = () => {
      const bw = bubble.offsetWidth || 300, bh = bubble.offsetHeight || 160;
      if (!rect) { bubble.style.left = Math.max(8, innerWidth / 2 - bw / 2) + 'px'; bubble.style.top = '80px'; return; }
      bubble.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - bw / 2, innerWidth - bw - 8)) + 'px';
      let top = rect.bottom + 10;
      if (top + bh > innerHeight - 8) top = rect.top - bh - 10 >= 8 ? rect.top - bh - 10 : Math.max(8, innerHeight - bh - 8);
      bubble.style.top = top + 'px';
    };
    place();
    const show = (res) => { if (opts.render) opts.render(res, $('#db-body')); else $('#db-body').textContent = res || '—'; place(); };
    if (cached) return show(cached);
    const token = (aiBubble.tok = (aiBubble.tok || 0) + 1);
    try {
      const res = await Cloud.aiInvoke(invokeBody);
      if (bubble.hidden || token !== aiBubble.tok) return;
      if (opts.cacheKey && res) dictPut(opts.cacheKey, res);
      show(res);
    } catch (e) { if (token === aiBubble.tok) $('#db-body').textContent = '⚠ ' + ((e && e.message) || 'تعذّر الحصول على النتيجة'); }
  }

  /* ═══════ القاموس: الكلمة المفردة ⇒ بطاقة كاملة (تشكيل، جذر، معنى في السياق، مرادفات) ═══════
     العبارة الأطول ⇒ معنى موجز كما كان. النتائج تُحفظ مؤقتاً (توفيراً لحصّة الذكاء). */
  const DICT_KEY = 'midad-dict-cache';
  let dictCache = null;
  function dictGet(k) {
    if (!dictCache) { try { dictCache = JSON.parse(localStorage.getItem(DICT_KEY) || '{}') || {}; } catch { dictCache = {}; } }
    return dictCache[k] || null;
  }
  function dictPut(k, v) {
    dictGet(k); dictCache[k] = v;
    const keys = Object.keys(dictCache);
    if (keys.length > 300) keys.slice(0, keys.length - 300).forEach((x) => delete dictCache[x]);
    try { localStorage.setItem(DICT_KEY, JSON.stringify(dictCache)); } catch {}
  }
  // نظّف الكلمة من علامات الترقيم والتطويل (مع إبقاء الحركات)
  const cleanWord = (t) => String(t || '').replace(/[\u0640]/g, '').replace(/^[^\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, '').trim();
  const isSingleWord = (t) => { const w = cleanWord(t); return !!w && !/\s/.test(w) && w.length <= 30; };
  // الجملة المحيطة بالتحديد (تُعطي الذكاء سياق المعنى المقصود)
  function selContext(word) {
    try {
      const sel = getSelection();
      const node = sel && sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
      const host = node && (node.nodeType === 1 ? node : node.parentElement);
      const block = host && host.closest ? (host.closest('p, h2, h3, li, blockquote, .pdf-textlayer') || host) : null;
      let t = block ? block.textContent.replace(/\s+/g, ' ') : '';
      const i = t.indexOf(word);
      if (i >= 0) t = t.slice(Math.max(0, i - 160), i + word.length + 160);
      return t.slice(0, 360);
    } catch { return ''; }
  }

  function defineWord(text, rect) {
    if (!text) return;
    if (!isSingleWord(text)) {
      const prompt = `عرّف بإيجاز شديد (جملة أو جملتين بالعربية الفصحى) معنى هذه الكلمة أو العبارة${book && book.title ? ` كما قد ترد في كتاب «${book.title}»` : ''}، ودون مقدمات: «${text}»`;
      return aiBubble(text, rect, { action: 'define', text: prompt });
    }
    const word = cleanWord(text);
    const ctx = selContext(word);
    const key = word + '|' + (book ? book.id : '');
    // بلا ذكاء ولا نتيجة محفوظة: بطاقة بديلة (نطق + المعجم على الويب) بدل نافذة المفتاح
    if (!dictGet(key) && !(window.Cloud && Cloud.aiReady && Cloud.aiReady())) return dictFallback(word, rect);
    const prompt = `أنت معجم عربي دقيق. حلّل الكلمة «${word}»${ctx ? ` كما وردت في هذا السياق: «${ctx}»` : ''}${book && book.title ? ` من كتاب «${book.title}»` : ''}.
أعِد JSON فقط دون أي نص آخر، بهذه الحقول:
{"word":"الكلمة مضبوطة بالشكل التام كما يقتضيها السياق","root":"الجذر بحروف منفصلة مثل: ك ت ب (أو \"\" للكلمات الأعجمية والأسماء)","type":"نوعها باختصار: اسم/فعل ماضٍ/مصدر/جمع تكسير… مع المفرد أو الجمع إن أفاد","meaning":"معناها المعجمي في جملة أو جملتين","context":"معناها المقصود في هذا السياق تحديداً، إن اختلف عن العام (وإلا \"\")","synonyms":["مرادف","مرادف"]}`;
    return aiBubble(word, rect, { action: 'define', text: prompt }, {
      cacheKey: key,
      render: (res, body) => renderDict(word, res, body, ctx),
    });
  }

  function renderDict(word, res, body, ctx0) {
    let d = null;
    try { const m = String(res).match(/\{[\s\S]*\}/); d = m ? JSON.parse(m[0]) : null; } catch {}
    if (!d || !d.meaning) { body.textContent = res || '—'; return; }
    const syn = (Array.isArray(d.synonyms) ? d.synonyms : []).filter(Boolean).slice(0, 5);
    $('#db-word').hidden = true; // الكلمة المشكولة في رأس البطاقة تغني عن العنوان
    body.innerHTML = `
      <div class="dw-head"><span class="dw-word">${esc(d.word || word)}</span>${d.root ? `<span class="dw-root" title="الجذر">${esc(d.root)}</span>` : ''}</div>
      ${d.type ? `<div class="dw-type">${esc(d.type)}</div>` : ''}
      <p class="dw-mean">${esc(d.meaning)}</p>
      ${d.context ? `<p class="dw-ctx"><b>في هذا السياق:</b> ${esc(d.context)}</p>` : ''}
      ${syn.length ? `<div class="dw-syn">${syn.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
      <div class="dw-acts"><button class="dw-say" title="انطقها">🔊</button><a class="dw-web" href="${almaany(word)}" target="_blank" rel="noopener">المعاني ↗</a>
        <button class="dw-save">📒 أضِفها إلى كلماتي</button></div>`;
    body.querySelector('.dw-say').onclick = () => sayWord(d.word || word);
    const save = body.querySelector('.dw-save');
    const q = d.word || word;
    const a = d.meaning + (d.root ? ` (الجذر: ${d.root})` : '') + (syn.length ? ` — مرادفات: ${syn.join('، ')}` : '');
    const done = (txt) => { save.textContent = txt; save.disabled = true; };
    const add = async (auto) => {
      try {
        const existing = (await Store.getDeck(book.id)) || { cards: [] };
        const bare = (s) => String(s || '').replace(/[ً-ْٰ]/g, '');
        const now = Date.now();
        const ex = (existing.cards || []).find((c) => bare(c.q) === bare(q));
        if (ex && !ex.del) return done('✓ في كلماتي');
        if (ex) { // حُذفت سابقاً ⇒ أعِدها
          await Store.saveDeck(book.id, existing.cards.map((c) => (c === ex ? { ...c, del: false, kind: 'word', box: 1, due: now, mt: now } : c)));
          if (window.Cloud) Cloud.pushDeck(book.id);
          return done('✓ أُعيدت إلى كلماتي');
        }
        await Store.saveDeck(book.id, [...(existing.cards || []), { id: 'fc' + now + Math.random().toString(36).slice(2, 6), q, a, kind: 'word', ctx: (ctx0 || selContext(word) || '').slice(0, 220), box: 1, due: now, mt: now }]);
        if (window.Cloud) Cloud.pushDeck(book.id);
        done(auto ? '✓ أُضيفت تلقائياً إلى كلماتي' : '✓ أُضيفت إلى كلماتي');
      } catch { if (!auto) Library.toast('تعذّر الحفظ'); }
    };
    save.onclick = () => add(false);
    if (vocabAuto()) add(true); // كل كلمة تبحث عنها تدخل «كلماتي» وبطاقات المراجعة
  }
  // «كلماتي» تلقائياً (يُطفأ من نافذة «كلماتي» في المكتبة)
  const vocabAuto = () => { try { return localStorage.getItem('midad-vocab-auto') !== '0'; } catch { return true; } };
  const almaany = (w) => `https://www.almaany.com/ar/dict/ar-ar/${encodeURIComponent(String(w).replace(/[ً-ْٰ]/g, ''))}/`;
  // نطق الكلمة بصوت الجهاز (مجاني، بلا اتصال غالباً)
  function sayWord(w) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(w); const v = pickVoice();
      if (v) u.voice = v; u.lang = v ? v.lang : 'ar-SA'; u.rate = 0.85;
      speechSynthesis.speak(u);
    } catch { Library.toast('النطق غير متاح على هذا الجهاز'); }
  }
  // بطاقة بديلة حين لا يتوفّر الذكاء: نطق + المعجم على الويب + تفعيل المعجم الذكي
  function dictFallback(word, rect) {
    const bubble = $('#define-bubble');
    $('#db-word').hidden = true;
    $('#db-body').innerHTML = `<div class="dw-head"><span class="dw-word">${esc(word)}</span></div>
      <p class="dw-mean">المعجم الذكي (التشكيل والجذر والمعنى في السياق) يحتاج مفتاح Gemini المجاني. في الأثناء:</p>
      <div class="dw-acts"><button class="dw-say">🔊 انطقها</button><a class="dw-web" href="${almaany(word)}" target="_blank" rel="noopener">ابحث في المعاني ↗</a>
        <button class="dw-key">🤖 فعّل المعجم الذكي</button></div>`;
    bubble.hidden = false;
    const bw = bubble.offsetWidth || 300, bh = bubble.offsetHeight || 160;
    bubble.style.left = (rect ? Math.max(8, Math.min(rect.left + rect.width / 2 - bw / 2, innerWidth - bw - 8)) : Math.max(8, innerWidth / 2 - bw / 2)) + 'px';
    bubble.style.top = (rect ? (rect.bottom + 10 + bh > innerHeight ? Math.max(8, rect.top - bh - 10) : rect.bottom + 10) : 80) + 'px';
    $('#db-body').querySelector('.dw-say').onclick = () => sayWord(word);
    $('#db-body').querySelector('.dw-key').onclick = () => { hideDefineBubble(); Library.needAI && Library.needAI('المعجم الذكي'); };
  }

  function translateSel(text, rect) {
    if (!text) return;
    return aiBubble('🌐 الترجمة', rect, { action: 'translate', text, question: 'الإنجليزية' });
  }

  /* ═══════ 🎧 الكتاب المسموع ═══════
     الكتاب ⇒ فصول (من الفهرس، أو كل ١٥ صفحة) ⇒ مقاطع (~٢٢٠٠ حرف) يُولَّد صوتها بالصوت الطبيعي
     (Gemini TTS) ويُضغط Opus على الجهاز (WebCodecs؛ ~٢٤٠ ك.ب للدقيقة بدل ٢٫٨ م.ب) ثم يُحفظ في
     IndexedDB للاستماع دون اتصال. الاستماع نفسه يُنزّل ما يلزمه أولاً بأول، والتقدّم يُحفظ لكل كتاب،
     والقارئ يتبع الصوت (الصفحة/الفقرة). البيان والمقاطع على هذا الجهاز فقط. */
  const AB = { bookId: null, list: null, man: null, want: [], queue: [], busy: false, waiters: new Map(), err: '', status: '', play: null, audio: null, url: null, rate: 1, onUi: null };
  const AB_SEG = 2200;
  const abSegKey = (ch, si) => `${ch.key}::${si}`;
  const abCanCompress = () => typeof AudioEncoder === 'function' && typeof AudioDecoder === 'function';
  function abReset() {
    abStop(); AB.bookId = book ? book.id : null; AB.list = null; AB.man = null; AB.want = []; AB.queue = []; AB.err = ''; AB.status = '';
    AB.waiters.forEach((ws) => ws.forEach((w) => w.reject(new Error('أُغلق الكتاب')))); AB.waiters.clear();
  }
  // قسّم نص الفصل إلى مقاطع عند حدود الجمل، مع موضع كلٍّ منها داخل الفصل
  function abSplit(text) {
    const out = []; const re = /[^.!؟?۔\n]+[.!؟?۔]*\s*|\n+/g; let cur = '', start = 0, m, pos = 0;
    while ((m = re.exec(text))) {
      const piece = m[0];
      if (cur && (cur + piece).length > AB_SEG) { if (cur.trim()) out.push({ t: cur.trim(), off: start }); cur = ''; start = pos; }
      if (!cur) start = pos;
      cur += piece; pos += piece.length;
      while (cur.length > AB_SEG * 1.4) { const cut = cur.lastIndexOf(' ', AB_SEG) > 200 ? cur.lastIndexOf(' ', AB_SEG) : AB_SEG; out.push({ t: cur.slice(0, cut).trim(), off: start }); start += cut; cur = cur.slice(cut); }
    }
    if (cur.trim()) out.push({ t: cur.trim(), off: start });
    return out.filter((s) => s.t.replace(/[\s\d\p{P}]/gu, '').length > 3);
  }
  // فصول الكتاب بنصوصها (تُبنى مرة لكل فتح)
  async function abChapters() {
    if (AB.list && AB.bookId === book.id) return AB.list;
    const list = [];
    const minLv = tocItems.length ? Math.min(...tocItems.map((t) => t.lvl || 1)) : 1;
    const tops = tocItems.map((t, i) => ({ ...t, i })).filter((t) => (t.lvl || 1) === minLv);
    if (isPdf) {
      try { await Library.getBookText(book.id); } catch {}
      const s = await Store.getFulltext(book.id);
      if (s && s.text && s.text.trim()) {
        const ps = (s.pageStarts && s.pageStarts.length) ? s.pageStarts : [0], N = ps.length;
        let bounds = [];
        const tp = tops.filter((t) => t.page).sort((a, b) => a.page - b.page);
        if (tp.length) { if (tp[0].page > 1) bounds.push({ label: 'البداية', sp: 1 }); for (const t of tp) if (!bounds.length || t.page > bounds[bounds.length - 1].sp) bounds.push({ label: t.label, sp: t.page }); }
        else for (let p0 = 1; p0 <= N; p0 += 15) bounds.push({ label: `صفحات ${p0}–${Math.min(N, p0 + 14)}`, sp: p0 });
        bounds.forEach((b, i) => {
          const ep = i + 1 < bounds.length ? bounds[i + 1].sp : N + 1;
          const a = ps[b.sp - 1] || 0, e = ep - 1 < N ? ps[ep - 1] : s.text.length;
          list.push({ label: b.label, text: s.text.slice(a, e), abs: a, sp: b.sp });
        });
        AB.pageOf = (abs) => { let lo = 0, hi = N - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ps[mid] <= abs) lo = mid; else hi = mid - 1; } return lo + 1; };
      }
    } else {
      const blocks = [...contentEl.children];
      const textBetween = (a, b) => { let t = '', n = a; while (n && n !== b) { t += (n.textContent || '') + '\n'; n = n.nextElementSibling; } return t; };
      const tt = tops.filter((t) => t.el);
      if (tt.length) {
        const intro = textBetween(blocks[0], tt[0].el);
        if (blocks[0] !== tt[0].el && intro.trim().length > 200) list.push({ label: 'البداية', text: intro, el: blocks[0] });
        tt.forEach((t, k) => list.push({ label: t.label, text: textBetween(t.el, tt[k + 1] ? tt[k + 1].el : null), el: t.el }));
      } else {
        let cur = '', first = blocks[0], n = 0;
        for (const b of blocks) {
          if (!cur) first = b;
          cur += (b.textContent || '') + '\n';
          if (cur.length > 15000) { list.push({ label: `الجزء ${++n}`, text: cur, el: first }); cur = ''; }
        }
        if (cur.trim()) list.push({ label: list.length ? `الجزء ${++n}` : 'الكتاب', text: cur, el: first });
      }
    }
    list.forEach((c, i) => { c.segs = abSplit(c.text); c.key = `c${i}_${c.text.length}`; });
    AB.list = list.filter((c) => c.segs.length);
    AB.bookId = book.id;
    return AB.list;
  }
  async function abManifest() {
    if (AB.man && AB.man.bookId === book.id) return AB.man;
    AB.man = (await Store.getAudio(book.id, 'manifest')) || { segs: {} };
    AB.man.bookId = book.id;
    return AB.man;
  }
  const abHas = (ch, si) => !!(AB.man && AB.man.segs[abSegKey(ch, si)]);
  const abDoneCount = (ch) => ch.segs.reduce((n, _, si) => n + (abHas(ch, si) ? 1 : 0), 0);

  /* ── ترميز: WAV (من Gemini) ⇒ Opus مضغوط في حاوية بسيطة: [طول الرأس 4 بايت][رأس JSON][الحزم] ── */
  function wavToPcm(b64) {
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dv = new DataView(u8.buffer);
    let sr = 24000, off = 12, data = null;
    while (off + 8 <= u8.length) {
      const id = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]), sz = dv.getUint32(off + 4, true);
      if (id === 'fmt ') sr = dv.getUint32(off + 12, true);
      if (id === 'data') { data = u8.slice(off + 8, Math.min(u8.length, off + 8 + sz)); break; }
      off += 8 + sz + (sz & 1);
    }
    if (!data) throw new Error('صوت غير صالح');
    return { pcm: new Int16Array(data.buffer, 0, data.length >> 1), sr };
  }
  function wavBlob(i16, sr) {
    const buf = new ArrayBuffer(44), dv = new DataView(buf);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + i16.byteLength, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    ws(36, 'data'); dv.setUint32(40, i16.byteLength, true);
    return new Blob([buf, i16], { type: 'audio/wav' });
  }
  async function opusEncode(pcm, sr) {
    const pk = []; let dcfg = null, err = null;
    const enc = new AudioEncoder({ output: (c, m) => { const b = new Uint8Array(c.byteLength); c.copyTo(b); pk.push({ b, d: c.duration || 0 }); if (m && m.decoderConfig) dcfg = m.decoderConfig; }, error: (e) => { err = e; } });
    enc.configure({ codec: 'opus', sampleRate: sr, numberOfChannels: 1, bitrate: 32000 });
    enc.encode(new AudioData({ format: 's16', sampleRate: sr, numberOfFrames: pcm.length, numberOfChannels: 1, timestamp: 0, data: pcm }));
    await enc.flush(); enc.close();
    if (err || !dcfg) throw err || new Error('تعذّر ضغط الصوت');
    let desc = '';
    if (dcfg.description) { const d = new Uint8Array(dcfg.description.buffer || dcfg.description); desc = btoa(String.fromCharCode(...d)); }
    const head = new TextEncoder().encode(JSON.stringify({ v: 1, codec: dcfg.codec, sr: dcfg.sampleRate || sr, ch: 1, desc, sizes: pk.map((p) => p.b.length), durs: pk.map((p) => p.d) }));
    const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, head.length, true);
    return new Blob([len, head, ...pk.map((p) => p.b)], { type: 'application/x-midad-opus' });
  }
  async function opusDecodeToWav(blob) {
    const u8 = new Uint8Array(await blob.arrayBuffer());
    const hl = new DataView(u8.buffer).getUint32(0, true);
    const h = JSON.parse(new TextDecoder().decode(u8.subarray(4, 4 + hl)));
    const chunks = []; let outSr = h.sr, err = null, total = 0;
    const dec = new AudioDecoder({
      output: (a) => {
        outSr = a.sampleRate;
        const f = new Float32Array(a.numberOfFrames);
        try { a.copyTo(f, { planeIndex: 0, format: 'f32-planar' }); } catch { a.copyTo(f, { planeIndex: 0 }); }
        chunks.push(f); total += f.length; a.close();
      },
      error: (e) => { err = e; },
    });
    const cfg = { codec: h.codec, sampleRate: h.sr, numberOfChannels: 1 };
    if (h.desc) cfg.description = Uint8Array.from(atob(h.desc), (c) => c.charCodeAt(0));
    dec.configure(cfg);
    let off = 4 + hl, ts = 0;
    h.sizes.forEach((sz, i) => { dec.decode(new EncodedAudioChunk({ type: 'key', timestamp: ts, duration: h.durs[i] || undefined, data: u8.subarray(off, off + sz) })); off += sz; ts += h.durs[i] || 20000; });
    await dec.flush(); dec.close();
    if (err) throw err;
    const i16 = new Int16Array(total); let o = 0;
    for (const f of chunks) { for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); i16[o++] = v < 0 ? v * 0x8000 : v * 0x7fff; } }
    return wavBlob(i16, outSr);
  }

  /* ── التوليد: طابور واحد؛ ما يحتاجه الاستماع الآن أولاً، ثم الفصول المطلوب تجهيزها ── */
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
  function abNotify(key, err) { const ws = AB.waiters.get(key); if (!ws) return; AB.waiters.delete(key); ws.forEach((w) => (err ? w.reject(err) : w.resolve())); }
  function abUi() { try { if (AB.onUi) AB.onUi(); } catch {} abBarUpdate(); }
  function abNext() {
    while (AB.want.length) { const w = AB.want[0]; if (abHas(w.ch, w.si)) { AB.want.shift(); continue; } return w; }
    for (const ch of AB.queue) { const si = ch.segs.findIndex((_, i) => !abHas(ch, i)); if (si >= 0) return { ch, si }; }
    AB.queue = []; return null;
  }
  async function abPump() {
    if (AB.busy) return;
    AB.busy = true; const bid = book && book.id;
    try {
      let task;
      while ((task = abNext()) && book && book.id === bid) {
        const { ch, si } = task, key = abSegKey(ch, si);
        AB.status = `يُجهَّز «${ch.label}» — المقطع ${si + 1} من ${ch.segs.length}`; abUi();
        let res = null, tries = 0;
        while (!res) {
          try {
            const data = await Cloud.invokeFn('ai', { action: 'tts', text: ch.segs[si].t, voice: settings.ttsVoice || 'Kore' });
            if (!data || !data.audio) throw new Error('لم يصل صوت');
            const { pcm, sr } = wavToPcm(data.audio);
            const blob = abCanCompress() ? await opusEncode(pcm, sr) : wavBlob(pcm, sr);
            res = { blob, dur: pcm.length / sr };
          } catch (e) {
            const msg = (e && e.message) || '';
            const quota = /quota|429|حصّ?ة|exhausted|rate/i.test(msg);
            if (book && book.id !== bid) return;
            if (quota && tries < 5) { tries++; const wait = 20 * tries; AB.status = `⏳ بلغتَ حدّ الصوت المؤقّت — نعيد المحاولة بعد ${wait} ث`; abUi(); await sleepMs(wait * 1000); continue; }
            if (!quota && tries < 2) { tries++; await sleepMs(2500); continue; }
            AB.err = quota ? 'نفدت حصّة الصوت الطبيعي لليوم — يُستأنف التجهيز من حيث توقّف حين تعود' : msg || 'تعذّر توليد الصوت';
            AB.queue = []; const ws = AB.want.splice(0); AB.status = '';
            abNotify(key, new Error(AB.err)); ws.forEach((w) => abNotify(abSegKey(w.ch, w.si), new Error(AB.err)));
            abUi(); return;
          }
        }
        if (!book || book.id !== bid) return;
        await Store.putAudio(bid, key, res.blob);
        AB.man.segs[key] = { dur: Math.round(res.dur * 10) / 10, size: res.blob.size, at: Date.now() };
        await Store.putAudio(bid, 'manifest', { segs: AB.man.segs, voice: settings.ttsVoice || 'Kore' });
        AB.err = '';
        abNotify(key);
        abUi();
      }
    } finally { AB.busy = false; AB.status = ''; abUi(); }
  }
  // مقطع جاهز للتشغيل (يولّده أولاً إن لزم)
  async function abSeg(ch, si) {
    await abManifest();
    const key = abSegKey(ch, si);
    if (!abHas(ch, si)) {
      const p0 = new Promise((resolve, reject) => { const ws = AB.waiters.get(key) || []; ws.push({ resolve, reject }); AB.waiters.set(key, ws); });
      AB.want = AB.want.filter((w) => w.ch !== ch || w.si !== si); AB.want.unshift({ ch, si });
      abPump();
      await p0;
    }
    return Store.getAudio(book.id, key);
  }
  function abPrefetch(ch, si) { // المقطع التالي في الخلفية، كي لا ينقطع الاستماع
    const nx = si + 1 < ch.segs.length ? { ch, si: si + 1 } : (() => { const ci = AB.list.indexOf(ch); const n = AB.list[ci + 1]; return n ? { ch: n, si: 0 } : null; })();
    if (nx && !abHas(nx.ch, nx.si) && !AB.want.some((w) => w.ch === nx.ch && w.si === nx.si)) { AB.want.push(nx); abPump(); }
  }

  /* ── المشغّل ── */
  const AB_POS = 'midad-ab-pos';
  const abPosAll = () => { try { return JSON.parse(localStorage.getItem(AB_POS) || '{}') || {}; } catch { return {}; } };
  function abSavePos() {
    if (!AB.play || !book) return;
    const all = abPosAll(); all[book.id] = { key: AB.play.ch.key, si: AB.play.si, t: Math.floor((AB.audio && AB.audio.currentTime) || 0), at: Date.now() };
    try { localStorage.setItem(AB_POS, JSON.stringify(all)); } catch {}
  }
  async function abPlay(ch, si, t = 0) {
    podStop();
    if (ttsOn) ttsStop();
    if (autoOn) stopAuto();
    const tok = (AB.tok = (AB.tok || 0) + 1);
    AB.play = { ch, si, loading: true }; abBarShow(); abBarUpdate();
    let blob;
    try { blob = await abSeg(ch, si); }
    catch (e) { if (tok !== AB.tok) return; AB.play.loading = false; abBarUpdate(); Library.toast('🎧 ' + ((e && e.message) || 'تعذّر تجهيز الصوت')); return; }
    if (tok !== AB.tok || !book) return;
    let src = blob;
    try { if (blob && blob.type === 'application/x-midad-opus') src = await opusDecodeToWav(blob); }
    catch { Library.toast('تعذّر تشغيل المقطع'); return; }
    if (tok !== AB.tok) return;
    if (!AB.audio) {
      AB.audio = new Audio();
      AB.audio.ontimeupdate = () => { abBarTime(); abFollow(); if (Date.now() - (AB.savedAt || 0) > 4000) { AB.savedAt = Date.now(); abSavePos(); } };
      AB.audio.onended = () => abStep(1, true);
      AB.audio.onplay = AB.audio.onpause = () => { abBarUpdate(); if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = AB.audio.paused ? 'paused' : 'playing'; } catch {} };
    }
    if (AB.url) URL.revokeObjectURL(AB.url);
    AB.url = URL.createObjectURL(src);
    AB.audio.src = AB.url;
    AB.audio.playbackRate = AB.rate;
    AB.play = { ch, si, loading: false, lastPage: 0 };
    try { AB.audio.currentTime = t; } catch {}
    AB.audio.play().catch(() => {});
    abSyncReader(true);
    abMedia();
    abSavePos();
    abPrefetch(ch, si);
    abBarUpdate();
  }
  function abStep(dir, auto) {
    if (!AB.play || !AB.list) return;
    const { ch, si } = AB.play; const ci = AB.list.indexOf(ch);
    let n = si + dir, c = ch;
    if (n >= ch.segs.length) { c = AB.list[ci + 1]; n = 0; }
    else if (n < 0) { c = AB.list[ci - 1]; n = c ? c.segs.length - 1 : 0; }
    if (!c) {
      if (auto) { // انتهى: لا «تابع» إلى آخر ثانية في الكتاب
        const all = abPosAll(); delete all[book.id]; try { localStorage.setItem(AB_POS, JSON.stringify(all)); } catch {}
        AB.tok++; AB.play = null; const b = $('#ab-bar'); if (b) b.hidden = true;
        Library.toast('🎧 انتهى الكتاب المسموع');
      }
      return;
    }
    abPlay(c, n, 0);
  }
  function abSeek(sec) {
    if (!AB.audio || !AB.play) return;
    const t = AB.audio.currentTime + sec;
    if (t < 0 && sec < 0 && AB.audio.currentTime < 2) return abStep(-1);
    if (AB.audio.duration && t >= AB.audio.duration) return abStep(1);
    AB.audio.currentTime = Math.max(0, t);
  }
  function abToggle() { if (!AB.audio || !AB.play) return; if (AB.audio.paused) AB.audio.play().catch(() => {}); else AB.audio.pause(); }
  function abStop() {
    AB.tok = (AB.tok || 0) + 1;
    if (AB.audio) { abSavePos(); try { AB.audio.pause(); } catch {} AB.audio.removeAttribute('src'); }
    if (AB.url) { URL.revokeObjectURL(AB.url); AB.url = null; }
    AB.play = null;
    const b = $('#ab-bar'); if (b) b.hidden = true;
  }
  // القارئ يتبع الصوت: صفحة PDF تقديرية بنسبة التقدّم داخل المقطع؛ وفي النص بداية المقطع
  function abSyncReader(start) {
    if (!AB.play || !book) return;
    const { ch, si } = AB.play, seg = ch.segs[si];
    if (isPdf && AB.pageOf) {
      const frac = AB.audio && AB.audio.duration ? AB.audio.currentTime / AB.audio.duration : 0;
      const pg = AB.pageOf(ch.abs + seg.off + Math.floor(seg.t.length * frac));
      if (pg !== AB.play.lastPage) { AB.play.lastPage = pg; if (!visiblePdfPages().includes(pg)) jumpTo(pg); }
    } else if (start && !isPdf) {
      const phrase = seg.t.split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 40);
      if (phrase.length > 8) jumpToPhrase(phrase);
    }
  }
  function abFollow() { if (isPdf && Date.now() - (AB.followAt || 0) > 1500) { AB.followAt = Date.now(); abSyncReader(false); } }
  function abMedia() {
    if (!('mediaSession' in navigator) || !AB.play) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: AB.play.ch.label, artist: book.title, album: 'مِداد — كتاب مسموع', artwork: book.cover ? [{ src: book.cover, sizes: '512x512' }] : [] });
      navigator.mediaSession.setActionHandler('play', () => AB.audio && AB.audio.play());
      navigator.mediaSession.setActionHandler('pause', () => AB.audio && AB.audio.pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => abStep(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => abStep(1));
      navigator.mediaSession.setActionHandler('seekbackward', () => abSeek(-15));
      navigator.mediaSession.setActionHandler('seekforward', () => abSeek(15));
    } catch {}
  }
  const fmtT = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  function abBarShow() {
    let b = $('#ab-bar');
    if (!b) {
      b = document.createElement('div'); b.id = 'ab-bar'; b.className = 'ab-bar'; b.hidden = true;
      b.innerHTML = `<div class="ab-info"><b class="ab-ch"></b><span class="ab-time"></span></div>
        <div class="ab-ctrl"><button class="ab-prev" aria-label="المقطع السابق">⏮</button><button class="ab-back" aria-label="رجوع ١٥ ثانية">↺15</button>
        <button class="ab-pp" aria-label="تشغيل/إيقاف">⏸</button><button class="ab-fwd" aria-label="تقدّم ١٥ ثانية">15↻</button><button class="ab-next" aria-label="المقطع التالي">⏭</button>
        <button class="ab-rate" aria-label="السرعة">1×</button><button class="ab-list" aria-label="الفصول">☰</button><button class="ab-x" aria-label="إيقاف">✕</button></div>
        <div class="ab-prog"><i></i></div>`;
      $('#reader').appendChild(b);
      b.querySelector('.ab-prev').onclick = () => abStep(-1);
      b.querySelector('.ab-next').onclick = () => abStep(1);
      b.querySelector('.ab-back').onclick = () => abSeek(-15);
      b.querySelector('.ab-fwd').onclick = () => abSeek(15);
      b.querySelector('.ab-pp').onclick = abToggle;
      b.querySelector('.ab-x').onclick = abStop;
      b.querySelector('.ab-list').onclick = openAudiobook;
      b.querySelector('.ab-rate').onclick = (e) => {
        const R = [1, 1.25, 1.5, 1.75, 0.85]; AB.rate = R[(R.indexOf(AB.rate) + 1) % R.length];
        if (AB.audio) AB.audio.playbackRate = AB.rate; e.currentTarget.textContent = AB.rate + '×';
        try { localStorage.setItem('midad-ab-rate', String(AB.rate)); } catch {}
      };
      try { AB.rate = parseFloat(localStorage.getItem('midad-ab-rate')) || 1; } catch {}
      b.querySelector('.ab-rate').textContent = AB.rate + '×';
    }
    b.hidden = false;
  }
  function abBarTime() {
    const b = $('#ab-bar'); if (!b || b.hidden || !AB.play || !AB.audio) return;
    const { ch, si } = AB.play;
    // الزمن داخل الفصل: مجموع مدد المقاطع السابقة (المعروفة) + موضع المقطع الحالي
    let before = 0, total = 0;
    ch.segs.forEach((s, i) => { const m = AB.man && AB.man.segs[abSegKey(ch, i)]; const d = m ? m.dur : s.t.length / 14; total += d; if (i < si) before += d; });
    const now = before + (AB.audio.currentTime || 0);
    b.querySelector('.ab-time').textContent = `${fmtT(now)} / ${fmtT(total)} · ${si + 1}/${ch.segs.length}`;
    b.querySelector('.ab-prog i').style.width = (total ? Math.min(100, (now / total) * 100) : 0) + '%';
  }
  function abBarUpdate() {
    const b = $('#ab-bar'); if (!b || !AB.play) return;
    b.querySelector('.ab-ch').textContent = (AB.play.loading ? '⏳ ' : '🎧 ') + AB.play.ch.label;
    b.querySelector('.ab-pp').textContent = AB.play.loading ? '…' : (AB.audio && !AB.audio.paused ? '⏸' : '▶');
    if (AB.play.loading) b.querySelector('.ab-time').textContent = AB.status || 'يُجهَّز الصوت…';
    else abBarTime();
  }

  /* ── لوحة الكتاب المسموع ── */
  async function openAudiobook() {
    if (Library.needAI && Library.needAI('الكتاب المسموع (الصوت الطبيعي)')) return;
    document.querySelectorAll('.ui-dialog').forEach((m) => m.remove());
    const o = document.createElement('div');
    o.className = 'ui-dialog ab-dialog';
    o.innerHTML = `<div class="ud-box ab-box" role="dialog" aria-modal="true" aria-labelledby="ab-title">
      <h3 id="ab-title">🎧 الكتاب المسموع</h3><div class="ab-body"><p class="cr-empty">⏳ جارٍ تحضير الفصول…</p></div></div>`;
    $('#reader').appendChild(o);
    const close = () => { AB.onUi = null; o.remove(); };
    o.onclick = (e) => { if (e.target === o) close(); };
    const body = o.querySelector('.ab-body');
    if (AB.bookId !== book.id) abReset();
    const list = await abChapters();
    await abManifest();
    if (!o.isConnected) return;
    if (!list.length) { body.innerHTML = `<p>لا يوجد نصّ مقروء في هذا الكتاب بعد${isPdf ? ' — إن كان مصوّراً فاستخرج نصّه أولاً (✨ ← استخراج النص)' : ''}.</p><div class="ud-actions"><button class="ud-cancel">إغلاق</button></div>`; body.querySelector('.ud-cancel').onclick = close; return; }
    const pos = abPosAll()[book.id];
    const posCh = pos && list.find((c) => c.key === pos.key);
    const hereIdx = (() => { // الفصل الذي يقرؤه القارئ الآن
      if (isPdf) { let k = 0; list.forEach((c, i) => { if (c.sp <= pdfPage) k = i; }); return k; }
      const ti = tocIndexNow(); if (ti < 0) return 0;
      const el = tocItems[ti] && tocItems[ti].el; const k = list.findIndex((c) => c.el === el); return k >= 0 ? k : 0;
    })();
    const draw = () => {
      const bytes = Object.values(AB.man.segs).reduce((n, s) => n + (s.size || 0), 0);
      const secs = Object.values(AB.man.segs).reduce((n, s) => n + (s.dur || 0), 0);
      const allDone = list.every((c) => abDoneCount(c) === c.segs.length);
      body.innerHTML = `
        <p class="ab-sub">${esc(book.title)} · ${list.length} ${list.length > 10 ? 'فصلاً' : 'فصول'} · بصوت «${esc(settings.ttsVoice || 'Kore')}»${secs ? ` · محفوظ ${fmtT(secs)} (${(bytes / 1048576).toFixed(1)} م.ب)` : ''}</p>
        <div class="ab-top">
          ${posCh ? `<button class="btn-gold ab-resume">▶ تابع: «${esc(posCh.label.slice(0, 30))}» ${fmtT(pos.t)}</button>` : ''}
          <button class="${posCh ? 'ud-cancel' : 'btn-gold'} ab-here">🎧 استمع من موضعك</button>
          ${allDone ? '' : `<button class="ud-cancel ab-all">⬇ جهّز الكتاب كله</button>`}
        </div>
        ${AB.status ? `<p class="ab-status">${esc(AB.status)}</p>` : ''}${AB.err ? `<p class="ab-err">⚠ ${esc(AB.err)}</p>` : ''}
        <div class="ab-list" role="list">${list.map((c, i) => {
          const dn = abDoneCount(c), n = c.segs.length, queued = AB.queue.includes(c);
          const dur = c.segs.reduce((x, _, si) => x + ((AB.man.segs[abSegKey(c, si)] || {}).dur || 0), 0);
          const playing = AB.play && AB.play.ch === c;
          return `<div class="ab-row${playing ? ' on' : ''}${i === hereIdx ? ' here' : ''}" role="listitem">
            <div class="ab-ri"><b>${esc(c.label)}</b><span>${dn === n ? `✓ جاهز · ${fmtT(dur)}` : dn ? `${dn}/${n} مقاطع${queued ? ' · في الطابور' : ''}` : `${n === 1 ? 'مقطع واحد' : n === 2 ? 'مقطعان' : n + ' مقاطع'} · ~${Math.max(1, Math.round(c.text.length / 14 / 60))} د${queued ? ' · في الطابور' : ''}`}</span>
              ${dn && dn < n ? `<div class="ab-mini"><i style="width:${(dn / n) * 100}%"></i></div>` : ''}</div>
            <div class="ab-ra"><button data-i="${i}" data-a="play" aria-label="استمع">${playing && AB.audio && !AB.audio.paused ? '⏸' : '▶'}</button>
              ${dn < n ? `<button data-i="${i}" data-a="${queued ? 'unq' : 'q'}" aria-label="${queued ? 'أوقف التجهيز' : 'جهّزه للاستماع دون اتصال'}">${queued ? '⏹' : '⬇'}</button>` : ''}
              ${dn ? `<button data-i="${i}" data-a="del" aria-label="احذف صوته">🗑</button>` : ''}</div></div>`;
        }).join('')}</div>
        <p class="ab-note">يُولَّد الصوت ويُحفظ على هذا الجهاز ليُسمع دون اتصال، ويتبعه القارئ صفحةً بصفحة. حصّة الصوت المجانية في Gemini محدودة يومياً: إن نفدت توقّف التجهيز وأكمل لاحقاً من حيث وقف.${abCanCompress() ? '' : ' <b>هذا المتصفح لا يدعم ضغط الصوت، فيُحفظ بحجم أكبر.</b>'}</p>
        <div class="ud-actions">${bytes ? '<button class="ud-cancel ab-wipe">🗑 احذف الصوت كله</button>' : ''}<button class="ud-cancel ab-close">إغلاق</button></div>`;
      body.querySelector('.ab-close').onclick = close;
      { const r = body.querySelector('.ab-resume'); if (r) r.onclick = () => { close(); abPlay(posCh, Math.min(pos.si, posCh.segs.length - 1), pos.t); }; }
      body.querySelector('.ab-here').onclick = () => {
        const c = list[hereIdx]; let si = 0;
        if (isPdf && AB.pageOf) c.segs.forEach((s, k) => { if (AB.pageOf(c.abs + s.off) <= pdfPage) si = k; });
        close(); abPlay(c, si, 0);
      };
      { const a = body.querySelector('.ab-all'); if (a) a.onclick = () => { list.forEach((c) => { if (!AB.queue.includes(c) && abDoneCount(c) < c.segs.length) AB.queue.push(c); }); AB.err = ''; abPump(); draw(); }; }
      { const w = body.querySelector('.ab-wipe'); if (w) w.onclick = async () => {
        if (!w.classList.contains('arm')) { w.classList.add('arm'); w.textContent = 'اضغط مجدداً للتأكيد'; return; }
        abStop(); AB.queue = []; await Store.deleteAudio(book.id); AB.man = { segs: {}, bookId: book.id }; draw();
      }; }
      body.querySelectorAll('[data-a]').forEach((btn) => (btn.onclick = async () => {
        const c = list[+btn.dataset.i];
        if (btn.dataset.a === 'play') { if (AB.play && AB.play.ch === c) { abToggle(); return draw(); } close(); return abPlay(c, 0, 0); }
        if (btn.dataset.a === 'q') { AB.queue.push(c); AB.err = ''; abPump(); return draw(); }
        if (btn.dataset.a === 'unq') { AB.queue = AB.queue.filter((x) => x !== c); return draw(); }
        if (btn.dataset.a === 'del') {
          if (AB.play && AB.play.ch === c) abStop();
          AB.queue = AB.queue.filter((x) => x !== c);
          for (let si = 0; si < c.segs.length; si++) { const k = abSegKey(c, si); if (AB.man.segs[k]) { delete AB.man.segs[k]; await Store.deleteAudio(book.id, k); } }
          await Store.putAudio(book.id, 'manifest', { segs: AB.man.segs, voice: settings.ttsVoice || 'Kore' });
          draw();
        }
      }));
    };
    AB.onUi = () => { if (o.isConnected) draw(); };
    draw();
  }

  /* ═══════ القراءة التلقائية (تمرير/تقليب بلا يدين) ═══════ */
  let autoOn = false, autoRAF = 0, autoTimer = 0;
  const autoContainer = () => pdfScrollActive() ? $('#r-pdf-scroll') : ((!isPdf && settings.flip === 'scroll') ? viewportEl : null);

  function toggleAuto() { if (autoOn) stopAuto(); else startAuto(); }

  function startAuto() {
    autoOn = true;
    $('#r-btn-auto').classList.add('on');
    const cont = autoContainer();
    if (cont) {
      let last = performance.now();
      const step = (now) => {
        if (!autoOn) return;
        const dt = Math.min(now - last, 60); last = now;
        cont.scrollTop += (settings.autoSpeed || 50) * 3 * dt / 1000;
        if (cont.scrollTop + cont.clientHeight >= cont.scrollHeight - 2) { stopAuto(); Library.toast('انتهت القراءة التلقائية ✓'); return; }
        autoRAF = requestAnimationFrame(step);
      };
      autoRAF = requestAnimationFrame(step);
    } else {
      const interval = Math.max(2500, (115 - (settings.autoSpeed || 50)) * 250);
      autoTimer = setInterval(() => {
        if (!autoOn) return;
        const atEnd = isPdf ? (pdfPage >= pageCount) : (curPage >= pageCount - 1);
        if (atEnd) { stopAuto(); Library.toast('انتهت القراءة التلقائية ✓'); return; }
        next();
      }, interval);
    }
    Library.toast('بدأت القراءة التلقائية ⏵ — المس الصفحة للإيقاف');
  }

  function stopAuto() {
    if (!autoOn && !autoRAF && !autoTimer) return;
    autoOn = false;
    $('#r-btn-auto').classList.remove('on');
    if (autoRAF) cancelAnimationFrame(autoRAF);
    clearInterval(autoTimer);
    autoRAF = 0; autoTimer = 0;
  }

  /* ═══════ الإعدادات ═══════ */
  function buildSettingsUI() {
    const themeRow = $('#theme-row');
    themeRow.innerHTML = Object.entries(THEMES).map(([k, t]) =>
      `<button data-theme="${k}" style="--p:${t.paper};--k:${t.ink}">أ<span>${t.label}</span></button>`).join('');
    themeRow.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { settings.theme = b.dataset.theme; settings.customPaper = null; applySettings(); };
    });

    const fontRow = $('#font-row');
    fontRow.innerHTML = FONTS.map((f, i) =>
      `<button data-i="${i}" style="font-family:${f.css}">${f.label}</button>`).join('');
    fontRow.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { settings.font = FONTS[+b.dataset.i].css; applySettings(); scheduleRepaginate(); };
    });

    $('#custom-paper').oninput = (e) => { settings.customPaper = e.target.value; settings.theme = 'custom'; applySettings(); };
    $('#set-brightness').oninput = (e) => { settings.brightness = +e.target.value; applySettings(); };
    $('#set-warmth').oninput = (e) => { settings.warmth = +e.target.value; applySettings(); };
    $('#set-fontsize').oninput = (e) => { settings.fontSize = +e.target.value; applySettings(); scheduleRepaginate(); };
    $('#set-lineheight').oninput = (e) => { settings.lineHeight = +e.target.value; applySettings(); scheduleRepaginate(); };
    $('#set-width').oninput = (e) => { settings.width = +e.target.value; applySettings(); scheduleRepaginate(); };
    $('#set-ttsrate').oninput = (e) => { settings.ttsRate = +e.target.value; if (ttsOn && ttsEngine === 'natural' && ttsAudio) ttsAudio.playbackRate = Math.max(0.5, Math.min(2, settings.ttsRate / 100)); Store.saveSettings(settings); };
    $('#set-autospeed').oninput = (e) => { settings.autoSpeed = +e.target.value; Store.saveSettings(settings); };
    { const er = $('#tts-engine-row'); if (er) er.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        settings.ttsEngine = b.dataset.engine; Store.saveSettings(settings);
        er.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        syncVoiceRows();
        if (settings.ttsEngine === 'natural' && !(window.Cloud && Cloud.aiReady && Cloud.aiReady())) Library.needAI && Library.needAI('الصوت الطبيعي');
      };
    }); }
    { const sv = $('#set-ttsvoice'); if (sv) sv.onchange = (e) => { settings.ttsVoice = e.target.value; ttsCache.clear(); Store.saveSettings(settings); tryNaturalVoice($('#tts-try-natural')); }; }
    { const dv = $('#set-ttsdevice'); if (dv) dv.onchange = (e) => { settings.ttsDeviceVoice = e.target.value; Store.saveSettings(settings); tryDeviceVoice(); }; }
    { const tn = $('#tts-try-natural'); if (tn) tn.onclick = () => tryNaturalVoice(tn); }
    { const td = $('#tts-try-device'); if (td) td.onclick = tryDeviceVoice; }
    { const ss = $('#set-ttssleep'); if (ss) ss.onchange = (e) => { settings.ttsSleep = +e.target.value; Store.saveSettings(settings); if (ttsOn) startSleepTimer(); }; }

    $('#spread-row').querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        settings.spread = b.dataset.spread === '1'; applySettings();
        if (isPdf) {
          if (pdfScrollActive()) { if (settings.spread) Library.toast('العرض المزدوج غير متاح مع «التمرير المتصل» — اختر «تقليب ورقي» أو «انزلاق»'); }
          else { showPdfPage(pdfPage); if (settings.spread && !pdfSpreadActive()) Library.toast('العرض المزدوج يظهر في الوضع الأفقي (اجعل النافذة أعرض من ارتفاعها)'); }
        } else scheduleRepaginate();
      };
    });

    { const fitr = $('#fit-row'); if (fitr) fitr.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { settings.pdfFit = b.dataset.fit; applySettings(); relayoutPdf(); };
    }); }

    // تفعيل/إطفاء القلب الواقعي (StPageFlip) لملفات PDF
    { const rfr = $('#realflip-row'); if (rfr) rfr.querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        settings.realFlip = b.dataset.realflip === '1';
        Store.saveSettings(settings);
        rfr.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        if (isPdf && !pdfScrollActive()) { teardownPageFlip(); showPdfPage(pdfPage); applySettings(); }
      };
    }); }

    $('#btn-reset-settings').onclick = () => {
      settings = Store.resetSettings();
      applySettings(false);
      scheduleRepaginate();
      Library.toast('عادت الإعدادات إلى وضعها الافتراضي ↺');
    };

    $('#bgmode-row').querySelectorAll('button').forEach((b) => {
      b.onclick = () => { settings.bg = b.dataset.bg; applySettings(); };
    });
    $('#fx-row').querySelectorAll('button').forEach((b) => {
      b.onclick = () => { settings.paperFx = b.dataset.fx; applySettings(); };
    });
    { const ar = $('#awake-row'); if (ar) ar.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { settings.keepAwake = b.dataset.awake === '1'; Store.saveSettings(settings); applySettings(); syncWakeLock(); };
    }); }
    { const fr = $('#focus-row'); if (fr) fr.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { settings.focusMode = b.dataset.focus === '1'; Store.saveSettings(settings); applySettings(); };
    }); }
    // القراءة الحيّة للصفحات المصوّرة (Tesseract على الجهاز)
    { const lr = $('#liveocr-row'); if (lr) lr.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', (b.dataset.lo === '1') === liveOcrOn());
      b.onclick = async () => {
        try { localStorage.setItem('midad-live-ocr', b.dataset.lo); } catch {}
        lr.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        if (isPdf && b.dataset.lo === '1') { if (pdfScrollActive()) { pdfSlots.forEach((s) => clearSlot(s)); renderVisibleSlots(); } else await renderPdf(pdfPage); }
        if (b.dataset.lo === '0') { LO.q = []; loPill(''); }
      };
    }); }
    // تنقية الصفحة المصوّرة (تسوية الخلفية وإزالة الشرائط الفاتحة)
    const enhanceRow = $('#enhance-row');
    if (enhanceRow) enhanceRow.querySelectorAll('button').forEach((b) => {
      b.onclick = async () => {
        settings.enhanceScan = b.dataset.enhance === '1';
        Store.saveSettings(settings);
        enhanceRow.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
        if (isPdf) {
          if (pdfScrollActive()) { pdfSlots.forEach((s) => clearSlot(s)); renderVisibleSlots(); }
          else await renderPdf(pdfPage);
        }
      };
    });
    $('#flip-row').querySelectorAll('button').forEach((b) => {
      b.onclick = async () => {
        stopAuto();
        const was = settings.flip;
        settings.flip = b.dataset.flip;
        const scrollChanged = (was === 'scroll') !== (settings.flip === 'scroll');
        applySettings();
        if (isPdf) {
          if (pdfZoom < minZoom()) pdfZoom = minZoom(); // أوضاع الصفحات لا تنزل تحت 100٪
          updateZoomUI();
          if (pdfScrollActive()) { teardownPageFlip(); await buildPdfScroll(); }
          else { teardownPdfScroll(); showPdfPage(pdfPage); } // يبني/يهدم StPageFlip حسب الوضع
          updateHUD();
        } else if (scrollChanged) {
          const pct = state.pct;
          setTimeout(() => {
            paginate();
            if (settings.flip === 'scroll') viewportEl.scrollTop = pct * (viewportEl.scrollHeight - viewportEl.clientHeight);
            else setPage(Math.round(pct * (pageCount - 1)), false);
            updateHUD();
          }, 30);
        }
      };
    });
  }

  window.addEventListener('midad-settings-adopted', () => {
    if (!isOpen) return;
    settings = Store.getSettings();
    applySettings(false);
    if (!isPdf) scheduleRepaginate();
  });

  function applySettings(save = true) {
    const r = $('#reader');
    let paper, ink;
    if (settings.theme === 'custom' && settings.customPaper) {
      paper = settings.customPaper;
      ink = luminance(paper) > 0.45 ? '#2c2418' : '#d9dce2';
    } else {
      const t = THEMES[settings.theme] || THEMES.sepia;
      paper = t.paper; ink = t.ink;
    }
    r.style.setProperty('--paper', paper);
    r.style.setProperty('--ink-c', ink);
    r.style.setProperty('--r-font', settings.font);
    r.style.setProperty('--r-size', settings.fontSize + 'px');
    r.style.setProperty('--r-lh', settings.lineHeight / 100);
    r.style.setProperty('--r-width', settings.width + 'px');

    $('#r-stage').style.filter = `brightness(${settings.brightness / 100})`;
    $('#r-warmth').style.opacity = settings.warmth / 100;
    $('#r-ambient').className = 'r-ambient bg-' + settings.bg;
    r.classList.remove('fx-aged', 'fx-grain', 'fx-vignette');
    if (settings.paperFx && settings.paperFx !== 'none') r.classList.add('fx-' + settings.paperFx);

    const dark = settings.theme === 'custom' ? luminance(paper) <= 0.45 : DARK_THEMES.includes(settings.theme);
    r.classList.toggle('pdf-dark', isPdf && dark);
    r.classList.toggle('mode-scroll', !isPdf && settings.flip === 'scroll');
    r.classList.toggle('pdf-scroll', pdfScrollActive());
    r.classList.toggle('focus-mode', !!settings.focusMode);
    if (settings.focusMode && !isPdf && settings.flip === 'scroll') updateFocusLine();
    // في وضع التمرير لـ PDF نخفي الكنفا المفرد وأداة الكتابة (العرض عبر الشرائح)
    if (isPdf) {
      const flipBook = pdfFlipBookActive();
      $('#r-canvas-wrap').hidden = pdfScrollActive() || flipBook;
      $('#r-btn-draw').style.display = (pdfScrollActive() || flipBook) ? 'none' : '';
      $('#zoom-pill').hidden = flipBook; // لا تكبير في وضع القلب الواقعي
      r.classList.toggle('fit-width', settings.pdfFit === 'width');
    }

    // تفعيل الأزرار
    $('#theme-row').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.theme === settings.theme));
    $('#font-row').querySelectorAll('button').forEach((b) => b.classList.toggle('active', FONTS[+b.dataset.i].css === settings.font));
    $('#bgmode-row').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.bg === settings.bg));
    $('#fx-row').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.fx === (settings.paperFx || 'none')));
    $('#flip-row').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.flip === settings.flip));
    $('#spread-row').querySelectorAll('button').forEach((b) => b.classList.toggle('active', (b.dataset.spread === '1') === !!settings.spread));
    { const rfr = $('#realflip-row'); if (rfr) rfr.querySelectorAll('button').forEach((b) => b.classList.toggle('active', (b.dataset.realflip === '1') === (settings.realFlip !== false))); }
    { const fitr = $('#fit-row'); if (fitr) fitr.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.fit === (settings.pdfFit || 'page'))); }
    { const fr = $('#focus-row'); if (fr) fr.querySelectorAll('button').forEach((b) => b.classList.toggle('active', (b.dataset.focus === '1') === !!settings.focusMode)); }
    { const ar = $('#awake-row'); if (ar) ar.querySelectorAll('button').forEach((b) => b.classList.toggle('active', (b.dataset.awake === '1') === (settings.keepAwake !== false))); }
    { const er = $('#enhance-row'); if (er) er.querySelectorAll('button').forEach((b) => b.classList.toggle('active', (b.dataset.enhance === '1') === (settings.enhanceScan !== false))); }
    $('#set-ttsrate').value = settings.ttsRate || 100;
    $('#set-autospeed').value = settings.autoSpeed || 50;
    { const er = $('#tts-engine-row'); if (er) er.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.engine === engineSetting())); }
    { const sv = $('#set-ttsvoice'); if (sv) sv.value = settings.ttsVoice || 'Kore'; }
    { const ss = $('#set-ttssleep'); if (ss) ss.value = String(settings.ttsSleep || 0); }
    syncVoiceRows();
    $('#set-brightness').value = settings.brightness;
    $('#set-warmth').value = settings.warmth;
    $('#set-fontsize').value = settings.fontSize;
    $('#set-lineheight').value = settings.lineHeight;
    $('#set-width').value = settings.width;
    if (settings.customPaper) $('#custom-paper').value = settings.customPaper;

    if (save) Store.saveSettings(settings);
  }

  function luminance(hex) {
    const n = parseInt(hex.slice(1), 16);
    const rr = (n >> 16) & 255, gg = (n >> 8) & 255, bb = n & 255;
    return (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255;
  }

  function scheduleRepaginate() {
    if (isPdf) return;
    clearTimeout(repagTimer);
    repagTimer = setTimeout(() => {
      const pct = state.pct;
      paginate();
      if (settings.flip !== 'scroll') setPage(Math.round(pct * (pageCount - 1)), false);
      buildTextToc();
      updateHUD();
    }, 260);
  }

  /* ═══════ شريط المعلومات ═══════ */
  // وضع التركيز: أبرِز الفقرة الأقرب لمركز نافذة القراءة وعتّم البقية
  function updateFocusLine() {
    if (!contentEl || isPdf) return;
    const vr = viewportEl.getBoundingClientRect();
    const cy = vr.top + vr.height * 0.42;
    let best = null, bestD = Infinity;
    for (const el of contentEl.children) {
      const r = el.getBoundingClientRect();
      if (r.bottom < vr.top || r.top > vr.bottom) continue;
      const d = Math.abs((r.top + r.bottom) / 2 - cy);
      if (d < bestD) { bestD = d; best = el; }
    }
    contentEl.querySelectorAll('.focus-line').forEach((e) => { if (e !== best) e.classList.remove('focus-line'); });
    if (best) best.classList.add('focus-line');
  }

  function updateHUD() {
    const label = $('#r-page-label');
    const slider = $('#r-slider');
    let cur, total, pct;
    if (isPdf) { cur = pdfPage; total = pageCount; pct = pdfScrollActive() ? state.pct : (pageCount > 1 ? (pdfPage - 1) / (pageCount - 1) : 1); }
    else if (settings.flip === 'scroll') {
      const max = viewportEl.scrollHeight - viewportEl.clientHeight;
      pct = max > 0 ? viewportEl.scrollTop / max : 1;
      cur = Math.round(pct * 100); total = 100;
      label.textContent = `${Math.round(pct * 100)}٪`;
    } else { cur = curPage + 1; total = pageCount; pct = state.pct; }

    if (!(settings.flip === 'scroll' && !isPdf)) label.textContent = `صفحة ${cur} من ${total} · ${Math.round(pct * 100)}٪`;
    slider.value = Math.round(pct * 100);
    slider.style.setProperty('--pct', Math.round(pct * 100) + '%');
    $('#r-time-left').textContent = timeLeftText(pct);
    updateRibbon();
    $('#r-prev').disabled = pct <= 0 && settings.flip !== 'scroll';
    $('#r-next').disabled = pct >= 1 && settings.flip !== 'scroll';
    highlightCurrentToc();
    updateNextPart();
  }

  function timeLeftText(pct) {
    let minutes;
    if (isPdf) minutes = (pageCount - pdfPage) * 1.5;
    else minutes = (totalChars * (1 - pct)) / 900;
    if (minutes < 1) return 'أوشكت على الختام ✨';
    if (minutes < 60) return `≈ ${Math.ceil(minutes)} دقيقة متبقية`;
    return `≈ ${Math.floor(minutes / 60)} س ${Math.ceil(minutes % 60)} د متبقية`;
  }

  /* ═══════ العلامات المرجعية ═══════ */
  function currentMarkKey() { return isPdf ? pdfPage : curPage; }

  function toggleBookmark() {
    const key = currentMarkKey();
    const i = (state.bookmarks || []).findIndex((m) => m.page === key);
    if (i >= 0) { markDeleted('bookmarks', state.bookmarks[i].id); state.bookmarks.splice(i, 1); Library.toast('أُزيلت العلامة المرجعية'); }
    else {
      state.bookmarks.push({
        id: 'm' + Date.now(), page: key, pct: state.pct,
        label: isPdf ? `صفحة ${pdfPage}` : `موضع ${Math.round(state.pct * 100)}٪ — صفحة ${curPage + 1}`,
        at: Date.now(),
      });
      Library.toast('أُضيفت علامة مرجعية 🔖', 'gold');
    }
    updateRibbon(); renderDrawerPanes(); schedulePersist();
  }

  function updateRibbon() {
    const on = (state.bookmarks || []).some((m) => m.page === currentMarkKey());
    $('#r-ribbon').classList.toggle('on', on);
    $('#r-btn-bookmark').classList.toggle('on', on);
  }

  /* ═══════ التظليل والملاحظات (نصي) ═══════ */
  function globalOffsetOf(node, offset) {
    const rng = document.createRange();
    rng.selectNodeContents(contentEl);
    rng.setEnd(node, offset);
    return rng.toString().length;
  }

  function applyHighlightToDOM(h) {
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
    let pos = 0, node;
    const parts = [];
    while ((node = walker.nextNode())) {
      const len = node.data.length;
      const s = Math.max(h.start - pos, 0), e = Math.min(h.end - pos, len);
      if (s < e) parts.push({ node, s, e });
      pos += len;
      if (pos >= h.end) break;
    }
    for (const pRange of parts) {
      const rng = document.createRange();
      rng.setStart(pRange.node, pRange.s);
      rng.setEnd(pRange.node, pRange.e);
      const mark = document.createElement('mark');
      mark.className = 'hl' + (h.note ? ' has-note' : '');
      mark.dataset.id = h.id;
      mark.style.setProperty('--c', h.color);
      try { rng.surroundContents(mark); } catch (e) { /* تجاهل التداخل */ }
    }
  }

  function rebuildText() {
    const pct = state.pct;
    renderContent();
    if (settings.flip !== 'scroll') {
      paginate();
      setPage(Math.min(curPage, pageCount - 1), false);
    }
    updateHUD();
  }

  function onTextSelection() {
    if (isPdf) return;
    const sel = getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!contentEl.contains(range.commonAncestorContainer)) return;
    const text = sel.toString();
    if (!text.trim() || text.length > 2000) return;
    const start = globalOffsetOf(range.startContainer, range.startOffset);
    const end = globalOffsetOf(range.endContainer, range.endOffset);
    if (end <= start) return;
    pendingSel = { start, end, text };
    pendingMarkId = null;
    showHlPopup(range.getBoundingClientRect(), false);
  }

  function showHlPopup(rect, existing) {
    const pop = $('#hl-popup');
    pop.hidden = false;
    $('#hl-del-btn').hidden = !existing;
    $('#hl-note-btn').textContent = existing ? '📝 تعديل الملاحظة' : '📝 تظليل + ملاحظة';
    { // تحديد كلمة واحدة ⇒ زر «معنى» في المقدّمة وبارز (القاموس أرجح ما يريده القارئ)
      const db = $('#hl-define-btn'); let t = '';
      try { t = String(getSelection() || ''); } catch {}
      const one = !existing && isSingleWord(t);
      db.classList.toggle('hl-primary', one);
      db.textContent = one ? '📖 معنى «' + cleanWord(t).slice(0, 14) + '»' : '📖 معنى';
      if (one && db.previousElementSibling !== pop.querySelector('.hl-colors')) pop.querySelector('.hl-colors').after(db);
      else if (!one && db.previousElementSibling !== $('#hl-note-btn')) $('#hl-note-btn').after(db);
    }
    const w = pop.offsetWidth || 300, h = pop.offsetHeight || 100;
    pop.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
    // فوق التحديد مع فسحة كافية حتى لا يحجبه؛ فإن لم يتّسع فوقه فأسفله
    let top = rect.top - h - 12;
    if (top < 8) top = Math.min(rect.bottom + 12, innerHeight - h - 8);
    pop.style.top = Math.max(8, top) + 'px';
  }
  function hideHlPopup() { $('#hl-popup').hidden = true; pendingSel = null; pendingPdfSel = null; }

  // ── دعم دمج المزامنة بلا فقدان: شواهد الحذف + طابع تعديل العناصر ──
  // كل حذف يُسجَّل في state.deleted[list][id]=وقت، وكل تعديل يضع it.mt=وقت،
  // فيدمج جهازان تعديلاتهما دون أن يدهس أحدهما الآخر (انظر mergeStates في cloud.js).
  function markDeleted(list, id) {
    if (!state || id == null) return;
    state.deleted = state.deleted || {};
    (state.deleted[list] = state.deleted[list] || {})[id] = Date.now();
  }
  function touchItem(it) { if (it) it.mt = Date.now(); }

  function addHighlight(color, withNote) {
    if (!pendingSel) return;
    const h = {
      id: 'h' + Date.now(), start: pendingSel.start, end: pendingSel.end,
      color, note: '', text: pendingSel.text, at: Date.now(),
    };
    state.highlights.push(h);
    getSelection().removeAllRanges();
    hideHlPopup();
    rebuildText();
    renderDrawerPanes();
    schedulePersist();
    if (withNote) openNoteModal(h);
    else Library.toast('ظُلّل النص ✓');
  }

  function openNoteModal(h) {
    $('#note-quote').textContent = '«' + h.text.trim() + '»';
    $('#note-text').value = h.note || '';
    $('#note-modal').hidden = false;
    setTimeout(() => $('#note-text').focus(), 60);
    $('#note-save').onclick = () => {
      h.note = $('#note-text').value.trim();
      touchItem(h);
      $('#note-modal').hidden = true;
      if (h.rects) refreshPdfHighlights(); else rebuildText(); // تظليل PDF مقابل نصي
      renderDrawerPanes(); schedulePersist();
      Library.toast('حُفظت الملاحظة 📝', 'gold');
    };
  }

  function openPdfNoteModal() {
    const pageAt = pdfPage;
    $('#note-quote').textContent = `ملاحظة على الصفحة ${pageAt}`;
    $('#note-text').value = '';
    $('#note-modal').hidden = false;
    setTimeout(() => $('#note-text').focus(), 60);
    $('#note-save').onclick = () => {
      const note = $('#note-text').value.trim();
      if (note) {
        state.pageNotes.push({ id: 'n' + Date.now(), page: pageAt - 1, note, at: Date.now() });
        renderDrawerPanes(); schedulePersist();
        Library.toast('حُفظت الملاحظة 📝', 'gold');
      }
      $('#note-modal').hidden = true;
    };
  }

  /* ═══════ الفهرس والأدراج ═══════ */
  let tocItems = []; // {label, lvl, el? (نصي), page? (pdf 1-based)}

  function buildTextToc() {
    tocItems = [];
    contentEl.querySelectorAll('h2, h3').forEach((el) => {
      tocItems.push({ label: el.textContent, lvl: el.tagName === 'H2' ? 1 : 2, el });
    });
    renderTocPane();
  }

  async function buildPdfToc() {
    tocItems = [];
    try {
      const outline = await pdfDoc.getOutline();
      if (outline) {
        const walk = async (items, lvl) => {
          for (const it of items) {
            let pageIdx = null;
            try {
              let dest = it.dest;
              if (typeof dest === 'string') dest = await pdfDoc.getDestination(dest);
              if (dest && dest[0]) pageIdx = await pdfDoc.getPageIndex(dest[0]);
            } catch {}
            tocItems.push({ label: it.title, lvl, page: pageIdx != null ? pageIdx + 1 : null });
            if (it.items && lvl < 2) await walk(it.items, lvl + 1);
          }
        };
        await walk(outline, 1);
      }
    } catch {}
    renderTocPane();
  }

  function elementPage(el) {
    const rect = el.getBoundingClientRect();
    const vpRect = viewportEl.getBoundingClientRect();
    const currentOffset = curPage * (pageW + GAP);
    const delta = vpRect.right - rect.right + currentOffset;
    return Math.max(0, Math.min(pageCount - 1, Math.floor((delta + 4) / (pageW + GAP))));
  }

  function renderTocPane() {
    const pane = $('#pane-toc');
    if (!tocItems.length) {
      pane.innerHTML = '<div class="drawer-empty">لا يحتوي هذا الكتاب على فهرس<br>💡 في الكتب النصية ابدأ سطر العنوان بعلامة #</div>';
      return;
    }
    // جمّع في فصول: كل عنوان رئيسي يبدأ فصلاً، والعناوين الفرعية تحته قابلة للطيّ
    const groups = [];
    tocItems.forEach((t, i) => {
      if (t.lvl === 1 || !groups.length) groups.push({ head: t, headIdx: i, children: [] });
      else groups[groups.length - 1].children.push({ t, i });
    });
    const anySub = groups.some((g) => g.children.length);
    const jumpAttr = (i) => `data-i="${i}"`;
    const row = (t, i, sub) => `<button class="toc-item ${sub ? 'lvl2' : ''}" ${jumpAttr(i)}>
        <span>${esc(t.label)}</span>${t.page ? `<small>ص ${t.page}</small>` : ''}</button>`;
    pane.innerHTML = groups.map((g, gi) => {
      const chev = g.children.length ? `<i class="toc-chev" data-g="${gi}">▾</i>` : (anySub ? '<i class="toc-chev empty"></i>' : '');
      const head = `<div class="toc-head">${chev}${row(g.head, g.headIdx, g.head.lvl === 2)}</div>`;
      const kids = g.children.length ? `<div class="toc-children" data-gc="${gi}">${g.children.map((c) => row(c.t, c.i, true)).join('')}</div>` : '';
      return `<div class="toc-group">${head}${kids}</div>`;
    }).join('');

    pane.querySelectorAll('.toc-item').forEach((btn) => {
      btn.onclick = () => {
        const t = tocItems[+btn.dataset.i];
        if (isPdf) { if (t.page) jumpTo(t.page); }
        else if (settings.flip === 'scroll') t.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else jumpTo(elementPage(t.el));
        closeDrawers();
      };
    });
    pane.querySelectorAll('.toc-chev[data-g]').forEach((ch) => {
      ch.onclick = (e) => {
        e.stopPropagation();
        const kids = pane.querySelector(`.toc-children[data-gc="${ch.dataset.g}"]`);
        if (kids) { kids.classList.toggle('collapsed'); ch.classList.toggle('collapsed'); }
      };
    });
  }

  function highlightCurrentToc() {
    if (isPdf || !tocItems.length || settings.flip === 'scroll') return;
    let curIdx = -1;
    tocItems.forEach((t, i) => { if (t.el && elementPage(t.el) <= curPage) curIdx = i; });
    document.querySelectorAll('#pane-toc .toc-item').forEach((b) => b.classList.toggle('current', +b.dataset.i === curIdx));
  }

  function renderDrawerPanes() {
    renderNotesPane();
    renderMarksPane();
    updateReadStat();
  }

  function renderNotesPane() {
    const pane = $('#pane-notes');
    let html = '';
    if (isPdf) html += `<button class="btn-ghost" style="width:100%;margin-bottom:14px" id="btn-add-pagenote">＋ أضف ملاحظة على الصفحة الحالية</button>`;
    const hls = (state.highlights || []).slice().sort((a, b) => a.start - b.start);
    const phls = (state.pdfHighlights || []).slice().sort((a, b) => a.page - b.page || a.at - b.at);
    const pns = (state.pageNotes || []).slice().sort((a, b) => a.page - b.page);
    if (!hls.length && !phls.length && !pns.length) {
      html += `<div class="drawer-empty">${isPdf ? 'ظلّل نصاً في الصفحة<br>لإضافة تظليل أو ملاحظة ✨' : 'ظلّل أي نص أثناء القراءة<br>لإضافة تظليل أو ملاحظة ✨'}</div>`;
    }
    html += hls.map((h) => `
      <div class="note-item" data-hid="${h.id}" style="--c:${h.color}">
        <q>${esc(h.text.trim())}</q>
        ${h.note ? `<div class="n-note">📝 ${esc(h.note)}</div>` : ''}
        <div class="n-meta"><span>${new Date(h.at).toLocaleDateString('ar')}</span><button class="n-del" data-del-h="${h.id}">حذف</button></div>
      </div>`).join('');
    html += phls.map((h) => `
      <div class="note-item" data-phid="${h.id}" data-page="${h.page}" style="--c:${h.color}">
        <q>${esc(h.text.trim())}</q>
        ${h.note ? `<div class="n-note">📝 ${esc(h.note)}</div>` : ''}
        <div class="n-meta"><span>صفحة ${h.page}</span><button class="n-del" data-del-ph="${h.id}">حذف</button></div>
      </div>`).join('');
    html += pns.map((n) => `
      <div class="note-item" data-pn="${n.page}" style="--c:#74c0fc">
        <div class="n-note">📝 ${esc(n.note)}</div>
        <div class="n-meta"><span>صفحة ${n.page + 1}</span><button class="n-del" data-del-n="${n.id}">حذف</button></div>
      </div>`).join('');
    pane.innerHTML = html;

    const addBtn = pane.querySelector('#btn-add-pagenote');
    if (addBtn) addBtn.onclick = openPdfNoteModal;
    pane.querySelectorAll('[data-del-h]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        markDeleted('highlights', b.dataset.delH);
        state.highlights = state.highlights.filter((h) => h.id !== b.dataset.delH);
        rebuildText(); renderDrawerPanes(); schedulePersist();
      };
    });
    pane.querySelectorAll('[data-del-n]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        markDeleted('pageNotes', b.dataset.delN);
        state.pageNotes = state.pageNotes.filter((n) => n.id !== b.dataset.delN);
        renderDrawerPanes(); schedulePersist();
      };
    });
    pane.querySelectorAll('[data-del-ph]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        markDeleted('pdfHighlights', b.dataset.delPh);
        state.pdfHighlights = state.pdfHighlights.filter((h) => h.id !== b.dataset.delPh);
        refreshPdfHighlights(); renderDrawerPanes(); schedulePersist();
      };
    });
    pane.querySelectorAll('.note-item[data-hid]').forEach((item) => {
      item.onclick = () => { jumpToHighlight(item.dataset.hid); closeDrawers(); };
    });
    pane.querySelectorAll('.note-item[data-phid]').forEach((item) => {
      item.onclick = () => { jumpTo(+item.dataset.page); closeDrawers(); };
    });
    pane.querySelectorAll('.note-item[data-pn]').forEach((item) => {
      if (item.dataset.hid) return;
      item.onclick = () => { jumpTo(+item.dataset.pn + 1); closeDrawers(); };
    });
  }

  function jumpToHighlight(hid) {
    const mark = contentEl.querySelector(`mark[data-id="${hid}"]`);
    if (!mark) return;
    if (settings.flip === 'scroll') mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else jumpTo(elementPage(mark));
    mark.classList.add('flash');
    setTimeout(() => mark.classList.remove('flash'), 1300);
  }

  function renderMarksPane() {
    const pane = $('#pane-marks');
    const marks = (state.bookmarks || []).slice().sort((a, b) => a.pct - b.pct);
    if (!marks.length) {
      pane.innerHTML = '<div class="drawer-empty">اضغط 🔖 أو الشريط الأحمر أعلى الصفحة<br>لحفظ علامة مرجعية</div>';
      return;
    }
    pane.innerHTML = marks.map((m) => `
      <button class="mark-item" data-id="${m.id}">
        <span class="mk-flag">🔖</span>
        <span>${esc(m.label)}</span>
        <small>${new Date(m.at).toLocaleDateString('ar')}</small>
        <span class="n-del" data-del="${m.id}">✕</span>
      </button>`).join('');
    pane.querySelectorAll('.mark-item').forEach((btn) => {
      btn.onclick = (e) => {
        if (e.target.dataset.del) {
          markDeleted('bookmarks', e.target.dataset.del);
          state.bookmarks = state.bookmarks.filter((m) => m.id !== e.target.dataset.del);
          renderMarksPane(); updateRibbon(); schedulePersist();
          return;
        }
        const m = marks.find((x) => x.id === btn.dataset.id);
        if (isPdf) jumpTo(m.page);
        else if (settings.flip === 'scroll') viewportEl.scrollTop = m.pct * (viewportEl.scrollHeight - viewportEl.clientHeight);
        else jumpTo(Math.round(m.pct * (pageCount - 1)));
        closeDrawers();
      };
    });
  }

  function updateReadStat() {
    $('#read-stat').innerHTML = `⏱ زمن القراءة: ${Library.fmtDuration(state.seconds || 0)}`;
  }

  /* ═══════ البحث داخل الكتاب ═══════ */
  function wireSearch() {
    $('#r-btn-search').onclick = () => {
      const s = $('#r-search');
      s.hidden = !s.hidden;
      if (!s.hidden) setTimeout(() => $('#r-search-input').focus(), 60);
    };
    $('#r-search-close').onclick = () => ($('#r-search').hidden = true);
    let t;
    $('#r-search-input').oninput = (e) => { clearTimeout(t); t = setTimeout(() => doSearch(e.target.value), 250); };
  }

  function doSearch(q) {
    const res = $('#r-search-results');
    const count = $('#r-search-count');
    q = q.trim();
    if (q.length < 2) { res.innerHTML = ''; count.textContent = ''; return; }
    const hay = contentEl.textContent;
    const matches = [];
    // يتجاهل التشكيل واختلاف الهمزات والتاء المربوطة والألف المقصورة
    let m = null, from = 0;
    while (matches.length < 80 && (m = ArSearch.find(hay, q, from))) {
      matches.push(m);
      from = m.index + m.length;
    }
    count.textContent = matches.length ? matches.length + ' نتيجة' : 'لا نتائج';
    res.innerHTML = matches.map((mm) => {
      const off = mm.index, len = mm.length;
      const a = Math.max(0, off - 40), b = Math.min(hay.length, off + len + 40);
      const before = esc(hay.slice(a, off)), hit = esc(hay.slice(off, off + len)), after = esc(hay.slice(off + len, b));
      return `<button data-off="${off}" data-len="${len}">…${before}<b>${hit}</b>${after}…</button>`;
    }).join('');
    res.querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => { jumpToOffset(+btn.dataset.off); $('#r-search').hidden = true; };
    });
  }

  function jumpToOffset(off) {
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
    let pos = 0, node;
    while ((node = walker.nextNode())) {
      if (pos + node.data.length > off) {
        const rng = document.createRange();
        rng.setStart(node, off - pos);
        rng.setEnd(node, Math.min(off - pos + 1, node.data.length));
        if (settings.flip === 'scroll') {
          const el = node.parentElement;
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          const rect = rng.getBoundingClientRect();
          const vpRect = viewportEl.getBoundingClientRect();
          const delta = vpRect.right - rect.right + curPage * (pageW + GAP);
          jumpTo(Math.max(0, Math.floor((delta + 4) / (pageW + GAP))));
        }
        return;
      }
      pos += node.data.length;
    }
  }

  // قفزة إلى أول ظهور لعبارة (من البحث الشامل)
  function jumpToPhrase(phrase) {
    const hay = contentEl.textContent;
    let off = hay.indexOf(phrase);
    if (off < 0) { // جرّب أول بضع كلمات إن لم تتطابق العبارة كاملة
      const words = phrase.split(' ').slice(0, 4).join(' ');
      off = hay.indexOf(words);
    }
    if (off < 0) { setPage(0, false); return; }
    jumpToOffset(off);
  }

  /* ═══════ الحفظ والمؤقتات ═══════ */
  function schedulePersist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(), 700);
  }
  async function persist(final = false) {
    if (!state) return;
    if (!isPdf && settings.flip === 'scroll') {
      const max = viewportEl.scrollHeight - viewportEl.clientHeight;
      state.pct = max > 0 ? viewportEl.scrollTop / max : 1;
      state.scrollTop = viewportEl.scrollTop;
    }
    await Store.saveState(state);
    if (window.Cloud) Cloud.pushState(book.id);
  }

  function bump() {
    lastActivity = Date.now();
    if (isOpen && !wakeLock && !(wakeVideo && !wakeVideo.paused)) syncWakeLock();
    else if (isOpen && wakeApiFailed && 'wakeLock' in navigator && !wakeLock) { wakeApiFailed = ''; syncWakeLock(); } // لمسة حديثة: جرّب القياسي ثانيةً
  }

  /* ═══════ إبقاء الشاشة مضاءة أثناء القراءة (Screen Wake Lock) ═══════
     القراءة لا تلمس الشاشة كثيراً فيطفئها الجهاز. نطلب قفل الشاشة ما دام الكتاب مفتوحاً،
     ونعيد طلبه عند العودة للتطبيق (المتصفح يلغيه عند الخروج منه)، ونتركه بعد خمول طويل
     كي لا يستنزف البطارية كتابٌ نُسي مفتوحاً — إلا أثناء القراءة الصوتية أو التلقائية. */
  const AWAKE_IDLE_MS = 15 * 60 * 1000;
  let wakeLock = null, wakeReq = null, wakeTimer = null;
  const wakeWanted = () => isOpen && settings && settings.keepAwake !== false && !document.hidden
    && (ttsOn || autoOn || Date.now() - lastActivity < AWAKE_IDLE_MS);
  /* بديل حيث لا تعمل واجهة القفل: فيديو صامت صغير جداً يُشغَّل مكرّراً (طريقة NoSleep.js).
     الجهاز لا يطفئ الشاشة أثناء تشغيل فيديو. نلجأ إليه حين:
     • لا يدعم المتصفح الواجهة (متصفحات واتساب/تيليجرام/فيسبوك الداخلية، نسخ قديمة)؛
     • يرفض النظام الطلب؛
     • آيفون مثبّتاً على الشاشة الرئيسية: قبل iOS 18.4 يُمنح القفل فيه ولا يعمل فعلاً. */
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const iosStandalone = isIOS && (navigator.standalone === true || matchMedia('(display-mode: standalone)').matches);
  let wakeVideo = null, wakeApiFailed = '', wakeStatus = 'off';
  function wakeVideoEl() {
    if (wakeVideo) return wakeVideo;
    const v = document.createElement('video');
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('muted', '');
    v.muted = true; v.loop = true; v.preload = 'auto'; v.setAttribute('aria-hidden', 'true'); v.tabIndex = -1;
    // مرئي بحجم بكسل واحد تقريباً: بعض المتصفحات لا تشغّل الفيديو المخفي تماماً
    v.style.cssText = 'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:.01;pointer-events:none;z-index:-1';
    for (const [src, type] of [['vendor/awake.mp4', 'video/mp4'], ['vendor/awake.webm', 'video/webm']]) {
      const s = document.createElement('source'); s.src = src; s.type = type; v.appendChild(s);
    }
    document.body.appendChild(v);
    wakeVideo = v;
    return v;
  }
  const needVideo = () => !('wakeLock' in navigator) || !!wakeApiFailed || iosStandalone;
  async function playWakeVideo() {
    const v = wakeVideoEl();
    if (!v.paused) return true;
    try { await v.play(); return true; } catch { return false; } // قد يحتاج لمسة: نعيد المحاولة مع اللمسة التالية
  }
  function setWakeStatus() {
    const api = !!wakeLock, vid = !!(wakeVideo && !wakeVideo.paused);
    wakeStatus = !wakeWanted() ? (settings && settings.keepAwake === false ? 'off' : 'idle') : (api || vid) ? (api ? 'api' : 'video') : 'failed';
    const el = $('#awake-status');
    if (el) el.textContent = {
      off: 'الشاشة تتبع إعداد الجهاز.',
      idle: 'متوقّف الآن (لا كتاب مفتوح أو خمول طويل).',
      api: '✓ تعمل — الشاشة لن تنطفئ أثناء القراءة.',
      video: !('wakeLock' in navigator) ? '✓ تعمل بطريقة بديلة (متصفحك لا يدعم الطريقة المعتادة).'
        : wakeApiFailed ? '✓ تعمل بطريقة بديلة (رفض النظام الطريقة المعتادة).' : '✓ تعمل — الشاشة لن تنطفئ أثناء القراءة.',
      failed: '⚠ لم يسمح الجهاز بإبقاء الشاشة مضاءة' + (wakeApiFailed ? ` (${wakeApiFailed})` : '') + ' — المس الصفحة مرة، وأوقف «توفير الطاقة» إن كان مفعّلاً.',
    }[wakeStatus];
  }
  async function syncWakeLock() {
    if (wakeWanted()) {
      // ١) الواجهة القياسية — طلبٌ واحد فقط في كل مرة: لمسة واحدة تطلق حدثَي نشاط، ولولا هذا
      //    لاجتمع قفلان ويبقى أحدهما معلّقاً بعد إغلاق الكتاب فلا تنطفئ الشاشة
      if ('wakeLock' in navigator && !wakeLock && !wakeReq) {
        wakeReq = navigator.wakeLock.request('screen');
        try {
          const l = await wakeReq;
          wakeLock = l; wakeApiFailed = '';
          l.addEventListener('release', () => { if (wakeLock === l) { wakeLock = null; setWakeStatus(); } });
          if (!wakeWanted()) return syncWakeLock(); // تغيّر الحال أثناء الطلب (أُغلق الكتاب مثلاً) ⇒ اتركه
        } catch (e) {
          wakeLock = null;
          // يُرفض أحياناً بلا لمسة حديثة أو مع توفير الطاقة ⇒ البديل الآن، وإعادة المحاولة مع اللمسة التالية
          wakeApiFailed = (e && e.name === 'NotAllowedError') ? 'رفضه النظام' : ((e && e.message) || 'خطأ').slice(0, 60);
        } finally { wakeReq = null; }
      }
      // ٢) البديل (فيديو صامت) حيث لا يكفي القفل
      if (needVideo()) await playWakeVideo();
      else if (wakeVideo && !wakeVideo.paused) wakeVideo.pause();
    } else {
      if (wakeLock) { const l = wakeLock; wakeLock = null; try { await l.release(); } catch {} }
      if (wakeVideo && !wakeVideo.paused) wakeVideo.pause();
    }
    setWakeStatus();
  }
  function startWakeLock() {
    syncWakeLock();
    clearInterval(wakeTimer);
    wakeTimer = setInterval(syncWakeLock, 60 * 1000); // يتحقق من الخمول كل دقيقة
  }
  function stopWakeLock() {
    clearInterval(wakeTimer); wakeTimer = null;
    syncWakeLock(); // isOpen صار false ⇒ يُترك القفل (وأيّ طلب جارٍ يُترك عند اكتماله)
  }

  function startTimers() {
    bump();
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (!isOpen || document.hidden) return;
      if (Date.now() - lastActivity < 90000) {
        state.seconds = (state.seconds || 0) + 5;
        Store.logAddSeconds(5); // سجلّ القراءة اليومي (سلسلة الأيام والهدف)
        if (window.Cloud && Cloud.pushStats) Cloud.pushStats(); // يُرفع مجمَّعاً كل دقيقة
        if (state.seconds % 30 === 0) { schedulePersist(); updateReadStat(); }
      }
    }, 5000);
    resetUiTimer();
  }

  /* أدوات القراءة (أسلوب Apple Books وPlay Books):
     • لمس منتصف الصفحة يُظهرها/يخفيها — في كل الأوضاع، النص والـPDF، المقلَّب والمتصل.
     • تقليب الصفحة باللمس أو السحب، أو التمرير للأمام، يخفيها (القراءة أولاً).
     • التمرير للخلف قليلاً يعيدها (كما في متصفحات الجوال)، وكذلك بلوغ أول الكتاب أو آخره.
     • باللمس: تبقى ظاهرة حتى يخفيها القارئ (لا مؤقّت يسحبها من تحت إصبعه).
       بالفأرة: تظهر بالحركة وتختفي بعد سكون قصير. */
  let lastPointerType = 'mouse';
  function showUI(sticky) {
    $('#reader').classList.remove('ui-hidden');
    if (sticky || lastPointerType !== 'mouse') clearTimeout(uiTimer);
    else resetUiTimer();
  }
  function hideUI() {
    if (!isOpen) return;
    const busy = document.querySelector('.r-drawer.open') || !$('#r-search').hidden || !$('#hl-popup').hidden || drawMode;
    if (busy) return;
    clearTimeout(uiTimer);
    $('#reader').classList.add('ui-hidden');
  }
  function toggleUI() { if ($('#reader').classList.contains('ui-hidden')) showUI(); else hideUI(); }
  // التمرير: للأمام يخفي، وللخلف (~٥٠ بكسل متتالية) يُظهر؛ الحافّتان تُظهران
  let scrollLastTop = 0, scrollUpAcc = 0;
  function onReadScroll(el) {
    if (!isOpen) return;
    lastActivity = Date.now(); // القراءة بالتمرير نشاطٌ يُبقي الشاشة مضاءة
    if (Date.now() - (onReadScroll.tc || 0) > 800) { onReadScroll.tc = Date.now(); trackChapter(); }
    if (autoOn) return;
    const top = el.scrollTop, d = top - scrollLastTop;
    scrollLastTop = top;
    if (Math.abs(d) < 2) return;
    const atEdge = top < 24 || top + el.clientHeight >= el.scrollHeight - 24;
    if (atEdge) { scrollUpAcc = 0; showUI(true); return; }
    if (d > 0) { scrollUpAcc = 0; if (top > 60 && !$('#reader').classList.contains('ui-hidden')) hideUI(); }
    else { scrollUpAcc -= d; if (scrollUpAcc > 50) { scrollUpAcc = 0; showUI(true); } }
  }
  function resetUiTimer() {
    clearTimeout(uiTimer);
    uiTimer = setTimeout(() => {
      const drawersOpen = document.querySelector('.r-drawer.open') || !$('#r-search').hidden || !$('#hl-popup').hidden || drawMode;
      if (isOpen && !drawersOpen) $('#reader').classList.add('ui-hidden');
    }, 3200);
  }

  /* ═══════ الأدراج ═══════ */
  function toggleDrawer(id) {
    const d = $(id);
    const was = d.classList.contains('open');
    closeDrawers();
    if (!was) {
      d.classList.add('open');
      $('#reader').classList.add('drawer-open');
      // درج الإعدادات: خلفية شفّافة كي تُعايِن تأثير الألوان والخطوط على الكتاب مباشرةً
      $('#reader').classList.toggle('settings-open', id === '#settings-drawer');
      if (id === '#settings-drawer') setWakeStatus();
      showUI();
    }
  }
  function closeDrawers() {
    document.querySelectorAll('.r-drawer').forEach((d) => d.classList.remove('open'));
    $('#reader').classList.remove('drawer-open', 'settings-open');
  }

  /* ═══════ ربط الأحداث ═══════ */
  function wire() {
    contentEl = $('#r-content');
    viewportEl = $('#r-viewport');
    $('#r-back').onclick = () => close();
    window.addEventListener('popstate', () => {
      if (!isOpen) return;
      // الرجوع يغلق أولاً ما فوق الصفحة (درج/بحث/مساعد/تحديد)، ثم الكتاب نفسه
      const layer = document.querySelector('.r-drawer.open') || !$('#r-search').hidden || ($('#ai-modal') && !$('#ai-modal').hidden) || !$('#hl-popup').hidden || !$('#define-bubble').hidden;
      if (layer) {
        closeDrawers(); $('#r-search').hidden = true; hideHlPopup(); hideDefineBubble();
        if ($('#ai-modal')) { $('#ai-modal').hidden = true; const ab = $('#r-btn-ai'); if (ab) ab.classList.remove('on'); }
        try { history.pushState({ midadReader: true }, ''); } catch {}
        return;
      }
      close(true);
    });
    $('#r-next').onclick = () => { next(); bump(); };
    $('#r-prev').onclick = () => { prev(); bump(); };
    $('#r-btn-settings').onclick = () => toggleDrawer('#settings-drawer');
    $('#r-btn-toc').onclick = () => toggleDrawer('#toc-drawer');
    // إغلاق الأدراج: لمس الخلفية أو زر ✕
    { const bd = $('#r-drawer-backdrop'); if (bd) bd.onclick = closeDrawers; }
    document.querySelectorAll('[data-close-drawer]').forEach((b) => (b.onclick = closeDrawers));
    $('#r-btn-bookmark').onclick = toggleBookmark;
    $('#r-ribbon').onclick = toggleBookmark;
    $('#r-btn-full').onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen().catch(() => {});
    };
    wireSearch();
    wireDraw();
    $('#r-btn-tts').onclick = ttsToggle;
    $('#zoom-in').onclick = () => setZoom(pdfZoom + 0.2);
    $('#zoom-out').onclick = () => setZoom(pdfZoom - 0.2);
    if ('speechSynthesis' in window) speechSynthesis.getVoices(); // تحميل الأصوات مبكراً

    // الانتقال إلى صفحة برقمها (نقرة على عدّاد الصفحات)
    $('#r-page-label').onclick = () => {
      if ((!isPdf && settings.flip === 'scroll') || $('#goto-input')) return;
      const label = $('#r-page-label');
      label.innerHTML = `<input id="goto-input" type="number" min="1" max="${pageCount}" placeholder="رقم الصفحة">`;
      const inp = $('#goto-input');
      inp.focus();
      const done = (go) => {
        const v = parseInt(inp.value);
        label.textContent = '';
        if (go && v >= 1 && v <= pageCount) jumpTo(isPdf ? v : v - 1);
        updateHUD();
      };
      inp.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') done(true);
        else if (e.key === 'Escape') done(false);
      };
      inp.onblur = () => setTimeout(() => { if ($('#goto-input')) done(false); }, 100);
    };

    // حفظ فوري عند إخفاء الصفحة أو إغلاقها (حماية البيانات)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && isOpen) { persist(); syncWakeLock(); } // خرج من التطبيق ⇒ أوقف الفيديو البديل فوراً (لا يستهلك البطارية في الخلفية)
      if (!document.hidden && isOpen) { bump(); syncWakeLock(); } // المتصفح ألغى القفل عند الخروج
    });
    window.addEventListener('pagehide', () => { if (isOpen) persist(); });

    $('#drawer-tabs').querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => {
        $('#drawer-tabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === btn));
        ['toc', 'notes', 'marks'].forEach((p) => ($('#pane-' + p).hidden = btn.dataset.pane !== p));
      };
    });
    $('#btn-export-notes').onclick = async () => {
      await persist();
      // إعادة استخدام مُصدِّر المكتبة
      const evt = book.id;
      const st = await Store.getState(evt);
      if (!(st.highlights || []).length && !(st.pageNotes || []).length) return Library.toast('لا ملاحظات بعد');
      let out = `ملاحظاتي على «${book.title}»${book.author ? ' — ' + book.author : ''}\n${'─'.repeat(40)}\n\n`;
      for (const h of st.highlights || []) out += `«${h.text.trim()}»\n${h.note ? '📝 ' + h.note + '\n' : ''}\n`;
      for (const n of st.pageNotes || []) out += `[صفحة ${n.page + 1}] 📝 ${n.note}\n\n`;
      const blob = new Blob(['﻿' + out], { type: 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ملاحظات - ${book.title}.txt`;
      a.click(); URL.revokeObjectURL(a.href);
      Library.toast('صُدّرت الملاحظات 📄', 'gold');
    };

    // شريط التقدم
    $('#r-slider').oninput = (e) => {
      const pct = +e.target.value / 100;
      if (isPdf) jumpTo(Math.round(pct * (pageCount - 1)) + 1);
      else if (settings.flip === 'scroll') {
        viewportEl.scrollTop = pct * (viewportEl.scrollHeight - viewportEl.clientHeight);
      } else jumpTo(Math.round(pct * (pageCount - 1)));
      bump();
    };

    // التمرير المتصل: تحديث التقدم
    viewportEl.addEventListener('scroll', () => {
      if (settings.flip !== 'scroll' || isPdf) return;
      const max = viewportEl.scrollHeight - viewportEl.clientHeight;
      state.pct = max > 0 ? viewportEl.scrollTop / max : 1;
      if (settings.focusMode) updateFocusLine();
      afterNavigate();
    }, { passive: true });

    // لوحة المفاتيح
    document.addEventListener('keydown', (e) => {
      if (!isOpen) return;
      if (e.target.matches('input, textarea')) {
        if (e.key === 'Escape') { $('#r-search').hidden = true; e.target.blur(); }
        return;
      }
      bump(); lastPointerType = 'mouse'; showUI();
      switch (e.key) {
        case 'ArrowLeft': case 'PageDown': case ' ': e.preventDefault(); next(); break;
        case 'ArrowRight': case 'PageUp': e.preventDefault(); prev(); break;
        case 'Home': jumpTo(isPdf ? 1 : 0); break;
        case 'End': jumpTo(isPdf ? pageCount : pageCount - 1); break;
        case 'b': case 'B': toggleBookmark(); break;
        case '+': case '=': if (isPdf) setZoom(pdfZoom + 0.2); break;
        case '-': if (isPdf) setZoom(pdfZoom - 0.2); break;
        case 'Escape':
          if ($('#ai-modal') && !$('#ai-modal').hidden) { $('#ai-modal').hidden = true; const ab = $('#r-btn-ai'); if (ab) ab.classList.remove('on'); }
          else if (!$('#hl-popup').hidden) hideHlPopup();
          else if (ttsOn) ttsStop();
          else if (drawMode) setDrawMode(false);
          else if (!$('#r-search').hidden) $('#r-search').hidden = true;
          else if (document.querySelector('.r-drawer.open')) closeDrawers();
          else if (!$('#note-modal').hidden) $('#note-modal').hidden = true;
          else close();
          break;
      }
    });

    // إظهار الواجهة بحركة الفأرة فقط (حركة الإصبع سحبٌ للقراءة، لا طلبٌ للأدوات)
    $('#reader').addEventListener('pointerdown', (e) => { lastPointerType = e.pointerType || 'mouse'; if (isOpen) bump(); }, { passive: true, capture: true });
    $('#reader').addEventListener('pointermove', (e) => { if (isOpen && e.pointerType === 'mouse') { lastPointerType = 'mouse'; showUI(); } }, { passive: true });
    viewportEl.addEventListener('scroll', () => { if (settings.flip === 'scroll' && !isPdf) onReadScroll(viewportEl); }, { passive: true });
    $('#r-pdf-scroll').addEventListener('scroll', (e) => onReadScroll(e.currentTarget), { passive: true });

    // نقر مزدوج على كلمة (في النص أو طبقة نص الـPDF) ⇒ معناها مباشرة
    $('#r-stage').addEventListener('dblclick', (e) => {
      if (!isOpen || drawMode || settings.dblDefine === false) return;
      if (e.target.closest && e.target.closest('button, .r-nav, .r-ribbon, #r-draw')) return;
      setTimeout(() => {
        const sel = getSelection();
        const t = sel ? String(sel) : '';
        if (!isSingleWord(t)) return;
        const rect = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : null;
        hideHlPopup();
        defineWord(t, rect);
      }, 30);
    });

    // مناطق النقر على الورقة + التحديد + السحب بالفأرة للتقليب
    let downX = null, downY = null;
    $('#r-stage').addEventListener('pointerdown', (e) => {
      if (drawMode && e.target.id === 'r-draw') { downX = null; return; }
      downX = e.clientX; downY = e.clientY;
    });
    $('#r-stage').addEventListener('pointerup', (e) => {
      if (!isOpen) return;
      bump();
      // أي لمسة توقف القراءة التلقائية
      if (autoOn) { stopAuto(); showUI(); downX = null; return; }
      const dx = downX != null ? e.clientX - downX : 0;
      const dy = downY != null ? e.clientY - downY : 0;
      downX = null; downY = null;
      setTimeout(() => {
        const sel = getSelection();
        if (sel && !sel.isCollapsed) { if (isPdf) onPdfSelection(); else onTextSelection(); return; }
        if (!$('#hl-popup').hidden) { hideHlPopup(); return; }
        // نقر على تظليل نصي موجود
        const mark = e.target.closest && e.target.closest('mark.hl');
        if (mark) {
          pendingMarkId = mark.dataset.id;
          pendingSel = null;
          showHlPopup(mark.getBoundingClientRect(), true);
          return;
        }
        // نقر على تظليل PDF موجود (طبقة النص فوقه، فنختبر النقطة)
        if (isPdf) {
          const under = document.elementsFromPoint(e.clientX, e.clientY);
          const phl = under.find((el) => el.classList && el.classList.contains('pdf-hl'));
          if (phl) {
            pendingPdfMark = phl.dataset.id;
            pendingSel = null; pendingMarkId = null; pendingPdfSel = null;
            showHlPopup(phl.getBoundingClientRect(), true);
            return;
          }
        }
        if (e.target.closest('.r-nav, .r-ribbon, button, #r-draw, .tts-caption, #zoom-pill')) return;
        // صفحات الـPDF المتصلة تُعدّ تمريراً حتى لو اختير «تقليب» (تكبير/وضع متصل)
        const paged = settings.flip !== 'scroll' && !e.target.closest('#r-pdf-scroll');
        // سحب أفقي = تقليب (سحب لليمين يقدّم الصفحة كما في الكتاب العربي)
        if (paged && Math.abs(dx) > 60) { if (dx > 0) next(); else prev(); hideUI(); return; }
        if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return; // سحب أو تمرير — ليس لمسة
        // التمرير المتصل: أي لمسة على الصفحة تُظهر الأدوات أو تخفيها
        if (!paged) { toggleUI(); return; }
        // المقلَّب: الحافّتان تقلّبان (والأدوات تختفي)، والمنتصف يُظهرها/يخفيها
        const stage = $('#r-stage').getBoundingClientRect();
        const x = (e.clientX - stage.left) / stage.width;
        if (x < 0.22) { next(); hideUI(); }
        else if (x > 0.78) { prev(); hideUI(); }
        else toggleUI();
      }, 10);
    });

    // منبثقة التظليل
    $('#hl-popup').querySelectorAll('.hl-colors button').forEach((b) => {
      b.onclick = () => {
        if (pendingMarkId) {
          const h = state.highlights.find((x) => x.id === pendingMarkId);
          if (h) { h.color = b.dataset.color; touchItem(h); rebuildText(); renderDrawerPanes(); schedulePersist(); }
          hideHlPopup();
        } else if (pendingPdfMark) {
          const h = state.pdfHighlights.find((x) => x.id === pendingPdfMark);
          if (h) { h.color = b.dataset.color; touchItem(h); refreshPdfHighlights(); renderDrawerPanes(); schedulePersist(); }
          pendingPdfMark = null; hideHlPopup();
        } else if (pendingPdfSel) addPdfHighlight(b.dataset.color, false);
        else addHighlight(b.dataset.color, false);
      };
    });
    $('#hl-note-btn').onclick = () => {
      if (pendingMarkId) {
        const h = state.highlights.find((x) => x.id === pendingMarkId);
        hideHlPopup();
        if (h) openNoteModal(h);
      } else if (pendingPdfMark) {
        const h = state.pdfHighlights.find((x) => x.id === pendingPdfMark);
        pendingPdfMark = null; hideHlPopup();
        if (h) openNoteModal(h);
      } else if (pendingPdfSel) addPdfHighlight('#f6d743', true);
      else addHighlight('#f6d743', true);
    };
    $('#hl-del-btn').onclick = () => {
      if (pendingMarkId) {
        markDeleted('highlights', pendingMarkId);
        state.highlights = state.highlights.filter((h) => h.id !== pendingMarkId);
        hideHlPopup(); rebuildText(); renderDrawerPanes(); schedulePersist();
      } else if (pendingPdfMark) {
        markDeleted('pdfHighlights', pendingPdfMark);
        state.pdfHighlights = state.pdfHighlights.filter((h) => h.id !== pendingPdfMark);
        pendingPdfMark = null; hideHlPopup(); refreshPdfHighlights(); renderDrawerPanes(); schedulePersist();
      }
    };
    // مساعد الذكاء (محمي: لا يتعطّل إن كانت عناصر الـHTML غير متطابقة مع النسخة)
    if ($('#r-btn-ai') && $('#ai-modal')) {
      // نص التحديد الحالي (نصي أو PDF)
      const selText = () => {
        if (pendingSel) return pendingSel.text;
        if (pendingPdfSel) return pendingPdfSel.text;
        if (pendingMarkId) { const h = state.highlights.find((x) => x.id === pendingMarkId); return h ? h.text : ''; }
        if (pendingPdfMark) { const h = state.pdfHighlights.find((x) => x.id === pendingPdfMark); return h ? h.text : ''; }
        return '';
      };
      $('#hl-explain-btn').onclick = () => {
        const txt = selText();
        hideHlPopup(); pendingPdfMark = null;
        if (txt) { openAI(); runAI('explain', { selection: txt }); }
      };
      { const ib = $('#hl-irab-btn'); if (ib) ib.onclick = () => {
        const txt = selText();
        hideHlPopup(); pendingPdfMark = null;
        if (txt) openIrab(txt);
      }; }
      $('#hl-share-btn').onclick = () => {
        const txt = selText();
        const pg = pendingPdfSel ? pendingPdfSel.page : (pendingPdfMark ? ((state.pdfHighlights.find((x) => x.id === pendingPdfMark) || {}).page) : '');
        hideHlPopup(); pendingPdfMark = null;
        if (txt) shareQuote(txt, pg);
      };
      const selRect = () => { const s = getSelection(); return (s && s.rangeCount && !s.isCollapsed) ? s.getRangeAt(0).getBoundingClientRect() : null; };
      $('#hl-define-btn').onclick = () => {
        const txt = selText(), rect = selRect();
        hideHlPopup(); pendingPdfMark = null;
        if (txt) defineWord(txt.trim(), rect);
      };
      { const tb = $('#hl-translate-btn'); if (tb) tb.onclick = () => {
        const txt = selText(), rect = selRect();
        hideHlPopup(); pendingPdfMark = null;
        if (txt) translateSel(txt.trim(), rect);
      }; }
      $('#db-close').onclick = hideDefineBubble;
      $('#r-btn-auto').onclick = toggleAuto;
      $('#r-btn-ai').onclick = openAI;
      { const ab = $('#r-btn-ab'); if (ab) ab.onclick = openAudiobook; }
      $('#ai-modal').querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => ($('#ai-modal').hidden = true)));
      $('#ai-modal').onclick = (e) => { if (e.target.id === 'ai-modal') $('#ai-modal').hidden = true; };
      $('#ai-quick').querySelectorAll('[data-ai]').forEach((b) => (b.onclick = () => runAI(b.dataset.ai)));
      $('#ai-send').onclick = () => runAI('ask');
      $('#ai-input').onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') runAI('ask'); };
    }

    // نافذة الملاحظة
    $('#note-modal').querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => ($('#note-modal').hidden = true)));
    $('#note-modal').onclick = (e) => { if (e.target.id === 'note-modal') $('#note-modal').hidden = true; };

    // تغيير الحجم
    let rzT;
    addEventListener('resize', () => {
      if (!isOpen) return;
      clearTimeout(rzT);
      rzT = setTimeout(() => {
        if (pdfScrollActive()) {
          const w = pdfSlotWidth(), anchor = pdfPage;
          for (const s of pdfSlots) { s.el.style.width = w + 'px'; s.el.style.height = Math.round(w / pdfAspect) + 'px'; clearSlot(s); }
          requestAnimationFrame(() => { pdfScrollTo(anchor, false); renderVisibleSlots(); });
        } else if (isPdf) {
          if (pageFlip && !pdfFlipBookActive()) { teardownPageFlip(); showPdfPage(pdfPage); } // خرج من الأفقي
          else if (pageFlip) { const box = $('#r-pageflip .pf-box'); if (box) { sizePfBox(box); try { pageFlip.update(); } catch {} } }
          else showPdfPage(pdfPage); // قد يبني StPageFlip إذا صار أفقياً
        }
        else { scheduleRepaginate(); }
      }, 200);
    });

    // سحب باللمس + تكبير بإصبعين (pinch)
    let touchX = null, pinch = null;
    const twoDist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const stage = $('#r-stage');

    stage.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        touchX = null; // ألغِ السحب أثناء القرص
        pinch = { d0: twoDist(e.touches), z0: pdfZoom, f0: settings.fontSize, target: pdfZoom, targetFont: settings.fontSize };
      } else if (e.touches.length === 1) {
        touchX = e.touches[0].clientX;
      }
    }, { passive: true });

    const pinchBadge = $('#pinch-badge');
    const showPinchBadge = (html) => { pinchBadge.innerHTML = html; pinchBadge.hidden = false; };

    stage.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault(); // امنع تكبير المتصفح والتمرير أثناء القرص
      const ratio = twoDist(e.touches) / pinch.d0;
      if (isPdf) {
        const target = Math.min(ZOOM_MAX, Math.max(minZoom(), pinch.z0 * ratio));
        pinch.target = target;
        // معاينة حيّة سلسة عبر تحويل CSS في كل الأوضاع، ثم رسم واضح عند رفع الإصبع
        const previewScale = (target / (pinch.z0 || 1)).toFixed(3);
        if (pdfScrollActive()) {
          const cont = $('#r-pdf-scroll');
          cont.style.transformOrigin = 'center center';
          cont.style.transform = `scale(${previewScale})`;
        } else {
          const cv = $('#r-canvas');
          cv.style.transformOrigin = 'center center';
          cv.style.transform = `scale(${previewScale})`;
          $('#reader').classList.add('zoomed');
        }
        $('#zoom-val').textContent = Math.round(target * 100) + '٪';
        $('#zoom-pill').hidden = false;
        showPinchBadge(`${Math.round(target * 100)}٪`);
      } else {
        // كتاب نصي: معاينة حيّة فورية عبر تحويل CSS بدل انتظار إعادة الترقيم
        const targetFont = Math.min(30, Math.max(14, Math.round(pinch.f0 * ratio)));
        pinch.targetFont = targetFont;
        const scale = targetFont / (pinch.f0 || targetFont);
        viewportEl.style.transformOrigin = 'center center';
        viewportEl.style.transform = `scale(${scale.toFixed(3)})`;
        showPinchBadge(`${targetFont}<small>حجم الخط</small>`);
      }
    }, { passive: false });

    stage.addEventListener('touchend', (e) => {
      // إنهاء القرص
      if (pinch && e.touches.length < 2) {
        pinchBadge.hidden = true;
        if (isPdf) {
          $('#r-canvas').style.transform = '';
          $('#r-pdf-scroll').style.transform = '';
          setZoom(pinch.target);
        } else {
          viewportEl.style.transform = ''; // أزل معاينة التحويل قبل الترقيم الحقيقي
          if (pinch.targetFont !== settings.fontSize) {
            settings.fontSize = pinch.targetFont;
            $('#set-fontsize').value = settings.fontSize;
            applySettings(); scheduleRepaginate();
          }
        }
        pinch = null; touchX = null;
        return;
      }
      if (pinch) return; // ما زال إصبع على الشاشة
      if (touchX == null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      // طبقة التقليب الواقعي (StPageFlip) تُدير سحبها بنفسها عبر wirePfDrag.
      // أحداث المؤشّر يوقفها stopPropagation، أمّا أحداث اللمس فتصل هنا مستقلّةً،
      // فتُنفّذ تنقّلاً ثانياً ⇐ انقلاب ورقتين لكل سحبة على الأجهزة اللمسية. تجاهلها.
      if (pdfFlipBookActive() && pageFlip) return;
      // لا تقليب أثناء تحديد نص للتظليل أو أثناء الكتابة أو عند التكبير
      const sel = getSelection();
      if ((sel && !sel.isCollapsed) || drawMode || (isPdf && pdfZoom > 1.01)) return;
      if (Math.abs(dx) > 60 && settings.flip !== 'scroll') {
        if (dx > 0) next(); else prev(); // سحب لليمين = التالية (RTL)
        hideUI();
      }
    }, { passive: true });

    stage.addEventListener('touchcancel', () => {
      // إلغاء القرص: أزل المعاينة والشارة دون تثبيت أي تغيير
      if (pinch) { pinchBadge.hidden = true; viewportEl.style.transform = ''; $('#r-canvas').style.transform = ''; $('#r-pdf-scroll').style.transform = ''; }
      pinch = null; touchX = null;
    }, { passive: true });
  }

  return { open, close, wire, previewHTML: buildHTML, mdToHtml, isOpen: () => isOpen };
})();
window.Reader = Reader;
