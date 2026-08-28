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
// خطأ خاصّ بالمفتاح (غير صالح/منتهٍ/بلا صلاحية) → جرّب مفتاحاً آخر بدل الفشل
const isKeyError = (status: number, msg: string) =>
  status === 401 || status === 403 ||
  (status === 400 && /api[\s_-]?key|key not valid|API_KEY_INVALID|invalid|expired|permission|denied/i.test(msg || ""));

// ── مزوّد متوافق مع OpenAI (يدعم الرؤية عبر image_url) — يغطّي OpenAI و OpenRouter و Qwen…‏ ──
async function callOpenAI(baseUrl: string, key: string, model: string, messages: unknown[], genCfg: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, ...extraHeaders },
      body: JSON.stringify({ model, messages, temperature: genCfg.temperature ?? 0.4, max_tokens: genCfg.maxOutputTokens ?? 2048 }),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data?.error?.message || "خطأ من المزوّد", status: res.status };
    const out = String(data?.choices?.[0]?.message?.content || "").trim();
    return { ok: true, text: out, status: 200 };
  } catch (e) { return { ok: false, error: String((e as Error)?.message || e), status: 502 }; }
}

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
    // تجاوز حصّة أو مفتاح معطوب → جرّب المفتاح التالي؛ خطأ آخر → أعده فوراً
    if (!isQuota(res.status, lastErr) && !isKeyError(res.status, lastErr)) return { ok: false, error: lastErr, status: res.status };
  }
  return { ok: false, error: lastErr, status: lastStatus };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || "ask");
    const provider = String(b.provider || "gemini").toLowerCase();

    const KEYS = collectKeys();
    const MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-3.6-flash";
    const OAI_KEY = Deno.env.get("OPENAI_API_KEY") || "";
    const OAI_BASE = Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1";
    const OAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini";
    const OR_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";
    const OR_MODEL = Deno.env.get("OPENROUTER_MODEL") || "qwen/qwen2.5-vl-72b-instruct:free";

    // ── تشخيص: المزوّدات والمفاتيح المتاحة ──
    if (action === "diag") {
      const fps = KEYS.map((k) => "…" + k.slice(-4));
      return json({ text:
        `Gemini — مفاتيح: ${KEYS.length} (متمايزة: ${new Set(fps).size})${fps.length ? " — " + fps.join("، ") : ""}\n` +
        `النموذج: ${MODEL}\n` +
        `OpenAI — ${OAI_KEY ? "مضبوط ✓ (…" + OAI_KEY.slice(-4) + ") نموذج: " + OAI_MODEL : "غير مضبوط"}\n` +
        `OpenRouter — ${OR_KEY ? "مضبوط ✓ (…" + OR_KEY.slice(-4) + ") نموذج: " + OR_MODEL : "غير مضبوط"}` });
    }

    // ── جهّز الموجّه/الصورة حسب الإجراء ──
    let genCfg: Record<string, unknown> = { temperature: 0.4, maxOutputTokens: 2048 };
    let ocrPrompt = "", image = "", mimeType = "image/jpeg", promptText = "";
    if (action === "ocr") {
      image = String(b.image || "");
      mimeType = String(b.mimeType || "image/jpeg");
      if (!image) return json({ error: "لا توجد صورة للاستخراج" }, 400);
      ocrPrompt =
        "أنت محرّرٌ يستخرج نص صفحة كتاب من صورتها ويعيده منسّقاً نظيفاً بصيغة ماركداون بسيطة بالعربية، وفق القواعد:\n" +
        "• انقل النص حرفياً دون ترجمة أو تلخيص أو إضافة من عندك.\n" +
        "• تجاهل ترويسة الصفحة المتكرّرة (اسم الكتاب أو الفصل أعلى الصفحة) والحواشي الجانبية.\n" +
        "• احتفظ برقم الصفحة إن وُجد، واجعله في سطر مستقلّ بمفرده.\n" +
        "• ادمج الأسطر المقطوعة في فقرات متّصلة، وافصل بين الفقرات بسطر فارغ واحد (لا تقطع الفقرة عند نهاية السطر).\n" +
        "• عناوين الفصول أو الأقسام: ابدأ سطرها بـ «# »، والعناوين الفرعية بـ «## ».\n" +
        "• إن فصل خطٌّ أفقي أسفل الصفحة بين المتن والحواشي/المراجع، فضع سطراً فيه «---» مكانه، واجعل كل حاشية مرقّمة (مثل «(١) …») في سطرٍ مستقل.\n" +
        "• الاقتباسات المميّزة: ابدأ سطرها بـ «> ». أبيات الشعر: بصيغة «/ الشطر الأول | الشطر الثاني».\n" +
        "• أعد النص المنسّق فقط دون أي شرح. وإن كانت الصفحة بلا نص مقروء فأعد سطراً فارغاً.";
      genCfg = { temperature: 0.1, maxOutputTokens: 4096 };
    } else {
      const payload = { text: String(b.text || ""), question: String(b.question || ""), title: String(b.title || "") };
      promptText = buildPrompt(action, payload);
    }

    // ── مزوّدات متوافقة مع OpenAI: OpenAI و OpenRouter ──
    if (provider === "openai" || provider === "oai" || provider === "openrouter") {
      const messages = action === "ocr"
        ? [{ role: "user", content: [{ type: "text", text: ocrPrompt }, { type: "image_url", image_url: { url: `data:${mimeType};base64,${image}` } }] }]
        : [{ role: "user", content: promptText }];
      let base = OAI_BASE, key = OAI_KEY, model = OAI_MODEL, headers: Record<string, string> = {};
      if (provider === "openrouter") {
        if (!OR_KEY) return json({ error: "مزوّد OpenRouter غير مضبوط في الخادم (OPENROUTER_API_KEY)" }, 400);
        base = "https://openrouter.ai/api/v1"; key = OR_KEY; model = OR_MODEL;
        headers = { "HTTP-Referer": "https://midad.app", "X-Title": "Midad" };
      } else if (!OAI_KEY) return json({ error: "مزوّد OpenAI غير مضبوط في الخادم (OPENAI_API_KEY)" }, 400);
      const r = await callOpenAI(base, key, model, messages, genCfg, headers);
      if (!r.ok) return json({ error: r.error }, isQuota(r.status, r.error || "") ? 429 : (r.status || 500));
      return json({ text: r.text || "لم يصل رد." });
    }

    // ── مزوّد Gemini (الافتراضي) ──
    if (!KEYS.length) return json({ error: "مفتاح Gemini غير مضبوط في الخادم (GEMINI_API_KEY أو GEMINI_API_KEYS)" }, 500);
    const parts = action === "ocr" ? [{ text: ocrPrompt }, { inlineData: { mimeType, data: image } }] : [{ text: promptText }];
    const r = await callGemini(MODEL, KEYS, parts, genCfg);
    if (!r.ok) return json({ error: r.error }, isQuota(r.status, r.error || "") ? 429 : (r.status || 500));
    return json({ text: r.text || "لم يصل رد." });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
