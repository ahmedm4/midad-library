/* ═══════ مِداد — الاستوديو: بطاقات الاقتباس المصمَّمة + «سنتي في القراءة» ═══════
   كل شيء يُرسم على لوحة (canvas) على الجهاز نفسه: ما تراه في المعاينة هو الصورة التي تُشارَك حرفياً. */
const Studio = (() => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, k) => { try { Library.toast(m, k); } catch {} };
  const LS = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const LSset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  /* ── أدوات رسم مشتركة ── */
  // لفّ النص على أسطر بعرض أقصى، مع احترام الأسطر الأصلية
  function wrap(x, text, maxW) {
    const out = [];
    for (const para of String(text).split(/\n+/)) {
      const words = para.trim().split(/\s+/).filter(Boolean);
      let line = '';
      for (const w of words) {
        const t = line ? line + ' ' + w : w;
        if (x.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
      }
      if (line) out.push(line);
    }
    return out;
  }
  // اختصر سطراً واحداً ليتّسع
  function fit1(x, t, maxW) {
    t = String(t || '');
    if (x.measureText(t).width <= maxW) return t;
    while (t.length > 1 && x.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t.trim() + '…';
  }
  async function fontsReady(list) {
    try { await Promise.all(list.map((f) => document.fonts.load(f))); } catch {}
  }
  function loadImg(src) {
    return new Promise((res) => {
      if (!src) return res(null);
      const im = new Image();
      if (!/^data:|^blob:/.test(src)) im.crossOrigin = 'anonymous';
      im.onload = () => res(im); im.onerror = () => res(null);
      im.src = src;
    });
  }
  // نجمة ثمانية (زخرفة إسلامية) — خطوط رفيعة
  function star8(x, cx, cy, r) {
    x.beginPath();
    for (let i = 0; i < 16; i++) {
      const a = (Math.PI / 8) * i - Math.PI / 2, rr = i % 2 ? r * 0.62 : r;
      const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
      i ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.closePath();
  }
  function pattern(x, W, H, color, step = 180) {
    x.save(); x.strokeStyle = color; x.lineWidth = 1.4;
    for (let yy = -step / 2, row = 0; yy < H + step; yy += step, row++)
      for (let xx = (row % 2) * step / 2 - step / 2; xx < W + step; xx += step) { star8(x, xx, yy, step * 0.36); x.stroke(); }
    x.restore();
  }
  async function blobOf(c) { return new Promise((r) => c.toBlob(r, 'image/png')); }
  async function shareOrSave(blob, name, title) {
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancel'; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('حُفظت الصورة 🖼', 'gold');
    return 'saved';
  }

  /* ═══════ بطاقات الاقتباس ═══════ */
  const TPL = {
    night: { name: 'ليلي ذهبي', sw: 'linear-gradient(135deg,#2a1f40,#0e0b16)', ink: '#f3ecd9', accent: '#d9a94f', sub: '#a79fbb', g: ['#241a38', '#171226', '#0e0b16'], glow: 'rgba(75,45,127,.55)', pat: 'rgba(217,169,79,.05)', frame: 1 },
    paper: { name: 'ورق عتيق', sw: 'linear-gradient(135deg,#f4e7c8,#dcc597)', ink: '#3b2a17', accent: '#8a5a2b', sub: '#7a6450', g: ['#f6ead0', '#ecdcb6', '#dcc597'], glow: 'rgba(255,255,255,.45)', pat: 'rgba(138,90,43,.07)', frame: 2, grain: 1 },
    emerald: { name: 'زمرّدي', sw: 'linear-gradient(135deg,#145246,#061915)', ink: '#eef6ef', accent: '#d3b86f', sub: '#9cc2b6', g: ['#145246', '#0b2e27', '#061915'], glow: 'rgba(60,170,140,.35)', pat: 'rgba(211,184,111,.06)', frame: 1 },
    sea: { name: 'بحري', sw: 'linear-gradient(135deg,#1b4570,#08121f)', ink: '#eaf2fb', accent: '#8cc8ff', sub: '#9bb3cc', g: ['#1b4570', '#10263f', '#08121f'], glow: 'rgba(120,190,255,.3)', pat: 'rgba(140,200,255,.06)', frame: 1 },
    rose: { name: 'وردي', sw: 'linear-gradient(135deg,#5a2a3d,#1b0f15)', ink: '#fbeef2', accent: '#f0a6bd', sub: '#c99aab', g: ['#5a2a3d', '#2f1622', '#1b0f15'], glow: 'rgba(240,166,189,.28)', pat: 'rgba(240,166,189,.06)', frame: 1 },
    white: { name: 'أبيض بسيط', sw: 'linear-gradient(135deg,#ffffff,#efebe3)', ink: '#1d1a16', accent: '#b0893f', sub: '#7c766c', g: ['#fdfcf9', '#f7f4ee', '#efebe3'], glow: 'rgba(255,255,255,0)', pat: 'rgba(0,0,0,0)', frame: 0 },
    cover: { name: 'غلاف الكتاب', sw: 'linear-gradient(135deg,#555,#111)', ink: '#ffffff', accent: '#ffd98a', sub: '#e3dccd', g: ['#222', '#111', '#000'], glow: 'rgba(0,0,0,0)', pat: 'rgba(255,255,255,0)', frame: 1, cover: 1 },
  };
  const FONTS = [
    { id: 'Amiri', name: 'أميري', w: 700, lh: 1.7 },
    { id: 'Noto Naskh Arabic', name: 'نسخ', w: 600, lh: 1.75 },
    { id: 'Aref Ruqaa', name: 'رقعة', w: 700, lh: 1.85 },
    { id: 'Reem Kufi', name: 'كوفي', w: 500, lh: 1.6 },
    { id: 'El Messiri', name: 'المسيري', w: 600, lh: 1.65 },
    { id: 'Scheherazade New', name: 'شهرزاد', w: 700, lh: 1.6 },
  ];
  const SIZES = { post: { w: 1080, h: 1350, name: 'منشور' }, square: { w: 1080, h: 1080, name: 'مربّع' }, story: { w: 1080, h: 1920, name: 'قصّة' } };

  function drawQuote(c, o) {
    const S = SIZES[o.size] || SIZES.post, W = S.w, H = S.h, t = TPL[o.tpl] || TPL.night;
    const F = FONTS.find((f) => f.id === o.font) || FONTS[0];
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    // الخلفية
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, t.g[0]); g.addColorStop(0.55, t.g[1]); g.addColorStop(1, t.g[2]);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    if (t.cover && o.coverImg) {
      const im = o.coverImg, sc = Math.max(W / im.width, H / im.height) * 1.15;
      x.save(); x.filter = 'blur(26px) saturate(1.2) brightness(.5)';
      x.drawImage(im, (W - im.width * sc) / 2, (H - im.height * sc) / 2, im.width * sc, im.height * sc);
      x.restore();
      const v = x.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,.05)'); v.addColorStop(1, 'rgba(0,0,0,.55)');
      x.fillStyle = v; x.fillRect(0, 0, W, H);
    }
    const rg = x.createRadialGradient(W / 2, H * 0.1, 40, W / 2, H * 0.1, H * 0.55);
    rg.addColorStop(0, t.glow); rg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = rg; x.fillRect(0, 0, W, H);
    pattern(x, W, H, t.pat);
    if (t.grain) { // حبيبات ورق خفيفة
      x.save(); for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(110,80,40,${Math.random() * 0.06})`; x.fillRect(Math.random() * W, Math.random() * H, 2, 2); } x.restore();
    }
    // الإطار
    x.strokeStyle = t.accent;
    if (t.frame === 1) {
      x.globalAlpha = 0.55; x.lineWidth = 3; x.strokeRect(46, 46, W - 92, H - 92);
      x.globalAlpha = 0.25; x.lineWidth = 1.5; x.strokeRect(62, 62, W - 124, H - 124); x.globalAlpha = 1;
    } else if (t.frame === 2) {
      x.globalAlpha = 0.6; x.lineWidth = 2.5; x.strokeRect(54, 54, W - 108, H - 108); x.globalAlpha = 1;
      for (const [cx, cy] of [[54, 54], [W - 54, 54], [54, H - 54], [W - 54, H - 54]]) { x.fillStyle = t.g[1]; star8(x, cx, cy, 22); x.fill(); x.lineWidth = 2; x.stroke(); }
    } else {
      x.fillStyle = t.accent; x.fillRect(W / 2 - 50, 92, 100, 5);
    }
    x.direction = 'rtl'; x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    // المساحات: أعلى للزخرفة، أسفل للكتاب والعلامة
    const foot = (o.showBook ? 170 : 0) + (o.showBrand ? 120 : 40);
    const top = H >= 1900 ? 380 : H > 1200 ? 250 : 210;
    const avail = H - top - foot - 80, maxW = W - 230;
    x.fillStyle = t.accent; x.font = `${H > 1200 ? 92 : 74}px 'Amiri', serif`;
    x.fillText('❝', W / 2, top - 40);
    // حجم الخط: يبدأ بحسب الطول ثم يصغر حتى يتّسع الكتلة
    const len = o.text.length;
    let fs = Math.round((len > 260 ? 44 : len > 160 ? 52 : len > 80 ? 62 : 74) * (H >= 1900 ? 1.3 : 1) * (o.scale || 1));
    let lines, lh;
    for (;;) {
      x.font = `${F.w} ${fs}px '${F.id}', 'Amiri', serif`;
      lines = wrap(x, o.text, maxW); lh = fs * F.lh;
      if (lines.length * lh <= avail || fs <= 24) break;
      fs -= 2;
    }
    const blockH = lines.length * lh;
    let y = top + Math.max(0, (avail - blockH) / 2) + fs;
    x.fillStyle = t.ink;
    if (t.cover) { x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 12; }
    for (const ln of lines) { x.fillText(ln, W / 2, y); y += lh; }
    x.shadowBlur = 0;
    let fy = H - foot - 10;
    if (o.showBook) {
      x.strokeStyle = t.accent; x.globalAlpha = 0.7; x.lineWidth = 2;
      x.beginPath(); x.moveTo(W / 2 - 60, fy + 10); x.lineTo(W / 2 + 60, fy + 10); x.stroke(); x.globalAlpha = 1;
      x.fillStyle = t.accent; x.font = "600 40px 'Amiri', serif";
      x.fillText(fit1(x, o.title || '', W - 220), W / 2, fy + 76);
      const sub = [o.author, o.page ? 'ص ' + o.page : ''].filter(Boolean).join(' · ');
      if (sub) { x.fillStyle = t.sub; x.font = "400 30px 'Tajawal', sans-serif"; x.fillText(fit1(x, sub, W - 220), W / 2, fy + 124); }
    }
    if (o.showBrand) {
      x.fillStyle = t.accent; x.globalAlpha = 0.9; x.font = "700 42px 'Aref Ruqaa', 'Amiri', serif";
      x.fillText('مِداد', W / 2, H - 92); x.globalAlpha = 1;
    }
    return c;
  }

  // مصمّم البطاقة: معاينة حيّة + قوالب + خطوط + مقاسات
  async function quoteCard(q) {
    let text = String(q.text || '').trim();
    if (!text) return;
    if (text.length > 600) text = text.slice(0, 597).trim() + '…';
    const pref = Object.assign({ tpl: 'night', font: 'Amiri', size: 'post', scale: 1, showBook: true, showBrand: true }, LS('midad-qcard', {}));
    const o = Object.assign({}, pref, { text, title: q.title || '', author: q.author || '', page: q.page || '' });
    const coverImg = await loadImg(q.cover);
    // القالب «غلاف الكتاب» يحتاج صورة غلاف قابلة للرسم
    let coverOk = false;
    if (coverImg) { try { const t = document.createElement('canvas'); t.width = t.height = 4; const tx = t.getContext('2d'); tx.drawImage(coverImg, 0, 0, 4, 4); tx.getImageData(0, 0, 1, 1); coverOk = true; } catch {} }
    if (o.tpl === 'cover' && !coverOk) o.tpl = 'night';
    o.coverImg = coverOk ? coverImg : null;

    const dlg = document.createElement('div');
    dlg.className = 'ui-dialog qd-dialog';
    const chips = (k, list) => list.map(([id, label, style]) => `<button class="qd-chip${o[k] === id ? ' on' : ''}" data-k="${k}" data-v="${esc(id)}"${style ? ` style="${style}"` : ''}>${label}</button>`).join('');
    dlg.innerHTML = `<div class="ud-box qd-box" role="dialog" aria-modal="true" aria-label="بطاقة اقتباس">
      <h3>🖼 بطاقة اقتباس</h3>
      <div class="qd-prev"><canvas class="qd-canvas" role="img" aria-label="معاينة البطاقة"></canvas></div>
      <div class="qd-ctl">
        <div class="qd-row"><span class="qd-lbl">القالب</span><div class="qd-chips">${chips('tpl', Object.entries(TPL).filter(([id]) => id !== 'cover' || coverOk).map(([id, t]) => [id, `<i class="qd-sw" style="background:${t.sw}"></i>${t.name}`]))}</div></div>
        <div class="qd-row"><span class="qd-lbl">الخط</span><div class="qd-chips">${chips('font', FONTS.map((f) => [f.id, f.name, `font-family:'${f.id}',serif;font-weight:${f.w}`]))}</div></div>
        <div class="qd-row"><span class="qd-lbl">المقاس</span><div class="qd-chips">${chips('size', Object.entries(SIZES).map(([id, s]) => [id, s.name]))}</div></div>
        <div class="qd-row"><span class="qd-lbl">حجم النص</span><input type="range" class="qd-scale" min="70" max="130" step="5" value="${Math.round(o.scale * 100)}" aria-label="حجم النص"></div>
        <div class="qd-row qd-checks"><label><input type="checkbox" class="qd-book"${o.showBook ? ' checked' : ''}> اسم الكتاب</label><label><input type="checkbox" class="qd-brand"${o.showBrand ? ' checked' : ''}> علامة مِداد</label></div>
        <details class="qd-edit"><summary>✏️ عدّل النص أو اختصره</summary><textarea class="qd-text" rows="4">${esc(text)}</textarea></details>
      </div>
      <div class="ud-actions"><button class="btn-gold qd-share">📤 شارك</button><button class="qd-save">⬇ احفظ</button>${window.ClipboardItem ? '<button class="qd-copy">📋 انسخ</button>' : ''}<button class="ud-cancel">إغلاق</button></div>
    </div>`;
    document.body.appendChild(dlg);
    const cv = dlg.querySelector('.qd-canvas');
    let busy = 0;
    const redraw = async () => {
      const my = ++busy;
      const F = FONTS.find((f) => f.id === o.font) || FONTS[0];
      await fontsReady([`${F.w} 60px '${F.id}'`, "700 60px 'Amiri'", "400 30px 'Tajawal'", "700 42px 'Aref Ruqaa'"]);
      if (my !== busy) return;
      drawQuote(cv, o);
      cv.style.aspectRatio = `${cv.width} / ${cv.height}`;
      const save = {}; for (const k of ['tpl', 'font', 'size', 'scale', 'showBook', 'showBrand']) save[k] = o[k];
      LSset('midad-qcard', save);
    };
    dlg.querySelectorAll('.qd-chip').forEach((b) => (b.onclick = () => {
      o[b.dataset.k] = b.dataset.v;
      dlg.querySelectorAll(`.qd-chip[data-k="${b.dataset.k}"]`).forEach((z) => z.classList.toggle('on', z === b));
      redraw();
    }));
    dlg.querySelector('.qd-scale').oninput = (e) => { o.scale = +e.target.value / 100; redraw(); };
    dlg.querySelector('.qd-book').onchange = (e) => { o.showBook = e.target.checked; redraw(); };
    dlg.querySelector('.qd-brand').onchange = (e) => { o.showBrand = e.target.checked; redraw(); };
    let tt; dlg.querySelector('.qd-text').oninput = (e) => { clearTimeout(tt); tt = setTimeout(() => { o.text = e.target.value.trim() || text; redraw(); }, 250); };
    const close = () => dlg.remove();
    dlg.querySelector('.ud-cancel').onclick = close;
    dlg.onclick = (e) => { if (e.target === dlg) close(); };
    const name = () => `اقتباس - ${(o.title || 'مداد').slice(0, 40)}.png`;
    dlg.querySelector('.qd-share').onclick = async () => { const b = await blobOf(cv); if (b) shareOrSave(b, name(), 'اقتباس من ' + (o.title || '')); };
    dlg.querySelector('.qd-save').onclick = async () => {
      const b = await blobOf(cv); if (!b) return;
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name(); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000); toast('حُفظت البطاقة 🖼', 'gold');
    };
    const cp = dlg.querySelector('.qd-copy');
    if (cp) cp.onclick = async () => {
      try { const b = await blobOf(cv); await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]); toast('✓ نُسخت الصورة — الصقها حيث شئت', 'gold'); }
      catch { toast('تعذّر النسخ — استعمل «احفظ»'); }
    };
    await redraw();
  }

  /* ═══════ سنتي في القراءة ═══════ */
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const PAL = [
    ['#3b2368', '#1a1030', '#0b0716', '#e9c887'], ['#0f4c5c', '#0a2a36', '#06141b', '#7fe0d0'], ['#5c1f3f', '#2c0f20', '#140710', '#ffb4cf'],
    ['#1d3f75', '#0f2142', '#070f22', '#9cc8ff'], ['#4a3a0f', '#2a2008', '#140f03', '#ffd56b'], ['#1f5135', '#0e2a1b', '#06150d', '#a8e6a1'],
    ['#4b1f6b', '#24103a', '#10071c', '#d9b3ff'], ['#6b2f12', '#381709', '#1a0a03', '#ffbf8a'], ['#26244f', '#141330', '#090818', '#e9c887'],
  ];
  // تمييز العدد بالعربية: ١ مفرد، ٢ مثنى، ٣–١٠ جمع، ١١+ مفرد منصوب
  const cnt = (n, one, two, few, many) => (n === 1 ? one : n === 2 ? two : (n % 100 >= 3 && n % 100 <= 10) ? `${n} ${few}` : `${n} ${many}`);
  const yearKeys = (log, Y) => Object.keys(log).filter((k) => k.startsWith(Y + '-') && log[k] > 0);
  const hoursOf = (sec) => Math.floor(sec / 3600);

  function computeYear(d, Y) {
    const { books, states, log, quotes } = d;
    const yS = new Date(Y, 0, 1).getTime(), yE = new Date(Y + 1, 0, 1).getTime();
    const inY = (t) => t >= yS && t < yE;
    const keys = yearKeys(log, Y).sort();
    let total = 0; const month = new Array(12).fill(0), wday = new Array(7).fill(0); let best = null;
    for (const k of keys) {
      const s = log[k]; total += s;
      const [yy, mm, dd] = k.split('-').map(Number), dt = new Date(yy, mm - 1, dd);
      month[mm - 1] += s; wday[dt.getDay()] += s;
      if (!best || s > best.s) best = { s, dt };
    }
    const active = keys.filter((k) => log[k] >= 60);
    // أطول سلسلة أيام متتالية (دقيقة على الأقل)
    let streak = 0, run = 0, prev = null;
    for (const k of active) {
      const [yy, mm, dd] = k.split('-').map(Number), t = new Date(yy, mm - 1, dd).getTime();
      run = prev != null && Math.round((t - prev) / 864e5) === 1 ? run + 1 : 1;
      streak = Math.max(streak, run); prev = t;
    }
    const finished = books.filter((b) => states[b.id] && states[b.id].finished && inY(states[b.id].finishedAt || 0))
      .sort((a, b) => states[a.id].finishedAt - states[b.id].finishedAt);
    const touched = books.filter((b) => states[b.id] && (inY(states[b.id].lastRead || 0) || finished.includes(b)) && !b.guide);
    const pages = finished.reduce((n, b) => n + (b.pages || 0), 0);
    const top = touched.slice().sort((a, b) => (states[b.id].seconds || 0) - (states[a.id].seconds || 0))[0] || null;
    const tally = (fn) => {
      const m = new Map();
      for (const b of touched) { const k = String(fn(b) || '').trim(); if (!k || k === 'أخرى') continue; const s = (states[b.id].seconds || 0) + (finished.includes(b) ? 3600 : 0); m.set(k, (m.get(k) || 0) + s); }
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const authors = tally((b) => b.author), cats = tally((b) => b.category);
    const qy = quotes.filter((q) => inY(q.at || 0));
    const pool = qy.filter((q) => q.text.length >= 30 && q.text.length <= 240);
    const fq = pool.find((q) => q.note) || pool.sort((a, b) => Math.abs(a.text.length - 120) - Math.abs(b.text.length - 120))[0] || qy[0] || null;
    const bestMonth = month.indexOf(Math.max(...month)), bestDay = wday.indexOf(Math.max(...wday));
    return { Y, total, days: active.length, month, wday, best, streak, finished, touched, pages, top, authors, cats, quotes: qy, fq, bestMonth, bestDay, goal: d.yearGoal || 12, words: d.words || 0 };
  }
  function persona(r) {
    const h = r.total / 3600;
    if (r.finished.length >= 24) return { e: '🦉', t: 'الملتهِم النهِم', d: 'كتابان في الشهر أو أكثر: الكتب عندك وجبة يومية.' };
    if (r.streak >= 30 || r.days >= 200) return { e: '🏔️', t: 'القارئ المثابر', d: 'تعود إلى كتابك يوماً بعد يوم، والعادة عندك أقوى من المزاج.' };
    if (r.quotes.length >= 60) return { e: '🖋️', t: 'صيّاد الأفكار', d: 'لا تمرّ عليك عبارة جميلة دون أن تحفظها.' };
    if (r.wday[5] + r.wday[6] > r.total * 0.45) return { e: '☕', t: 'قارئ العطلات', d: 'تدّخر أجمل ساعات القراءة لأيام الراحة.' };
    if (r.touched.length >= 15 && r.finished.length < r.touched.length / 3) return { e: '🧭', t: 'المستكشف', d: 'تتذوّق كتباً كثيرة وتبحث دائماً عن الكتاب التالي.' };
    if (h >= 50) return { e: '🌙', t: 'رفيق الكتب', d: 'ساعات طويلة بصحبة الورق — القراءة جزء من يومك.' };
    return { e: '🌱', t: 'القارئ الصاعد', d: 'بداية جميلة — والسنة القادمة تنتظر منك المزيد.' };
  }

  function slideBg(x, W, H, p, seed) {
    const g = x.createLinearGradient(0, 0, W * 0.3, H);
    g.addColorStop(0, p[0]); g.addColorStop(0.5, p[1]); g.addColorStop(1, p[2]);
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    const blob = (cx, cy, r, a) => { const rg = x.createRadialGradient(cx, cy, 0, cx, cy, r); rg.addColorStop(0, p[3] + a); rg.addColorStop(1, p[3] + '00'); x.fillStyle = rg; x.fillRect(0, 0, W, H); };
    blob(W * (0.15 + (seed % 3) * 0.3), H * 0.12, 620, '33'); blob(W * (0.85 - (seed % 2) * 0.6), H * 0.88, 700, '22');
    pattern(x, W, H, p[3] + '0d', 200);
  }
  function T(x, s, X, Y, font, color, align = 'center') { x.font = font; x.fillStyle = color; x.textAlign = align; x.fillText(s, X, Y); }
  function slides(r) {
    const W = 1080, H = 1920, out = [];
    const fmtH = (sec) => { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h ? `${h} ساعة${m ? ' و' + m + ' دقيقة' : ''}` : `${m} دقيقة`; };
    const mk = (i, fn) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'); x.direction = 'rtl'; x.textBaseline = 'alphabetic'; const p = PAL[i % PAL.length]; slideBg(x, W, H, p, i); fn(x, p); T(x, 'مِداد', W / 2, H - 90, "700 46px 'Aref Ruqaa', serif", p[3] + 'cc'); out.push(c); };
    const ink = '#fbf6ea', soft = 'rgba(251,246,234,.72)';
    // ١ الافتتاح
    mk(0, (x, p) => {
      T(x, 'سنتك في القراءة', W / 2, 640, "700 76px 'El Messiri', sans-serif", soft);
      T(x, String(r.Y), W / 2, 960, "800 300px 'Reem Kufi', sans-serif", p[3]);
      T(x, 'حكايتك مع الكتب هذا العام', W / 2, 1120, "400 50px 'Tajawal', sans-serif", ink);
      T(x, 'اضغط لتتابع ←', W / 2, 1500, "400 38px 'Tajawal', sans-serif", soft);
    });
    // ٢ الوقت
    mk(1, (x, p) => {
      T(x, 'قضيتَ مع الكتب', W / 2, 560, "500 60px 'El Messiri', sans-serif", soft);
      const h = hoursOf(r.total), m = Math.round((r.total % 3600) / 60);
      T(x, h ? String(h) : String(m), W / 2, 900, "800 320px 'Reem Kufi', sans-serif", p[3]);
      T(x, h ? 'ساعة' + (m ? ` و${m} دقيقة` : '') : 'دقيقة', W / 2, 1010, "600 64px 'El Messiri', sans-serif", ink);
      T(x, `في ${cnt(r.days, 'يوم واحد', 'يومين', 'أيام', 'يوماً')} من أيام السنة`, W / 2, 1180, "400 48px 'Tajawal', sans-serif", ink);
      if (r.best) T(x, `أطول يوم: ${fmtH(r.best.s)} — ${r.best.dt.getDate()} ${MONTHS[r.best.dt.getMonth()]}`, W / 2, 1290, "400 40px 'Tajawal', sans-serif", soft);
      if (h >= 4) T(x, `≈ ${Math.round(r.total / 3600 / 2)} فيلماً طويلاً… لكنّك اخترت الكتب 📚`, W / 2, 1420, "400 40px 'Tajawal', sans-serif", soft);
    });
    // ٣ الإيقاع
    mk(2, (x, p) => {
      T(x, 'إيقاعك', W / 2, 400, "700 80px 'El Messiri', sans-serif", ink);
      T(x, String(r.streak), W / 2, 700, "800 240px 'Reem Kufi', sans-serif", p[3]);
      T(x, (r.streak % 100 >= 3 && r.streak % 100 <= 10 ? 'أيام متتالية' : r.streak === 1 ? 'يوم واحد' : r.streak === 2 ? 'يومان متتاليان' : 'يوماً متتالياً') + ' — أطول سلسلة لك', W / 2, 790, "500 48px 'Tajawal', sans-serif", ink);
      const mx = Math.max(1, ...r.month), bw = 58, gap = 12, x0 = W / 2 + (12 * (bw + gap) - gap) / 2, base = 1330;
      for (let i = 0; i < 12; i++) {
        const hh = Math.max(6, (r.month[i] / mx) * 360), bx = x0 - (i + 1) * bw - i * gap;
        x.fillStyle = i === r.bestMonth ? p[3] : 'rgba(255,255,255,.22)';
        x.beginPath(); x.roundRect ? x.roundRect(bx, base - hh, bw, hh, 12) : x.rect(bx, base - hh, bw, hh); x.fill();
        T(x, MONTHS[i].slice(0, 3), bx + bw / 2, base + 50, "400 26px 'Tajawal', sans-serif", soft);
      }
      T(x, `أنشط شهورك: ${MONTHS[r.bestMonth]}`, W / 2, 1500, "600 50px 'El Messiri', sans-serif", ink);
      T(x, `ويومك المفضّل للقراءة: ${DAYS[r.bestDay]}`, W / 2, 1580, "400 42px 'Tajawal', sans-serif", soft);
    });
    // ٤ الكتب المكتملة
    mk(3, (x, p) => {
      T(x, 'أنهيتَ', W / 2, 420, "600 64px 'El Messiri', sans-serif", soft);
      const n = r.finished.length, pct = Math.min(1, n / Math.max(1, r.goal));
      x.lineWidth = 34; x.lineCap = 'round';
      x.strokeStyle = 'rgba(255,255,255,.14)'; x.beginPath(); x.arc(W / 2, 700, 210, 0, Math.PI * 2); x.stroke();
      x.strokeStyle = p[3]; x.beginPath(); x.arc(W / 2, 700, 210, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, pct)); x.stroke();
      T(x, String(n), W / 2, 770, "800 200px 'Reem Kufi', sans-serif", ink);
      T(x, n === 1 ? 'كتاباً واحداً' : n === 2 ? 'كتابين' : (n % 100 >= 3 && n % 100 <= 10) ? 'كتب' : 'كتاباً', W / 2, 1010, "600 58px 'El Messiri', sans-serif", ink);
      T(x, n >= r.goal ? `🎯 تجاوزتَ هدفك (${r.goal}) — أحسنت!` : `من هدفك: ${r.goal} كتاباً`, W / 2, 1090, "400 42px 'Tajawal', sans-serif", soft);
      let y = 1220;
      x.font = "600 42px 'Amiri', serif";
      for (const b of r.finished.slice(-6).reverse()) { T(x, '• ' + fit1(x, b.title, W - 240), W / 2, y, "600 42px 'Amiri', serif", ink); y += 66; }
      if (r.finished.length > 6) T(x, `و${r.finished.length - 6} غيرها`, W / 2, y + 6, "400 36px 'Tajawal', sans-serif", soft);
      if (r.pages) T(x, `≈ ${r.pages.toLocaleString('en')} صفحة`, W / 2, 1700, "500 44px 'Tajawal', sans-serif", p[3]);
    });
    // ٥ رفيق السنة
    if (r.top) mk(4, (x, p) => {
      T(x, 'رفيقك الأطول هذا العام', W / 2, 480, "600 60px 'El Messiri', sans-serif", soft);
      T(x, '📖', W / 2, 760, "200px serif", ink);
      x.font = "700 80px 'Amiri', serif";
      const ls = wrap(x, r.top.title, W - 200).slice(0, 3); let y = 980;
      for (const l of ls) { T(x, l, W / 2, y, "700 80px 'Amiri', serif", p[3]); y += 120; }
      if (r.top.author) T(x, r.top.author, W / 2, y + 20, "400 48px 'Tajawal', sans-serif", ink);
      const s = (r.top.id && r.states0 && r.states0[r.top.id]) ? r.states0[r.top.id].seconds : 0;
      if (s) T(x, `${fmtH(s)} من القراءة`, W / 2, y + 120, "500 44px 'Tajawal', sans-serif", soft);
    });
    // ٦ المفضّلون
    if (r.authors.length || r.cats.length) mk(5, (x, p) => {
      T(x, 'ذوقك', W / 2, 420, "700 84px 'El Messiri', sans-serif", ink);
      let y = 640;
      if (r.authors.length) {
        T(x, 'كاتبك الأقرب', W / 2, y, "500 46px 'Tajawal', sans-serif", soft);
        x.font = "700 76px 'Amiri', serif"; T(x, fit1(x, r.authors[0][0], W - 180), W / 2, y + 110, "700 76px 'Amiri', serif", p[3]);
        if (r.authors[1]) T(x, 'ثم: ' + r.authors.slice(1, 3).map((a) => a[0]).join(' · '), W / 2, y + 190, "400 38px 'Tajawal', sans-serif", soft);
        y += 380;
      }
      if (r.cats.length) {
        T(x, 'الموضوع الذي شغلك', W / 2, y, "500 46px 'Tajawal', sans-serif", soft);
        T(x, r.cats[0][0], W / 2, y + 110, "700 76px 'El Messiri', sans-serif", p[3]);
        if (r.cats[1]) T(x, 'ثم: ' + r.cats.slice(1, 3).map((a) => a[0]).join(' · '), W / 2, y + 190, "400 38px 'Tajawal', sans-serif", soft);
      }
      T(x, `${cnt(r.touched.length, 'كتاب واحد', 'كتابان', 'كتب', 'كتاباً')} فتحتها هذا العام`, W / 2, 1640, "400 42px 'Tajawal', sans-serif", ink);
    });
    // ٧ الاقتباس
    if (r.fq) mk(6, (x, p) => {
      T(x, `حفظتَ ${cnt(r.quotes.length, 'اقتباساً واحداً', 'اقتباسين', 'اقتباسات', 'اقتباساً')}${r.words ? ` و${cnt(r.words, 'كلمة', 'كلمتين', 'كلمات', 'كلمة')}` : ''}`, W / 2, 380, "600 56px 'El Messiri', sans-serif", soft);
      T(x, 'ومن أجملها', W / 2, 460, "400 44px 'Tajawal', sans-serif", soft);
      T(x, '❝', W / 2, 640, "120px 'Amiri', serif", p[3]);
      let fs = r.fq.text.length > 160 ? 56 : 66; x.font = `700 ${fs}px 'Amiri', serif`;
      let ls = wrap(x, r.fq.text, W - 220); while (ls.length * fs * 1.7 > 760 && fs > 34) { fs -= 4; x.font = `700 ${fs}px 'Amiri', serif`; ls = wrap(x, r.fq.text, W - 220); }
      let y = 760 + Math.max(0, (760 - ls.length * fs * 1.7) / 2);
      for (const l of ls) { T(x, l, W / 2, y, `700 ${fs}px 'Amiri', serif`, ink); y += fs * 1.7; }
      x.font = "500 40px 'Tajawal', sans-serif"; T(x, '— ' + fit1(x, r.fq.book ? r.fq.book.title : '', W - 220), W / 2, y + 40, "500 40px 'Tajawal', sans-serif", p[3]);
    });
    // ٨ الشخصية
    const pe = persona(r);
    mk(7, (x, p) => {
      T(x, 'شخصيتك القرائية', W / 2, 520, "600 60px 'El Messiri', sans-serif", soft);
      T(x, pe.e, W / 2, 860, "260px serif", ink);
      T(x, pe.t, W / 2, 1100, "700 104px 'Aref Ruqaa', serif", p[3]);
      x.font = "400 46px 'Tajawal', sans-serif"; let y = 1240;
      for (const l of wrap(x, pe.d, W - 240)) { T(x, l, W / 2, y, "400 46px 'Tajawal', sans-serif", ink); y += 72; }
    });
    // ٩ الخلاصة
    mk(8, (x, p) => {
      T(x, `${r.Y} في سطور`, W / 2, 300, "700 84px 'El Messiri', sans-serif", ink);
      T(x, pe.e + ' ' + pe.t, W / 2, 400, "700 56px 'Aref Ruqaa', serif", p[3]);
      const cells = [
        [String(hoursOf(r.total) || Math.round(r.total / 60)), hoursOf(r.total) ? 'ساعة قراءة' : 'دقيقة قراءة'],
        [String(r.days), 'يوم قراءة'], [String(r.finished.length), 'كتاب مكتمل'], [String(r.streak), 'أطول سلسلة'],
        [String(r.quotes.length), 'اقتباس'], [String(r.touched.length), 'كتاب فتحته'],
      ];
      const cw = 420, chh = 270, gx = 40, gy = 40, x0 = W / 2 - cw - gx / 2, y0 = 520;
      cells.forEach(([v, l], i) => {
        const col = i % 2, row = Math.floor(i / 2), cx = W - (x0 + col * (cw + gx)) - cw, cy = y0 + row * (chh + gy);
        x.fillStyle = 'rgba(255,255,255,.08)'; x.strokeStyle = p[3] + '55'; x.lineWidth = 2;
        x.beginPath(); x.roundRect ? x.roundRect(cx, cy, cw, chh, 28) : x.rect(cx, cy, cw, chh); x.fill(); x.stroke();
        T(x, v, cx + cw / 2, cy + 150, "800 120px 'Reem Kufi', sans-serif", p[3]);
        T(x, l, cx + cw / 2, cy + 225, "500 40px 'Tajawal', sans-serif", ink);
      });
      if (r.top) { x.font = "600 40px 'Amiri', serif"; T(x, 'رفيق السنة: ' + fit1(x, r.top.title, W - 300), W / 2, 1560, "600 40px 'Amiri', serif", soft); }
      if (r.authors[0]) T(x, 'الكاتب الأقرب: ' + r.authors[0][0], W / 2, 1630, "400 38px 'Tajawal', sans-serif", soft);
    });
    return out;
  }

  async function wrapped(d, forceY) {
    const now = new Date();
    const years = new Set(Object.keys(d.log || {}).map((k) => +k.slice(0, 4)).filter((y) => y > 2000));
    for (const b of d.books) { const s = d.states[b.id]; if (s && s.finishedAt) years.add(new Date(s.finishedAt).getFullYear()); }
    let Y = forceY || now.getFullYear();
    let r = computeYear(d, Y);
    // في أول السنة: اعرض السنة الماضية إن كانت الحالية شبه فارغة
    if (!forceY && r.total < 3600 && !r.finished.length && years.has(Y - 1)) { Y -= 1; r = computeYear(d, Y); }
    if (r.total < 60 && !r.finished.length) { toast(`لا توجد قراءة مسجّلة في ${Y} بعد — اقرأ قليلاً ثم عُد 🌱`); return; }
    r.states0 = d.states;
    await fontsReady(["800 100px 'Reem Kufi'", "700 80px 'El Messiri'", "600 60px 'El Messiri'", "400 40px 'Tajawal'", "500 40px 'Tajawal'", "700 80px 'Amiri'", "600 40px 'Amiri'", "700 80px 'Aref Ruqaa'"]);
    const cs = slides(r);
    const urls = cs.map((c) => c.toDataURL('image/jpeg', 0.9));
    const ys = [...years].filter((y) => y !== Y).sort((a, b) => b - a);

    const ov = document.createElement('div');
    ov.className = 'wr-ov'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', `سنتك في القراءة ${Y}`);
    ov.innerHTML = `<div class="wr-stage">
        <div class="wr-bars">${cs.map(() => '<i><b></b></i>').join('')}</div>
        <img class="wr-img" alt="">
        <button class="wr-zone wr-prev" aria-label="السابق"></button><button class="wr-zone wr-next" aria-label="التالي"></button>
        <div class="wr-top"><button class="wr-x" aria-label="إغلاق">✕</button>${ys.length ? `<select class="wr-year" aria-label="السنة"><option>${Y}</option>${ys.map((y) => `<option>${y}</option>`).join('')}</select>` : ''}</div>
      </div>
      <div class="wr-acts"><button class="btn-gold wr-share">📤 شارك هذه</button><button class="wr-all">⬇ احفظ الكل</button></div>`;
    document.body.appendChild(ov);
    const img = ov.querySelector('.wr-img'), bars = [...ov.querySelectorAll('.wr-bars i')];
    let i = 0, timer = 0, held = false, t0 = 0, remain = 0;
    const DUR = 6500;
    const show = (n) => {
      i = Math.max(0, Math.min(cs.length - 1, n));
      img.src = urls[i]; img.alt = `الشريحة ${i + 1} من ${cs.length}`;
      img.classList.remove('in'); void img.offsetWidth; img.classList.add('in');
      bars.forEach((b, k) => { b.classList.toggle('done', k < i); b.classList.toggle('now', k === i); b.firstChild.style.animation = 'none'; void b.firstChild.offsetWidth; b.firstChild.style.animation = ''; });
      clearTimeout(timer); remain = DUR; t0 = Date.now();
      if (i < cs.length - 1) timer = setTimeout(() => show(i + 1), DUR);
    };
    const pause = () => { if (held) return; held = true; clearTimeout(timer); remain -= Date.now() - t0; ov.classList.add('paused'); };
    const resume = () => { if (!held) return; held = false; ov.classList.remove('paused'); t0 = Date.now(); if (i < cs.length - 1) timer = setTimeout(() => show(i + 1), Math.max(300, remain)); };
    let downAt = 0;
    for (const z of ov.querySelectorAll('.wr-zone')) {
      z.onpointerdown = () => { downAt = Date.now(); setTimeout(() => { if (downAt && Date.now() - downAt >= 280) pause(); }, 300); };
      z.onpointerup = () => { const long = Date.now() - downAt >= 280; downAt = 0; if (long) { resume(); return; } show(i + (z.classList.contains('wr-next') ? 1 : -1)); };
      z.onpointerleave = () => { downAt = 0; resume(); };
    }
    const close = () => { clearTimeout(timer); ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowLeft') show(i + 1); else if (e.key === 'ArrowRight') show(i - 1); };
    document.addEventListener('keydown', onKey);
    ov.querySelector('.wr-x').onclick = close;
    const ysel = ov.querySelector('.wr-year');
    if (ysel) ysel.onchange = () => {
      const y = +ysel.value; close(); wrapped(d, y);
    };
    ov.querySelector('.wr-share').onclick = async () => { pause(); const b = await blobOf(cs[i]); if (b) await shareOrSave(b, `سنتي في القراءة ${Y} - ${i + 1}.png`, `سنتي في القراءة ${Y}`); resume(); };
    ov.querySelector('.wr-all').onclick = async () => {
      pause();
      for (let k = 0; k < cs.length; k++) {
        const b = await blobOf(cs[k]); const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = `سنتي في القراءة ${Y} - ${k + 1}.png`; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000); await new Promise((res) => setTimeout(res, 350));
      }
      toast(`حُفظت ${cs.length} صور 🖼`, 'gold'); resume();
    };
    show(0);
  }
  return { quoteCard, drawQuote, wrapped, computeYear, shareOrSave };
})();
window.Studio = Studio;
