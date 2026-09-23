/* ═══════ مِداد — إتاحة الوصول (لوحة المفاتيح وقارئ الشاشة) ═══════
   طبقة عامة تكمل الواجهة دون المساس بمنطقها:
   • تسمية الأزرار الأيقونية لقارئ الشاشة (title وحده لا يُقرأ بثبات)
   • النوافذ: دور «حوار»، نقل التركيز إليها وإعادته، وحصر Tab داخلها
   • Escape يغلق النافذة العليا في المكتبة (القارئ ونافذة الاستكشاف لهما معالجتهما)
   • تسمية حقول الإدخال التي بلا اسم */
const A11y = (() => {
  const FOCUSABLE = 'button:not([disabled]):not([hidden]), a[href], input:not([disabled]):not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])';
  const COLOR_NAMES = { '#f6d743': 'أصفر', '#8ce99a': 'أخضر', '#74c0fc': 'أزرق', '#faa2c1': 'وردي' };
  const hasLetters = (t) => /\p{L}/u.test(t);

  // اسم مسموع للزرّ الأيقوني: من title (+ أي رقم ظاهر، مثل «🔥 4» ⇒ «لوحة الإنجاز — 4»).
  // الأسماء التلقائية تُعلَّم (data-a11y-auto) لتُحدَّث إن تغيّر title أو النص لاحقاً.
  function labelControl(el) {
    const auto = el.dataset && el.dataset.a11yAuto === '1';
    if (!auto && (el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby'))) return;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    const title = el.getAttribute('title');
    let label = '';
    if (hasLetters(text)) label = '';                      // له نصّ مقروء
    else if (el.dataset && el.dataset.color) {
      // ألوان التظليل بلا title؛ ألوان قلم الرسم لها title («أحمر»…)
      label = title ? (el.closest('#draw-bar') ? 'لون القلم: ' + title : title)
        : 'تظليل ' + (COLOR_NAMES[String(el.dataset.color).toLowerCase()] || 'بلون');
    } else if (title) {
      const num = (text.match(/\d+/) || [])[0];
      label = num ? `${title} — ${num}` : title;
    }
    if (label) { el.setAttribute('aria-label', label); el.dataset.a11yAuto = '1'; }
    else if (auto) { el.removeAttribute('aria-label'); delete el.dataset.a11yAuto; }
  }
  function labelField(el) {
    if (el.type === 'hidden' || el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby')) return;
    if (el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))) return;
    const name = el.getAttribute('placeholder') || el.getAttribute('title');
    if (name) el.setAttribute('aria-label', name);
  }

  function setupDialog(bd) {
    if (bd.dataset.a11y) return;
    bd.dataset.a11y = '1';
    const box = bd.querySelector('.modal, .disc-modal, .ud-box, .sm-box') || bd;
    if (!box.hasAttribute('role')) box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    if (box.tabIndex < 0) box.tabIndex = -1;
    const h = box.querySelector('h2, h3');
    if (h && !box.hasAttribute('aria-labelledby')) {
      if (!h.id) h.id = 'dlg-' + Math.random().toString(36).slice(2, 8);
      box.setAttribute('aria-labelledby', h.id);
    }
    // التركيز: إلى داخل النافذة عند فتحها، وإلى ما كان عليه عند إغلاقها
    let prev = null;
    const onToggle = () => {
      if (!bd.hidden) {
        prev = document.activeElement;
        requestAnimationFrame(() => { const f = box.querySelector(FOCUSABLE); (f || box).focus({ preventScroll: true }); });
      } else if (prev && document.contains(prev)) { try { prev.focus({ preventScroll: true }); } catch {} prev = null; }
    };
    new MutationObserver(onToggle).observe(bd, { attributes: true, attributeFilter: ['hidden'] });
    if (!bd.hidden) onToggle();
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    const pick = (sel) => [...(root.matches && root.matches(sel) ? [root] : []), ...root.querySelectorAll(sel)];
    pick('button, [role="button"], a[href]').forEach(labelControl);
    pick('input, select, textarea').forEach(labelField);
    pick('.modal-backdrop, .ui-dialog, .shelf-modal').forEach(setupDialog);
  }

  // ظاهر فعلاً؟ (offsetParent لا يصلح: يساوي null دائماً للعناصر الثابتة position:fixed كخلفيات النوافذ)
  const visible = (el) => !el.hidden && el.getClientRects().length > 0;
  // النافذة الظاهرة العليا (آخرها في المستند)
  const openDialogs = () => [...document.querySelectorAll('.modal-backdrop, .ui-dialog, .shelf-modal')].filter(visible);

  function onKey(e) {
    if (e.key === 'Tab') {
      // حصر Tab داخل النافذة المفتوحة
      const top = openDialogs().pop(); if (!top) return;
      const items = [...top.querySelectorAll(FOCUSABLE)].filter(visible);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }
    if (e.key !== 'Escape') return;
    const menu = document.querySelector('.bc-menu');
    if (menu) { menu.remove(); e.preventDefault(); return; }
    const reader = document.getElementById('reader');
    if (reader && !reader.hidden) return;                 // القارئ يدير Escape بنفسه
    const top = openDialogs().filter((m) => !m.classList.contains('disc-backdrop')).pop(); // الاستكشاف يديره بنفسه
    if (!top) return;
    const x = top.querySelector('[data-close], .ud-cancel, .sm-close');
    if (x) x.click(); else top.hidden = true;
    e.preventDefault();
  }

  function init() {
    scan(document.body);
    // ما يُضاف لاحقاً (بطاقات، نوافذ الاستكشاف، الحوارات) يُعالَج دفعةً واحدة لكل إطار
    let pending = new Set(), relabel = new Set(), raf = 0;
    const autoOf = (n) => { const el = n.nodeType === 1 ? n : n.parentElement; return el && el.closest ? el.closest('[data-a11y-auto]') : null; };
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) if (n.nodeType === 1) pending.add(n);
        // تغيّر title أو نصّ زرٍّ مُسمّى تلقائياً (حالة المزامنة، عدّاد السلسلة…) ⇒ حدّث اسمه
        const a = autoOf(m.target); if (a) relabel.add(a);
      }
      if (!raf) raf = requestAnimationFrame(() => {
        raf = 0;
        const list = [...pending], rl = [...relabel]; pending = new Set(); relabel = new Set();
        list.forEach(scan); rl.forEach(labelControl);
      });
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['title'] });
    document.addEventListener('keydown', onKey);
  }

  return { init, scan };
})();
window.A11y = A11y;
