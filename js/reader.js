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

    contentEl = $('#r-content');
    viewportEl = $('#r-viewport');
    $('#r-book-title').textContent = book.title;
    $('#r-book-author').textContent = book.author || '';
    $('#reader').hidden = false;
    document.body.style.overflow = 'hidden';
    isOpen = true;

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
    reader.classList.remove('zoomed');

    buildSettingsUI();
    applySettings(false);

    if (isPdf) {
      let blob = await Store.getPayload(id);
      if (!blob && window.Cloud) { await Cloud.ensurePayload(id); blob = await Store.getPayload(id); }
      if (!blob) {
        const notUploaded = book.cloudHasFile === false;
        Library.toast(notUploaded
          ? 'ملف هذا الكتاب لم يُرفع للسحابة — افتح التطبيق على الجهاز الذي أضفته فيه وزامِن (سيُرفع تلقائياً)'
          : 'تعذّر تنزيل ملف الكتاب — تحقّق من الاتصال ثم أعد المحاولة');
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
    showUI();
  }

  async function close() {
    if (!isOpen) return;
    isOpen = false;
    await persist(true);
    clearInterval(tickTimer); clearTimeout(uiTimer); clearTimeout(saveTimer);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    $('#reader').hidden = true;
    document.body.style.overflow = '';
    closeDrawers(); hideHlPopup(); $('#r-search').hidden = true;
    { const m = $('#ai-modal'); if (m) m.hidden = true; }
    { const d = $('#define-bubble'); if (d) d.hidden = true; }
    setDrawMode(false);
    ttsStop();
    stopAuto();
    teardownPdfScroll();
    teardownPageFlip();
    $('#r-pdf-scroll').innerHTML = '';
    // إتلاف مستند PDF لتحرير الخطوط والذاكرة (يمنع تبعثر الخطوط عند إعادة الفتح)
    if (pdfDoc) { try { await pdfDoc.destroy(); } catch {} }
    pdfDoc = null; ocrFull = null; pristineHTML = ''; contentEl.innerHTML = '';
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
      state.finished = true;
      if (!celebrated) { celebrated = true; Library.toast('🎉 مبارك! أنهيت الكتاب', 'gold'); }
    }
    updateHUD();
    schedulePersist();
    bump();
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
    if (pdfScrollActive()) { pdfScrollTo(Math.max(1, Math.min(n, pageCount))); }
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
  const PF_MAX_PAGES = 1500; // سقف أمان لعدد عناصر DOM (النافذة تحلّ مشكلة الذاكرة/البطء)
  const PF_CANVAS_MAX = 220; // حتى هذا العدد نستخدم محرّك الكانفاس (ظلّ واقعي سلس)؛ فوقه نافذة DOM (بلا ظلّ)
  const PF_WINDOW = 4;       // كم صفحة تُرسَم حول الموضع في كل اتجاه
  const PF_KEEP = 9;         // أبعد من هذا المدى تُفرَّغ صورها لتحرير الذاكرة
  let pfLoaded = new Set();  // فهارس الصفحات المرسومة حالياً
  let pfWinToken = 0;        // لإلغاء تحميل نافذة قديمة عند تغيّر الموضع
  let pfWinTid = null;       // مؤقّت تأجيل رسم النافذة بعد التقليب
  let pfCanvasMode = false;  // true عند استخدام محرّك الكانفاس (كتب ≤ PF_CANVAS_MAX)
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
    pfWinToken++; pfLoaded = new Set(); clearTimeout(pfWinTid); // ألغِ أي تحميل نافذة جارٍ وحرّر التتبّع
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

  // يرسم صور نافذة حول الموضع (المركز أولاً) ويُفرّغ الصفحات البعيدة لتحرير الذاكرة
  async function ensurePfWindow(centerIdx) {
    const inner = $('#r-pageflip .pf-inner'); if (!inner) return;
    const tok = ++pfWinToken;
    // فرّغ الصور خارج مدى الإبقاء
    Array.from(pfLoaded).forEach((idx) => {
      if (idx < centerIdx - PF_KEEP || idx > centerIdx + PF_KEEP) {
        inner.querySelectorAll('img[data-idx="' + idx + '"]').forEach((im) => im.removeAttribute('src'));
        pfLoaded.delete(idx);
      }
    });
    // رتّب: المركز ثم الجوار الأقرب فالأبعد (ليجهز التقليب في الاتجاهين والصفحة التالية أثناء الطي)
    const order = [centerIdx];
    for (let d = 1; d <= PF_WINDOW; d++) { order.push(centerIdx + d); order.push(centerIdx - d); }
    for (const idx of order) {
      if (tok !== pfWinToken) return; // بدأت نافذة أحدث
      if (idx < 0 || idx >= pageCount || pfLoaded.has(idx)) continue;
      const imgs = inner.querySelectorAll('img[data-idx="' + idx + '"]');
      if (!imgs.length) continue;
      try { const url = await renderPfImage(idx); imgs.forEach((im) => { im.src = url; }); pfLoaded.add(idx); }
      catch {}
    }
  }

  // موجّه بناء الكتاب: كانفاس (ظلّ واقعي) للكتب حتى PF_CANVAS_MAX، وإلا نافذة DOM (سريعة، بلا ظلّ) للكتب الضخمة
  function buildPageFlip(gotoPage) {
    if (pageFlip) { const t = Math.max(0, Math.min((gotoPage || pdfPage) - 1, pageCount - 1)); pageFlip.turnToPage(t); if (!pfCanvasMode) ensurePfWindow(t); return; }
    if (pageCount <= PF_CANVAS_MAX) buildPageFlipCanvas(gotoPage);
    else buildPageFlipDom(gotoPage);
  }

  // ═══ محرّك الكانفاس (كل الصفحات كصور معكوسة تُرسم على كانفا واحدة — ظلّ سلس كـfliphtml5) ═══
  async function buildPageFlipCanvas(gotoPage) {
    if (pfBuilding) return;
    pfBuilding = true; pfCanvasMode = true;
    const cont = $('#r-pageflip');
    const targetIdx = Math.max(0, Math.min((gotoPage || pdfPage) - 1, pageCount - 1));
    $('#reader').classList.add('pageflip-on');
    $('#r-canvas-wrap').hidden = true; $('#r-canvas-wrap2').hidden = true;
    $('#reader').classList.remove('pdf-spread');
    cont.hidden = false;
    cont.innerHTML = '<div class="pf-loading"><div class="disc-spin big"></div><p>جارٍ تحضير الكتاب…</p><div class="pf-prog"><i id="pf-prog-i"></i></div></div>';
    const myTok = ++renderToken;
    try {
      const p1 = await pdfDoc.getPage(1); const v = p1.getViewport({ scale: 1 }); pfAspect = v.width / v.height;
      if (myTok !== renderToken) { pfBuilding = false; return; }
      // ارسم كل الصفحات كصور معكوسة أفقياً (تُصحَّح باتجاهها عبر مرآة الحاوية RTL)
      const urls = [];
      for (let i = 0; i < pageCount; i++) {
        if (myTok !== renderToken) { pfBuilding = false; return; }
        try { urls.push(await renderPfImage(i, true)); } catch { urls.push(''); }
        const pi = $('#pf-prog-i'); if (pi) pi.style.width = Math.round(((i + 1) / pageCount) * 100) + '%';
      }
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
        drawShadow: true, flippingTime: 650, usePortrait: true, maxShadowOpacity: 0.4,
        showCover: false, useMouseEvents: false, showPageCorners: false, mobileScrollSupport: false, startPage: targetIdx,
      });
      pageFlip.loadFromImages(urls);
      pageFlip.on('flip', (e) => {
        pdfPage = (e.data || 0) + 1;
        state.pct = pageCount > 1 ? (pdfPage - 1) / (pageCount - 1) : 1;
        afterNavigate();
      });
      wirePfDrag(inner);
      pdfPage = targetIdx + 1;
    } catch (e) { console.error('pageflip canvas', e); teardownPageFlip(); renderPdf(gotoPage || pdfPage); }
    pfBuilding = false;
  }

  async function buildPageFlipDom(gotoPage) {
    pfCanvasMode = false;
    const cont = $('#r-pageflip');
    const targetIdx = Math.max(0, Math.min((gotoPage || pdfPage) - 1, pageCount - 1));
    if (pfBuilding) return;
    pfBuilding = true;
    $('#reader').classList.add('pageflip-on');
    $('#r-canvas-wrap').hidden = true; $('#r-canvas-wrap2').hidden = true;
    $('#reader').classList.remove('pdf-spread');
    cont.hidden = false;
    cont.innerHTML = '<div class="pf-loading"><div class="disc-spin big"></div><p>جارٍ فتح الكتاب…</p></div>';
    const myTok = ++renderToken;
    try {
      const p1 = await pdfDoc.getPage(1); const v = p1.getViewport({ scale: 1 }); pfAspect = v.width / v.height;
      if (myTok !== renderToken) { pfBuilding = false; return; }
      // ابنِ كل الصفحات كإطارات فارغة (سريع جداً) — تُملأ صورها بالنافذة المتحركة
      const box = document.createElement('div'); box.className = 'pf-box rtl';
      const inner = document.createElement('div'); inner.className = 'pf-inner';
      for (let i = 0; i < pageCount; i++) {
        const d = document.createElement('div'); d.className = 'pf-page';
        const img = document.createElement('img'); img.className = 'pf-img'; img.dataset.idx = i;
        d.appendChild(img); inner.appendChild(d);
      }
      // املأ الصفحة الحالية (والمقابلة في العرض المزدوج) قبل التهيئة كي يظهر المحتوى فوراً
      pfLoaded = new Set();
      const preIdxs = [targetIdx];
      if (spreadFits()) preIdxs.push(targetIdx % 2 === 0 ? targetIdx + 1 : targetIdx - 1);
      for (const i of preIdxs) {
        if (i < 0 || i >= pageCount || pfLoaded.has(i)) continue;
        const im = inner.querySelector('img[data-idx="' + i + '"]');
        if (im) { try { im.src = await renderPfImage(i); pfLoaded.add(i); } catch {} }
      }
      if (myTok !== renderToken) { pfBuilding = false; return; }
      cont.innerHTML = '';
      box.appendChild(inner); cont.appendChild(box);
      sizePfBox(box);
      const bookH = box.clientHeight;
      const pageW = Math.round(bookH * pfAspect);
      pageFlip = new St.PageFlip(inner, {
        width: pageW, height: Math.round(bookH), size: 'stretch',
        minWidth: 160, maxWidth: 3000, minHeight: 160, maxHeight: 2000,
        drawShadow: false, flippingTime: 650, usePortrait: true, maxShadowOpacity: 0.4,
        showCover: false, useMouseEvents: false, showPageCorners: false, mobileScrollSupport: false, startPage: targetIdx,
      });
      pageFlip.loadFromHTML(inner.querySelectorAll('.pf-page'));
      pageFlip.on('flip', (e) => {
        pdfPage = (e.data || 0) + 1;
        state.pct = pageCount > 1 ? (pdfPage - 1) / (pageCount - 1) : 1;
        // أجّل رسم صور النافذة (ثقيل على المعالج) حتى تكتمل حركة الاستقرار — يمنع الارتجاج/الإزاحة في النهاية
        clearTimeout(pfWinTid); pfWinTid = setTimeout(() => ensurePfWindow(pdfPage - 1), 350);
        afterNavigate();
      });
      wirePfDrag(inner);
      pdfPage = targetIdx + 1;
      ensurePfWindow(targetIdx); // ارسم بقية النافذة (الجوار) في الخلفية
    } catch (e) { console.error('pageflip', e); teardownPageFlip(); renderPdf(gotoPage || pdfPage); }
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
    try {
      const tc = await page.getTextContent();
      if (myToken !== renderToken) return; // انتقلت الصفحة أثناء الجلب
      await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: cssVp, textDivs: [] }).promise;
    } catch (e) { /* بعض الصفحات بلا نص */ }
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
    try {
      const tc = await page.getTextContent();
      await pdfjsLib.renderTextLayer({ textContentSource: tc, container: tl, viewport: page.getViewport({ scale: cssScale }), textDivs: [] }).promise;
    } catch (e) { /* صفحة بلا نص */ }
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
    cont.scrollTo({ top: s.el.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
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
    if (state.pct >= 0.995 && !state.finished) { state.finished = true; if (!celebrated) { celebrated = true; Library.toast('🎉 مبارك! أنهيت الكتاب', 'gold'); } }
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

  function setZoom(z) {
    if (!isPdf) return;
    pdfZoom = Math.min(2.4, Math.max(1, Math.round(z * 10) / 10));
    $('#zoom-val').textContent = Math.round(pdfZoom * 100) + '٪';
    $('#reader').classList.toggle('zoomed', pdfZoom > 1.001);
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
    const score = (v) => (/(natural|online|neural|premium|enhanced)/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1);
    return vs.slice().sort((a, b) => score(b) - score(a))[0];
  }

  async function pdfHasReadableText() {
    if (ocrFull && ocrFull.text && ocrFull.text.trim().length > 15) return true; // نص مُستخرَج متاح
    for (let p = pdfPage; p <= Math.min(pageCount, pdfPage + 4); p++) {
      try {
        const page = await pdfDoc.getPage(p);
        const tc = await page.getTextContent();
        if (tc.items.map((i) => i.str).join('').trim().length > 15) return true;
      } catch {}
    }
    return false;
  }

  // نص صفحة من نتيجة الـOCR (1-based) عند غياب النص الأصلي
  function ocrPageText(n) {
    if (!ocrFull || !ocrFull.pageStarts) return '';
    const ps = ocrFull.pageStarts;
    const a = ps[n - 1] ?? 0, b = ps[n] ?? ocrFull.text.length;
    return ocrFull.text.slice(a, b).replace(/\s+/g, ' ').trim();
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
        Library.toast('هذا الكتاب صفحاته مصوّرة — فعّل المزامنة السحابية لاستخراج نصه (OCR)');
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
    const wantNatural = settings.ttsEngine === 'natural' && window.Cloud && Cloud.aiReady && Cloud.aiReady();
    ttsEngine = wantNatural ? 'natural' : 'device';
    ttsOn = true; ttsPaused = false;
    $('#r-btn-tts').classList.add('on');
    setupMediaSession();
    startSleepTimer();
    Library.toast(ttsEngine === 'natural' ? 'بدأ الاستماع بصوت طبيعي 🔊' : 'بدأت القراءة الصوتية 🔊 — اضغط الزر ذاته للإيقاف');
    if (ttsEngine === 'natural') speakNatural(); else speakNext();
  }

  // نصّ الوحدة الحالية (فقرة نصية أو صفحة PDF) + تمييزها وتمرير الصفحة إليها
  async function currentUnit(highlight = true) {
    if (isPdf) {
      let text = '';
      try { const page = await pdfDoc.getPage(pdfPage); const tc = await page.getTextContent(); text = tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim(); } catch {}
      if (!text) text = ocrPageText(pdfPage);
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
    if (isPdf) { if (pdfPage >= pageCount) return false; jumpTo(pdfPage + 1); return true; }
    ttsIdx++; return ttsIdx < ttsEls.length;
  }

  /* ── محرّك صوت الجهاز (speechSynthesis) ── */
  async function speakNext() {
    if (!ttsOn || ttsPaused) return;
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
      const data = await Cloud.invokeFn('ai', { action: 'tts', text, voice: settings.ttsVoice || 'Kore' });
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

  /* ── إيقاف مؤقّت/استئناف/تخطّي (يعملان مع المحرّكين وأزرار شاشة القفل) ── */
  function ttsPause() {
    if (!ttsOn || ttsPaused) return;
    ttsPaused = true;
    if (ttsEngine === 'natural') { try { ttsAudio && ttsAudio.pause(); } catch {} }
    else { try { speechSynthesis.pause(); } catch {} }
    if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = 'paused'; } catch {}
  }
  function ttsResume() {
    if (!ttsOn || !ttsPaused) return;
    ttsPaused = false;
    if (ttsEngine === 'natural') { try { ttsAudio && ttsAudio.play(); } catch {} }
    else { try { speechSynthesis.resume(); } catch {} }
    if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = 'playing'; } catch {}
  }
  function ttsSkip(dir) {
    if (!ttsOn) return;
    if (contentEl) contentEl.querySelectorAll('.tts-now').forEach((e) => e.classList.remove('tts-now'));
    if (isPdf) { const t = pdfPage + dir; if (t >= 1 && t <= pageCount) jumpTo(t); }
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
      navigator.mediaSession.setActionHandler('previoustrack', () => ttsSkip(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => ttsSkip(1));
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
    $('#r-btn-tts').classList.remove('on');
    if ('mediaSession' in navigator) try { navigator.mediaSession.playbackState = 'none'; ['play', 'pause', 'previoustrack', 'nexttrack', 'stop'].forEach((a) => navigator.mediaSession.setActionHandler(a, null)); } catch {}
    if (finished) Library.toast('انتهت القراءة الصوتية ✓');
  }

  /* ═══════ مساعد القراءة الذكي ═══════ */
  let aiBusy = false;

  function openAI() {
    if (!window.Cloud || !Cloud.aiReady || !Cloud.aiReady()) {
      const cfg = window.Cloud && Cloud.isConfigured && Cloud.isConfigured();
      Library.toast(cfg ? 'سجّل الدخول (زر السحابة) لاستخدام المساعد الذكي' : 'المساعد الذكي يحتاج تفعيل المزامنة السحابية');
      return;
    }
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
        const have = new Set((existing.cards || []).map((c) => c.q));
        const now = Date.now();
        const fresh = cards.filter((c) => !have.has(c.q)).map((c) => ({ id: 'fc' + now + Math.random().toString(36).slice(2, 6), q: c.q || '', a: c.a || '', box: 1, due: now }));
        const merged = [...(existing.cards || []), ...fresh];
        await Store.saveDeck(book.id, merged);
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
  async function currentChapterText() {
    if (!isPdf && tocItems.length) {
      let idx = 0; tocItems.forEach((t, i) => { if (t.el && elementPage(t.el) <= curPage) idx = i; });
      const startEl = tocItems[idx] && tocItems[idx].el, endEl = tocItems[idx + 1] && tocItems[idx + 1].el;
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
          let idx = 0; tocItems.forEach((t, i) => { if (t.page && t.page <= pdfPage) idx = i; });
          const sp = tocItems[idx].page || 1, ep = (tocItems[idx + 1] && tocItems[idx + 1].page) || (ps.length + 1);
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
    const labels = { summarize: '📄 لخّص الكتاب', chapter: '📑 لخّص هذا الفصل', keypoints: '💡 أبرز نقاط الكتاب', flashcards: '🃏 بطاقات من الكتاب', hlcards: '🖍 بطاقات من تظليلاتي', quiz: '📝 اختبرني' };
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
      else if (action === 'chapter') {
        const ch = await currentChapterText();
        if (!ch || !ch.text.trim()) { loading.classList.remove('loading'); loading.innerHTML = 'تعذّر تحديد نصّ الفصل الحالي — إن كان الكتاب مصوّراً فاستخرج نصّه أولاً.'; return; }
        body = { action: 'sumtext', title: book.title, text: `لخّص القسم${ch.label ? ` «${ch.label}»` : ''} من كتاب «${book.title}» تلخيصاً وافياً: الفكرة العامة، ثم أبرز الأفكار في نقاط، ثم خلاصة قصيرة.\n\n=== نص القسم ===\n${ch.text.slice(0, 120000)}` };
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

  /* ═══════ مشاركة الاقتباس كبطاقة صورة ═══════ */
  async function shareQuote(text) {
    text = (text || '').trim();
    if (!text) return;
    if (text.length > 320) text = text.slice(0, 317).trim() + '…';
    Library.toast('🖼 جارٍ إنشاء البطاقة…');
    try { await document.fonts.load("700 60px 'Amiri'"); await document.fonts.load("400 30px 'Tajawal'"); } catch {}
    const W = 1080, H = 1350, dpr = 1;
    const c = document.createElement('canvas');
    c.width = W * dpr; c.height = H * dpr;
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    // خلفية متدرجة فاخرة
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#241a38'); g.addColorStop(0.55, '#171226'); g.addColorStop(1, '#0e0b16');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    // توهّج علوي
    const rg = x.createRadialGradient(W / 2, 120, 40, W / 2, 120, 600);
    rg.addColorStop(0, 'rgba(75,45,127,.5)'); rg.addColorStop(1, 'rgba(75,45,127,0)');
    x.fillStyle = rg; x.fillRect(0, 0, W, H);
    // إطار ذهبي
    x.strokeStyle = 'rgba(217,169,79,.5)'; x.lineWidth = 3;
    x.strokeRect(46, 46, W - 92, H - 92);
    x.direction = 'rtl'; x.textAlign = 'center';
    // زخرفة
    x.fillStyle = '#d9a94f'; x.font = "60px 'Amiri', serif";
    x.fillText('❝', W / 2, 250);
    // نص الاقتباس مع لفّ الأسطر
    x.fillStyle = '#f3ecd9';
    let fs = text.length > 180 ? 46 : text.length > 90 ? 56 : 64;
    x.font = `700 ${fs}px 'Amiri', serif`;
    const maxW = W - 260, lh = fs * 1.65, words = text.split(/\s+/);
    const lines = []; let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    }
    if (line) lines.push(line);
    const blockH = lines.length * lh;
    let y = Math.max(360, H / 2 - blockH / 2);
    for (const ln of lines) { x.fillText(ln, W / 2, y); y += lh; }
    // فاصل
    x.strokeStyle = 'rgba(217,169,79,.6)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(W / 2 - 60, y + 24); x.lineTo(W / 2 + 60, y + 24); x.stroke();
    // الكتاب والمؤلف
    x.fillStyle = '#e9c887'; x.font = "600 40px 'Amiri', serif";
    x.fillText(book.title, W / 2, y + 90);
    if (book.author) { x.fillStyle = '#9a92ad'; x.font = "400 30px 'Tajawal', sans-serif"; x.fillText(book.author, W / 2, y + 140); }
    // العلامة السفلية
    x.fillStyle = '#d9a94f'; x.font = "700 44px 'Aref Ruqaa', 'Amiri', serif";
    x.fillText('مِداد', W / 2, H - 90);
    x.fillStyle = 'rgba(154,146,173,.7)'; x.font = "400 22px 'Tajawal', sans-serif";
    x.fillText('مكتبتي الرقمية', W / 2, H - 55);

    const blob = await new Promise((res) => c.toBlob(res, 'image/png', 0.95));
    const file = new File([blob], `اقتباس - ${book.title}.png`, { type: 'image/png' });
    // مشاركة أصلية إن دعمها الجهاز، وإلا تنزيل
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: 'اقتباس من ' + book.title }); return; } catch {}
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    Library.toast('حُفظت بطاقة الاقتباس 🖼', 'gold');
  }

  /* ═══════ القاموس الفوري (معنى بالذكاء الاصطناعي) ═══════ */
  function hideDefineBubble() { $('#define-bubble').hidden = true; }

  // فقاعة ذكاء مشتركة (المعنى/الترجمة): تعرض العنوان وتنتظر نتيجة الاستدعاء
  async function aiBubble(title, rect, invokeBody, notReadyMsg) {
    if (!window.Cloud || !Cloud.aiReady || !Cloud.aiReady()) {
      const cfg = window.Cloud && Cloud.isConfigured && Cloud.isConfigured();
      return Library.toast(cfg ? 'سجّل الدخول (زر السحابة) لاستخدام هذه الميزة' : notReadyMsg);
    }
    const bubble = $('#define-bubble');
    $('#db-word').textContent = title.length > 60 ? title.slice(0, 60) + '…' : title;
    $('#db-body').innerHTML = '<span class="ai-typing"><i></i><i></i><i></i></span>';
    bubble.hidden = false;
    const bw = 300;
    if (rect) {
      bubble.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - bw / 2, innerWidth - bw - 8)) + 'px';
      bubble.style.top = (rect.bottom + 10 < innerHeight - 180 ? rect.bottom + 10 : Math.max(60, rect.top - 190)) + 'px';
    } else { bubble.style.left = (innerWidth / 2 - bw / 2) + 'px'; bubble.style.top = '80px'; }
    try {
      const res = await Cloud.aiInvoke(invokeBody);
      if (bubble.hidden) return;
      $('#db-body').textContent = res || '—';
    } catch (e) { $('#db-body').textContent = '⚠ ' + ((e && e.message) || 'تعذّر الحصول على النتيجة'); }
  }

  function defineWord(text, rect) {
    if (!text) return;
    const prompt = `عرّف بإيجاز شديد (جملة أو جملتين بالعربية الفصحى) معنى هذه الكلمة أو العبارة${book && book.title ? ` كما قد ترد في كتاب «${book.title}»` : ''}، ودون مقدمات: «${text}»`;
    return aiBubble(text, rect, { action: 'define', text: prompt }, 'المعنى الفوري يحتاج تفعيل المزامنة السحابية');
  }

  function translateSel(text, rect) {
    if (!text) return;
    return aiBubble('🌐 الترجمة', rect, { action: 'translate', text, question: 'الإنجليزية' }, 'الترجمة تحتاج تفعيل المزامنة السحابية');
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
        const vl = $('#tts-voice-label'); if (vl) vl.hidden = settings.ttsEngine !== 'natural';
        if (settings.ttsEngine === 'natural' && !(window.Cloud && Cloud.aiReady && Cloud.aiReady())) Library.toast('الصوت الطبيعي يحتاج تفعيل المزامنة السحابية وتسجيل الدخول (زر ☁️)');
      };
    }); }
    { const sv = $('#set-ttsvoice'); if (sv) sv.onchange = (e) => { settings.ttsVoice = e.target.value; ttsCache.clear(); Store.saveSettings(settings); }; }
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
    { const fr = $('#focus-row'); if (fr) fr.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { settings.focusMode = b.dataset.focus === '1'; Store.saveSettings(settings); applySettings(); };
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
    { const er = $('#enhance-row'); if (er) er.querySelectorAll('button').forEach((b) => b.classList.toggle('active', (b.dataset.enhance === '1') === (settings.enhanceScan !== false))); }
    $('#set-ttsrate').value = settings.ttsRate || 100;
    $('#set-autospeed').value = settings.autoSpeed || 50;
    { const er = $('#tts-engine-row'); if (er) er.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.engine === (settings.ttsEngine || 'natural'))); }
    { const sv = $('#set-ttsvoice'); if (sv) sv.value = settings.ttsVoice || 'Kore'; }
    { const ss = $('#set-ttssleep'); if (ss) ss.value = String(settings.ttsSleep || 0); }
    { const vl = $('#tts-voice-label'); if (vl) vl.hidden = (settings.ttsEngine || 'natural') !== 'natural'; }
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
    if (i >= 0) { state.bookmarks.splice(i, 1); Library.toast('أُزيلت العلامة المرجعية'); }
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
    const w = pop.offsetWidth || 300, h = pop.offsetHeight || 100;
    pop.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
    // فوق التحديد مع فسحة كافية حتى لا يحجبه؛ فإن لم يتّسع فوقه فأسفله
    let top = rect.top - h - 12;
    if (top < 8) top = Math.min(rect.bottom + 12, innerHeight - h - 8);
    pop.style.top = Math.max(8, top) + 'px';
  }
  function hideHlPopup() { $('#hl-popup').hidden = true; pendingSel = null; pendingPdfSel = null; }

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
        state.highlights = state.highlights.filter((h) => h.id !== b.dataset.delH);
        rebuildText(); renderDrawerPanes(); schedulePersist();
      };
    });
    pane.querySelectorAll('[data-del-n]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        state.pageNotes = state.pageNotes.filter((n) => n.id !== b.dataset.delN);
        renderDrawerPanes(); schedulePersist();
      };
    });
    pane.querySelectorAll('[data-del-ph]').forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
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
    let idx = 0;
    while (matches.length < 80 && (idx = hay.indexOf(q, idx)) !== -1) {
      matches.push(idx);
      idx += q.length;
    }
    count.textContent = matches.length ? matches.length + ' نتيجة' : 'لا نتائج';
    res.innerHTML = matches.map((off, i) => {
      const a = Math.max(0, off - 40), b = Math.min(hay.length, off + q.length + 40);
      const before = esc(hay.slice(a, off)), hit = esc(hay.slice(off, off + q.length)), after = esc(hay.slice(off + q.length, b));
      return `<button data-off="${off}" data-len="${q.length}">…${before}<b>${hit}</b>${after}…</button>`;
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

  function bump() { lastActivity = Date.now(); }

  function startTimers() {
    bump();
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (!isOpen || document.hidden) return;
      if (Date.now() - lastActivity < 90000) {
        state.seconds = (state.seconds || 0) + 5;
        Store.logAddSeconds(5); // سجلّ القراءة اليومي (سلسلة الأيام والهدف)
        if (state.seconds % 30 === 0) { schedulePersist(); updateReadStat(); }
      }
    }, 5000);
    resetUiTimer();
  }

  function showUI() {
    $('#reader').classList.remove('ui-hidden');
    resetUiTimer();
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
    $('#r-back').onclick = close;
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
    document.addEventListener('visibilitychange', () => { if (document.hidden && isOpen) persist(); });
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
      bump(); showUI();
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

    // إظهار الواجهة عند الحركة
    $('#reader').addEventListener('pointermove', () => { if (isOpen) showUI(); }, { passive: true });

    // مناطق النقر على الورقة + التحديد + السحب بالفأرة للتقليب
    let downX = null;
    $('#r-stage').addEventListener('pointerdown', (e) => {
      if (drawMode && e.target.id === 'r-draw') { downX = null; return; }
      downX = e.clientX;
    });
    $('#r-stage').addEventListener('pointerup', (e) => {
      if (!isOpen) return;
      bump();
      // أي لمسة توقف القراءة التلقائية
      if (autoOn) { stopAuto(); showUI(); downX = null; return; }
      const dx = downX != null ? e.clientX - downX : 0;
      downX = null;
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
        if (e.target.closest('.r-nav, .r-ribbon, button, #r-draw, #r-pdf-scroll')) return;
        const paged = settings.flip !== 'scroll';
        // سحب أفقي = تقليب (سحب لليمين يقدّم الصفحة كما في الكتاب العربي)
        if (paged && Math.abs(dx) > 60) { if (dx > 0) next(); else prev(); return; }
        if (Math.abs(dx) > 12) return; // سحب قصير — لا شيء
        // مناطق التقليب بالنقر
        const stage = $('#r-stage').getBoundingClientRect();
        const x = (e.clientX - stage.left) / stage.width;
        if (!paged) return;
        if (x < 0.22) next();
        else if (x > 0.78) prev();
        else { $('#reader').classList.toggle('ui-hidden'); }
      }, 10);
    });

    // منبثقة التظليل
    $('#hl-popup').querySelectorAll('.hl-colors button').forEach((b) => {
      b.onclick = () => {
        if (pendingMarkId) {
          const h = state.highlights.find((x) => x.id === pendingMarkId);
          if (h) { h.color = b.dataset.color; rebuildText(); renderDrawerPanes(); schedulePersist(); }
          hideHlPopup();
        } else if (pendingPdfMark) {
          const h = state.pdfHighlights.find((x) => x.id === pendingPdfMark);
          if (h) { h.color = b.dataset.color; refreshPdfHighlights(); renderDrawerPanes(); schedulePersist(); }
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
        state.highlights = state.highlights.filter((h) => h.id !== pendingMarkId);
        hideHlPopup(); rebuildText(); renderDrawerPanes(); schedulePersist();
      } else if (pendingPdfMark) {
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
      $('#hl-share-btn').onclick = () => {
        const txt = selText();
        hideHlPopup(); pendingPdfMark = null;
        if (txt) shareQuote(txt);
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
        const target = Math.min(2.4, Math.max(1, pinch.z0 * ratio));
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
      // لا تقليب أثناء تحديد نص للتظليل أو أثناء الكتابة أو عند التكبير
      const sel = getSelection();
      if ((sel && !sel.isCollapsed) || drawMode || (isPdf && pdfZoom > 1.01)) return;
      if (Math.abs(dx) > 60 && settings.flip !== 'scroll') {
        if (dx > 0) next(); else prev(); // سحب لليمين = التالية (RTL)
      }
    }, { passive: true });

    stage.addEventListener('touchcancel', () => {
      // إلغاء القرص: أزل المعاينة والشارة دون تثبيت أي تغيير
      if (pinch) { pinchBadge.hidden = true; viewportEl.style.transform = ''; $('#r-canvas').style.transform = ''; $('#r-pdf-scroll').style.transform = ''; }
      pinch = null; touchX = null;
    }, { passive: true });
  }

  return { open, close, wire, previewHTML: buildHTML, mdToHtml };
})();
window.Reader = Reader;
