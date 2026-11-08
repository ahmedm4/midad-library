/* ═══════ مِداد — القياس المجهول وسجلّ الأعطال ═══════
   ١) عدّاد الأجهزة النشطة: مرة يومياً يُرسل كل متصفح إشارة فيها معرّف عشوائي خاص بهذا الغرض
      (لا علاقة له بالحساب ولا بالكتب)، ونوع الجهاز، وهل التطبيق مثبّت، ورقم الإصدار. لا بريد ولا IP ولا محتوى.
   ٢) سجلّ الأعطال: حين يفشل فتح كتاب أو تنزيله أو المزامنة أو الإضافة من «استكشف» تُرسل رسالة
      الخطأ مختصرة إلى لوحة التحكم، كي يُعرف الخلل ويُصلَح قبل أن يشتكي منه أحد.
   يعمل فقط حين يكون مشروع التطبيق مضبوطاً في config.js، وبلا أي أثر على سرعة الواجهة. */
const Telemetry = (() => {
  const base = () => { const c = window.MIDAD_CONFIG; return c && c.url && c.anonKey ? { url: c.url.replace(/\/+$/, ''), key: c.anonKey } : null; };
  const ver = () => { try { return typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''; } catch { return ''; } };
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };

  function anonId() {
    let id = ls('midad-anon');
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2)); ls('midad-anon', id); }
    return id;
  }
  function kind() {
    try {
      const coarse = matchMedia('(pointer: coarse)').matches, m = Math.min(screen.width, screen.height);
      return coarse ? (m < 600 ? 'phone' : 'tablet') : 'desktop';
    } catch { return ''; }
  }
  const standalone = () => { try { return navigator.standalone === true || matchMedia('(display-mode: standalone)').matches; } catch { return false; } };
  const signedIn = () => { try { return !!(window.Cloud && Cloud.isSignedIn && Cloud.isSignedIn()); } catch { return false; } };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };

  // رمز الجلسة إن كان المستخدم مسجّلاً في مشروع التطبيق (ليُنسب العطل لحسابه في اللوحة)، وإلا المفتاح العام
  function bearer(b) {
    try {
      const ref = (b.url.match(/^https:\/\/([^.]+)\./) || [])[1];
      const raw = ls(`sb-${ref}-auth-token`);
      const t = raw && JSON.parse(raw);
      if (t && t.access_token && (!t.expires_at || t.expires_at * 1000 > Date.now() + 30e3)) return t.access_token;
    } catch {}
    return b.key;
  }
  async function rpc(name, args) {
    const b = base();
    if (!b || !navigator.onLine) return false;
    const send = (tok) => fetch(`${b.url}/rest/v1/rpc/${name}`, {
      method: 'POST', keepalive: true,
      headers: { apikey: b.key, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    try {
      let r = await send(bearer(b));
      if (r.status === 401) r = await send(b.key);
      return r.ok;
    } catch { return false; }
  }

  /* ── الإشارة اليومية ── */
  async function ping() {
    if (ls('midad-ping') === today()) return;
    const ok = await rpc('midad_ping', { p_device: anonId(), p_kind: kind(), p_standalone: standalone(), p_signed: signedIn(), p_ver: ver() });
    if (ok) ls('midad-ping', today());
  }

  /* ── الأعطال ── */
  const seen = new Set();
  let sent = 0;
  function uaShort() {
    const u = navigator.userAgent;
    const os = /iPhone|iPad|iPod/.test(u) ? 'iOS' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : '?';
    const br = /EdgA?\//.test(u) ? 'Edge' : /CriOS|Chrome\//.test(u) ? 'Chrome' : /FxiOS|Firefox\//.test(u) ? 'Firefox' : /Safari\//.test(u) ? 'Safari' : '?';
    return `${br}/${os}`;
  }
  // يُزال من الرسالة ما قد يكون شخصياً (بريد، رموز طويلة) قبل الإرسال
  const scrub = (s) => String(s || '').replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>').replace(/\b(eyJ[\w-]{10,}|[A-Za-z0-9_-]{40,})\b/g, '<token>').slice(0, 480);
  function report(k, message, ctx) {
    try {
      const msg = scrub(message && message.message ? message.message : message);
      if (!msg) return;
      const sig = k + '|' + msg;
      if (seen.has(sig) || sent >= 15) return; // مرة واحدة لكل رسالة في الجلسة، وسقف للجلسة
      seen.add(sig); sent++;
      const context = { ua: uaShort(), online: navigator.onLine, kind: kind(), installed: standalone() };
      try { if (window.Cloud && Cloud.provider) context.provider = Cloud.provider(); } catch {}
      if (ctx && typeof ctx === 'object') for (const key in ctx) { const v = ctx[key]; if (v != null) context[key] = typeof v === 'string' ? scrub(v).slice(0, 200) : v; }
      // بلا شبكة: لا فائدة من الإرسال الآن (والعطل غالباً بسبب الشبكة نفسها)
      if (!navigator.onLine) return;
      setTimeout(() => rpc('midad_log_error', { p_device: anonId(), p_ver: ver(), p_kind: String(k).slice(0, 40), p_message: msg, p_context: context }), 0);
    } catch {}
  }

  // أخطاء البرمجة غير المُلتقطة في ملفات التطبيق نفسه (لا إضافات المتصفح ولا المواقع الأخرى)
  window.addEventListener('error', (e) => {
    try {
      if (!e || !e.filename || e.filename.indexOf(location.origin) !== 0) return;
      if (/ResizeObserver loop|Script error/i.test(e.message || '')) return;
      report('js', e.message, { at: `${e.filename.replace(location.origin, '')}:${e.lineno}:${e.colno}` });
    } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try {
      const r = e && e.reason;
      const m = (r && (r.message || r)) || '';
      if (!m || /AbortError|aborted|Failed to fetch|NetworkError|Load failed/i.test(String(m) + (r && r.name))) return;
      const at = r && r.stack ? String(r.stack).split('\n').find((l) => l.indexOf(location.origin) >= 0) : '';
      report('promise', String(m), at ? { at: at.trim().replace(location.origin, '').slice(0, 160) } : null);
    } catch {}
  });

  // الإشارة بعد أن يستقرّ التطبيق (لا تنافس تحميل المكتبة)
  setTimeout(ping, 6000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(ping, 3000); });

  return { report, ping, anonId };
})();
window.Telemetry = Telemetry;
