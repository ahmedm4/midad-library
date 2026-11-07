// مِداد — دالة لوحة التحكم (للمسؤولين فقط)
// تعمل بمفتاح الخدمة (SUPABASE_SERVICE_ROLE_KEY — يوفّره Supabase تلقائياً) بعد التحقّق من أن المتصل مسؤول:
// دوره «admin» في جدول midad_profiles، أو بريده ضمن السرّ الاختياري ADMIN_EMAILS.
// كل تعديل يُسجَّل في midad_audit.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SB = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const svc = { apikey: SRK, Authorization: `Bearer ${SRK}` };

const FEATURES = ["sync", "ai_server", "discover"] as const;
const STATUSES = ["pending", "approved", "blocked"];

async function rest(path: string, init: RequestInit & { prefer?: string } = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    ...init,
    headers: { ...svc, "Content-Type": "application/json", Prefer: init.prefer || "return=representation", ...(init.headers || {}) },
  });
  const text = await r.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error((data && (data.message || data.error)) || `REST ${r.status}`);
  return data;
}
async function authAdmin(path: string, init: RequestInit = {}) {
  const r = await fetch(`${SB}/auth/v1/admin/${path}`, { ...init, headers: { ...svc, "Content-Type": "application/json", ...(init.headers || {}) } });
  const text = await r.text();
  let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error((data && (data.msg || data.message || data.error)) || `auth ${r.status}`);
  return data;
}

// المتصل: مستخدم حقيقي (رمز جلسة لا المفتاح العام)، ومسؤول
async function caller(req: Request): Promise<{ id: string; email: string } | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token === ANON) return null;
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: ANON } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { id: String(u.id), email: String(u.email || "").toLowerCase() } : null;
}
const envAdmins = () => (Deno.env.get("ADMIN_EMAILS") || "").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
async function isAdmin(who: { id: string; email: string }) {
  if (envAdmins().includes(who.email)) return true;
  const rows = await rest(`midad_profiles?email=eq.${encodeURIComponent(who.email)}&select=role,status`);
  return !!(rows && rows[0] && rows[0].role === "admin" && rows[0].status === "approved");
}
async function audit(actor: string, action: string, target: string, detail: unknown) {
  try { await rest("midad_audit", { method: "POST", body: JSON.stringify({ actor, action, target, detail }), prefer: "return=minimal" }); } catch { /* السجلّ لا يُفشل العملية */ }
}
async function getConfig() {
  const rows = await rest("midad_config?key=eq.app&select=value");
  return (rows && rows[0] && rows[0].value) || {};
}

// كل مستخدمي البريد من Supabase Auth (للتواريخ وتأكيد البريد وآخر دخول)
async function allAuthUsers() {
  const out: any[] = [];
  for (let page = 1; page <= 50; page++) {
    const d = await authAdmin(`users?page=${page}&per_page=500`);
    const list = (d && d.users) || [];
    out.push(...list);
    if (list.length < 500) break;
  }
  return out;
}

// حذف بيانات مستخدم بريد من السحابة: ملفاته في المخزن، وكتبه، وسجلّ قراءته
async function deleteUserData(uid: string) {
  const bucket = "midad-files";
  const listDir = async (prefix: string) => {
    const r = await fetch(`${SB}/storage/v1/object/list/${bucket}`, {
      method: "POST", headers: { ...svc, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
    });
    return r.ok ? await r.json() : [];
  };
  const paths: string[] = [];
  for (const f of await listDir(`${uid}/`)) {
    if (f.id) paths.push(`${uid}/${f.name}`);
    else if (f.name === "assets") {
      for (const book of await listDir(`${uid}/assets/`)) for (const a of await listDir(`${uid}/assets/${book.name}/`)) paths.push(`${uid}/assets/${book.name}/${a.name}`);
    }
  }
  for (let i = 0; i < paths.length; i += 500) {
    await fetch(`${SB}/storage/v1/object/${bucket}`, { method: "DELETE", headers: { ...svc, "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: paths.slice(i, i + 500) }) });
  }
  await rest(`midad_books?owner=eq.${uid}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
  await rest(`midad_stats?owner=eq.${uid}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
  return paths.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!SB || !SRK) return json({ error: "مفتاح الخدمة غير متاح للدالة" }, 500);
  try {
    const who = await caller(req);
    if (!who) return json({ error: "سجّل الدخول أولاً", code: "auth" }, 401);
    if (!(await isAdmin(who))) return json({ error: "هذه الصفحة للمسؤولين فقط", code: "forbidden" }, 403);
    const b = await req.json().catch(() => ({}));
    const action = String(b.action || "");

    if (action === "me") return json({ email: who.email, admin: true });

    if (action === "pending_count") {
      const rows = await rest("midad_profiles?status=eq.pending&select=email");
      return json({ count: (rows || []).length });
    }

    // كل المستخدمين: الملفّات + بيانات Auth + الاستعمال (كتب ومساحة)
    if (action === "users" || action === "overview") {
      const [profiles, authUsers, usage, config] = await Promise.all([
        rest("midad_profiles?select=*&order=created_at.desc"),
        allAuthUsers().catch(() => []),
        rest("rpc/midad_admin_usage", { method: "POST", body: "{}" }).catch(() => []),
        getConfig(),
      ]);
      const byId = new Map((authUsers as any[]).map((u) => [u.id, u]));
      const use = new Map((usage as any[]).map((u) => [u.owner, u]));
      const users = (profiles as any[]).map((p) => {
        const a = p.id ? byId.get(p.id) : null;
        const u = p.id ? use.get(p.id) : null;
        return {
          ...p,
          confirmed: a ? !!(a.email_confirmed_at || a.confirmed_at) : null,
          last_sign_in: a ? a.last_sign_in_at : null,
          books: u ? +u.books : 0,
          bytes: u ? +u.bytes : 0,
        };
      });
      // حسابات بريد بلا ملفّ (أُنشئت قبل التثبيت ولم تُرحَّل لسبب ما) — تُعرض كي لا تختفي
      for (const a of authUsers as any[]) {
        if (a.email && !users.some((u) => u.id === a.id)) {
          users.push({ email: String(a.email).toLowerCase(), id: a.id, provider: "email", status: "approved", role: "user", features: {}, created_at: a.created_at, missingProfile: true, books: 0, bytes: 0 });
        }
      }
      if (action === "users") return json({ users, config });
      const count = (f: (u: any) => boolean) => users.filter(f).length;
      const since = Date.now() - 30 * 864e5;
      const days: Record<string, number> = {};
      for (let i = 0; i < 30; i++) days[new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)] = 0;
      for (const u of users) { const d = String(u.created_at || "").slice(0, 10); if (d in days) days[d]++; }
      return json({
        totals: {
          users: users.length, pending: count((u) => u.status === "pending"), approved: count((u) => u.status === "approved"),
          blocked: count((u) => u.status === "blocked"), google: count((u) => u.provider === "google"), email: count((u) => u.provider === "email"),
          admins: count((u) => u.role === "admin"), books: users.reduce((n, u) => n + (u.books || 0), 0), bytes: users.reduce((n, u) => n + (u.bytes || 0), 0),
          active30: count((u) => (u.last_seen && Date.parse(u.last_seen) > since) || (u.last_sign_in && Date.parse(u.last_sign_in) > since)),
        },
        signups: Object.entries(days).sort(([a], [b]) => a.localeCompare(b)).map(([day, n]) => ({ day, n })),
        recent: users.slice(0, 8), pending: users.filter((u) => u.status === "pending").slice(0, 20), config,
      });
    }

    if (action === "user_update" || action === "users_bulk") {
      const emails: string[] = (action === "users_bulk" ? b.emails : [b.email]).map((e: unknown) => String(e || "").toLowerCase()).filter(Boolean);
      if (!emails.length) return json({ error: "لا مستخدمين" }, 400);
      const patch: Record<string, unknown> = {};
      if (b.status !== undefined) {
        if (!STATUSES.includes(b.status)) return json({ error: "حالة غير صالحة" }, 400);
        patch.status = b.status;
        if (b.status === "approved") patch.approved_at = new Date().toISOString();
      }
      if (b.role !== undefined) {
        if (!["user", "admin"].includes(b.role)) return json({ error: "دور غير صالح" }, 400);
        patch.role = b.role;
      }
      if (b.features !== undefined) {
        const f: Record<string, boolean> = {};
        for (const k of FEATURES) if (typeof b.features[k] === "boolean") f[k] = b.features[k];
        patch.features = f;
      }
      if (b.note !== undefined) patch.note = String(b.note || "").slice(0, 500);
      if (!Object.keys(patch).length) return json({ error: "لا تعديل" }, 400);
      // لا يُنزع المسؤول عن نفسه ولا يحظر نفسه (كي لا يُغلق الباب على اللوحة)
      if (emails.includes(who.email) && (patch.role === "user" || patch.status === "blocked" || patch.status === "pending")) {
        return json({ error: "لا يمكنك إزالة صلاحياتك أو حظر حسابك بنفسك" }, 400);
      }
      // ملفّات مفقودة (حسابات بريد قديمة) ⇒ نُنشئها أولاً
      for (const e of emails) {
        const ex = await rest(`midad_profiles?email=eq.${encodeURIComponent(e)}&select=email`);
        if (!ex.length && b.id) await rest("midad_profiles", { method: "POST", body: JSON.stringify({ email: e, id: b.id, provider: "email", status: "approved" }) });
      }
      const filter = `email=in.(${emails.map((e) => `"${e.replace(/"/g, "")}"`).join(",")})`;
      const rows = await rest(`midad_profiles?${filter}`, { method: "PATCH", body: JSON.stringify(patch) });
      await audit(who.email, action === "users_bulk" ? "users_bulk" : "user_update", emails.join(", "), patch);
      return json({ ok: true, updated: (rows || []).length });
    }

    if (action === "user_delete") {
      const email = String(b.email || "").toLowerCase();
      if (!email) return json({ error: "لا مستخدم" }, 400);
      if (email === who.email) return json({ error: "لا يمكنك حذف حسابك من هنا" }, 400);
      const rows = await rest(`midad_profiles?email=eq.${encodeURIComponent(email)}&select=*`);
      const p = rows[0] || { email, id: b.id || null, provider: "email" };
      let files = 0;
      if (p.id) {
        files = await deleteUserData(p.id);
        try { await authAdmin(`users/${p.id}`, { method: "DELETE" }); } catch (e) { if (!/not.?found/i.test(String((e as Error).message))) throw e; }
      }
      await rest(`midad_profiles?email=eq.${encodeURIComponent(email)}`, { method: "DELETE", prefer: "return=minimal" });
      await audit(who.email, "user_delete", email, { provider: p.provider, files });
      return json({ ok: true, files });
    }

    if (action === "config_get") return json({ config: await getConfig() });

    if (action === "config_set") {
      const cur = await getConfig();
      const v = b.config || {};
      const next: Record<string, unknown> = { ...cur };
      if (["open", "approval", "closed"].includes(v.registration)) next.registration = v.registration;
      for (const k of ["google_signin", "google_approval", "discover_anonymous"]) if (typeof v[k] === "boolean") next[k] = v[k];
      if (v.sources && typeof v.sources === "object") {
        const s: Record<string, boolean> = { ...(cur.sources || {}) };
        for (const k of ["archive", "wikisource", "ablibrary", "narjes", "alfeker"]) if (typeof v.sources[k] === "boolean") s[k] = v.sources[k];
        next.sources = s;
      }
      if (v.defaults && typeof v.defaults === "object") {
        const d: Record<string, boolean> = { ...(cur.defaults || {}) };
        for (const k of FEATURES) if (typeof v.defaults[k] === "boolean") d[k] = v.defaults[k];
        next.defaults = d;
      }
      if (v.announcement && typeof v.announcement === "object") {
        next.announcement = {
          active: !!v.announcement.active,
          text: String(v.announcement.text || "").slice(0, 600),
          kind: ["info", "warn", "success"].includes(v.announcement.kind) ? v.announcement.kind : "info",
          at: Date.now(),
        };
      }
      await rest("midad_config?on_conflict=key", {
        method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ key: "app", value: next, updated_at: new Date().toISOString() }),
      });
      await audit(who.email, "config_set", "app", v);
      return json({ ok: true, config: next });
    }

    if (action === "audit") {
      const rows = await rest(`midad_audit?select=*&order=at.desc&limit=${Math.min(500, Math.max(10, +b.limit || 200))}`);
      return json({ entries: rows || [] });
    }

    return json({ error: "إجراء غير معروف" }, 400);
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/midad_profiles|relation .* does not exist|schema cache/i.test(msg)) return json({ error: "الجداول غير مُعدّة بعد — نفّذ ملف admin_setup.sql في SQL Editor", code: "setup" }, 500);
    return json({ error: msg }, 500);
  }
});
