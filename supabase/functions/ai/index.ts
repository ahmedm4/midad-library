// ═══════ مِداد — دالة الذكاء الاصطناعي (Supabase Edge Function) ═══════
// تحفظ مفتاح Gemini كسرّ في الخادم فلا يظهر في المتصفح.
// المتغيّرات السرية المطلوبة: GEMINI_API_KEY  (واختياري GEMINI_MODEL)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function buildPrompt(action: string, p: { text: string; question: string; title: string }) {
  const book = p.text.slice(0, 200000); // سقف آمن للسياق
  const base = "أنت «مساعد القراءة» في تطبيق مِداد. أجب بالعربية الفصحى بأسلوب واضح ومنظّم، واستخدم عناوين ونقاطاً عند المناسبة. لا تُطل دون فائدة.";
  switch (action) {
    case "summarize":
      return `${base}\n\nلخّص الكتاب «${p.title}» تلخيصاً وافياً: فكرته العامة، ثم أبرز أفكاره ومحاوره في نقاط، ثم خلاصة قصيرة.\n\n=== نص الكتاب ===\n${book}`;
    case "keypoints":
      return `${base}\n\nاستخرج أهم النقاط والأفكار من الكتاب «${p.title}» في قائمة موجزة (٧ إلى ١٢ نقطة).\n\n=== نص الكتاب ===\n${book}`;
    case "explain":
      return `${base}\n\nاشرح المقطع التالي وبسّط معناه للقارئ${p.title ? ` من كتاب «${p.title}»` : ""}، مع توضيح أي مصطلح غامض:\n\n«${p.text.slice(0, 8000)}»`;
    case "ask":
      return `${base}\n\nأجب عن سؤال القارئ اعتماداً على نص الكتاب «${p.title}» أدناه. إن لم تكن الإجابة في النص فاذكر ذلك بصراحة ثم أجب بما تعرفه إن أمكن.\n\nالسؤال: ${p.question}\n\n=== نص الكتاب ===\n${book}`;
    default:
      return `${base}\n\n${p.text}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const KEY = Deno.env.get("GEMINI_API_KEY");
    if (!KEY) return json({ error: "مفتاح Gemini غير مضبوط في الخادم (GEMINI_API_KEY)" }, 500);
    const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";

    const b = await req.json().catch(() => ({}));
    const action = String(b.action || "ask");

    // ── OCR: استخراج نص صفحة مصوّرة عبر رؤية Gemini ──
    let parts: unknown[];
    let genCfg: Record<string, unknown> = { temperature: 0.4, maxOutputTokens: 2048 };
    if (action === "ocr") {
      const image = String(b.image || "");
      const mimeType = String(b.mimeType || "image/jpeg");
      if (!image) return json({ error: "لا توجد صورة للاستخراج" }, 400);
      const ocrPrompt =
        "استخرج كامل النص المكتوب في هذه الصورة (صفحة من كتاب) حرفياً وبالترتيب الصحيح من اليمين إلى اليسار. " +
        "أعِد النص فقط دون أي تعليق أو عناوين أو شرح أو أوصاف. حافظ على فواصل الفقرات. " +
        "إن لم تحتوِ الصورة على نص مقروء فأعد سطراً فارغاً فقط.";
      parts = [{ text: ocrPrompt }, { inlineData: { mimeType, data: image } }];
      genCfg = { temperature: 0.1, maxOutputTokens: 4096 };
    } else {
      const payload = { text: String(b.text || ""), question: String(b.question || ""), title: String(b.title || "") };
      parts = [{ text: buildPrompt(action, payload) }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
    const gRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: genCfg,
      }),
    });
    const data = await gRes.json();
    if (!gRes.ok) return json({ error: data?.error?.message || "خطأ من Gemini" }, 500);
    const out = (data?.candidates?.[0]?.content?.parts || []).map((x: any) => x.text || "").join("").trim();
    return json({ text: out || "لم يصل رد." });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
