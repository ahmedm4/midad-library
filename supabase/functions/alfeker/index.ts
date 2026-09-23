// ═══════ مِداد — وسيط «شبكة الفكر» (alfeker.net) ═══════
// alfeker.net موقع PHP بلا واجهة برمجية، صفحاته محجوبة بـCORS.
// ملف الكتاب مرفوع على MediaFire و/أو Google Drive، في قائمتين: «تحميل الكتاب» و«روابط بديلة»
// (أيّ المستضيفين أولاً يختلف من كتاب لآخر)، وقد يكون الكتاب جزءاً واحداً أو عدة أجزاء.
// هذه الدالة تكشط الصفحة من الخادم، وتجمع كل جزء بمراياه، وتنزّل الجزء المطلوب مجرّبةً
// المرايا بالترتيب حتى تنجح إحداها.
// إجراءات: list (catid|q) ، detail (id) ، file (mirrors | id+part | fileUrl+host) ، fetch (url)
// ملاحظة: تكامل هشّ بطبيعته (يعتمد على بنية HTML وسياسات المستضيفات).

const BASE = "https://alfeker.net";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Length, X-Midad-Host",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const stripTags = (s: string) => (s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const decode = (s: string) => (s || "")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");

async function getHtml(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ar,en;q=0.8" } });
  if (!r.ok) throw new Error("alfeker HTTP " + r.status);
  return await r.text();
}

// يحوّل رابط صورة نسبيّاً إلى مطلق
const absImg = (src: string) => !src ? "" : (src.startsWith("http") ? src : `${BASE}/${src.replace(/^\//, "")}`);

function parseCards(html: string) {
  const out: any[] = [];
  const re = /<article class="box-excerpt">([\s\S]*?)<\/article>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const c = m[1];
    const id = (c.match(/library\.php\?id=(\d+)/) || [])[1];
    const title = decode(stripTags((c.match(/<h2>\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ""));
    const img = absImg((c.match(/<img[^>]*src="([^"]+)"/) || [])[1] || "");
    const author = decode(stripTags((c.match(/authors\.php\?id=\d+[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ""));
    const category = decode(stripTags((c.match(/library\.php\?catid=\d+[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ""));
    const views = (c.match(/icon-eye[^>]*>\s*([\d,]+)/) || [])[1] || "";
    if (id && title) out.push({ id, title, cover: img, author, category, views });
  }
  return out;
}

/* ── المستضيفات والمرايا ── */
type Mirror = { host: string; url: string };

function classifyHost(url: string): string {
  if (/(?:drive|docs)\.google\.com/i.test(url)) return "drive";
  if (/mediafire\.com/i.test(url)) return "mediafire";
  if (/dropbox\.com/i.test(url)) return "dropbox";
  if (/\.pdf(?:[?#]|$)/i.test(url)) return "direct";
  return "";
}
const driveIdOf = (u: string) => (u.match(/\/file\/d\/([-\w]+)/) || u.match(/[?&]id=([-\w]+)/) || [])[1] || "";
// معرّفات Drive القديمة (0B…) تتطلب resourcekey منذ تحديث Google الأمني (2021)، وروابط الموقع
// لا تحمله، فتُحوِّل Google التنزيل المجهول إلى صفحة تسجيل الدخول. نؤخّرها ولا نعتمد عليها.
const isLegacyDrive = (u: string) => /^0B/.test(driveIdOf(u));

// ترتيب التجربة: Drive الحديث (سريع وموثوق) ← MediaFire (متوفّر في كل الكتب تقريباً)
// ← رابط مباشر/Dropbox ← Drive القديم (يفشل غالباً).
function mirrorRank(m: Mirror): number {
  if (m.host === "drive") return isLegacyDrive(m.url) ? 9 : 0;
  if (m.host === "mediafire") return 1;
  if (m.host === "direct") return 2;
  if (m.host === "dropbox") return 3;
  return 8;
}
const sortMirrors = (ms: Mirror[]) => [...ms].sort((a, b) => mirrorRank(a) - mirrorRank(b));

/* ── أجزاء الكتاب: كل قائمة تحميل بعد عنوانها مباشرةً (article > nav > ul.bookinfo) ── */
type Part = { n: number; label: string; short: string; size: string; mirrors: Mirror[] };

function parseParts(html: string): Part[] {
  type Item = { label: string; size: string; url: string; host: string };
  const lists: Item[][] = [];
  const titleRe = /<div class="title[^"]*">\s*[^<]*?\s*<\/div>/g;
  let t: RegExpExecArray | null;
  while ((t = titleRe.exec(html))) {
    const after = html.slice(t.index + t[0].length, t.index + t[0].length + 60000);
    const ul = after.match(/^\s*<article[^>]*>\s*<nav>\s*<ul class="bookinfo">([\s\S]*?)<\/ul>/);
    if (!ul) continue;
    const items: Item[] = [];
    for (const li of ul[1].matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      const body = li[1];
      const href = (body.match(/href="(https?:\/\/[^"]+)"/i) || [])[1];
      if (!href) continue;
      const url = decode(href);
      const host = classifyHost(url);
      if (!host) continue;
      // التسمية = ما قبل <span> بلا القوسين الخارجيين (قد تحوي أقواساً داخلية مثل «(ع)»)
      const label = decode(stripTags(body.split(/<span/i)[0])).replace(/^\(\s*/, "").replace(/\s*\)\s*$/, "").trim();
      const size = (body.match(/\(\s*([\d.,]+\s*[KMG]B)\s*\)/i) || [])[1] || "";
      items.push({ label, size, url, host });
    }
    if (items.length) lists.push(items);
  }
  if (!lists.length) return [];

  // تسمية مختصرة دقيقة: «الجزء 3» ، «الجزء 3 · القسم 1» ، «الجزآن 9–10».
  // (لا نستخدم : حدود الكلمات في JS لا تعمل مع الحروف العربية)
  const designator = (label: string) => {
    const m = label.match(/(?:الجزء|ج)\s*[-:]?\s*0*(\d{1,3})(?:\s*[-–]\s*0*(\d{1,3}))?(?!\d)/);
    if (!m) return null;
    const tail = label.slice((m.index || 0) + m[0].length, (m.index || 0) + m[0].length + 16);
    const sec = tail.match(/^\s*[-–]?\s*(?:القسم|قسم|قـ|ق)\s*0*(\d{1,2})(?!\d)/);
    return { start: +m[1], end: m[2] ? +m[2] : 0, sec: sec ? +sec[1] : 0 };
  };
  const shortOf = (label: string, i: number) => {
    const d = designator(label);
    if (!d) return `الجزء ${i + 1}`;
    const range = d.end && d.end !== d.start
      ? `${d.end - d.start === 1 ? "الجزآن" : "الأجزاء"} ${d.start}–${d.end}`
      : `الجزء ${d.start}`;
    return range + (d.sec ? ` · القسم ${d.sec}` : "");
  };
  const norm = (s: string) => s.replace(/ـ/g, "").replace(/\s+/g, " ").trim();
  const maxLen = Math.max(...lists.map((l) => l.length));

  const build = (keyOf: (it: Item, i: number) => string): Part[] => {
    const map = new Map<string, Part>();
    for (const list of lists) {
      list.forEach((it, i) => {
        const k = keyOf(it, i);
        if (!map.has(k)) map.set(k, { n: 0, label: it.label, short: shortOf(it.label, i), size: it.size, mirrors: [] });
        const p = map.get(k)!;
        if (!p.size && it.size) p.size = it.size;
        if (!p.mirrors.some((m) => m.url === it.url)) p.mirrors.push({ host: it.host, url: it.url });
      });
    }
    return [...map.values()];
  };
  // القائمتان تحملان التسميات نفسها ⇒ نطابق بالتسمية الكاملة (لا برقم الجزء وحده: قد ينقسم
  // الجزء الواحد أقساماً «ج03 - قـ 1/2» أو يجمع ملفٌّ جزأين «ج09-10»). فإن لم تتطابق نطابق بالموضع.
  let parts = build((it) => "l" + norm(it.label));
  if (parts.length > maxLen) parts = build((_it, i) => "i" + i);
  // ترتيب الصفحة نفسه هو الترتيب الصحيح (لا نعيد الفرز)
  parts.forEach((p, i) => { p.n = i + 1; p.mirrors = sortMirrors(p.mirrors); });
  return parts;
}

function parseDetail(html: string, id: string) {
  // العنوان: وسم <title> هو اسم الكتاب في alfeker (أوثق من h1/h2)
  let title = decode(stripTags((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || ""))
    .replace(/\s*[-|]\s*(alfeker|شبكة الفكر).*$/i, "").trim();
  if (!title) title = decode(stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || ""));
  const author = decode(stripTags((html.match(/authors\.php\?id=\d+[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ""));
  // القسم فقط من كتلة معلومات الكتاب (لا من قائمة التصنيفات الجانبية)
  const category = decode(stripTags((html.match(/القسم\s*:?\s*<span>\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ""));
  const pages = (html.match(/عدد\s*الصفحات[^\d]{0,20}(\d+)/) || [])[1] || "";
  const cover = absImg((html.match(/uploads\/pictures\/(?!\.thumb)[^"']+\.(?:jpg|jpeg|png)/i) || html.match(/uploads\/pictures\/[^"']+\.(?:jpg|jpeg|png)/i) || [])[0] || "");

  let parts = parseParts(html);
  // احتياط لصفحات بلا قوائم منظّمة: كل روابط الملفات مرايا لجزء واحد
  if (!parts.length) {
    const urls = [...new Set((html.match(/https?:\/\/[^"'\s<>]+/g) || []).map(decode))].filter((u) => classifyHost(u));
    if (urls.length) parts = [{ n: 1, label: title, short: "الجزء 1", size: "", mirrors: sortMirrors(urls.map((u) => ({ host: classifyHost(u), url: u }))) }];
  }
  const partsCount = +((html.match(/الأجزاء\s*:?\s*<span>\s*(\d+)/) || [])[1] || 0) || parts.length;
  // العنوان بلا لاحقة الأجزاء: «- 11 جزء» أو «(4 أجزاء)» أو «- ج1 ج2 ج3»
  const baseTitle = title
    .replace(/\s*[-–(]\s*\d+\s*(?:جزء|أجزاء|مجلد|مجلدات)\s*\)?\s*$/, "")
    .replace(/\s*[-–]\s*(?:ج\s*\d+\s*[،,]?\s*){2,}$/, "")
    .trim() || title;

  // توافق مع النسخ السابقة من التطبيق (تقرأ fileUrl/host فقط): أفضل مرآة للجزء الأول
  const first = parts[0]?.mirrors || [];
  const best = first[0] || { host: "", url: "" };
  const alt = first.find((m) => m.host === "mediafire" && m.url !== best.url);
  return {
    id, title, baseTitle, author, category, pages, cover, partsCount, parts,
    fileUrl: best.url, host: best.host, altUrl: alt ? alt.url : "", altHost: alt ? "mediafire" : "",
  };
}

/* ── التنزيل ── */
// الاستجابة ملفّ (لا صفحة HTML)؟ — لا نستهلك الجسم هنا
const isFileResponse = (r: Response) => r.ok && !/text\/html/i.test(r.headers.get("content-type") || "");

// MediaFire: غالباً يحوّل رابط الملف مباشرةً (302) إلى خادم التنزيل فيصل الملف نفسه؛
// وإن أعاد صفحة الملف استخرجنا رابط زرّ التنزيل منها.
async function mediafireFetch(pageUrl: string): Promise<Response> {
  const headers = { "User-Agent": UA, "Accept-Language": "ar,en;q=0.8" };
  const r = await fetch(pageUrl, { headers, redirect: "follow" });
  if (isFileResponse(r)) return r;
  if (!r.ok) throw new Error("أعاد الحالة " + r.status);
  const html = await r.text();
  if (/file has been removed|invalid or deleted|File Removed|dmca/i.test(html)) throw new Error("الملف محذوف");
  const direct =
    (html.match(/href="(https?:\/\/download\d*\.mediafire\.com\/[^"]+)"/i) || [])[1] ||
    (html.match(/(https?:\/\/download\d*\.mediafire\.com\/[^"'\s\\<>]+)/i) || [])[1];
  if (!direct) throw new Error(/captcha/i.test(html) ? "يطلب تحقّقاً بشرياً" : "تعذّر استخراج رابط التنزيل");
  const r2 = await fetch(decode(direct), { headers: { ...headers, "Referer": pageUrl }, redirect: "follow" });
  if (!isFileResponse(r2)) throw new Error("لم يُعِد ملفاً");
  return r2;
}

// Google Drive مع معالجة صفحة التأكيد (فحص الفيروسات للملفات الكبيرة) وكشف طلب تسجيل الدخول
async function driveFetch(fileId: string): Promise<Response> {
  const headers = { "User-Agent": UA };
  const toSignIn = (r: Response) => /accounts\.google\.com|ServiceLogin|\/signin\//i.test(r.url);
  let res = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, { headers, redirect: "follow" });
  if (toSignIn(res)) throw new Error("يطلب تسجيل الدخول (رابط قديم غير عامّ)");
  if (isFileResponse(res)) return res;
  if (!res.ok) throw new Error("أعاد الحالة " + res.status);
  const html = await res.text();
  if (/<title>[^<]*Sign-in/i.test(html)) throw new Error("يطلب تسجيل الدخول");
  // ⚠ نطابق <form action="http…"> فقط: صفحات Google مليئة بسمات jsaction="rcuQ6b:npT2md;…"
  // وكانت مطابقةُ action= العامّة تلتقطها رابطاً ⇒ «Url scheme 'rcuq6b' not supported».
  const form = html.match(/<form\b[^>]*\baction="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/form>/i);
  if (!form) {
    if (/quota|too many users/i.test(html)) throw new Error("تجاوز الملف حصّة التنزيل — حاول لاحقاً");
    throw new Error("لم يُعِد الملف");
  }
  const action = decode(form[1]);
  const params = new URLSearchParams();
  for (const inp of form[2].matchAll(/<input\b[^>]*>/gi)) {
    const name = (inp[0].match(/\bname="([^"]+)"/) || [])[1];
    const value = (inp[0].match(/\bvalue="([^"]*)"/) || [])[1] ?? "";
    if (name) params.set(name, decode(value));
  }
  if (!params.has("id")) params.set("id", fileId);
  if (!params.has("export")) params.set("export", "download");
  res = await fetch(action + (action.includes("?") ? "&" : "?") + params.toString(), { headers, redirect: "follow" });
  if (toSignIn(res)) throw new Error("يطلب تسجيل الدخول");
  if (!isFileResponse(res)) throw new Error("لم يُعِد الملف (قد تكون الحصّة ممتلئة)");
  return res;
}

async function resolveMirror(m: Mirror): Promise<Response> {
  if (m.host === "drive") {
    const id = driveIdOf(m.url);
    if (!id) throw new Error("رابط غير صالح");
    return driveFetch(id);
  }
  if (m.host === "mediafire") return mediafireFetch(m.url);
  const url = m.host === "dropbox"
    ? m.url.replace(/([?&])dl=0/, "$1dl=1").replace(/www\.dropbox/, "dl.dropboxusercontent")
    : m.url;
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!isFileResponse(r)) throw new Error("لم يُعِد ملفاً");
  return r;
}

const HOST_AR: Record<string, string> = { drive: "Google Drive", mediafire: "MediaFire", dropbox: "Dropbox", direct: "الرابط المباشر" };

// يجرّب المرايا بالترتيب ويعيد أول ملف ينجح، أو خطأً يجمع سبب فشل كل مرآة
async function fetchFromMirrors(mirrors: Mirror[]): Promise<{ res: Response; host: string }> {
  const errs: string[] = [];
  for (const m of sortMirrors(mirrors)) {
    try { return { res: await resolveMirror(m), host: m.host }; }
    catch (e) { errs.push(`${HOST_AR[m.host] || m.host}: ${String((e as Error)?.message || e)}`); }
  }
  throw new Error(errs.join(" • ") || "لا توجد روابط");
}

// ينظّف قائمة المرايا الواردة من العميل (مستضيفات ملفات معروفة فقط)
function cleanMirrors(list: unknown): Mirror[] {
  if (!Array.isArray(list)) return [];
  const out: Mirror[] = [];
  for (const m of list as any[]) {
    const url = String(m?.url || "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const host = classifyHost(url);
    if (host && !out.some((x) => x.url === url)) out.push({ host, url });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || "list");

    if (action === "list") {
      const q = String(b.q || "").trim();
      const catid = String(b.catid || "").trim();
      const url = q
        ? `${BASE}/search.php?search=${encodeURIComponent(q)}&author=&parent=&type=`
        : `${BASE}/library.php?catid=${encodeURIComponent(catid || "65")}`;
      const html = await getHtml(url);
      return json({ books: parseCards(html) });
    }

    if (action === "detail") {
      const id = String(b.id || "").trim();
      if (!id) return json({ error: "معرّف الكتاب مفقود" }, 400);
      const html = await getHtml(`${BASE}/library.php?id=${encodeURIComponent(id)}`);
      return json(parseDetail(html, id));
    }

    // وسيط عام: يجلب أي رابط مباشر (PDF/نص) من الخادم ويعيده للمتصفح بلا قيد CORS
    if (action === "fetch") {
      const target = String(b.url || "").trim();
      if (!/^https?:\/\/.+/i.test(target)) return json({ error: "رابط غير صالح" }, 400);
      let dr: Response;
      try { dr = await fetch(target, { headers: { "User-Agent": UA, "Accept": "*/*", "Accept-Language": "ar,en;q=0.8" } }); }
      catch (e) { return json({ error: "تعذّر الوصول إلى الرابط: " + String((e as Error)?.message || e) }, 502); }
      if (!dr.ok) return json({ error: "الرابط أعاد الحالة " + dr.status }, 502);
      const ct = dr.headers.get("content-type") || "application/octet-stream";
      const headers = new Headers(CORS);
      headers.set("Content-Type", ct);
      const cl = dr.headers.get("content-length"); if (cl) headers.set("Content-Length", cl);
      headers.set("Content-Disposition", "inline");
      return new Response(dr.body, { status: 200, headers });
    }

    // تنزيل جزء: العميل الحديث يرسل mirrors للجزء؛ السابق يرسل fileUrl/host (+id)
    if (action === "file") {
      const id = String(b.id || "").trim();
      let mirrors = cleanMirrors(b.mirrors);
      if (!mirrors.length) {
        const fileUrl = String(b.fileUrl || "").trim();
        // بمعرّف الكتاب نعيد استخراج كل مرايا الجزء المطلوب — فتستفيد النسخ السابقة من التطبيق
        // (التي ترسل رابطاً واحداً) من سلسلة التجربة أيضاً
        if (id) {
          try {
            const d = parseDetail(await getHtml(`${BASE}/library.php?id=${encodeURIComponent(id)}`), id);
            const byUrl = fileUrl ? d.parts.find((p) => p.mirrors.some((m) => m.url === fileUrl)) : undefined;
            const idx = Math.max(0, Math.min(+b.part || 0, d.parts.length - 1));
            mirrors = (byUrl || d.parts[idx])?.mirrors || [];
          } catch { /* نكمل بالرابط المُرسَل */ }
        }
        if (!mirrors.length && fileUrl) mirrors = cleanMirrors([{ url: fileUrl }]);
      }
      if (!mirrors.length) return json({ error: "لا يوجد ملف قابل للتنزيل لهذا الكتاب" }, 404);

      let got: { res: Response; host: string };
      try { got = await fetchFromMirrors(mirrors); }
      catch (e) {
        return json({ error: "تعذّر التنزيل من كل الروابط — " + String((e as Error)?.message || e), manual: mirrors.map((m) => m.url) }, 502);
      }
      const dr = got.res;
      const ct = dr.headers.get("content-type") || "";
      const headers = new Headers(CORS);
      headers.set("Content-Type", /pdf/i.test(ct) ? ct : "application/pdf");
      const cl = dr.headers.get("content-length"); if (cl) headers.set("Content-Length", cl);
      headers.set("Content-Disposition", "inline");
      headers.set("X-Midad-Host", got.host);
      return new Response(dr.body, { status: 200, headers });
    }

    return json({ error: "إجراء غير معروف" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
