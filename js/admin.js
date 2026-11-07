/* ═══════ مِداد — لوحة التحكم ═══════
   صفحة مستقلّة للمسؤولين. تستعمل جلسة التطبيق نفسها (المتصفح نفسه ⇒ لا دخول ثانٍ)،
   وكل البيانات والتعديلات عبر دالة الخادم «admin» التي تتحقّق من أن المتصل مسؤول. */
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const cfg = window.MIDAD_CONFIG || {};
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (n) => Number(n || 0).toLocaleString('ar');
const fmtBytes = (n) => { n = +n || 0; if (n < 1048576) return n ? Math.max(1, Math.round(n / 1024)) + ' ك.ب' : '—'; if (n < 1073741824) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' م.ب'; return (n / 1073741824).toFixed(2) + ' غ.ب'; };
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('ar', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const ago = (d) => {
  if (!d) return '—';
  const s = (Date.now() - Date.parse(d)) / 1000;
  if (s < 3600) return 'قبل ' + Math.max(1, Math.round(s / 60)) + ' د';
  if (s < 86400) return 'قبل ' + Math.round(s / 3600) + ' س';
  if (s < 86400 * 30) return 'قبل ' + Math.round(s / 86400) + ' يوم';
  return fmtDate(d);
};
const FEATURES = {
  sync: { label: 'المزامنة السحابية', desc: 'حفظ الكتب والتقدّم والتظليلات في السحابة ومزامنتها بين الأجهزة (تستهلك مساحة مشروعك).' },
  ai_server: { label: 'المساعد الذكي بمفاتيح الخادم', desc: 'استعمال مفاتيح Gemini الخاصة بك للتلخيص واستخراج النص والصوت. بدونها يضيف المستخدم مفتاحه الخاص.' },
  discover: { label: '«استكشف» عبر الخادم', desc: 'جلب الكتب من شبكة الفكر ومكتبة نرجس عبر دالة الخادم.' },
};
const STATUS_AR = { approved: 'مقبول', pending: 'بانتظار الموافقة', blocked: 'محظور' };
const SOURCES_AR = { archive: '🌐 أرشيف الإنترنت', wikisource: '📜 ويكي مصدر', ablibrary: '📚 مكتبة أهل البيت', narjes: '📕 مكتبة نرجس', alfeker: '📗 شبكة الفكر' };

let sb = null, session = null;
let state = { view: 'overview', users: null, config: null, overview: null, audit: null };
let usersFilter = 'all', usersQuery = '', usersSort = { k: 'created_at', dir: -1 };

function toast(msg, kind = '') {
  const t = document.createElement('div'); t.className = 'ad-toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 3800);
}
async function api(action, body = {}) {
  const { data } = await sb.auth.getSession();
  const token = data && data.session ? data.session.access_token : '';
  const r = await fetch(`${cfg.url}/functions/v1/admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey, Authorization: `Bearer ${token || cfg.anonKey}` },
    body: JSON.stringify({ action, ...body }),
  });
  let d = null; try { d = await r.json(); } catch {}
  if (r.status === 404 && !d) throw Object.assign(new Error('دالة «admin» غير منشورة بعد'), { code: 'nofn' });
  if (!r.ok || !d || d.error) throw Object.assign(new Error((d && d.error) || `خطأ ${r.status}`), { code: d && d.code, status: r.status });
  return d;
}

/* ── الدخول ── */
function showGate(msg, signedIn) {
  $('#app').hidden = true; $('#gate').hidden = false;
  $('#gate-msg').textContent = msg;
  $('#login-form').hidden = !!signedIn; $('#gate-actions').hidden = !signedIn;
}
async function boot() {
  if (!cfg.url || !cfg.anonKey) return showGate('إعداد المشروع غير موجود في هذه النسخة.');
  const createClient = window.__midadSbFactory || (await import(SDK_URL)).createClient; // (الأول للاختبار)
  sb = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session) return showGate('سجّل الدخول بحساب المسؤول.');
  try {
    const me = await api('me');
    $('#me-email').textContent = me.email;
    $('#gate').hidden = true; $('#app').hidden = false;
    go(location.hash.slice(1) || 'overview');
    refreshBadge();
    setInterval(refreshBadge, 60000);
  } catch (e) {
    if (e.code === 'forbidden') return showGate('هذا الحساب ليس مسؤولاً. سجّل الدخول بحساب المسؤول.', true);
    if (e.code === 'setup' || e.code === 'nofn') return showSetup(e.message);
    showGate('تعذّر الوصول: ' + e.message, true);
  }
}
function showSetup(msg) {
  $('#gate').hidden = true; $('#app').hidden = false;
  $('#view').innerHTML = `<div class="setup-box"><b>اللوحة تحتاج إعداداً لمرة واحدة</b><br>${esc(msg)}<br><br>
    ١) نفّذ الملف <code>supabase/admin_setup.sql</code> في Supabase ← SQL Editor.<br>
    ٢) انشر الدالة <code>admin</code> (والدوال <code>gdrive</code> و<code>ai</code> و<code>alfeker</code> المحدّثة).<br>
    ٣) اجعل حسابك مسؤولاً بالسطر الأخير في ملف SQL.</div>`;
}
$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('#login-btn'); btn.disabled = true; btn.textContent = '…';
  try {
    const { error } = await sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-pass').value });
    if (error) throw error;
    await boot();
  } catch (err) { toast(/invalid login/i.test(err.message) ? 'البريد أو كلمة المرور غير صحيحة' : err.message, 'bad'); }
  finally { btn.disabled = false; btn.textContent = 'دخول'; }
};
const signOut = async () => { await sb.auth.signOut(); location.reload(); };
$('#gate-signout').onclick = signOut;
$('#signout').onclick = signOut;

/* ── التنقّل ── */
const TITLES = { overview: 'نظرة عامة', pending: 'طلبات الانتظار', users: 'المستخدمون', features: 'الإمكانيات', settings: 'إعدادات الموقع', announce: 'الإعلان', audit: 'سجلّ الأعمال' };
document.querySelectorAll('#nav button').forEach((b) => (b.onclick = () => go(b.dataset.view)));
$('#refresh').onclick = () => { state.users = state.overview = state.audit = state.config = null; go(state.view); refreshBadge(); };
async function go(view) {
  if (!TITLES[view]) view = 'overview';
  state.view = view;
  history.replaceState(null, '', '#' + view);
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  $('#view-title').textContent = TITLES[view];
  $('#view').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
  try { await VIEWS[view](); }
  catch (e) {
    if (e.code === 'setup' || e.code === 'nofn') return showSetup(e.message);
    $('#view').innerHTML = `<div class="empty">⚠ ${esc(e.message)}</div>`;
  }
  $('#main').focus({ preventScroll: true });
}
async function refreshBadge() {
  try { const d = await api('pending_count'); const b = $('#badge-pending'); b.hidden = !d.count; b.textContent = nf(d.count); } catch {}
}
const loadUsers = async (force) => { if (!state.users || force) { const d = await api('users'); state.users = d.users; state.config = d.config; } return state.users; };
const loadConfig = async (force) => { if (!state.config || force) state.config = (await api('config_get')).config; return state.config; };

/* ── عمليات المستخدمين ── */
async function updateUsers(emails, patch, okMsg) {
  try {
    if (emails.length === 1) await api('user_update', { email: emails[0], ...patch, id: (state.users || []).find((u) => u.email === emails[0])?.id });
    else await api('users_bulk', { emails, ...patch });
    toast(okMsg || '✓ حُفظ', 'ok');
    state.users = null; state.overview = null; refreshBadge();
    return true;
  } catch (e) { toast(e.message, 'bad'); return false; }
}
const pillStatus = (s) => `<span class="pill ${s}">${STATUS_AR[s] || s}</span>`;
const pillProv = (p) => `<span class="pill ${p}">${p === 'google' ? 'Google' : 'بريد'}</span>`;

/* ═══ نظرة عامة ═══ */
async function viewOverview() {
  const d = state.overview || (state.overview = await api('overview'));
  const t = d.totals, max = Math.max(1, ...d.signups.map((x) => x.n));
  const limit = 1073741824, pct = Math.min(100, (t.bytes / limit) * 100);
  $('#view').innerHTML = `
    <div class="kpis">
      <div class="kpi clickable" data-go="users"><span>المستخدمون</span><b>${nf(t.users)}</b><small>${nf(t.email)} بريد · ${nf(t.google)} Google</small></div>
      <div class="kpi warn clickable" data-go="pending"><span>بانتظار الموافقة</span><b>${nf(t.pending)}</b><small>${t.pending ? 'تحتاج قرارك' : 'لا طلبات'}</small></div>
      <div class="kpi ok"><span>المقبولون</span><b>${nf(t.approved)}</b><small>${nf(t.admins)} مسؤول</small></div>
      <div class="kpi bad"><span>المحظورون</span><b>${nf(t.blocked)}</b></div>
      <div class="kpi"><span>نشطون (٣٠ يوماً)</span><b>${nf(t.active30)}</b></div>
      <div class="kpi"><span>الكتب في السحابة</span><b>${nf(t.books)}</b></div>
    </div>
    <div class="grid2">
      <div class="panel"><h3>التسجيلات الجديدة <small>آخر ٣٠ يوماً · ${nf(d.signups.reduce((n, x) => n + x.n, 0))}</small></h3>
        <div class="chart" role="img" aria-label="رسم التسجيلات اليومية">${d.signups.map((x) => `<div class="bar${x.n ? '' : ' zero'}" style="height:${x.n ? Math.max(6, (x.n / max) * 100) : 3}%" data-tip="${esc(fmtDate(x.day))}: ${x.n}"></div>`).join('')}</div>
        <div class="chart-axis"><span>${fmtDate(d.signups[0]?.day)}</span><span>اليوم</span></div></div>
      <div class="panel"><h3>مساحة المخزن <small>Supabase (المجانية ١ غ.ب)</small></h3>
        <b style="font-size:22px">${fmtBytes(t.bytes)}</b>
        <div class="meter"><i class="${pct > 85 ? 'warn' : ''}" style="width:${pct.toFixed(1)}%"></i></div>
        <small style="color:var(--muted)">${pct.toFixed(1)}٪ من الحدّ المجاني — مستخدمو Google يحفظون في Drive حساباتهم لا في مخزنك</small></div>
    </div>
    <div class="grid2">
      <div class="panel"><h3>بانتظار الموافقة ${d.pending.length ? `<button class="ad-btn small ok" id="ov-approve-all">✓ قبول الكل (${nf(d.pending.length)})</button>` : ''}</h3>
        ${d.pending.length ? `<div class="pend-list">${d.pending.slice(0, 6).map((u) => pendRow(u, false)).join('')}</div>` : '<div class="empty">✓ لا طلبات معلّقة</div>'}</div>
      <div class="panel"><h3>أحدث المستخدمين</h3>
        <div class="pend-list">${d.recent.map((u) => `<div class="pend"><div class="who"><b>${esc(u.email)}</b><span>${pillProv(u.provider)} ${pillStatus(u.status)} · ${ago(u.created_at)}</span></div></div>`).join('') || '<div class="empty">—</div>'}</div></div>
    </div>`;
  document.querySelectorAll('[data-go]').forEach((k) => (k.onclick = () => go(k.dataset.go)));
  wirePendRows();
  const all = $('#ov-approve-all');
  if (all) all.onclick = async () => { if (await updateUsers(d.pending.map((u) => u.email), { status: 'approved' }, `✓ قُبل ${nf(d.pending.length)} حساباً`)) go('overview'); };
}
const pendRow = (u, check = true) => `<div class="pend" data-email="${esc(u.email)}">
    ${check ? `<input type="checkbox" class="pend-chk" aria-label="تحديد ${esc(u.email)}">` : ''}
    <div class="who"><b>${esc(u.email)}</b><span>${pillProv(u.provider)} · طلب ${ago(u.created_at)}${u.provider === 'email' && u.confirmed === false ? ' · لم يؤكّد بريده' : ''}</span></div>
    <button class="ad-btn small ok" data-act="approve">✓ قبول</button>
    <button class="ad-btn small bad" data-act="block">✕ رفض</button></div>`;
function wirePendRows() {
  document.querySelectorAll('.pend[data-email] [data-act]').forEach((b) => (b.onclick = async () => {
    const email = b.closest('.pend').dataset.email;
    const approve = b.dataset.act === 'approve';
    if (await updateUsers([email], { status: approve ? 'approved' : 'blocked' }, approve ? `✓ قُبل ${email}` : `رُفض ${email}`)) go(state.view);
  }));
}

/* ═══ طلبات الانتظار ═══ */
async function viewPending() {
  const users = (await loadUsers()).filter((u) => u.status === 'pending');
  if (!users.length) { $('#view').innerHTML = '<div class="panel"><div class="empty">✓ لا طلبات بانتظار الموافقة.<br><small>الطلبات الجديدة تظهر هنا، وعددها في القائمة الجانبية.</small></div></div>'; return; }
  $('#view').innerHTML = `<div class="panel">
    <div class="toolbar"><label class="ad-btn small"><input type="checkbox" id="pend-all" style="accent-color:var(--gold)"> تحديد الكل</label>
      <button class="ad-btn small ok" id="pend-approve" disabled>✓ قبول المحدَّد</button>
      <button class="ad-btn small bad" id="pend-block" disabled>✕ رفض المحدَّد</button>
      <span style="color:var(--muted);font-size:12.5px;margin-inline-start:auto">${nf(users.length)} طلب</span></div>
    <div class="pend-list">${users.map((u) => pendRow(u)).join('')}</div></div>`;
  wirePendRows();
  const chks = () => [...document.querySelectorAll('.pend-chk')];
  const picked = () => chks().filter((c) => c.checked).map((c) => c.closest('.pend').dataset.email);
  const sync = () => { const n = picked().length; $('#pend-approve').disabled = $('#pend-block').disabled = !n; };
  chks().forEach((c) => (c.onchange = sync));
  $('#pend-all').onchange = (e) => { chks().forEach((c) => (c.checked = e.target.checked)); sync(); };
  $('#pend-approve').onclick = async () => { const p = picked(); if (await updateUsers(p, { status: 'approved' }, `✓ قُبل ${nf(p.length)} حساباً`)) go('pending'); };
  $('#pend-block').onclick = async () => { const p = picked(); if (confirm(`رفض ${p.length} حساباً؟ سيصبح «محظوراً» ويمكنك قبوله لاحقاً.`) && await updateUsers(p, { status: 'blocked' }, `رُفض ${nf(p.length)} حساباً`)) go('pending'); };
}

/* ═══ المستخدمون ═══ */
async function viewUsers() {
  const users = await loadUsers();
  const counts = { all: users.length, approved: 0, pending: 0, blocked: 0, admin: 0, google: 0, email: 0 };
  for (const u of users) { counts[u.status]++; if (u.role === 'admin') counts.admin++; counts[u.provider]++; }
  const TABS = [['all', 'الكل'], ['approved', 'مقبول'], ['pending', 'بانتظار'], ['blocked', 'محظور'], ['admin', 'المسؤولون'], ['google', 'Google'], ['email', 'بريد']];
  $('#view').innerHTML = `<div class="toolbar">
      <input type="search" id="u-q" placeholder="ابحث بالبريد أو الملاحظة…" value="${esc(usersQuery)}" aria-label="بحث في المستخدمين">
      <div class="tabs" id="u-tabs">${TABS.map(([k, l]) => `<button data-f="${k}" class="${usersFilter === k ? 'on' : ''}">${l}<i>${nf(counts[k])}</i></button>`).join('')}</div>
    </div><div id="u-table"></div>`;
  $('#u-q').oninput = (e) => { usersQuery = e.target.value.trim().toLowerCase(); drawUsers(); };
  $('#u-tabs').querySelectorAll('button').forEach((b) => (b.onclick = () => { usersFilter = b.dataset.f; viewUsers(); }));
  drawUsers();
}
function drawUsers() {
  let list = (state.users || []).filter((u) => {
    if (usersFilter === 'admin' ? u.role !== 'admin' : ['google', 'email'].includes(usersFilter) ? u.provider !== usersFilter : usersFilter !== 'all' && u.status !== usersFilter) return false;
    return !usersQuery || u.email.includes(usersQuery) || String(u.note || '').toLowerCase().includes(usersQuery);
  });
  const k = usersSort.k, dir = usersSort.dir;
  list = list.slice().sort((a, b) => { const x = a[k] ?? '', y = b[k] ?? ''; return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * dir; });
  const cols = [['email', 'البريد'], ['provider', 'النوع'], ['status', 'الحالة'], ['role', 'الدور'], ['books', 'الكتب'], ['bytes', 'المساحة'], ['created_at', 'التسجيل'], ['last_seen', 'آخر نشاط']];
  $('#u-table').innerHTML = list.length ? `<div class="table-wrap"><table><thead><tr>${cols.map(([c, l]) => `<th data-k="${c}">${l}${usersSort.k === c ? (dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}<th></th></tr></thead><tbody>
    ${list.map((u) => `<tr data-email="${esc(u.email)}">
      <td class="email" data-l="البريد">${esc(u.email)}</td>
      <td data-l="النوع">${pillProv(u.provider)}</td>
      <td data-l="الحالة">${pillStatus(u.status)}</td>
      <td data-l="الدور">${u.role === 'admin' ? '<span class="pill admin">مسؤول</span>' : 'مستخدم'}</td>
      <td class="num" data-l="الكتب">${u.provider === 'google' ? '—' : nf(u.books)}</td>
      <td class="num" data-l="المساحة">${u.provider === 'google' ? 'Drive' : fmtBytes(u.bytes)}</td>
      <td data-l="التسجيل">${fmtDate(u.created_at)}</td>
      <td data-l="آخر نشاط">${ago(u.last_seen || u.last_sign_in)}</td>
      <td><div class="row-actions">${u.status === 'pending' ? '<button class="ad-btn small ok" data-q="approve">قبول</button>' : ''}<button class="ad-btn small" data-q="open">إدارة</button></div></td>
    </tr>`).join('')}</tbody></table></div>` : '<div class="panel"><div class="empty">لا نتائج</div></div>';
  document.querySelectorAll('#u-table th[data-k]').forEach((th) => (th.onclick = () => { usersSort = { k: th.dataset.k, dir: usersSort.k === th.dataset.k ? -usersSort.dir : -1 }; drawUsers(); }));
  document.querySelectorAll('#u-table tr[data-email]').forEach((tr) => {
    const email = tr.dataset.email;
    tr.querySelectorAll('[data-q]').forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      if (b.dataset.q === 'approve') { if (await updateUsers([email], { status: 'approved' }, `✓ قُبل ${email}`)) { await loadUsers(true); viewUsers(); } }
      else openUser(email);
    }));
    tr.ondblclick = () => openUser(email);
  });
}

/* درج إدارة مستخدم */
async function openUser(email) {
  const u = (state.users || []).find((x) => x.email === email); if (!u) return;
  const conf = state.config || (await loadConfig());
  const defaults = conf.defaults || {};
  document.querySelectorAll('.drawer, .drawer-bg').forEach((x) => x.remove());
  const bg = document.createElement('div'); bg.className = 'drawer-bg';
  const d = document.createElement('aside'); d.className = 'drawer'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'إدارة ' + email);
  const me = $('#me-email').textContent;
  const feat = { ...(u.features || {}) };
  const triOf = (k) => (typeof feat[k] === 'boolean' ? (feat[k] ? 'on' : 'off') : 'def');
  d.innerHTML = `<button class="x-btn" aria-label="إغلاق">✕</button>
    <h3>${esc(u.email)}</h3><div>${pillProv(u.provider)} ${pillStatus(u.status)} ${u.role === 'admin' ? '<span class="pill admin">مسؤول</span>' : ''}</div>
    <dl class="meta">
      <dt>التسجيل</dt><dd>${fmtDate(u.created_at)}</dd>
      <dt>الموافقة</dt><dd>${fmtDate(u.approved_at)}</dd>
      <dt>آخر نشاط</dt><dd>${ago(u.last_seen || u.last_sign_in)}</dd>
      ${u.provider === 'email' ? `<dt>البريد مؤكَّد</dt><dd>${u.confirmed === false ? 'لا' : u.confirmed ? 'نعم' : '—'}</dd><dt>الكتب في السحابة</dt><dd>${nf(u.books)}</dd><dt>المساحة</dt><dd>${fmtBytes(u.bytes)}</dd>` : '<dt>التخزين</dt><dd>Google Drive الخاص به</dd>'}
    </dl>
    <section><b>حالة الحساب</b><div class="btns">
      <button class="ad-btn small ok" data-st="approved" ${u.status === 'approved' ? 'disabled' : ''}>✓ قبول</button>
      <button class="ad-btn small" data-st="pending" ${u.status === 'pending' || u.email === me ? 'disabled' : ''}>⏳ إعادة للانتظار</button>
      <button class="ad-btn small bad" data-st="blocked" ${u.status === 'blocked' || u.email === me ? 'disabled' : ''}>⛔ حظر</button></div></section>
    <section><b>الدور</b><div class="btns">
      ${u.role === 'admin' ? `<button class="ad-btn small" data-role="user" ${u.email === me ? 'disabled' : ''}>إزالة صلاحية المسؤول</button>` : '<button class="ad-btn small" data-role="admin">🛡 جعله مسؤولاً</button>'}</div></section>
    <section><b>الإمكانيات <small style="font-weight:400">(«افتراضي» = إعداد الموقع العام)</small></b>
      ${Object.entries(FEATURES).map(([k, f]) => `<div class="switch-row"><div><b>${f.label}</b><p>الافتراضي الآن: ${defaults[k] === false ? 'معطّل' : 'مفعّل'}</p></div>
        <div class="tri" data-k="${k}">${[['def', 'افتراضي'], ['on', 'مفعّل'], ['off', 'معطّل']].map(([v, l]) => `<button data-v="${v}" class="${triOf(k) === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`).join('')}
      <div class="btns" style="margin-top:10px"><button class="ad-btn small gold" id="save-feat">حفظ الإمكانيات</button></div></section>
    <section><b>ملاحظة خاصة (لا يراها المستخدم)</b><textarea id="u-note" maxlength="500">${esc(u.note || '')}</textarea>
      <div class="btns" style="margin-top:8px"><button class="ad-btn small" id="save-note">حفظ الملاحظة</button></div></section>
    ${u.email !== me ? `<div class="danger-zone"><b>حذف الحساب نهائياً</b><p>${u.provider === 'email' ? 'يُحذف الحساب وكتبه وملفاته من السحابة ولا يمكن التراجع. كتبه على أجهزته تبقى محلياً.' : 'يُحذف سجلّه هنا فقط؛ بياناته في Google Drive الخاص به لا تُمسّ. إن عاد سيُعامَل كتسجيل جديد.'}</p>
      <button class="ad-btn small bad" id="del-user">🗑 حذف الحساب</button></div>` : ''}`;
  document.body.append(bg, d);
  const close = () => { bg.remove(); d.remove(); };
  bg.onclick = close; d.querySelector('.x-btn').onclick = close;
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  const after = async () => { close(); await loadUsers(true); if (state.view === 'users') viewUsers(); else go(state.view); };
  d.querySelectorAll('[data-st]').forEach((b) => (b.onclick = async () => { if (await updateUsers([email], { status: b.dataset.st }, '✓ تغيّرت حالة الحساب')) after(); }));
  d.querySelectorAll('[data-role]').forEach((b) => (b.onclick = async () => {
    if (b.dataset.role === 'admin' && !confirm(`منح ${email} صلاحية المسؤول؟ سيتمكّن من إدارة كل المستخدمين والإعدادات.`)) return;
    if (await updateUsers([email], { role: b.dataset.role }, '✓ تغيّر الدور')) after();
  }));
  d.querySelectorAll('.tri').forEach((tri) => tri.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    tri.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    const k = tri.dataset.k; if (b.dataset.v === 'def') delete feat[k]; else feat[k] = b.dataset.v === 'on';
  })));
  $('#save-feat', d).onclick = async () => { if (await updateUsers([email], { features: feat }, '✓ حُفظت الإمكانيات')) after(); };
  $('#save-note', d).onclick = async () => { if (await updateUsers([email], { note: $('#u-note', d).value }, '✓ حُفظت الملاحظة')) { u.note = $('#u-note', d).value; } };
  const del = $('#del-user', d);
  if (del) del.onclick = async () => {
    const typed = prompt(`للتأكيد اكتب البريد:\n${email}`);
    if ((typed || '').trim().toLowerCase() !== email) return toast('لم يُحذف — البريد غير مطابق');
    del.disabled = true;
    try { const r = await api('user_delete', { email, id: u.id }); toast(`🗑 حُذف الحساب${r.files ? ` و${nf(r.files)} ملف` : ''}`, 'ok'); after(); }
    catch (e) { toast(e.message, 'bad'); del.disabled = false; }
  };
}

/* ═══ الإمكانيات (الافتراضي لكل المستخدمين) ═══ */
async function viewFeatures() {
  const conf = await loadConfig();
  const users = await loadUsers().catch(() => []);
  const defaults = { sync: true, ai_server: true, discover: true, ...(conf.defaults || {}) };
  const overrides = (k) => users.filter((u) => typeof (u.features || {})[k] === 'boolean').length;
  $('#view').innerHTML = `<div class="panel"><h3>الإمكانيات الافتراضية <small>تنطبق على كل مستخدم مقبول ما لم تُغيَّر له من «المستخدمون ← إدارة»</small></h3>
    ${Object.entries(FEATURES).map(([k, f]) => `<div class="switch-row"><div><b>${f.label}</b><p>${f.desc}${overrides(k) ? ` · <span style="color:var(--gold-soft)">${nf(overrides(k))} مستخدم بإعداد خاص</span>` : ''}</p></div>
      <button class="switch" role="switch" data-k="${k}" aria-checked="${defaults[k] !== false}" aria-label="${f.label}"></button></div>`).join('')}
    <div class="save-bar"><button class="ad-btn gold" id="save-defaults">حفظ</button></div></div>
    <div class="panel"><h3>كيف تعمل الإمكانيات؟</h3><p style="color:var(--muted);line-height:1.9">تُفرض على الخادم نفسه لا في الواجهة فقط: المزامنة عبر صلاحيات قاعدة البيانات (RLS)، والمساعد في دالة <b>ai</b>، والاستكشاف في دالة <b>alfeker</b>. المسؤول يملك كل الإمكانيات دائماً. المستخدم بلا إمكانية المزامنة يبقى يقرأ كتبه على جهازه كالمعتاد.</p></div>`;
  wireSwitches();
  $('#save-defaults').onclick = async () => {
    const d = {}; document.querySelectorAll('.switch[data-k]').forEach((s) => (d[s.dataset.k] = s.getAttribute('aria-checked') === 'true'));
    try { state.config = (await api('config_set', { config: { defaults: d } })).config; toast('✓ حُفظت الإمكانيات الافتراضية', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  };
}
const wireSwitches = () => document.querySelectorAll('.switch').forEach((s) => (s.onclick = () => s.setAttribute('aria-checked', s.getAttribute('aria-checked') === 'true' ? 'false' : 'true')));

/* ═══ إعدادات الموقع ═══ */
async function viewSettings() {
  const c = await loadConfig();
  const src = { archive: true, wikisource: true, ablibrary: true, narjes: true, alfeker: true, ...(c.sources || {}) };
  const sw = (k, on, label, desc) => `<div class="switch-row"><div><b>${label}</b><p>${desc}</p></div><button class="switch" role="switch" data-k="${k}" aria-checked="${on !== false}" aria-label="${label}"></button></div>`;
  $('#view').innerHTML = `
    <div class="panel"><h3>التسجيل بالبريد</h3>
      <div class="switch-row"><div><b>تسجيل الحسابات الجديدة</b><p>«بالموافقة»: يُنشأ الحساب وينتظر قبولك قبل أن يزامن. «مغلق»: لا يمكن إنشاء حسابات جديدة. الحسابات الحالية لا تتأثّر.</p></div>
        <div class="seg" id="reg">${[['open', 'مفتوح'], ['approval', 'بالموافقة'], ['closed', 'مغلق']].map(([v, l]) => `<button data-v="${v}" class="${(c.registration || 'approval') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
    <div class="panel"><h3>الدخول بحساب Google</h3>
      ${sw('google_signin', c.google_signin, 'إظهار «المزامنة بحساب Google»', 'يحفظ المستخدم كتبه في Google Drive الخاص به (لا يستهلك مخزنك).')}
      ${sw('google_approval', c.google_approval, 'حسابات Google الجديدة تنتظر الموافقة', 'عند الإيقاف يُقبل كل حساب Google جديد تلقائياً.')}</div>
    <div class="panel"><h3>«استكشف»</h3>
      ${sw('discover_anonymous', c.discover_anonymous, 'متاح للزوار بلا حساب', 'عند الإيقاف لا يعمل جلب الكتب عبر الخادم إلا لأصحاب الحسابات المقبولة.')}
      ${Object.entries(SOURCES_AR).map(([k, l]) => sw('src:' + k, src[k], l, k === 'alfeker' || k === 'narjes' ? 'عبر دالة الخادم' : 'مباشرة من المتصفح')).join('')}</div>
    <div class="save-bar"><button class="ad-btn gold" id="save-settings">حفظ الإعدادات</button></div>`;
  wireSwitches();
  $('#reg').querySelectorAll('button').forEach((b) => (b.onclick = () => $('#reg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b))));
  $('#save-settings').onclick = async () => {
    const v = { registration: $('#reg button.on').dataset.v, sources: {} };
    document.querySelectorAll('.switch[data-k]').forEach((s) => {
      const on = s.getAttribute('aria-checked') === 'true', k = s.dataset.k;
      if (k.startsWith('src:')) v.sources[k.slice(4)] = on; else v[k] = on;
    });
    try { state.config = (await api('config_set', { config: v })).config; toast('✓ حُفظت إعدادات الموقع — تصل للمستخدمين خلال دقائق', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  };
}

/* ═══ الإعلان ═══ */
async function viewAnnounce() {
  const a = (await loadConfig()).announcement || {};
  $('#view').innerHTML = `<div class="panel"><h3>إعلان أعلى المكتبة <small>يظهر لكل مستخدمي التطبيق، ويستطيع كلٌّ إخفاءه حتى تغيّر النص</small></h3>
    <div class="switch-row"><div><b>تفعيل الإعلان</b></div><button class="switch" role="switch" id="ann-on" aria-checked="${!!a.active}" aria-label="تفعيل الإعلان"></button></div>
    <label class="ad-field" style="margin:12px 0">النوع<div class="seg" id="ann-kind">${[['info', '📢 معلومة'], ['warn', '⚠️ تنبيه'], ['success', '✅ خبر سارّ']].map(([v, l]) => `<button data-v="${v}" class="${(a.kind || 'info') === v ? 'on' : ''}">${l}</button>`).join('')}</div></label>
    <label class="ad-field">النص<textarea id="ann-text" rows="4" maxlength="600" placeholder="مثال: أُضيفت أقسام جديدة في «استكشف»…">${esc(a.text || '')}</textarea></label>
    <b style="display:block;margin-top:14px;font-size:13px;color:var(--muted)">معاينة</b><div class="ann-preview" id="ann-prev"></div>
    <div class="save-bar"><button class="ad-btn gold" id="save-ann">حفظ ونشر</button></div></div>`;
  wireSwitches();
  const kind = () => $('#ann-kind button.on').dataset.v;
  const prev = () => { const p = $('#ann-prev'); p.className = 'ann-preview ' + kind(); p.innerHTML = `<span>${kind() === 'warn' ? '⚠️' : kind() === 'success' ? '✅' : '📢'}</span><p>${esc($('#ann-text').value || '…')}</p>`; };
  $('#ann-kind').querySelectorAll('button').forEach((b) => (b.onclick = () => { $('#ann-kind').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); prev(); }));
  $('#ann-text').oninput = prev; prev();
  $('#save-ann').onclick = async () => {
    const v = { active: $('#ann-on').getAttribute('aria-checked') === 'true', kind: kind(), text: $('#ann-text').value.trim() };
    if (v.active && !v.text) return toast('اكتب نص الإعلان أولاً', 'bad');
    try { state.config = (await api('config_set', { config: { announcement: v } })).config; toast(v.active ? '✓ نُشر الإعلان' : '✓ أُوقف الإعلان', 'ok'); } catch (e) { toast(e.message, 'bad'); }
  };
}

/* ═══ السجلّ ═══ */
async function viewAudit() {
  const entries = state.audit || (state.audit = (await api('audit', { limit: 300 })).entries);
  const ACT = { user_update: 'تعديل مستخدم', users_bulk: 'تعديل جماعي', user_delete: 'حذف حساب', config_set: 'تعديل الإعدادات' };
  const detail = (e) => {
    const d = e.detail || {};
    if (d.status) return 'الحالة ← ' + (STATUS_AR[d.status] || d.status);
    if (d.role) return 'الدور ← ' + (d.role === 'admin' ? 'مسؤول' : 'مستخدم');
    if (d.features) return 'الإمكانيات: ' + Object.entries(d.features).map(([k, v]) => `${FEATURES[k]?.label || k} ${v ? '✓' : '✕'}`).join('، ') || 'افتراضية';
    if (d.note !== undefined) return 'ملاحظة';
    if (e.action === 'config_set') return Object.keys(d).join('، ');
    if (e.action === 'user_delete') return d.files ? `${d.files} ملف` : '';
    return '';
  };
  $('#view').innerHTML = entries.length ? `<div class="table-wrap"><table><thead><tr><th>الوقت</th><th>المسؤول</th><th>العملية</th><th>الهدف</th><th>التفاصيل</th></tr></thead><tbody>
    ${entries.map((e) => `<tr><td data-l="الوقت">${esc(new Date(e.at).toLocaleString('ar'))}</td><td class="email" data-l="المسؤول">${esc(e.actor)}</td><td data-l="العملية">${esc(ACT[e.action] || e.action)}</td><td class="email" data-l="الهدف">${esc(e.target || '')}</td><td data-l="التفاصيل">${esc(detail(e))}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="panel"><div class="empty">لا أعمال مسجّلة بعد</div></div>';
}

const VIEWS = { overview: viewOverview, pending: viewPending, users: viewUsers, features: viewFeatures, settings: viewSettings, announce: viewAnnounce, audit: viewAudit };
window.__adminState = state; // للاختبار
boot();
