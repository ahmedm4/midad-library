// ═══════ مِداد — دالة الذكاء الاصطناعي (Supabase Edge Function) ═══════
// تحفظ مفاتيح Gemini كسرّ في الخادم فلا تظهر في المتصفح.
// الأسرار: GEMINI_API_KEY  أو  GEMINI_API_KEYS (عدة مفاتيح مفصولة بفاصلة لمضاعفة الحصّة)
//          واختياري GEMINI_MODEL
//
// تدوير المفاتيح: عند نفاد حصّة مفتاح (429/تجاوز حصّة) تنتقل الدالة للمفتاح التالي تلقائياً.

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

// يجمع المفاتيح من GEMINI_API_KEYS (مفصولة بفاصلة أو سطر) ومن GEMINI_API_KEY، دون تكرار
function collectKeys(): string[] {
  const raw = `${Deno.env.get("GEMINI_API_KEYS") || ""},${Deno.env.get("GEMINI_API_KEY") || ""}`;
  const keys = raw.split(/[,\n\s]+/).map((s) => s.trim()).filter(Boolean);
  return [...new Set(keys)];
}

const isQuota = (status: number, msg: string) =>
  status === 429 || /quota|exceeded|RESOURCE_EXHAUSTED|rate.?limit|too many/i.test(msg || "");

// ينادي Gemini مع تدوير المفاتيح: يبدأ من مفتاح عشوائي، وعند تجاوز الحصّة ينتقل للتالي
async function callGemini(model: string, keys: string[], parts: unknown[], genCfg: Record<string, unknown>) {
  let lastErr = "خطأ من Gemini", lastStatus = 500;
  const start = Math.floor(Math.random() * keys.length);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[(start + i) % keys.length];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    let res: Response, data: any;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: genCfg }),
      });
      data = await res.json();
    } catch (e) { lastErr = String((e as Error)?.message || e); lastStatus = 502; continue; }
    if (res.ok) {
      const out = (data?.candidates?.[0]?.content?.parts || []).map((x: any) => x.text || "").join("").trim();
      return { ok: true, text: out, status: 200 };
    }
    lastErr = data?.error?.message || "خطأ من Gemini";
    lastStatus = res.status;
    // تجاوز حصّة → جرّب المفتاح التالي؛ خطأ آخر → أعده فوراً
    if (!isQuota(res.status, lastErr)) return { ok: false, error: lastErr, status: res.status };
  }
  return { ok: false, error: lastErr, status: lastStatus };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const KEYS = collectKeys();
    if (!KEYS.length) return json({ error: "مفتاح Gemini غير مضبوط في الخادم (GEMINI_API_KEY أو GEMINI_API_KEYS)" }, 500);
    const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";

    const b = await req.json().catch(() => ({}));
    const action = String(b.action || "ask");

    // ── تشخيص: عدد المفاتيح وبصماتها (آخر ٤ أحرف فقط) للتأكد من التحميل والتمايز ──
    if (action === "diag") {
      const fps = KEYS.map((k) => "…" + k.slice(-4));
      const distinct = new Set(fps).size;
      return json({ text: `عدد المفاتيح المُحمّلة: ${KEYS.length}\nالمتمايزة: ${distinct}\nالبصمات: ${fps.join("، ")}\nالنموذج: ${MODEL}` });
    }

    // ── OCR: استخراج نص صفحة مصوّرة عبر رؤية Gemini ──
    let parts: unknown[];
    let genCfg: Record<string, unknown> = { temperature: 0.4, maxOutputTokens: 2048 };
    if (action === "ocr") {
      const image = String(b.image || "");
      const mimeType = String(b.mimeType || "image/jpeg");
      if (!image) return json({ error: "لا توجد صورة للاستخراج" }, 400);
      const ocrPrompt =
        "أنت محرّرٌ يستخرج نص صفحة كتاب من صورتها ويعيده منسّقاً نظيفاً بصيغة ماركداون بسيطة بالعربية، وفق القواعد:\n" +
        "• انقل النص حرفياً دون ترجمة أو تلخيص أو إضافة من عندك.\n" +
        "• تجاهل ترويسة الصفحة المتكرّرة (اسم الكتاب أو الفصل أعلى الصفحة) والحواشي الجانبية.\n" +
        "• احتفظ برقم الصفحة إن وُجد، واجعله في سطر مستقلّ بمفرده.\n" +
        "• ادمج الأسطر المقطوعة في فقرات متّصلة، وافصل بين الفقرات بسطر فارغ واحد (لا تقطع الفقرة عند نهاية السطر).\n" +
        "• عناوين الفصول أو الأقسام: ابدأ سطرها بـ «# »، والعناوين الفرعية بـ «## ».\n" +
        "• إن فصل خطٌّ أفقي أسفل الصفحة بين المتن والحواشي/المراجع، فضع سطراً فيه «---» مكانه، واجعل كل حاشية مرقّمة (مثل «(١) …») في سطرٍ مستقل.\n" +
        "• الاقتباسات المميّزة: ابدأ سطرها بـ «> ». أبيات الشعر: بصيغة «/ الشطر الأول | الشطر الثاني».\n" +
        "• أعد النص المنسّق فقط دون أي شرح. وإن كانت الصفحة بلا نص مقروء فأعد سطراً فارغاً.";
      parts = [{ text: ocrPrompt }, { inlineData: { mimeType, data: image } }];
      genCfg = { temperature: 0.1, maxOutputTokens: 4096 };
    } else {
      const payload = { text: String(b.text || ""), question: String(b.question || ""), title: String(b.title || "") };
      parts = [{ text: buildPrompt(action, payload) }];
    }

    const r = await callGemini(MODEL, KEYS, parts, genCfg);
    // نعيد حالة 429 عند تجاوز الحصّة كي يتعرّف عليها العميل وينتظر ويعيد المحاولة
    if (!r.ok) return json({ error: r.error }, isQuota(r.status, r.error || "") ? 429 : (r.status || 500));
    return json({ text: r.text || "لم يصل رد." });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
