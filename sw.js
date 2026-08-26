/* ═══════ مِداد — عامل الخدمة (عمل بلا إنترنت) ═══════ */
const VERSION = 'midad-v31';
const SHELL = [
  './', 'index.html',
  'css/main.css', 'css/reader.css',
  'js/store.js', 'js/config.js', 'js/cloud.js', 'js/library.js', 'js/reader.js', 'js/app.js',
  'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'vendor/fflate.min.js',
  'icon.svg', 'manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    // تجاهل أي ملف يفشل تحميله حتى لا يفشل التثبيت كله
    await Promise.all(SHELL.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // لا نتدخّل في نداءات Supabase (المزامنة تحتاج الشبكة دائماً)
  if (/supabase\.co$/.test(url.hostname)) return;

  const sameOrigin = url.origin === self.location.origin;

  // تصفّح الصفحة: شبكة أولاً، ثم القشرة المخزّنة عند انقطاع الإنترنت
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(VERSION); c.put('index.html', net.clone()); return net;
      } catch { return (await caches.match('index.html')) || (await caches.match('./')); }
    })());
    return;
  }

  // أصول التطبيق (نفس الأصل): الشبكة أولاً لضمان تطابق كل الملفات معاً،
  // ثم الكاش عند انقطاع الإنترنت فقط (يمنع خلط نسخة قديمة بأخرى جديدة)
  if (sameOrigin) {
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        if (net && net.ok) { const c = await caches.open(VERSION); c.put(req, net.clone()); }
        return net;
      } catch {
        const cached = await caches.match(req);
        return cached || new Response('', { status: 504 });
      }
    })());
    return;
  }

  // الخطوط والمكتبات الخارجية: خزّنها عند أول جلب (stale-while-revalidate)
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || /cdn\.jsdelivr\.net$/.test(url.hostname)) {
    e.respondWith((async () => {
      const cached = await caches.match(req);
      const net = fetch(req).then((res) => {
        if (res && (res.ok || res.type === 'opaque')) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => null);
      return cached || (await net) || new Response('', { status: 504 });
    })());
  }
});
