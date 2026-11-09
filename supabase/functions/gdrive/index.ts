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
let appOrigin = ""; // عنوان التطبيق (لرابط لوحة التحكم في رسالة الإشعار)

/* ── لوحة التحكم: حسابات Google تمرّ بالموافقة كحسابات البريد ──
   الجدول midad_profiles (ملف admin_setup.sql). إن لم يُنشأ بعد تعمل الدالة كما كانت. */
const SB = Deno.env.get("SUPABASE_URL") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { apikey: SRK, Authorization: `Bearer ${SRK}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`REST ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const t = await r.text(); return t ? JSON.parse(t) : null;
}
const emailOfIdToken = (t: string) => {
  try { const p = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)))); return String(p.email || "").toLowerCase(); }
  catch { return ""; }
};
async function emailOfAccess(access: string) {
  try { const r = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${access}` } }); return r.ok ? String((await r.json()).email || "").toLowerCase() : ""; }
  catch { return ""; }
}
// حالة حساب Google: جديدٌ عند الدخول ⇒ بانتظار الموافقة (إن طُلبت)؛ وعند التحديث ⇒ مقبول
// (من يملك رمز تحديث سبق له الدخول قبل تفعيل الموافقة — لا نقطع عنه الخدمة)
async function gate(email: string, isNewSignIn: boolean): Promise<{ ok: boolean; status?: string }> {
  if (!SB || !SRK || !email) return { ok: true };
  try {
    const rows = await rest(`midad_profiles?email=eq.${encodeURIComponent(email)}&select=status`);
    let status = rows && rows[0] ? rows[0].status : "";
    if (!status) {
      let needApproval = true;
      try { const c = await rest("midad_config?key=eq.app&select=value"); needApproval = !(c && c[0] && c[0].value && c[0].value.google_approval === false); } catch { /* افتراضياً: موافقة */ }
      status = isNewSignIn && needApproval ? "pending" : "approved";
      await rest("midad_profiles", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify({ email, provider: "google", status, approved_at: status === "approved" ? new Date().toISOString() : null }) });
      if (status === "pending") {
        fetch(`${SB}/functions/v1/admin`, { method: "POST", headers: { "Content-Type": "application/json", apikey: SRK, Authorization: `Bearer ${SRK}` },
          body: JSON.stringify({ action: "notify_signup", app: appOrigin }) }).catch(() => {});
      }
    } else if (status === "approved") {
      rest(`midad_profiles?email=eq.${encodeURIComponent(email)}`, { method: "PATCH", body: JSON.stringify({ last_seen: new Date().toISOString() }), headers: { Prefer: "return=minimal" } }).catch(() => {});
    }
    return { ok: status === "approved", status };
  } catch (e) {
    // الجداول غير مُنشأة بعد ⇒ لا بوابة (السلوك السابق)
    if (/42P01|does not exist|schema cache/i.test(String((e as Error).message))) return { ok: true };
    throw e;
  }
}
const GATE_MSG: Record<string, string> = {
  pending: "تم استلام طلبك ✓ — حسابك بانتظار موافقة المسؤول. ستتمكّن من المزامنة بحساب Google فور الموافقة (سجّل الدخول حينها مرة أخرى).",
  blocked: "تم إيقاف هذا الحساب من قِبل المسؤول.",
};

async function tokenCall(params: Record<string, string>, isNewSignIn = false) {
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
  // بوابة الموافقة: لا رموز قبل قبول الحساب
  const email = emailOfIdToken(d.id_token || "") || await emailOfAccess(d.access_token || "");
  const g = await gate(email, isNewSignIn);
  if (!g.ok) {
    if (isNewSignIn && d.refresh_token) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(d.refresh_token)}`, { method: "POST" }).catch(() => {});
    return json({ error: GATE_MSG[g.status || ""] || "الحساب غير مقبول بعد", code: g.status === "blocked" ? "blocked" : "pending" }, 403);
  }
  // نُعيد ما يحتاجه المتصفح فقط
  return json({
    access_token: d.access_token, expires_in: d.expires_in, scope: d.scope,
    refresh_token: d.refresh_token, id_token: d.id_token,
  });
}
// إعداد الموقع: هل الدخول بحساب Google مفعّل من لوحة التحكم؟
async function googleEnabled() {
  if (!SB || !SRK) return true;
  try { const c = await rest("midad_config?key=eq.app&select=value"); return !(c && c[0] && c[0].value && c[0].value.google_signin === false); }
  catch { return true; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  appOrigin = (() => { const o = req.headers.get("origin") || ""; const ref = req.headers.get("referer") || ""; try { return ref ? new URL(".", ref).href : o; } catch { return o; } })();
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") || "";
  const secret = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
  try {
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || "");
    if (action === "version") return json({ fn: "gdrive", fnVersion: "2026.11.8" });
    // هل الدخول بحساب Google مُعدّ؟ (يُظهر التطبيق الزرّ عندها فقط)
    if (action === "config") return json({ clientId: clientId && secret && (await googleEnabled()) ? clientId : "" });
    if (!clientId || !secret) return json({ error: "الدخول بحساب Google غير مُعدّ في هذا الخادم بعد", code: "not_configured" }, 503);

    if (action === "exchange") {
      const code = String(b.code || "");
      if (!code) return json({ error: "رمز التفويض مفقود" }, 400);
      // نافذة Google المنبثقة (ux_mode: popup) تستعمل redirect_uri الخاص «postmessage»
      if (!(await googleEnabled())) return json({ error: "الدخول بحساب Google موقوف حالياً", code: "disabled" }, 403);
      return tokenCall({ code, client_id: clientId, client_secret: secret, redirect_uri: "postmessage", grant_type: "authorization_code" }, true);
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
    return json({ error: "إجراء غير معروف", code: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
