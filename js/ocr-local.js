/* ═══════ مِداد — استخراج النص على الجهاز (Tesseract) ═══════
   محرّك OCR مفتوح المصدر يعمل داخل المتصفح نفسه: بلا مفتاح ولا خادم ولا كلفة.
   يُحمَّل عند أول استعمال فقط (المكتبة من jsDelivr، ونموذج العربية يُخزَّن في المتصفح بعد أول تنزيل).
   غرضه الأول البحث: دقّته أقل من Gemini في الطبعات القديمة، لكن البحث يتسامح مع أخطاء قليلة. */
const LocalOCR = (() => {
  const SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const PX = 1600; // أطول ضلع للصفحة المرسومة: دقّة كافية للعربية المشكولة دون إبطاء
  let loading = null, scheduler = null, nWorkers = 0, idleTimer = null;

  // عدد العمّال المتوازين: نصف أنوية المعالج، بحدّ ٤ على الحاسب و٢ على الجوال (حرارة وبطارية)
  function workerCount() {
    const hc = navigator.hardwareConcurrency || 2;
    let coarse = false; try { coarse = matchMedia('(pointer: coarse)').matches; } catch {}
    return Math.max(1, Math.min(coarse ? 2 : 4, Math.floor(hc / 2)));
  }
  function loadLib() {
    if (window.Tesseract) return Promise.resolve();
    if (!loading) loading = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = SRC; s.async = true;
      s.onload = () => res();
      s.onerror = () => { loading = null; rej(new Error('تعذّر تحميل محرّك الاستخراج — تحقّق من الاتصال')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  async function init(onStatus) {
    clearTimeout(idleTimer);
    if (scheduler) return nWorkers;
    if (onStatus) onStatus('جارٍ تحميل محرّك الاستخراج (أول مرة فقط)…');
    await loadLib();
    const n = workerCount();
    const sch = Tesseract.createScheduler();
    for (let i = 0; i < n; i++) {
      if (onStatus) onStatus(`تجهيز محرّك العربية… (${i + 1}/${n})`);
      sch.addWorker(await Tesseract.createWorker('ara', 1));
    }
    scheduler = sch; nWorkers = n;
    return n;
  }
  // ارسم صفحة PDF على لوحة بالدقّة المناسبة
  async function renderPage(pdf, n) {
    const page = await pdf.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, PX / Math.max(v1.width, v1.height)) });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp, intent: 'print' }).promise;
    try { page.cleanup(); } catch {}
    return c;
  }
  // تنظيف الناتج: علامات الاتجاه الخفية، والمسافات الزائدة، والأسطر الفارغة المتكرّرة
  const clean = (t) => String(t || '').replace(/[‎‏‪-‮⁦-⁩]/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  async function recognizePage(pdf, n) {
    if (!scheduler) await init();
    const c = await renderPage(pdf, n);
    const { data } = await scheduler.addJob('recognize', c);
    c.width = c.height = 0; // حرّر الذاكرة فوراً
    return { text: clean(data.text), confidence: data.confidence || 0 };
  }
  /* صفحة مع مواضع كلماتها (للقراءة الحيّة: طبقة نص شفّافة قابلة للتحديد فوق الصفحة المصوّرة).
     الإحداثيات نسبية (0–1) فتصلح لأي مقاس عرض. الكلمات مرتّبة سطراً سطراً، ومن اليمين في الأسطر العربية. */
  async function recognizePageWords(pdf, n) {
    if (!scheduler) await init();
    const c = await renderPage(pdf, n);
    const W = c.width, H = c.height;
    const { data } = await scheduler.addJob('recognize', c);
    c.width = c.height = 0;
    const AR = /[؀-ۿ]/;
    const src = (data.lines && data.lines.length) ? data.lines : [{ words: data.words || [] }];
    const lines = [];
    for (const ln of src) {
      let ws = (ln.words || []).filter((w) => w && w.text && w.text.trim() && w.bbox && (w.confidence == null || w.confidence > 25))
        .map((w) => ({ t: clean(w.text), b: [w.bbox.x0 / W, w.bbox.y0 / H, w.bbox.x1 / W, w.bbox.y1 / H].map((v) => Math.round(v * 1e4) / 1e4) }))
        .filter((w) => w.t);
      if (!ws.length) continue;
      const ar = ws.filter((w) => AR.test(w.t)).length * 2 >= ws.length;
      ws.sort((a, b) => (ar ? b.b[0] - a.b[0] : a.b[0] - b.b[0]));
      lines.push(ws);
    }
    lines.sort((a, b) => a[0].b[1] - b[0].b[1]);
    return { text: lines.map((l) => l.map((w) => w.t).join(' ')).join('\n'), lines, conf: data.confidence || 0 };
  }
  // صورة جاهزة (لوحة/صورة) — لالتقاط اقتباس من كتاب ورقي
  async function recognizeCanvas(c, onStatus) {
    if (!scheduler) await init(onStatus);
    const { data } = await scheduler.addJob('recognize', c);
    return { text: clean(data.text), confidence: data.confidence || 0 };
  }
  // أغلق العمّال بعد دقيقة خمول (كل عامل يحجز ذاكرة معتبرة)
  function release() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => { if (scheduler) { try { await scheduler.terminate(); } catch {} scheduler = null; nWorkers = 0; } }, 60000);
  }
  return { init, recognizePage, recognizePageWords, recognizeCanvas, release, workers: () => nWorkers || workerCount() };
})();
window.LocalOCR = LocalOCR;
