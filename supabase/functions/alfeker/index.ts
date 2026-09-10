// ═══════ مِداد — وسيط «شبكة الفكر» (alfeker.net) ═══════
// alfeker.net موقع PHP بلا واجهة برمجية، صفحاته محجوبة بـCORS، وملفاته على Google Drive.
// هذه الدالة تكشط صفحاته من الخادم (بلا قيد CORS) وتنزّل ملف الكتاب من Drive وتعيده للمتصفح.
// إجراءات: list (catid|q) ، detail (id) ، file (id) — بثّ ملف PDF.
// ملاحظة: تكامل هشّ بطبيعته (يعتمد على بنية HTML وحصص Google Drive).

const BASE = "https://alfeker.net";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

function parseDetail(html: string, id: string) {
  // العنوان: وسم <title> هو اسم الكتاب في alfeker (أوثق من h1/h2)
  let title = decode(stripTags((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || ""))
    .replace(/\s*[-|]\s*(alfeker|شبكة الفكر).*$/i, "").trim();
  if (!title) title = decode(stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || ""));
  const author = decode(stripTags((html.match(/authors\.php\?id=\d+[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ""));
  // القسم فقط من كتلة معلومات الكتاب (لا من قائمة التصنيفات الجانبية)
  const category = decode(stripTags((html.match(/القسم\s*:?\s*<span>\s*<a[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ""));
  const pages = (html.match(/عدد\s*الصفحات[^\d]{0,20}(\d+)/) || [])[1] || "";
  // الكتاب قد يُرفع على عدة مستضيفات معاً؛ نفضّل Google Drive (يعمل عبر الوسيط) على MediaFire (يحجب الخوادم)
  const driveUrl = (html.match(/https?:\/\/drive\.google\.com\/[^"'\s<>]+/i) || [])[0] || "";
  const dropboxUrl = (html.match(/https?:\/\/(?:www\.)?dropbox\.com\/[^"'\s<>]+/i) || [])[0] || "";
  const mfUrl = (html.match(/https?:\/\/(?:www\.)?mediafire\.com\/[^"'\s<>]+/i) || [])[0] || "";
  const directUrl = (html.match(/https?:\/\/[^"'\s<>]+\.pdf(?:\/file)?/i) || [])
    .filter((u: string) => !/(mediafire|drive\.google|dropbox)/i.test(u))[0] || "";
  let fileUrl = "", host = "";
  if (driveUrl) { fileUrl = driveUrl; host = "drive"; }
  else if (directUrl) { fileUrl = directUrl; host = "direct"; }
  else if (dropboxUrl) { fileUrl = dropboxUrl; host = "dropbox"; }
  else if (mfUrl) { fileUrl = mfUrl; host = "mediafire"; }
  fileUrl = decode(fileUrl);
  // رابط بديل يدوي (MediaFire) عند توفّر Drive، أو Drive عند غيابه — للاحتياط
  let altUrl = "", altHost = "";
  if (host === "drive" && mfUrl) { altUrl = decode(mfUrl); altHost = "mediafire"; }
  const cover = absImg((html.match(/uploads\/pictures\/(?!\.thumb)[^"']+\.(?:jpg|jpeg|png)/i) || html.match(/uploads\/pictures\/[^"']+\.(?:jpg|jpeg|png)/i) || [])[0] || "");
  return { id, title, author, category, pages, fileUrl, host, altUrl, altHost, cover };
}

// MediaFire: اجلب صفحة الملف واستخرج رابط التنزيل المباشر (أنماط متعددة)
async function mediafireFetch(pageUrl: string): Promise<Response> {
  const html = await getHtml(pageUrl);
  const direct =
    (html.match(/href="(https?:\/\/download[^"]+\.mediafire\.com\/[^"]+)"/i) || [])[1] ||
    (html.match(/(https?:\/\/download[^"'\s\\]+\.mediafire\.com\/[^"'\s\\]+)/i) || [])[1] ||
    (html.match(/href="(https?:\/\/[^"]+\.mediafire\.com\/[^"]+\.pdf[^"]*)"/i) || [])[1];
  if (!direct) throw new Error("تعذّر استخراج رابط MediaFire (قد يتطلب تحقّقاً بشرياً)");
  return fetch(decode(direct), { headers: { "User-Agent": UA, "Referer": pageUrl } });
}

// حلّ رابط الملف إلى بثّ بايتات حسب المستضيف
async function resolveFile(fileUrl: string, host: string): Promise<Response> {
  if (host === "drive") {
    const driveId = (fileUrl.match(/\/file\/d\/([-\w]+)/) || fileUrl.match(/[?&]id=([-\w]+)/) || [])[1];
    if (!driveId) throw new Error("رابط Drive غير صالح");
    return driveFetch(driveId);
  }
  if (host === "mediafire") return mediafireFetch(fileUrl);
  if (host === "dropbox") return fetch(fileUrl.replace(/([?&])dl=0/, "$1dl=1").replace(/www\.dropbox/, "dl.dropboxusercontent"), { headers: { "User-Agent": UA } });
  return fetch(fileUrl, { headers: { "User-Agent": UA } }); // مباشر
}

// تنزيل ملف من Google Drive مع معالجة صفحة تأكيد الملفات الكبيرة
async function driveFetch(fileId: string): Promise<Response> {
  const headers = { "User-Agent": UA };
  let res = await fetch(`https://drive.google.com/uc?export=download&id=${fileId}`, { headers });
  let ct = res.headers.get("content-type") || "";
  if (!/text\/html/i.test(ct)) return res; // ملف مباشر
  const html = await res.text();
  // النموذج الحديث: form إلى drive.usercontent.google.com/download بحقول مخفية
  let action = (html.match(/action="([^"]+)"/i) || [])[1] || "https://drive.usercontent.google.com/download";
  action = decode(action);
  const params = new URLSearchParams();
  for (const m of html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)) params.set(m[1], decode(m[2]));
  if (!params.has("id")) params.set("id", fileId);
  if (!params.has("export")) params.set("export", "download");
  const conf = (html.match(/[?&]confirm=([\w-]+)/) || [])[1];
  if (conf && !params.has("confirm")) params.set("confirm", conf);
  const url2 = action + (action.includes("?") ? "&" : "?") + params.toString();
  res = await fetch(url2, { headers });
  return res;
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

    if (action === "file") {
      let fileUrl = String(b.fileUrl || "").trim();
      let host = String(b.host || "").trim();
      const id = String(b.id || "").trim();
      if (!fileUrl && id) {
        const html = await getHtml(`${BASE}/library.php?id=${encodeURIComponent(id)}`);
        const d = parseDetail(html, id); fileUrl = d.fileUrl; host = d.host;
      }
      if (!fileUrl) return json({ error: "لا يوجد ملف قابل للتنزيل لهذا الكتاب" }, 404);
      let dr: Response;
      try { dr = await resolveFile(fileUrl, host); }
      catch (e) { return json({ error: "تعذّر تنزيل الملف: " + String((e as Error)?.message || e) }, 502); }
      const ct = dr.headers.get("content-type") || "";
      if (!dr.ok || /text\/html/i.test(ct)) {
        return json({ error: "تعذّر تنزيل الملف من المستضيف (قد تكون حصّة التحميل ممتلئة — حاول لاحقاً)" }, 502);
      }
      const headers = new Headers(CORS);
      headers.set("Content-Type", ct.includes("pdf") ? ct : "application/pdf");
      const cl = dr.headers.get("content-length"); if (cl) headers.set("Content-Length", cl);
      headers.set("Content-Disposition", "inline");
      return new Response(dr.body, { status: 200, headers });
    }

    return json({ error: "إجراء غير معروف" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
