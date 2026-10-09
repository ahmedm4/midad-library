// مِداد — بوّابة تسجيل الدخول بحساب Google (لمزامنة المكتبة في Google Drive الخاص بالمستخدم)
// المتصفح يحصل على «رمز تفويض» من نافذة Google، وهذه الدالة تبادله برمز وصول ورمز تحديث
// لأن التبادل يحتاج «سرّ العميل» الذي لا يجوز وضعه في التطبيق. لا تخزّن الدالة شيئاً ولا ترى الكتب:
// الملفات تنتقل مباشرة بين المتصفح وGoogle Drive.
// الأسرار المطلوبة: GOOGLE_CLIENT_ID و GOOGLE_CLIENT_SECRET (عميل OAuth من نوع Web application).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const TOKEN_URL = "https://oauth2.googleapis.com/token";

async function tokenCall(params: Record<string, string>) {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = String(d.error || "token_error");
    const msg = code === "invalid_grant" ? "انتهى إذن Google أو أُلغي — سجّل الدخول من جديد" : `Google: ${d.error_description || code}`;
    return json({ error: msg, code }, r.status === 400 || r.status === 401 ? 400 : 502);
  }
  // نُعيد ما يحتاجه المتصفح فقط
  return json({
    access_token: d.access_token, expires_in: d.expires_in, scope: d.scope,
    refresh_token: d.refresh_token, id_token: d.id_token,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") || "";
  const secret = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || "");
    // هل الدخول بحساب Google مُعدّ؟ (يُظهر التطبيق الزرّ عندها فقط)
    if (action === "config") return json({ clientId: clientId && secret ? clientId : "" });
    if (!clientId || !secret) return json({ error: "الدخول بحساب Google غير مُعدّ في هذا الخادم بعد", code: "not_configured" }, 503);

    if (action === "exchange") {
      const code = String(b.code || "");
      if (!code) return json({ error: "رمز التفويض مفقود" }, 400);
      // نافذة Google المنبثقة (ux_mode: popup) تستعمل redirect_uri الخاص «postmessage»
      return tokenCall({ code, client_id: clientId, client_secret: secret, redirect_uri: "postmessage", grant_type: "authorization_code" });
    }
    if (action === "refresh") {
      const rt = String(b.refresh_token || "");
      if (!rt) return json({ error: "رمز التحديث مفقود" }, 400);
      return tokenCall({ refresh_token: rt, client_id: clientId, client_secret: secret, grant_type: "refresh_token" });
    }
    if (action === "revoke") {
      const t = String(b.token || "");
      if (t) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => {});
      return json({ ok: true });
    }
    return json({ error: "إجراء غير معروف" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
