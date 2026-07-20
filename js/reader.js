/* ═══════ مِداد — محرّك القراءة ═══════ */
const Reader = (() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const THEMES = {
    white: { paper: '#fbfaf6', ink: '#22201c', label: 'ناصع' },
    cream: { paper: '#f9f0dc', ink: '#3c2f1d', label: 'كريمي' },
    sepia: { paper: '#f4e4c9', ink: '#43301a', label: 'سيبيا' },
    aged:  { paper: '#e6d2aa', ink: '#3d2c15', label: 'عتيق' },
    gray:  { paper: '#2e3036', ink: '#d5d8de', label: 'رمادي' },
    night: { paper: '#171920', ink: '#c6cad2', label: 'ليلي' },
    black: { paper: '#0a0a0c', ink: '#b7bbc3', label: 'أسود' },
  };
  const DARK_THEMES = ['gray', 'night', 'black'];
  const FONTS = [
    { css: "'Noto Naskh Arabic', serif", label: 'نسخ' },
    { css: "'Amiri', serif", label: 'أميري' },
    { css: "'Tajawal', sans-serif", label: 'تجوّل' },
    { css: "'Aref Ruqaa', serif", label: 'رقعة' },
  ];
  const GAP = 64;

  let book = null, state = null, settings = null;
  let isPdf = false, isOpen = false;
  // نصي
  let contentEl, viewportEl, pristineHTML = '', pageW = 0, colW = 0, pageCount = 1, curPage = 0, totalChars = 0;
  // PDF
  let pdfDoc = null, pdfPage = 1, renderToken = 0, pdfZoom = 1;
  // مؤقتات
  let saveTimer = null, uiTimer = null, tickTimer = null, lastActivity = 0, repagTimer = null;
  let flipping = false, pendingMarkId = null, pendingSel = null;
  let celebrated = false;

  /* ═══════ فتح وإغلاق ═══════ */
  async function open(id) {
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
    $('#r-canvas-wrap').hidden = !isPdf;
    $('#r-btn-search').style.display = isPdf ? 'none' : '';
    $('#typo-section').style.display = isPdf ? 'none' : '';
    $('#flip-scroll-btn').style.display = isPdf ? 'none' : '';
    $('#r-btn-draw').style.display = isPdf ? '' : 'none';
    state.drawings = state.drawings || {};
    setDrawMode(false);
    pdfZoom = 1;
    $('#zoom-pill').hidden = !isPdf;
    $('#zoom-val').textContent = '100٪';
    reader.classList.remove('zoomed');

    buildSettingsUI();
    applySettings(false);

    if (isPdf) {
      const blob = await Store.getPayload(id);
      const buf = await blob.arrayBuffer();
      pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
      pageCount = pdfDoc.numPages;
      pdfPage = Math.min(Math.max(state.page + 1, 1), pageCount);
      await renderPdf(pdfPage);
      buildPdfToc();
    } else {
      const text = await Store.getPayload(id) || '';
      pristineHTML = buildHTML(text);
      renderContent();
      setTimeout(() => {
        paginate();
        const target = state.pct ? Math.round(state.pct * (pageCount - 1)) : 0;
        if (settings.flip === 'scroll') {
          viewportEl.scrollTop = state.pct * (viewportEl.scrollHeight - viewportEl.clientHeight);
        } else setPage(target, false);
        buildTextToc();
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
    setDrawMode(false);
    ttsStop();
    pdfDoc = null; pristineHTML = ''; contentEl.innerHTML = '';
    Library.refresh();
  }

  /* ═══════ بناء نص الكتاب ═══════ */
  function buildHTML(text) {
    const lines = text.split(/\r?\n/);
    let html = '', para = [];
    const flush = () => { if (para.length) { html += '<p>' + esc(para.join(' ')) + '</p>'; para = []; } };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) { flush(); continue; }
      let m;
      if ((m = line.match(/^#\s+(.+)/))) { flush(); html += '<h2>' + esc(m[1]) + '</h2>'; }
      else if ((m = line.match(/^#{2,4}\s+(.+)/))) { flush(); html += '<h3>' + esc(m[1]) + '</h3>'; }
      else if (/^(الفصل|الباب|المقدمة|الخاتمة|القسم|الجزء)\s/.test(line) && line.length < 60) { flush(); html += '<h2>' + esc(line) + '</h2>'; }
      else para.push(line);
    }
    flush();
    return html || '<p>(كتاب فارغ)</p>';
  }

  function renderContent() {
    contentEl.innerHTML = pristineHTML;
    totalChars = contentEl.textContent.length;
    for (const h of (state.highlights || []).slice().sort((a, b) => a.start - b.start)) applyHighlightToDOM(h);
  }

  function paginate() {
    if (isPdf) return;
    // القرار على عرض النافذة، ثم تتوسع الورقة عبر CSS قبل القياس
    const spreadOn = settings.spread && settings.flip !== 'scroll' && window.innerWidth >= 900;
    $('#reader').classList.toggle('spread', spreadOn);
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
    if (!isPdf && settings.flip === 'scroll') {
      viewportEl.scrollBy({ top: dir * viewportEl.clientHeight * 0.9, behavior: 'smooth' });
      return;
    }
    if (isPdf) {
      const target = pdfPage + dir;
      if (target < 1 || target > pageCount) return;
      if (settings.flip === 'flip' && pdfZoom <= 1.001) flipPdf(target, dir);
      else { pdfPage = target; renderPdf(target, true); state.pct = pageCount > 1 ? (target - 1) / (pageCount - 1) : 1; afterNavigate(); }
    } else {
      const target = curPage + dir;
      if (target < 0 || target > pageCount - 1) return;
      if (settings.flip === 'flip') flipText(target, dir);
      else setPage(target, true);
    }
  }

  function jumpTo(n) { // فهرس الصفحات (نصي: رقم صفحة، PDF: رقم صفحة 1-based)
    if (isPdf) { pdfPage = Math.max(1, Math.min(n, pageCount)); renderPdf(pdfPage, true); state.pct = pageCount > 1 ? (pdfPage - 1) / (pageCount - 1) : 1; afterNavigate(); }
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
      setLeafFrom(main, pdfPage);
      layer.appendChild(leaf);
      leaf.classList.add('turning');
      pdfPage = target;
      renderPdf(target);
      state.pct = pageCount > 1 ? (target - 1) / (pageCount - 1) : 1;
      afterNavigate();
      setTimeout(() => { leaf.remove(); flipping = false; }, 570);
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

  /* ═══════ عرض PDF ═══════ */
  async function renderPdf(n, fade = false, targetCanvas = null) {
    const canvas = targetCanvas || $('#r-canvas');
    const token = targetCanvas ? -1 : ++renderToken;
    try {
      const page = await pdfDoc.getPage(n);
      const stage = $('#r-stage');
      const availH = stage.clientHeight * 0.95;
      const availW = Math.min(stage.clientWidth - 130, 1100);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(availH / vp1.height, availW / vp1.width) * pdfZoom;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const vp = page.getViewport({ scale: scale * dpr });
      if (token !== -1 && token !== renderToken) return;
      canvas.width = vp.width; canvas.height = vp.height;
      canvas.style.width = (vp.width / dpr) + 'px';
      canvas.style.height = (vp.height / dpr) + 'px';
      if (fade && !targetCanvas) { canvas.style.opacity = '0'; }
      // intent:'print' يتجنب requestAnimationFrame فيكتمل الرسم حتى في التبويبات الخلفية
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, intent: 'print' }).promise;
      if (fade && !targetCanvas) setTimeout(() => (canvas.style.opacity = '1'), 30);
      if (!targetCanvas) syncDrawLayer();
    } catch (e) { console.error('pdf render', e); }
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
    $('#draw-clear').onclick = () => {
      if ((state.drawings[pdfPage] || []).length && confirm('مسح كل كتابات هذه الصفحة؟')) {
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
  function setZoom(z) {
    if (!isPdf) return;
    pdfZoom = Math.min(2.4, Math.max(1, Math.round(z * 10) / 10));
    $('#zoom-val').textContent = Math.round(pdfZoom * 100) + '٪';
    $('#reader').classList.toggle('zoomed', pdfZoom > 1.001);
    renderPdf(pdfPage);
  }

  /* ═══════ القراءة الصوتية ═══════ */
  let ttsOn = false, ttsIdx = 0, ttsEls = [];

  function pickVoice() {
    const vs = speechSynthesis.getVoices();
    return vs.find((v) => /^ar/i.test(v.lang)) || null;
  }

  function ttsToggle() {
    if (ttsOn) return ttsStop();
    if (!('speechSynthesis' in window)) return Library.toast('القراءة الصوتية غير مدعومة في متصفحك');
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
    ttsOn = true;
    $('#r-btn-tts').classList.add('on');
    Library.toast('بدأت القراءة الصوتية 🔊 — اضغط الزر ذاته للإيقاف');
    speakNext();
  }

  async function speakNext() {
    if (!ttsOn) return;
    let text = '', el = null;
    if (isPdf) {
      try {
        const page = await pdfDoc.getPage(pdfPage);
        const tc = await page.getTextContent();
        text = tc.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      } catch { text = ''; }
      if (!text) {
        if (pdfPage < pageCount) { jumpTo(pdfPage + 1); return speakNext(); }
        return ttsStop(true);
      }
    } else {
      if (ttsIdx >= ttsEls.length) return ttsStop(true);
      el = ttsEls[ttsIdx];
      if (settings.flip === 'scroll') el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      else {
        const pg = elementPage(el);
        if (pg !== curPage) setPage(pg, false);
      }
      el.classList.add('tts-now');
      text = el.textContent;
    }
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v ? v.lang : 'ar-SA';
    u.rate = (settings.ttsRate || 100) / 100;
    u.onend = () => {
      if (el) el.classList.remove('tts-now');
      if (!ttsOn) return;
      if (isPdf) {
        if (pdfPage < pageCount) { jumpTo(pdfPage + 1); speakNext(); }
        else ttsStop(true);
      } else { ttsIdx++; speakNext(); }
    };
    u.onerror = () => { if (el) el.classList.remove('tts-now'); if (ttsOn) ttsStop(); };
    speechSynthesis.speak(u);
  }

  function ttsStop(finished = false) {
    ttsOn = false;
    try { speechSynthesis.cancel(); } catch {}
    if (contentEl) contentEl.querySelectorAll('.tts-now').forEach((e) => e.classList.remove('tts-now'));
    $('#r-btn-tts').classList.remove('on');
    if (finished) Library.toast('انتهت القراءة الصوتية ✓');
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
    $('#set-ttsrate').oninput = (e) => { settings.ttsRate = +e.target.value; Store.saveSettings(settings); };

    $('#spread-row').querySelectorAll('button').forEach((b) => {
      b.onclick = () => { settings.spread = b.dataset.spread === '1'; applySettings(); scheduleRepaginate(); };
    });

    $('#btn-reset-settings').onclick = () => {
      settings = Store.resetSettings();
      applySettings(false);
      scheduleRepaginate();
      Library.toast('عادت الإعدادات إلى وضعها الافتراضي ↺');
    };

    $('#bgmode-row').querySelectorAll('button').forEach((b) => {
      b.onclick = () => { settings.bg = b.dataset.bg; applySettings(); };
    });
    $('#flip-row').querySelectorAll('button').forEach((b) => {
      b.onclick = () => {
        const was = settings.flip;
        settings.flip = b.dataset.flip;
        applySettings();
        if (!isPdf && (was === 'scroll') !== (settings.flip === 'scroll')) {
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

    const dark = settings.theme === 'custom' ? luminance(paper) <= 0.45 : DARK_THEMES.includes(settings.theme);
    r.classList.toggle('pdf-dark', isPdf && dark);
    r.classList.toggle('mode-scroll', !isPdf && settings.flip === 'scroll');

    // تفعيل الأزرار
    $('#theme-row').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.theme === settings.theme));
    $('#font-row').querySelectorAll('button').forEach((b) => b.classList.toggle('active', FONTS[+b.dataset.i].css === settings.font));
    $('#bgmode-row').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.bg === settings.bg));
    $('#flip-row').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.flip === settings.flip));
    $('#spread-row').querySelectorAll('button').forEach((b) => b.classList.toggle('active', (b.dataset.spread === '1') === !!settings.spread));
    $('#set-ttsrate').value = settings.ttsRate || 100;
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
  function updateHUD() {
    const label = $('#r-page-label');
    const slider = $('#r-slider');
    let cur, total, pct;
    if (isPdf) { cur = pdfPage; total = pageCount; pct = pageCount > 1 ? (pdfPage - 1) / (pageCount - 1) : 1; }
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
    const w = pop.offsetWidth || 300;
    pop.style.left = Math.max(8, Math.min(rect.left + rect.width / 2 - w / 2, innerWidth - w - 8)) + 'px';
    pop.style.top = Math.max(8, rect.top - 54) + 'px';
  }
  function hideHlPopup() { $('#hl-popup').hidden = true; pendingSel = null; }

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
      rebuildText(); renderDrawerPanes(); schedulePersist();
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
    pane.innerHTML = tocItems.map((t, i) =>
      `<button class="toc-item ${t.lvl === 2 ? 'lvl2' : ''}" data-i="${i}">
        <span>${esc(t.label)}</span>${t.page ? `<small>ص ${t.page}</small>` : ''}
      </button>`).join('');
    pane.querySelectorAll('.toc-item').forEach((btn) => {
      btn.onclick = () => {
        const t = tocItems[+btn.dataset.i];
        if (isPdf) { if (t.page) jumpTo(t.page); }
        else if (settings.flip === 'scroll') t.el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else jumpTo(elementPage(t.el));
        closeDrawers();
      };
    });
  }

  function highlightCurrentToc() {
    if (isPdf || !tocItems.length || settings.flip === 'scroll') return;
    let curIdx = -1;
    tocItems.forEach((t, i) => { if (t.el && elementPage(t.el) <= curPage) curIdx = i; });
    document.querySelectorAll('#pane-toc .toc-item').forEach((b, i) => b.classList.toggle('current', i === curIdx));
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
    const pns = (state.pageNotes || []).slice().sort((a, b) => a.page - b.page);
    if (!hls.length && !pns.length) {
      html += `<div class="drawer-empty">${isPdf ? 'لا ملاحظات بعد' : 'ظلّل أي نص أثناء القراءة<br>لإضافة تظليل أو ملاحظة ✨'}</div>`;
    }
    html += hls.map((h) => `
      <div class="note-item" data-hid="${h.id}" style="--c:${h.color}">
        <q>${esc(h.text.trim())}</q>
        ${h.note ? `<div class="n-note">📝 ${esc(h.note)}</div>` : ''}
        <div class="n-meta"><span>${new Date(h.at).toLocaleDateString('ar')}</span><button class="n-del" data-del-h="${h.id}">حذف</button></div>
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
    pane.querySelectorAll('.note-item[data-hid]').forEach((item) => {
      item.onclick = () => { jumpToHighlight(item.dataset.hid); closeDrawers(); };
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
  }

  function bump() { lastActivity = Date.now(); }

  function startTimers() {
    bump();
    clearInterval(tickTimer);
    tickTimer = setInterval(() => {
      if (!isOpen || document.hidden) return;
      if (Date.now() - lastActivity < 90000) {
        state.seconds = (state.seconds || 0) + 5;
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
    if (!was) { d.classList.add('open'); showUI(); }
  }
  function closeDrawers() {
    document.querySelectorAll('.r-drawer').forEach((d) => d.classList.remove('open'));
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
          if (!$('#hl-popup').hidden) hideHlPopup();
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
      const dx = downX != null ? e.clientX - downX : 0;
      downX = null;
      setTimeout(() => {
        const sel = getSelection();
        if (sel && !sel.isCollapsed) { onTextSelection(); return; }
        if (!$('#hl-popup').hidden) { hideHlPopup(); return; }
        // نقر على تظليل موجود
        const mark = e.target.closest && e.target.closest('mark.hl');
        if (mark) {
          pendingMarkId = mark.dataset.id;
          pendingSel = null;
          showHlPopup(mark.getBoundingClientRect(), true);
          return;
        }
        if (e.target.closest('.r-nav, .r-ribbon, button, #r-draw')) return;
        const paged = isPdf || settings.flip !== 'scroll';
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
        } else addHighlight(b.dataset.color, false);
      };
    });
    $('#hl-note-btn').onclick = () => {
      if (pendingMarkId) {
        const h = state.highlights.find((x) => x.id === pendingMarkId);
        hideHlPopup();
        if (h) openNoteModal(h);
      } else addHighlight('#f6d743', true);
    };
    $('#hl-del-btn').onclick = () => {
      if (pendingMarkId) {
        state.highlights = state.highlights.filter((h) => h.id !== pendingMarkId);
        hideHlPopup(); rebuildText(); renderDrawerPanes(); schedulePersist();
      }
    };

    // نافذة الملاحظة
    $('#note-modal').querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => ($('#note-modal').hidden = true)));
    $('#note-modal').onclick = (e) => { if (e.target.id === 'note-modal') $('#note-modal').hidden = true; };

    // تغيير الحجم
    let rzT;
    addEventListener('resize', () => {
      if (!isOpen) return;
      clearTimeout(rzT);
      rzT = setTimeout(() => {
        if (isPdf) renderPdf(pdfPage);
        else { scheduleRepaginate(); }
      }, 200);
    });

    // سحب باللمس
    let touchX = null;
    $('#r-stage').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    $('#r-stage').addEventListener('touchend', (e) => {
      if (touchX == null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      touchX = null;
      // لا تقليب أثناء تحديد نص للتظليل أو أثناء الكتابة على الصفحة
      const sel = getSelection();
      if ((sel && !sel.isCollapsed) || drawMode) return;
      if (Math.abs(dx) > 60 && (isPdf || settings.flip !== 'scroll')) {
        if (dx > 0) next(); else prev(); // سحب لليمين = التالية (RTL)
      }
    }, { passive: true });
  }

  return { open, close, wire };
})();
