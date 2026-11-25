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
  "wikisource.org", "inahj.org", "imamhussain.org", "rafed.net", "haydarya.org"];
const isPublicHost = (u: string) => {
  try { const h = new URL(u).hostname.toLowerCase(); return PUBLIC_HOSTS.some((d) => h === d || h.endsWith("." + d)); }
  catch { return false; }
};

/* ── «إصدارات العتبة الحسينية» (publication.imamhussain.org) ──
   موقع Laravel بلا واجهة برمجية عامة، لكن كل بطاقة تحمل سجلّ الإصدار كاملاً (JSON) في
   onclick="selectedImage({...})": العنوان والنبذة والغلاف والحجم والنوع (BOOK/MAGAZINE) والملف.
   الملفات روابط PDF مباشرة؛ تُنزَّل عبر إجراء fetch العام (الموقع لا يرسل ترويسات CORS). */
const IH = "https://publication.imamhussain.org";
function ihParse(html: string) {
  const out: any[] = [], seen = new Set<number>();
  for (const m of html.matchAll(/selectedImage\((\{[\s\S]*?\})\)"/g)) {
    let o: any;
    try { o = JSON.parse(decode(m[1])); } catch { continue; }
    if (!o || !o.id || !o.pdf || o.deleted_at || seen.has(o.id)) continue;
    seen.add(o.id);
    out.push({
      id: String(o.id), title: String(o.title || "").trim(), type: String(o.type || "").toUpperCase(),
      desc: stripTags(decode(String(o.content || ""))).slice(0, 600),
      cover: o.pic ? `${IH}/uploads/publications/${encodeURIComponent(o.pic)}` : "",
      pdf: `${IH}/uploads/pdf/${encodeURIComponent(o.pdf)}`,
      size: String(o.size || ""), downloads: +o.downloads || 0, cat: o.cat_id ? String(o.cat_id) : "", date: String(o.created_at || "").slice(0, 10),
    });
  }
  return out;
}
function ihSections(html: string) {
  const out: { id: string; label: string }[] = [], seen = new Set<string>();
  for (const m of html.matchAll(/category\/(\d+)"[^>]*>([\s\S]{0,400}?)<\/a>/g)) {
    const label = decode(stripTags(m[2]));
    if (!label || seen.has(m[1])) continue;
    seen.add(m[1]); out.push({ id: m[1], label });
  }
  return out;
}

/* ── «مكتبة رافد» (lib.rafed.net) ──
   موقع PHP قديم بلا CORS. لكل كتاب مجلد ثابت Books/<id>_<slug>/ فيه الأغلفة بثلاثة أحجام
   (cover / cover-medium ‏300px / cover-big نحو 900px). الملفات عبر print.php?type=d_book&format=pdf|pdfimg|doc
   (تحويل 302 إلى الملف؛ نحو ٨٠٪ من الكتب بلا PDF، Word فقط). لكن نصّ كل كتاب متاح كاملاً في
   «نسخة الطباعة» print.php?type=p_book&from=1&to=N: صفحات div.page فيها فقرات بأصناف rfdToc1-3
   (العناوين) و rfdFootnote (الحواشي) — نحوّلها إلى نصّ بعناوين Markdown يقرؤه مِداد مباشرة.
   البحث: ac.php?text=…&ops=1 (العناوين) | 2 (المؤلفون) &page=N (من الصفر، ٢٠ نتيجة) → JSON فيه HTML. */
const RF = "https://lib.rafed.net";
const rfDigits = (s: string) => latinDigits(decode(s || ""));
function rfCard(bl: string) {
  const id = (bl.match(/b_id=(\d+)/) || [])[1];
  if (!id) return null;
  const img = (bl.match(/src="(Books\/[^"]+?)\/images\/cover[^"]*"/) || [])[1] || "";
  const title = decode(stripTags((bl.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || ""));
  const spans = [...bl.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((m) => decode(stripTags(m[1])));
  const author = spans.find((s) => !/^الناشر/.test(s)) || "";
  const publisher = (spans.find((s) => /^الناشر/.test(s)) || "").replace(/^الناشر\s*:\s*/, "");
  const pages = +(rfDigits((bl.match(/>([^<]*?)\s*صفحة<\/span>/) || [])[1] || "").replace(/\D/g, "")) || 0;
  const views = +(rfDigits((bl.match(/>([^<]*?)\s*مشاهدة<\/span>/) || [])[1] || "").replace(/\D/g, "")) || 0;
  const fmts = [...new Set([...bl.matchAll(/format=(\w+)/g)].map((m) => m[1]))];
  return { id, title, author, publisher, pages, views, fmts, cover: img ? `${RF}/${img}/images/cover-medium.jpg` : "" };
}
// مجلد الكتاب من تحويل رابط التنزيل (دون تنزيل الملف نفسه) — لأغلفة نتائج البحث
async function rfFolder(id: string): Promise<string> {
  for (const f of ["doc", "pdf"]) {
    try {
      const r = await fetch(`${RF}/print.php?type=d_book&book=${id}&format=${f}`, { headers: { "User-Agent": UA }, redirect: "manual" });
      const loc = r.headers.get("location") || "";
      await r.body?.cancel();
      const m = loc.match(/\/(Books\/[^/]+)\//);
      if (m) return m[1];
    } catch { /* التالي */ }
  }
  return "";
}
function rfSearchRows(out: string) {
  const rows: any[] = [];
  for (const part of out.split('class="resultRow"').slice(1)) {
    const id = (part.match(/b_id=(\d+)/) || [])[1];
    if (!id) continue;
    rows.push({
      id,
      title: decode(stripTags((part.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || "")),
      vols: +rfDigits((part.match(/عدد المجلدات\s*:\s*([^\]<]+)/) || [])[1] || "").replace(/\D/g, "") || 0,
      author: decode(stripTags((part.match(/<span style="color: green;">([\s\S]*?)<\/span>/) || [])[1] || "")),
      desc: decode(stripTags((part.match(/<span style="font-size:10px;color:#888;">([\s\S]*?)<\/span>/) || [])[1] || "")).slice(0, 300),
    });
  }
  return rows;
}
function rfDetail(html: string, id: string) {
  const v = (name: string) => (html.match(new RegExp(`var ${name}\\s*=\\s*['"]([^'"]*)['"]`)) || [])[1] || "";
  const folder = (v("imgpath").match(/^(Books\/[^/]+)\//) || [])[1] || "";
  const field = (label: string) => decode(stripTags((html.match(new RegExp(label + "\\s*:\\s*(?:<[^>]+>\\s*)*([^<\\n]+)")) || [])[1] || "")).trim();
  const vols: { id: string; label: string }[] = [];
  const sel = (html.match(/<select id="relbooks"[\s\S]*?<\/select>/) || [])[0] || "";
  for (const m of sel.matchAll(/<option value="(\d+)"[^>]*>([^<]*)<\/option>/g)) vols.push({ id: m[1], label: rfDigits(m[2]).trim() });
  const fmts = [...new Set([...html.matchAll(/print\.php\?type=d_book&(?:amp;)?book=\d+&(?:amp;)?format=(\w+)/g)].map((m) => m[1]))];
  const pages = +((html.match(/bEd\s*=\s*(\d+)/) || [])[1] || 0);
  const intro = (html.match(/b_id=(\d+)">مقدمة الكتاب</) || [])[1] || "";
  // العنوان الكامل (مع رقم الجزء) في رأس الصفحة: «إختيار معرفة الرجال - ج ١»
  const head = rfDigits(stripTags((html.match(/&nbsp;\s*<\/[a-z]+>\s*([^<]{2,300}?)\s*<(?:br|\/)/) || [])[1] || ""));
  const name = decode(v("bookName"));
  return {
    id, title: name || head, fullTitle: head && name && head.startsWith(name) ? head : name || head,
    author: field("المؤلف"), editor: field("المحقق"), publisher: field("الناشر"), edition: rfDigits(field("الطبعة")).replace(/^0$/, ""),
    subject: field("الموضوع"), date: rfDigits(field("تاريخ النشر")), pages,
    cover: folder ? `${RF}/${folder}/images/${/hasBigCover\s*=\s*true/.test(html) ? "cover-big" : "cover"}.jpg` : "",
    coverSmall: folder ? `${RF}/${folder}/images/${/hasBigCover\s*=\s*true/.test(html) ? "cover-medium" : "cover"}.jpg` : "",
    fmts, vols, intro,
    pdf: fmts.includes("pdf") ? `${RF}/print.php?type=d_book&book=${id}&format=pdf` : "",
    pdfimg: fmts.includes("pdfimg") ? `${RF}/print.php?type=d_book&book=${id}&format=pdfimg` : "",
  };
}
// فهرس الكتاب من صفحته (ul.treeview متداخلة): العنوان، والصفحة، والمستوى
function rfToc(html: string): { title: string; page: number; depth: number }[] {
  const at = html.indexOf('<ul class="treeview">');
  if (at < 0) return [];
  const out: { title: string; page: number; depth: number }[] = [];
  let depth = -1;
  for (const m of html.slice(at, at + 400000).matchAll(/<ul\b[^>]*>|<\/ul>|<a href="\?type=c_fbook&(?:amp;)?b_id=\d+&(?:amp;)?page=(\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    if (m[0].startsWith("<ul")) { depth++; continue; }
    if (m[0] === "</ul>") { if (--depth < 0) break; continue; }
    const title = decode(stripTags(m[2])).replace(/\s+/g, " ").trim();
    if (title) out.push({ title, page: +m[1], depth: Math.max(0, depth) });
  }
  return out;
}
const rfKey = (s: string) => arNorm(s).replace(/[^\p{L}\p{N}]+/gu, "");
// «نسخة الطباعة» → نصّ مِداد. العناوين (# ## ###) من فهرس الكتاب في موقعه، كلٌّ في صفحته
// (تحلّ محلّ سطرها في الصفحة إن وُجد)؛ أسطر «دليل الكتاب» (rfdToc) تبقى أسطراً عادية بلا نقاط الحشو.
function rfToText(html: string, toc: { title: string; page: number; depth: number }[] = []): { text: string; pages: number; heads: number } {
  const chunks = html.split(/class="page booksize"/).slice(1);
  const out: string[] = [];
  const para = (inner: string) => decode(stripTags(inner.replace(/<br\s*\/?>/gi, " "))).replace(/\s+/g, " ").trim();
  const byPage = new Map<number, typeof toc>();
  for (const t of toc) { const l = byPage.get(t.page) || []; l.push(t); byPage.set(t.page, l); }
  let heads = 0;
  chunks.forEach((ch, idx) => {
    const body = (ch.match(/<div class="pgcontent">([\s\S]*?)<\/div>\s*<div class="pgnum">/) || [])[1] || "";
    const lines: string[] = [];
    // فقرات وجداول (الشعر يأتي في جداول: صدر وعجز)
    for (const m of body.matchAll(/<p(?:\s+class=["']?([\w-]+)["']?)?[^>]*>([\s\S]*?)<\/p>|<table[\s\S]*?<\/table>/g)) {
      if (m[0].startsWith("<table")) {
        for (const tr of m[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
          const cells = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => para(c[1])).filter(Boolean);
          if (cells.length) lines.push(cells.join(" … "));
        }
        continue;
      }
      const cls = m[1] || "";
      let t = para(m[2]);
      if (!t) continue;
      if (/^rfdToc/.test(cls)) { t = t.replace(/\s*[.…·]{3,}\s*/g, " … "); lines.push(t); }
      else if (/^rfdLine/.test(cls)) lines.push("————");
      else if (/Bold|Center|Heading/i.test(cls) && t.length < 140) lines.push("**" + t.replace(/\*/g, "") + "**");
      else lines.push(t);
    }
    // عناوين هذه الصفحة من الفهرس: تحلّ محلّ السطر المطابق، وإلا تُضاف أعلى الصفحة
    const hs = byPage.get(idx + 1) || [];
    let insertAt = 0;
    for (const h of hs) {
      const mark = "#".repeat(Math.min(3, h.depth + 1)) + " " + h.title;
      const k = rfKey(h.title);
      const found = k ? lines.findIndex((l, n) => n >= insertAt && !l.startsWith("#") && rfKey(l.replace(/\*\*/g, "")) === k) : -1;
      if (found >= 0) { lines[found] = mark; insertAt = found + 1; }
      else { lines.splice(insertAt, 0, mark); insertAt++; }
      heads++;
    }
    if (lines.length) out.push(lines.join("\n\n"));
  });
  return { text: out.join("\n\n"), pages: chunks.length, heads };
}

/* ── «مكتبة الروضة الحيدرية» (haydarya.org) — «المكتبة المختصة بأمير المؤمنين (ع)» ──
   نظام محتوى قديم: كل باب ?id=N؛ الأبواب الأمّ تعرض أبوابها الفرعية بطاقاتٍ <li><a href="?id=N">،
   والأبواب الطرفية قائمةٌ كاملة بلا ترقيم: span.ace_item فيه الغلاف (rpic.php?i=files/…jpg) والعنوان
   (?id=N&sid=M) والمؤلف والمحقق وعدد المجلدات والناشر والتاريخ. صفحة الكتاب فيها div.books2_files
   بروابط PDF مباشرة (جزء أو أجزاء). الموقع يرفض وكلاء المستخدم القصيرة (406) — نرسل UA متصفح كاملاً.
   أقسام الموقع الأخرى (الرسائل الجامعية…) نصوص HTML بلا ملفات، فلا تُعرض. */
const HY = "https://www.haydarya.org";
const HY_ROOT = "38";
type HySec = { id: string; label: string; parent: string; leaf: boolean; count: number };
let hyTree: { at: number; list: HySec[] } | null = null;
const hyIndex = new Map<string, { at: number; items: any[] }>();
const hyTitle = (h: string) => decode((h.match(/<title>\s*([\s\S]*?)\s*-\s*مكتبة الروضة/) || [])[1] || "").replace(/\s+/g, " ").trim();
function hyChildren(h: string) {
  // البطاقات الفرعية في جسم الصفحة فقط (لا روابط القوائم العامة)
  const at = h.indexOf('class="sub-menu"');
  const body = at >= 0 ? h.slice(at) : h;
  const out: { id: string; label: string }[] = [], seen = new Set<string>();
  for (const m of body.matchAll(/<li><a href="\?id=(\d+)"[^>]*>([\s\S]*?)<\/a><\/li>/g)) {
    if (seen.has(m[1])) continue;
    const label = decode(stripTags(m[2].replace(/<div class="veiw_num">[\s\S]*?<\/div>\s*<\/div>/, ""))).replace(/\s+/g, " ").trim();
    seen.add(m[1]); out.push({ id: m[1], label });
  }
  return out;
}
function hyItems(h: string, cat: string) {
  const out: any[] = [], seen = new Set<string>();
  for (const part of h.split('<span class="ace_item">').slice(1)) {
    const sid = (part.match(new RegExp(`href="\\?id=${cat}&(?:amp;)?sid=(\\d+)"`)) || [])[1];
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    const f = (label: string) => decode(stripTags((part.match(new RegExp(`<span>${label}\\s*:?(?:&nbsp;)?\\s*</span>([\\s\\S]*?)</div>`)) || [])[1] || "")).replace(/\s+/g, " ").trim();
    const img = (part.match(/rpic\.php\?i=(files\/[^&"]+)/) || [])[1] || "";
    out.push({
      id: `${cat}:${sid}`, cat,
      title: decode((part.match(/class="name"[^>]*title="([^"]*)"/) || [])[1] || "").replace(/\s+/g, " ").trim(),
      author: f("المؤلف"), editor: f("المحقق"), vols: +latinDigits(f("عدد المجلدات")).replace(/\D/g, "") || 0,
      publisher: f("الناشر"), date: f("تاريخ الانتشار"),
      cover: img ? `${HY}/rpic.php?i=${img}&w=300&h=424` : "", coverFull: img ? `${HY}/${img}` : "",
    });
  }
  return out;
}
const hyGet = (q: string) => getHtml(`${HY}/${q}`);
// شجرة الأبواب (بحثاً بالعرض، ٦ طلبات متوازية) — تُحفظ في ذاكرة الدالة ١٢ ساعة
async function hySections(): Promise<HySec[]> {
  if (hyTree && Date.now() - hyTree.at < 12 * 3600e3) return hyTree.list;
  const list: HySec[] = [];
  let front = [{ id: HY_ROOT, label: "", parent: "" }];
  const seen = new Set([HY_ROOT]);
  for (let depth = 0; front.length && depth < 6; depth++) {
    const next: typeof front = [];
    for (let i = 0; i < front.length; i += 6) {
      const batch = front.slice(i, i + 6);
      const pages = await Promise.all(batch.map((s) => hyGet(`?id=${s.id}`).catch(() => "")));
      batch.forEach((s, k) => {
        const h = pages[k];
        if (!h) return;
        const kids = hyChildren(h).filter((c) => !seen.has(c.id));
        const items = hyItems(h, s.id);
        if (s.id !== HY_ROOT) list.push({ id: s.id, label: s.label || hyTitle(h), parent: s.parent, leaf: !kids.length, count: items.length });
        if (items.length) hyIndex.set(s.id, { at: Date.now(), items });
        for (const c of kids) { seen.add(c.id); next.push({ id: c.id, label: c.label, parent: s.id === HY_ROOT ? "" : s.id }); }
      });
    }
    front = next;
  }
  // الأبواب التي لا كتب فيها ولا في فروعها تُحذف؛ والعدد يشمل الفروع
  const total = (id: string): number => list.filter((x) => x.parent === id).reduce((a, x) => a + total(x.id), 0) + (list.find((x) => x.id === id)?.count || 0);
  const kept = list.map((x) => ({ ...x, count: total(x.id) })).filter((x) => x.count > 0);
  if (kept.length) hyTree = { at: Date.now(), list: kept };
  return kept;
}
async function hyCat(cat: string) {
  const c = hyIndex.get(cat);
  if (c && Date.now() - c.at < 6 * 3600e3) return c.items;
  const items = hyItems(await hyGet(`?id=${cat}`), cat);
  hyIndex.set(cat, { at: Date.now(), items });
  return items;
}
// كل الكتب تحت باب (أو في المكتبة كلها): يجمع كتب الباب وفروعه
async function hyAll(under: string) {
  const tree = await hySections();
  const desc = (id: string): string[] => tree.filter((x) => x.parent === id).flatMap((x) => [x.id, ...desc(x.id)]);
  const ids = under ? [under, ...desc(under)] : tree.map((x) => x.id);
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 6) {
    const got = await Promise.all(ids.slice(i, i + 6).map((id) => hyCat(id).catch(() => [])));
    for (const g of got) out.push(...g);
  }
  const seen = new Set<string>();
  return out.filter((x) => !seen.has(x.id) && seen.add(x.id));
}
const arNorm = (s: string) => String(s || "").replace(/[ً-ٰٟـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim().toLowerCase();
function hyDetail(h: string, cat: string, sid: string) {
  const files: { label: string; url: string; kind: string }[] = [];
  const box = (h.match(/<div class="books2_files">([\s\S]*?)<\/div>/) || [])[1] || "";
  for (const m of box.matchAll(/<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    let url = "";
    try { url = new URL(decode(m[1]), HY + "/").href; } catch { continue; }
    const kind = ((url.match(/\.(\w+)(?:[?#]|$)/) || [])[1] || "").toLowerCase();
    files.push({ url, kind, label: decode(stripTags(m[2])).replace(/^تحميل\s*/, "").replace(/\s+/g, " ").trim() });
  }
  const it = hyItems(h.replace('<div class="ace_bio_info">', '<span class="ace_item">'), cat).find((x) => x.id === `${cat}:${sid}`) || {};
  const bio = decode(stripTags(((h.match(/<div class="ace_bio_text">([\s\S]*?)<\/div>/) || [])[1] || "").replace(/<\/p>/g, "\n"))).trim();
  return { ...it, id: `${cat}:${sid}`, cat, files, desc: bio.slice(0, 1500), title: (it as any).title || hyTitle(h) };
}

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
    if (action === "version") return json({ fn: "alfeker", fnVersion: "2026.11.25" });

    // لوحة التحكم: المصدر موقوف؟ الزوار بلا حساب ممنوعون؟ المستخدم معطّلة عنه الإمكانية؟
    {
      const cfg = await siteConfig();
      const isNarjes = action === "fetch" && /narjeslibrary\.com|ww-api\.com/i.test(String(b.url || ""));
      const isIH = action.startsWith("ih_") || (action === "fetch" && /imamhussain\.org/i.test(String(b.url || "")));
      const isRF = action.startsWith("rf_") || (action === "fetch" && /rafed\.net/i.test(String(b.url || "")));
      const isHY = action.startsWith("hy_") || (action === "fetch" && /haydarya\.org/i.test(String(b.url || "")));
      const src = isIH ? "imamhussain" : isRF ? "rafed" : isHY ? "haydarya" : isNarjes ? "narjes" : action === "fetch" ? "" : "alfeker";
      if (src && cfg.sources && cfg.sources[src] === false) return json({ error: "هذا المصدر موقوف حالياً من إدارة التطبيق", code: "source_off" }, 403);
      const who = await callerUser(req);
      if (!who && cfg.discover_anonymous === false && src) return json({ error: "«استكشف» متاح لأصحاب الحسابات فقط — سجّل الدخول من زر السحابة ☁️", code: "auth" }, 401);
      if (who && src && !(await discoverAllowedFor(who.id))) return json({ error: "«استكشف» غير مفعّل لحسابك", code: "forbidden" }, 403);
    }

    // إصدارات العتبة الحسينية: الأبواب (الجهات الناشرة)، والقوائم (بحث | باب | الكتب | الأحدث)
    if (action === "ih_sections") {
      return json({ sections: ihSections(await getHtml(`${IH}/`)) });
    }
    if (action === "ih_list") {
      const q = String(b.q || "").trim().slice(0, 120);
      const cat = /^\d+$/.test(String(b.cat || "")) ? String(b.cat) : "";
      const page = Math.max(1, Math.min(500, Math.floor(+b.page || 1)));
      const pg = page > 1 ? `page=${page}` : "";
      const latest = !q && !cat && b.kind !== "books";
      if (latest && page > 1) return json({ items: [], page, hasMore: false }); // «الأحدث» صفحة واحدة
      const url = q ? `${IH}/results?query=${encodeURIComponent(q)}${pg ? "&" + pg : ""}`
        : cat ? `${IH}/category/${cat}${pg ? "?" + pg : ""}`
        : latest ? `${IH}/` : `${IH}/books${pg ? "?" + pg : ""}`;
      let html: string;
      try { html = await getHtml(url); }
      catch (e) { if (page > 1) return json({ items: [], page, hasMore: false }); throw e; }
      const items = ihParse(html);
      const hasMore = !latest && items.length > 0 && new RegExp(`[?&]page=${page + 1}(?!\\d)`).test(html);
      return json({ items, page, hasMore });
    }

    // مكتبة رافد: القوائم (باب | بحث بالعنوان والمؤلف)، والتفاصيل، والنصّ الكامل
    if (action === "rf_list") {
      const q = String(b.q || "").trim().slice(0, 120);
      const cat = /^\d+$/.test(String(b.cat || "")) ? String(b.cat) : "0";
      const page = Math.max(1, Math.min(500, Math.floor(+b.page || 1)));
      if (q) {
        // العناوين والمؤلفون معاً (طلبان متوازيان)، ثم مجلد كل كتاب لغلافه
        const one = async (ops: string) => {
          const r = await fetch(`${RF}/ac.php?text=${encodeURIComponent(q)}&ops=${ops}&page=${page - 1}&output=true`, { headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest" } });
          if (!r.ok) return { rows: [] as any[], more: false };
          const j = await r.json().catch(() => ({}));
          const out = String(j.output || "");
          return { rows: rfSearchRows(out), more: out.includes(`page = '${page}'`) };
        };
        const [t, a] = await Promise.all([one("1"), one("2")]);
        const seen = new Set<string>();
        const rows = [...t.rows, ...a.rows].filter((x) => !seen.has(x.id) && seen.add(x.id));
        const folders = await Promise.all(rows.map((x) => rfFolder(x.id)));
        const items = rows.map((x, i) => ({ ...x, cover: folders[i] ? `${RF}/${folders[i]}/images/cover-medium.jpg` : "" }));
        return json({ items, page, hasMore: t.more || a.more });
      }
      let html: string;
      try { html = await getHtml(`${RF}/view.php?type=c_blist&cid=${cat}&lang=&cen=&order=title&limit=42&page=${page - 1}`); }
      catch (e) { if (page > 1) return json({ items: [], page, hasMore: false }); throw e; }
      const items = html.split('class="specCatBook"').slice(1).map(rfCard).filter(Boolean);
      return json({ items, page, hasMore: items.length > 0 && html.includes(`page=${page}"`) });
    }
    if (action === "rf_detail") {
      const id = String(b.id || "").trim();
      if (!/^\d+$/.test(id)) return json({ error: "معرّف الكتاب مفقود" }, 400);
      return json(rfDetail(await getHtml(`${RF}/view.php?type=c_fbook&b_id=${id}`), id));
    }
    if (action === "rf_text") {
      const id = String(b.id || "").trim();
      const to = Math.max(1, Math.min(20000, Math.floor(+b.pages || 0)));
      if (!/^\d+$/.test(id) || !b.pages) return json({ error: "معرّف الكتاب أو عدد صفحاته مفقود" }, 400);
      const [html, page] = await Promise.all([
        getHtml(`${RF}/print.php?type=p_book&book=${id}&from=1&to=${to}`),
        getHtml(`${RF}/view.php?type=c_fbook&b_id=${id}`).catch(() => ""),
      ]);
      const r = rfToText(html, rfToc(page));
      if (!r.text.trim()) return json({ error: "لا يوجد نصّ متاح لهذا الكتاب" }, 404);
      return json(r);
    }

    // مكتبة الروضة الحيدرية: الأبواب (شجرة)، والقوائم (باب | الكل | بحث)، والتفاصيل
    if (action === "hy_sections") return json({ sections: await hySections() });
    if (action === "hy_list") {
      const q = arNorm(String(b.q || "").slice(0, 120));
      const cat = /^\d+$/.test(String(b.cat || "")) ? String(b.cat) : "";
      const page = Math.max(1, Math.min(500, Math.floor(+b.page || 1)));
      const per = 48;
      let items = cat && !q ? await hyAll(cat) : await hyAll("");
      if (q) {
        const words = q.split(" ").filter(Boolean);
        items = items.filter((x) => { const hay = arNorm(`${x.title} ${x.author} ${x.editor} ${x.publisher}`); return words.every((w) => hay.includes(w)); });
      }
      return json({ items: items.slice((page - 1) * per, page * per), page, total: items.length, hasMore: items.length > page * per });
    }
    if (action === "hy_detail") {
      const m = String(b.id || "").match(/^(\d+):(\d+)$/);
      if (!m) return json({ error: "معرّف الكتاب مفقود" }, 400);
      return json(hyDetail(await hyGet(`?id=${m[1]}&sid=${m[2]}`), m[1], m[2]));
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

    return json({ error: "إجراء غير معروف", code: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
