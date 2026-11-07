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
  .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ");

async function getHtml(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ar,en;q=0.8" } });
  if (!r.ok) throw new Error("alfeker HTTP " + r.status);
  return await r.text();
}

// «٦٦٥» ⇒ «665» و«٢٠ م.ب» ⇒ «20 MB» (الموقع الجديد يكتب الأرقام والأحجام بالعربية)
const latinDigits = (s: string) => (s || "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
const sizeOf = (s: string) => latinDigits(decode(stripTags(s))).replace(/\s*م\.?\s*ب\.?/, " MB").replace(/\s*ك\.?\s*ب\.?/, " KB").replace(/\s*غ\.?\s*ب\.?/, " GB").replace(/٫/g, ".").trim();

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
  // ⚠ لا نكتفي بالقديم إن وُجد: صفحات الموقع الجديد قد تحوي كتلة جانبية بالبنية القديمة («كتاب مميّز»)
  //   فيظهر كتاب واحد بدل كل النتائج. نقرأ الاثنتين ونقدّم الجديد ونحذف المكرّر.
  const legacy = out.splice(0);
  // الموقع الجديد (منذ نوفمبر 2026): <li class="fk-hcard"> … /b/<الرقم>/ — الرقم نفسه رقم الكتاب القديم
  // نقسم عند بداية كل بطاقة (بطاقات نتائج البحث تحوي قوائم داخلية فلا يصلح البحث عن نهايتها)
  for (const chunk of html.split('<li class="fk-hcard">').slice(1)) {
    const c = chunk.slice(0, 6000);
    const id = (c.match(/alfeker\.net\/b\/(\d+)\//) || [])[1];
    const title = decode(stripTags((c.match(/class="fk-hcard-title"[^>]*>([\s\S]*?)<\/h3>/) || [])[1] || ""));
    const img = absImg((c.match(/<img[^>]*src="([^"]+)"/) || [])[1] || "");
    const author = decode(stripTags((c.match(/class="fk-hcard-author"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ""));
    const category = decode(stripTags((c.match(/class="fk-hcard-section"[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ""));
    if (id && title && !out.some((x) => x.id === id)) out.push({ id, title, cover: img, author, category, views: "" });
  }
  // صفحة بالبنية القديمة كلها (الموقع القديم) ⇒ نتائجها؛ وإلا فالقديم الشاذّ يُضاف إن لم يتكرّر
  if (!out.length) return legacy;
  return out;
}

// ── هوية المتصل: مستخدم مسجَّل في هذا المشروع؟ (والاختياري: ضمن قائمة البُرد المسموح بها) ──
// المفتاح العام (anon) مكشوف في الموقع بطبيعته، فلا يكفي وحده دليلاً على هوية المتصل.
async function callerUser(req: Request): Promise<{ id: string; email: string } | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!token || !url || !anon || token === anon) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anon } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? { id: String(u.id), email: String(u.email || "").toLowerCase() } : null;
  } catch { return null; }
}
// إعدادات الموقع من لوحة التحكم (تُخزَّن دقيقة في ذاكرة الدالة)
let cfgCache: { at: number; v: any } | null = null;
async function siteConfig(): Promise<any> {
  if (cfgCache && Date.now() - cfgCache.at < 60000) return cfgCache.v;
  const SB = Deno.env.get("SUPABASE_URL") || "", key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  let v: any = {};
  try { const r = await fetch(`${SB}/rest/v1/midad_config?key=eq.app&select=value`, { headers: { apikey: key, Authorization: `Bearer ${key}` } }); if (r.ok) v = ((await r.json())[0] || {}).value || {}; } catch { /* افتراضي: كل شيء متاح */ }
  cfgCache = { at: Date.now(), v };
  return v;
}
async function discoverAllowedFor(id: string): Promise<boolean> {
  const SB = Deno.env.get("SUPABASE_URL") || "", SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!SB || !SRK) return true;
  try {
    const r = await fetch(`${SB}/rest/v1/midad_profiles?id=eq.${id}&select=status,role,features`, { headers: { apikey: SRK, Authorization: `Bearer ${SRK}` } });
    if (!r.ok) return true;
    const p = (await r.json())[0];
    if (!p || p.role === "admin") return true;
    if (p.status === "blocked") return false;
    if (typeof (p.features || {}).discover === "boolean") return p.features.discover;
    const d = ((await siteConfig()).defaults || {}).discover;
    return d !== false;
  } catch { return true; }
}
const allowedEmails = () => (Deno.env.get("ALLOWED_EMAILS") || "").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

// مواقع الكتب التي يخدمها الوسيط لأي زائر بلا حساب (كي لا يصير وسيطاً مفتوحاً لكل الإنترنت)
const PUBLIC_HOSTS = ["alfeker.net", "mediafire.com", "drive.google.com", "docs.google.com", "googleusercontent.com",
  "dropbox.com", "dropboxusercontent.com", "narjeslibrary.com", "ww-api.com", "ablibrary.net", "archive.org",
  "wikisource.org", "inahj.org"];
const isPublicHost = (u: string) => {
  try { const h = new URL(u).hostname.toLowerCase(); return PUBLIC_HOSTS.some((d) => h === d || h.endsWith("." + d)); }
  catch { return false; }
};

/* ── المستضيفات والمرايا ── */
type Mirror = { host: string; url: string };

function classifyHost(url: string): string {
  if (/alfeker\.net\/\?fk_dl=\d+/i.test(url)) return "fkdl";
  if (/(?:drive|docs)\.google\.com/i.test(url)) return "drive";
  if (/mediafire\.com/i.test(url)) return "mediafire";
  if (/dropbox\.com/i.test(url)) return "dropbox";
  if (/\.pdf(?:[?#]|$)/i.test(url)) return "direct";
  return "";
}
const driveIdOf = (u: string) => (u.match(/\/file\/d\/([-\w]+)/) || u.match(/[?&]id=([-\w]+)/) || [])[1] || "";
// معرّفات Drive القديمة (0B…) تتطلب resourcekey منذ تحديث Google الأمني (2021)، وروابط الموقع
// لا تحمله، فتُحوِّل Google التنزيل المجهول إلى صفحة تسجيل الدخول. نؤخّرها ولا نعتمد عليها.
// … إلا إن حمل الرابط مفتاح المورد (الموقع الجديد يضيفه) فيعمل كالحديث
const resourceKeyOf = (u: string) => (u.match(/[?&]resourcekey=([-\w]+)/) || [])[1] || "";
const isLegacyDrive = (u: string) => /^0B/.test(driveIdOf(u)) && !resourceKeyOf(u);

// ترتيب التجربة: Drive الحديث (سريع وموثوق) ← MediaFire (متوفّر في كل الكتب تقريباً)
// ← رابط مباشر/Dropbox ← Drive القديم (يفشل غالباً).
function mirrorRank(m: Mirror): number {
  if (m.host === "drive") return isLegacyDrive(m.url) ? 9 : 0;
  if (m.host === "mediafire" || m.host === "fkdl") return 1;
  if (m.host === "direct") return 2;
  if (m.host === "dropbox") return 3;
  return 8;
}
const sortMirrors = (ms: Mirror[]) => [...ms].sort((a, b) => mirrorRank(a) - mirrorRank(b));

/* ── أجزاء الكتاب: كل قائمة تحميل بعد عنوانها مباشرةً (article > nav > ul.bookinfo) ── */
type Part = { n: number; label: string; short: string; size: string; mirrors: Mirror[]; read?: string };

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
      // نتسامح مع مسافات داخل الاقتباس وعلامة الاقتباس المفردة: بعض الصفحات تكتب href=" https://… "
      const href = (body.match(/href\s*=\s*["']\s*(https?:\/\/[^"'\s]+)\s*["']/i) || [])[1];
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
  // الموقع الجديد: كل ملف (جزء) سطرٌ واحد فيه كل روابطه — Drive (أساسي/بديل) ورابط الموقع (MediaFire)
  if (!lists.length) {
    const reads: string[] = [];
    for (const f of html.matchAll(/<li class="fk-file">([\s\S]*?)<\/li>/g)) {
      const body = f[1];
      const label = decode(stripTags((body.match(/class="fk-file-name"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || ""));
      const size = sizeOf((body.match(/<small>([\s\S]*?)<\/small>/) || [])[1] || "");
      const urls = [...body.matchAll(/(?:href|data-fk-read)="(https?:\/\/[^"]+)"/g)].map((x) => decode(x[1]));
      // زرّ «تصفّح الكتاب» في الموقع: عارض Google Drive المضمَّن (/preview) — يُعرض دون تنزيل
      const readAttr = decode((body.match(/data-fk-read="(https?:\/\/[^"]+)"/) || [])[1] || "");
      const items: Item[] = [];
      const seenDrive = new Set<string>();
      for (const url of urls) {
        const host = classifyHost(url);
        if (!host) continue;
        if (host === "drive") { const id = driveIdOf(url); if (!id || seenDrive.has(id)) continue; seenDrive.add(id); }
        if (!items.some((x) => x.url === url)) items.push({ label, size, url, host });
      }
      if (items.length) { lists.push(items.map((x) => x)); reads.push(readAttr); } // سطر = جزء
    }
    if (lists.length) {
      // هنا كل «قائمة» جزءٌ واحد بمراياه؛ نحوّلها إلى أجزاء مباشرةً
      const designatorNew = (label: string) => (label.match(/(?:الجزء|ج)\s*[-:]?\s*0*(\d{1,3})(?!\d)/) || [])[1];
      return lists.map((items, i) => {
        const d = designatorNew(items[0].label);
        // رابط العرض: من زرّ «تصفّح» إن وُجد، وإلا نبنيه من رابط Drive (‎/file/d/ID/preview)
        const drive = items.find((x) => x.host === "drive");
        const did = drive ? driveIdOf(drive.url) : "";
        const rk = drive ? resourceKeyOf(drive.url) : "";
        const read = reads[i] || (did ? `https://drive.google.com/file/d/${did}/preview${rk ? `?resourcekey=${rk}` : ""}` : "");
        return { n: i + 1, label: items[0].label, short: lists.length > 1 ? `الجزء ${d || i + 1}` : "الكتاب كاملاً", size: items[0].size, mirrors: sortMirrors(items.map((x) => ({ host: x.host, url: x.url }))), read };
      });
    }
    return [];
  }

  // تسمية مختصرة دقيقة: «الجزء 3» ، «الجزء 3 · القسم 1» ، «الجزآن 9–10».
  // (لا نستخدم حدود الكلمات b في التعابير: لا تعمل مع الحروف العربية في JS)
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
  // الموقع الجديد: العنوان في h1.fk-book-title (وسم <title> فيه لاحقة اسم الموقع)
  const h1New = decode(stripTags((html.match(/<h1 class="fk-book-title"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || ""));
  if (h1New) title = h1New;
  if (!title) title = decode(stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || ""));
  const author = decode(stripTags(
    (html.match(/class="fk-author-chip"[\s\S]*?<b>([\s\S]*?)<\/b>/) || [])[1] ||
    (html.match(/authors\.php\?id=\d+[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ""));
  // القسم فقط من كتلة معلومات الكتاب (لا من قائمة التصنيفات الجانبية)
  const secLi = (html.match(/<li title="القسم">([\s\S]*?)<\/li>/) || [])[1] || "";
  const secLinks = [...secLi.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)].map((x) => decode(stripTags(x[1])));
  const category = secLinks.length ? secLinks[secLinks.length - 1]
    : decode(stripTags((html.match(/القسم\s*:?\s*<span>\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ""));
  const pages = (latinDigits(html.match(/<li title="عدد الصفحات">[\s\S]*?class="fk-meta-val">([^<]*)/)?.[1] || "").match(/\d+/) || [])[0]
    || (html.match(/عدد\s*الصفحات[^\d]{0,20}(\d+)/) || [])[1] || "";
  const cover = absImg(
    (html.match(/property="og:image" content="([^"]+)"/) || html.match(/og:image" content="([^"]+)"/) || [])[1] ||
    (html.match(/uploads\/pictures\/(?!\.thumb)[^"']+\.(?:jpg|jpeg|png)/i) || html.match(/uploads\/pictures\/[^"']+\.(?:jpg|jpeg|png)/i) || [])[0] || "");

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

/* ── أقسام الموقع: من القائمة الجانبية (تتبع الموقع إن أضاف أقساماً) ── */
type Section = { label: string; path: string; count: number; subs?: Section[] };
const sectionPath = (href: string) => {
  const m = href.match(/^https?:\/\/(?:www\.)?alfeker\.net\/(section\/[^?#"]+)$/i);
  return m ? (m[1].endsWith("/") ? m[1] : m[1] + "/") : "";
};
function parseSections(html: string): Section[] {
  const start = html.indexOf("hk-sidebar__nav");
  if (start < 0) return [];
  let end = html.indexOf("wp-block-social-links", start);
  if (end < 0) end = start + 120000;
  const seg = html.slice(start, end);
  const out: Section[] = [];
  let parent: Section | null = null;
  for (const chunk of seg.split("<li ").slice(1)) {
    const cls = (chunk.match(/class="([^"]*)"/) || [])[1] || "";
    const label = decode(stripTags((chunk.match(/wp-block-navigation-item__label">([\s\S]*?)<\/span>/) || [])[1] || ""));
    const count = +latinDigits((chunk.match(/fk-sec-count[^>]*>([^<]*)</) || [])[1] || "").replace(/\D/g, "") || 0;
    const path = sectionPath(decode((chunk.match(/href="([^"]+)"/) || [])[1] || ""));
    if (!label) continue;
    if (/\bfk-sub-all\b/.test(cls)) { if (parent && !parent.path) parent.path = path; continue; } // «كل كتب القسم» ⇒ رابط القسم الأب
    if (/\bfk-subsec-\d+/.test(cls)) { if (parent && path) (parent.subs ||= []).push({ label, path, count }); continue; }
    // قسم رئيسي برابط مباشر؛ أما الرئيسي ذو القائمة الفرعية فبلا رابط (يأتي من «كل كتب القسم») فيُعامَل أباً أدناه
    if (/\bfk-sec-\d+/.test(cls) && path) { parent = null; out.push({ label, path, count }); continue; }
    // قسم أب بقائمة فرعية (بلا رابط مباشر؛ يأتي رابطه من «كل كتب القسم»)
    parent = { label, path, count, subs: [] };
    out.push(parent);
  }
  return out.filter((x) => x.path);
}

/* ── التنزيل ── */
// الاستجابة ملفّ (لا صفحة HTML)؟ — لا نستهلك الجسم هنا
const isFileResponse = (r: Response) => r.ok && !/text\/html/i.test(r.headers.get("content-type") || "");

// MediaFire: رابط الملف يحوّل غالباً (302) إلى خادم التنزيل فيصل الملف نفسه؛
// وإن أعاد صفحة الملف استخرجنا رابط زرّ التنزيل منها.
async function mediafireFetchOne(pageUrl: string): Promise<Response> {
  const headers = { "User-Agent": UA, "Accept-Language": "ar,en;q=0.8" };
  const r = await fetch(pageUrl, { headers, redirect: "follow" });
  if (isFileResponse(r)) return r;
  if (!r.ok) throw new Error("أعاد الحالة " + r.status);
  const html = await r.text();
  if (/file has been removed|invalid or deleted|File Removed|dmca/i.test(html)) throw new Error("الملف محذوف");
  const direct =
    (html.match(/href="(https?:\/\/download\d*\.mediafire\.com\/[^"]+)"/i) || [])[1] ||
    (html.match(/(https?:\/\/download\d*\.mediafire\.com\/[^"'\s\<>]+)/i) || [])[1];
  if (!direct) throw new Error(/captcha/i.test(html) ? "يطلب تحقّقاً بشرياً" : "تعذّر استخراج رابط التنزيل");
  const r2 = await fetch(decode(direct), { headers: { ...headers, "Referer": pageUrl }, redirect: "follow" });
  if (!isFileResponse(r2)) throw new Error("لم يُعِد ملفاً");
  return r2;
}

// المفتاح السريع للملف من أيّ صيغة رابط: ?KEY ، /file/KEY ، /file_premium/KEY ، /download/KEY ، /view/KEY
const mfKeyOf = (u: string) =>
  (u.match(/mediafire\.com\/(?:(?:file|file_premium|download|view)\/|\?)([a-z0-9]{8,20})/i) || [])[1] || "";

// ⚠ روابط الموقع القديمة بصيغة «mediafire.com/?KEY» يرفضها MediaFire بـ403 حين يطلبها خادم
// في مركز بيانات (كخوادم Supabase)، بينما الصيغة القياسية «www.mediafire.com/file/KEY» للملف
// نفسه تعمل وتحوّل إلى الملف مباشرةً. (من جهاز منزلي تعمل الصيغتان، فلا يظهر الفرق محلياً.)
// لذا نجرّب الصيغة القياسية أولاً ثم الرابط الأصلي احتياطاً.
async function mediafireFetch(pageUrl: string): Promise<Response> {
  const key = mfKeyOf(pageUrl);
  const tries = [...new Set([key ? `https://www.mediafire.com/file/${key}` : "", pageUrl].filter(Boolean))];
  let last: Error | null = null;
  for (const u of tries) {
    try { return await mediafireFetchOne(u); }
    catch (e) { last = e as Error; }
  }
  throw last || new Error("تعذّر التنزيل");
}

// Google Drive مع معالجة صفحة التأكيد (فحص الفيروسات للملفات الكبيرة) وكشف طلب تسجيل الدخول
async function driveFetch(fileId: string, resourceKey = ""): Promise<Response> {
  const headers = { "User-Agent": UA };
  const toSignIn = (r: Response) => /accounts\.google\.com|ServiceLogin|\/signin\//i.test(r.url);
  const rk = resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : "";
  let res = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}${rk}`, { headers, redirect: "follow" });
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
  if (resourceKey && !params.has("resourcekey")) params.set("resourcekey", resourceKey);
  res = await fetch(action + (action.includes("?") ? "&" : "?") + params.toString(), { headers, redirect: "follow" });
  if (toSignIn(res)) throw new Error("يطلب تسجيل الدخول");
  if (!isFileResponse(res)) throw new Error("لم يُعِد الملف (قد تكون الحصّة ممتلئة)");
  return res;
}

async function resolveMirror(m: Mirror, depth = 0): Promise<Response> {
  if (m.host === "drive") {
    const id = driveIdOf(m.url);
    if (!id) throw new Error("رابط غير صالح");
    return driveFetch(id, resourceKeyOf(m.url));
  }
  if (m.host === "fkdl") {
    // رابط الموقع يحوّل (302) إلى المستضيف الفعلي ⇒ نقرأ الوجهة ونكمل بمعالجها المعتاد
    const r = await fetch(m.url, { headers: { "User-Agent": UA }, redirect: "manual" });
    const loc = r.headers.get("location") || "";
    if (r.status >= 300 && r.status < 400 && loc && depth < 2) {
      const target = decode(new URL(loc, m.url).href);
      const host = classifyHost(target) || (/\.pdf/i.test(target) ? "direct" : "");
      if (!host) {
        const f = await fetch(target, { headers: { "User-Agent": UA }, redirect: "follow" });
        if (isFileResponse(f)) return f;
        throw new Error("وجهة غير معروفة");
      }
      return resolveMirror({ host, url: target }, depth + 1);
    }
    if (isFileResponse(r)) return r;
    throw new Error("لم يحوّل إلى ملف (" + r.status + ")");
  }
  if (m.host === "mediafire") return mediafireFetch(m.url);
  const url = m.host === "dropbox"
    ? m.url.replace(/([?&])dl=0/, "$1dl=1").replace(/www\.dropbox/, "dl.dropboxusercontent")
    : m.url;
  const r = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!isFileResponse(r)) throw new Error("لم يُعِد ملفاً");
  return r;
}

const HOST_AR: Record<string, string> = { drive: "Google Drive", mediafire: "MediaFire", dropbox: "Dropbox", direct: "الرابط المباشر", fkdl: "رابط شبكة الفكر" };

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

    // لوحة التحكم: المصدر موقوف؟ الزوار بلا حساب ممنوعون؟ المستخدم معطّلة عنه الإمكانية؟
    {
      const cfg = await siteConfig();
      const isNarjes = action === "fetch" && /narjeslibrary\.com|ww-api\.com/i.test(String(b.url || ""));
      const src = isNarjes ? "narjes" : action === "fetch" ? "" : "alfeker";
      if (src && cfg.sources && cfg.sources[src] === false) return json({ error: "هذا المصدر موقوف حالياً من إدارة التطبيق", code: "source_off" }, 403);
      const who = await callerUser(req);
      if (!who && cfg.discover_anonymous === false && src) return json({ error: "«استكشف» متاح لأصحاب الحسابات فقط — سجّل الدخول من زر السحابة ☁️", code: "auth" }, 401);
      if (who && src && !(await discoverAllowedFor(who.id))) return json({ error: "«استكشف» غير مفعّل لحسابك", code: "forbidden" }, 403);
    }

    if (action === "sections") {
      return json({ sections: parseSections(await getHtml(`${BASE}/sections/`)) });
    }

    if (action === "list") {
      const q = String(b.q || "").trim();
      const catid = String(b.catid || "").trim();
      const page = Math.max(1, Math.min(500, Math.floor(+b.page || 1)));
      const section = String(b.section || "").trim();
      const validSection = /^section\/[-%\w\/]+\/$/.test(section) ? section : "";
      let url: string;
      // البحث في الموقع صفحة واحدة بكل النتائج (لا ترقيم) ⇒ لا صفحات بعدها
      if (q) { if (page > 1) return json({ books: [], page, hasMore: false }); url = `${BASE}/?s=${encodeURIComponent(q)}&post_type=book`; }
      // الأقسام تُرقَّم بـ ?pg=N (وليس /page/N/ الذي يعيد الصفحة الأولى)
      else if (validSection) url = `${BASE}/${validSection}${page > 1 ? `?pg=${page}` : ""}`;
      // روابط الأقسام القديمة (library.php?catid=…) ما زالت تحوّل إلى أقسام الموقع الجديد (للنسخ السابقة من التطبيق)
      else url = `${BASE}/library.php?catid=${encodeURIComponent(catid || "65")}`;
      let html: string;
      try { html = await getHtml(url); }
      catch (e) { if (page > 1 && /404/.test(String((e as Error).message))) return json({ books: [], hasMore: false }); throw e; }
      const books = parseCards(html);
      const total = +latinDigits((html.match(/hwza-log-count[\s\S]{0,400}?([٠-٩\d][٠-٩\d,٬]*)\s*كتاب/) || [])[1] || "").replace(/\D/g, "") || 0;
      // المزيد = في شريط الصفحات رابطٌ إلى الصفحة التالية
      const hasMore = !!validSection && books.length > 0 && html.includes(`pg=${page + 1}"`);
      return json({ books, page, hasMore, total });
    }

    if (action === "detail") {
      const id = String(b.id || "").trim();
      if (/^\d+$/.test(id)) {
        let html = "";
        try { html = await getHtml(`${BASE}/b/${id}/`); } catch { /* ← الرابط القديم احتياطاً */ }
        if (html) return json(parseDetail(html, id));
      }
      if (!id) return json({ error: "معرّف الكتاب مفقود" }, 400);
      const html = await getHtml(`${BASE}/library.php?id=${encodeURIComponent(id)}`);
      return json(parseDetail(html, id));
    }

    // وسيط عام: يجلب أي رابط مباشر (PDF/نص) من الخادم ويعيده للمتصفح بلا قيد CORS
    if (action === "fetch") {
      const target = String(b.url || "").trim();
      if (!/^https?:\/\/.+/i.test(target)) return json({ error: "رابط غير صالح" }, 400);
      // الزائر بلا حساب: مواقع الكتب المعروفة فقط؛ صاحب الحساب: أي رابط (الإضافة من رابط)
      if (!isPublicHost(target) && !(await callerUser(req))) {
        return json({ error: "هذا الموقع غير مدعوم عبر الخادم العام — نزّل الملف من متصفحك ثم أضِفه عبر «أضف كتاباً ← من ملف»", code: "host" }, 403);
      }
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
            const d = parseDetail(await getHtml(/^\d+$/.test(id) ? `${BASE}/b/${id}/` : `${BASE}/library.php?id=${encodeURIComponent(id)}`), id);
            const byUrl = fileUrl ? d.parts.find((p) => p.mirrors.some((m) => m.url === fileUrl)) : undefined;
            const idx = Math.max(0, Math.min(+b.part || 0, d.parts.length - 1));
            mirrors = (byUrl || d.parts[idx])?.mirrors || [];
          } catch { /* نكمل بالرابط المُرسَل */ }
        }
        if (!mirrors.length && fileUrl) mirrors = cleanMirrors([{ url: fileUrl }]);
      }
      if (!mirrors.length) return json({ error: "لا يوجد ملف قابل للتنزيل لهذا الكتاب" }, 404);
      // الروابط «المباشرة» الواردة من العميل: لغير أصحاب الحسابات من مواقع الكتب المعروفة فقط
      if (mirrors.some((m) => m.host === "direct" && !isPublicHost(m.url)) && !(await callerUser(req))) {
        mirrors = mirrors.filter((m) => m.host !== "direct" || isPublicHost(m.url));
        if (!mirrors.length) return json({ error: "هذا الرابط غير مدعوم عبر الخادم العام", code: "host" }, 403);
      }

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
