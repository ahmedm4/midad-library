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
  ocr_local: { label: '🔤 استخراج النص على الجهاز (تجريبي)', desc: 'فهرسة الكتب المصوّرة للبحث بمحرّك Tesseract داخل المتصفح: مجاني بلا مفتاح ولا خادم. مطفأ افتراضياً — فعّله لمن تريد تجربته. المسؤول يملكه دائماً.', optIn: true },
};
// الإمكانية الاختيارية مطفأة ما لم تُفعَّل صراحةً؛ البقية مفعّلة ما لم تُعطَّل
const featDefault = (k, defaults) => (FEATURES[k] && FEATURES[k].optIn ? defaults[k] === true : defaults[k] !== false);
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
  // دالة منشورة أقدم من الواجهة: لا تعرف الإجراءات الجديدة
  if (d && (d.code === 'unknown_action' || d.error === 'إجراء غير معروف')) throw Object.assign(new Error('دالة «admin» المنشورة أقدم من لوحة التحكم ولا تعرف هذه الصفحة.'), { code: 'oldfn' });
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
const TITLES = { overview: 'نظرة عامة', pending: 'طلبات الانتظار', users: 'المستخدمون', activity: 'النشاط', errors: 'الأعطال', health: 'صحة النظام', features: 'الإمكانيات', settings: 'إعدادات الموقع', announce: 'الإعلان', audit: 'سجلّ الأعمال' };
document.querySelectorAll('#nav button').forEach((b) => (b.onclick = () => go(b.dataset.view)));
$('#refresh').onclick = () => { state.users = state.overview = state.audit = state.config = state.activity = state.errors = state.health = null; go(state.view); refreshBadge(); };
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
    if (e.code === 'oldfn') {
      $('#view').innerHTML = `<div class="empty">⚠ ${esc(e.message)}<br><br>أعد نشر الدوال من مجلد المشروع، ثم أعد تنفيذ <code>supabase/admin_setup.sql</code>:<pre dir="ltr" style="text-align:left;user-select:all;margin-top:10px">supabase functions deploy admin --no-verify-jwt
supabase functions deploy ai --no-verify-jwt
supabase functions deploy alfeker --no-verify-jwt
supabase functions deploy gdrive --no-verify-jwt</pre></div>`;
      return;
    }
    $('#view').innerHTML = `<div class="empty">⚠ ${esc(e.message)}</div>`;
  }
  $('#main').focus({ preventScroll: true });
}
let lastPending = null;
async function refreshBadge() {
  try {
    const d = await api('pending_count'); const b = $('#badge-pending'); b.hidden = !d.count; b.textContent = nf(d.count);
    if (lastPending !== null && d.count > lastPending && 'Notification' in window && Notification.permission === 'granted') {
      try { const n = new Notification('مِداد — طلب تسجيل جديد', { body: `${d.count} حساب بانتظار موافقتك`, icon: 'icon-192.png', tag: 'midad-pending' }); n.onclick = () => { window.focus(); go('pending'); }; } catch {}
      state.users = state.overview = null;
    }
    lastPending = d.count;
  } catch {}
  try {
    const e = await api('errors', { limit: 200 });
    const day = Date.now() - 864e5, n = (e.errors || []).filter((x) => Date.parse(x.at) > day).length;
    const b = $('#badge-errors'); b.hidden = !n; b.textContent = nf(n); b.title = 'أعطال آخر ٢٤ ساعة';
  } catch {}
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

/* رسم أعمدة بسيط: items = [{day, v}] */
const barChart = (items, label, cls = '') => {
  const max = Math.max(1, ...items.map((x) => x.v));
  return `<div class="chart ${cls}" role="img" aria-label="${esc(label)}">${items.map((x) => `<div class="bar${x.v ? '' : ' zero'}" style="height:${x.v ? Math.max(6, (x.v / max) * 100) : 3}%" data-tip="${esc(fmtDate(x.day))}: ${nf(x.v)}"></div>`).join('')}</div>
    <div class="chart-axis"><span>${fmtDate(items[0]?.day)}</span><span>اليوم</span></div>`;
};
const loadActivity = async () => { if (!state.activity) { const d = await api('activity', { days: 30 }); state.activity = d.activity || { setup: true }; } return state.activity; };
const needSql = '<div class="empty">نفّذ ملف <code>admin_setup.sql</code> المحدَّث في SQL Editor لتبدأ هذه البيانات بالتجمّع.</div>';

/* ═══ نظرة عامة ═══ */
async function viewOverview() {
  const [d, act] = await Promise.all([state.overview || api('overview'), loadActivity().catch(() => ({ setup: true }))]);
  state.overview = d;
  const t = d.totals, max = Math.max(1, ...d.signups.map((x) => x.n));
  const actRow = act && !act.setup ? `<div class="kpis">
      <div class="kpi clickable" data-go="activity"><span>أجهزة نشطة اليوم</span><b>${nf(act.today)}</b><small>كل الزوار، بحساب أو بدونه</small></div>
      <div class="kpi clickable" data-go="activity"><span>هذا الأسبوع</span><b>${nf(act.week)}</b></div>
      <div class="kpi clickable" data-go="activity"><span>آخر ٣٠ يوماً</span><b>${nf(act.month)}</b><small>${nf(act.installed)} مثبّت كتطبيق</small></div>
      <div class="kpi bad clickable" data-go="errors"><span>أعطال اليوم</span><b>${nf((act.daily || []).slice(-1)[0]?.errors || 0)}</b></div>
    </div>` : '';
  const limit = 1073741824, pct = Math.min(100, (t.bytes / limit) * 100);
  $('#view').innerHTML = `
    <div class="kpis">
      <div class="kpi clickable" data-go="users"><span>المستخدمون</span><b>${nf(t.users)}</b><small>${nf(t.email)} بريد · ${nf(t.google)} Google</small></div>
      <div class="kpi warn clickable" data-go="pending"><span>بانتظار الموافقة</span><b>${nf(t.pending)}</b><small>${t.pending ? 'تحتاج قرارك' : 'لا طلبات'}</small></div>
      <div class="kpi ok"><span>المقبولون</span><b>${nf(t.approved)}</b><small>${nf(t.admins)} مسؤول</small></div>
      <div class="kpi bad"><span>المحظورون</span><b>${nf(t.blocked)}</b></div>
      <div class="kpi"><span>نشطون (٣٠ يوماً)</span><b>${nf(t.active30)}</b></div>
      <div class="kpi"><span>الكتب في السحابة</span><b>${nf(t.books)}</b></div>
    </div>${actRow}
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
const quotaOf = (u) => { if (u.role === 'admin') return 0; const q = u.quota_mb ?? (state.config && state.config.quota_mb) ?? 0; return q > 0 ? q : 0; };
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
      <td class="num" data-l="المساحة">${u.provider === 'google' ? 'Drive' : fmtBytes(u.bytes) + (quotaOf(u) ? `<small class="q ${u.bytes >= quotaOf(u) * 1048576 ? 'full' : ''}"> / ${nf(quotaOf(u))} م.ب</small>` : '')}</td>
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
      ${Object.entries(FEATURES).map(([k, f]) => `<div class="switch-row"><div><b>${f.label}</b><p>الافتراضي الآن: ${featDefault(k, defaults) ? 'مفعّل' : 'معطّل'}</p></div>
        <div class="tri" data-k="${k}">${[['def', 'افتراضي'], ['on', 'مفعّل'], ['off', 'معطّل']].map(([v, l]) => `<button data-v="${v}" class="${triOf(k) === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>`).join('')}
      <div class="btns" style="margin-top:10px"><button class="ad-btn small gold" id="save-feat">حفظ الإمكانيات</button></div></section>
    ${u.provider === 'email' ? `<section><b>حدّ المساحة السحابية</b>
      <p style="color:var(--muted);font-size:12.5px;margin:4px 0 8px">فارغ = حدّ الموقع العام (${conf.quota_mb ? nf(conf.quota_mb) + ' م.ب' : 'بلا حدّ'}) · 0 = بلا حدّ لهذا المستخدم · يستعمل الآن ${fmtBytes(u.bytes)}</p>
      <div class="btns"><input type="number" min="0" step="50" id="u-quota" class="num-in" value="${u.quota_mb ?? ''}" placeholder="افتراضي" aria-label="الحدّ بالميغابايت"> <span>م.ب</span>
      <button class="ad-btn small" id="save-quota">حفظ الحدّ</button></div></section>` : ''}
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
  const sq = $('#save-quota', d);
  if (sq) sq.onclick = async () => { const v = $('#u-quota', d).value.trim(); if (await updateUsers([email], { quota_mb: v === '' ? null : +v }, '✓ حُفظ حدّ المساحة')) after(); };
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
      <button class="switch" role="switch" data-k="${k}" aria-checked="${featDefault(k, defaults)}" aria-label="${f.label}"></button></div>`).join('')}
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
    <div class="panel"><h3>المساحة السحابية</h3>
      <div class="switch-row"><div><b>حدّ المساحة لكل مستخدم</b><p>بالميغابايت، لحسابات البريد في مشروعك (0 = بلا حدّ). يمكن تغييره لمستخدم بعينه من درجه. مستخدمو Google يحفظون في Drive حساباتهم فلا يشملهم. المسؤول بلا حدّ.</p></div>
        <span><input type="number" min="0" step="50" id="quota-mb" class="num-in" value="${+c.quota_mb || 0}" aria-label="الحدّ بالميغابايت"> م.ب</span></div></div>
    <div class="panel"><h3>إشعار بالطلبات الجديدة</h3>
      ${sw('notify_email', c.notify_email, 'إشعار بالبريد', 'رسالة لبريد كل مسؤول عند كل طلب تسجيل جديد. تحتاج السرّ RESEND_API_KEY في Supabase (حساب مجاني في resend.com).')}
      <div class="btns" style="margin:6px 0 12px"><button class="ad-btn small" id="notify-test">✉️ أرسل رسالة تجريبية لبريدي</button></div>
      <div class="switch-row"><div><b>إشعارات المتصفح</b><p>تنبيه على هذا الجهاز حين يصل طلب جديد واللوحة أو التطبيق مفتوحان.</p></div>
        <button class="ad-btn small" id="notify-browser"></button></div></div>
    <div class="save-bar"><button class="ad-btn gold" id="save-settings">حفظ الإعدادات</button></div>`;
  wireSwitches();
  const nb = $('#notify-browser');
  const nbDraw = () => { const p = 'Notification' in window ? Notification.permission : 'unsupported'; nb.textContent = p === 'granted' ? '✓ مفعّلة' : p === 'denied' ? 'محظورة من المتصفح' : p === 'unsupported' ? 'غير مدعومة' : '🔔 فعّلها'; nb.disabled = p !== 'default'; };
  nbDraw(); nb.onclick = async () => { try { await Notification.requestPermission(); } catch {} nbDraw(); };
  $('#notify-test').onclick = async (e) => { e.target.disabled = true; try { const r = await api('notify_test'); toast('✓ أُرسلت إلى ' + r.to, 'ok'); } catch (er) { toast(er.message, 'bad'); } e.target.disabled = false; };
  $('#reg').querySelectorAll('button').forEach((b) => (b.onclick = () => $('#reg').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b))));
  $('#save-settings').onclick = async () => {
    const v = { registration: $('#reg button.on').dataset.v, sources: {}, quota_mb: Math.max(0, +$('#quota-mb').value || 0) };
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
  const ACT = { user_update: 'تعديل مستخدم', users_bulk: 'تعديل جماعي', user_delete: 'حذف حساب', config_set: 'تعديل الإعدادات', errors_clear: 'مسح أعطال' };
  const detail = (e) => {
    const d = e.detail || {};
    if (d.status) return 'الحالة ← ' + (STATUS_AR[d.status] || d.status);
    if (d.role) return 'الدور ← ' + (d.role === 'admin' ? 'مسؤول' : 'مستخدم');
    if (d.features) return 'الإمكانيات: ' + Object.entries(d.features).map(([k, v]) => `${FEATURES[k]?.label || k} ${v ? '✓' : '✕'}`).join('، ') || 'افتراضية';
    if (d.note !== undefined) return 'ملاحظة';
    if (d.quota_mb !== undefined) return 'حدّ المساحة ← ' + (d.quota_mb == null ? 'افتراضي' : d.quota_mb + ' م.ب');
    if (e.action === 'config_set') return Object.keys(d).join('، ');
    if (e.action === 'user_delete') return d.files ? `${d.files} ملف` : '';
    return '';
  };
  $('#view').innerHTML = entries.length ? `<div class="table-wrap"><table><thead><tr><th>الوقت</th><th>المسؤول</th><th>العملية</th><th>الهدف</th><th>التفاصيل</th></tr></thead><tbody>
    ${entries.map((e) => `<tr><td data-l="الوقت">${esc(new Date(e.at).toLocaleString('ar'))}</td><td class="email" data-l="المسؤول">${esc(e.actor)}</td><td data-l="العملية">${esc(ACT[e.action] || e.action)}</td><td class="email" data-l="الهدف">${esc(e.target || '')}</td><td data-l="التفاصيل">${esc(detail(e))}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="panel"><div class="empty">لا أعمال مسجّلة بعد</div></div>';
}

/* ═══ النشاط ═══ */
const KIND_AR = { phone: '📱 جوال', tablet: '📟 لوحي', desktop: '💻 حاسب', unknown: 'غير معروف' };
async function viewActivity() {
  const a = await loadActivity();
  if (!a || a.setup) { $('#view').innerHTML = `<div class="panel">${needSql}</div>`; return; }
  const daily = a.daily || [];
  const split = (obj, map) => { const tot = Object.values(obj || {}).reduce((n, x) => n + x, 0) || 1; return Object.entries(obj || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => `<div class="split-row"><span>${esc(map ? map[k] || k : k)}</span><div class="meter"><i style="width:${(n * 100 / tot).toFixed(1)}%"></i></div><b>${nf(n)}</b></div>`).join('') || '<div class="empty">—</div>'; };
  const month = a.month || 0;
  $('#view').innerHTML = `
    <div class="kpis">
      <div class="kpi"><span>نشطون اليوم</span><b>${nf(a.today)}</b></div>
      <div class="kpi"><span>هذا الأسبوع</span><b>${nf(a.week)}</b></div>
      <div class="kpi"><span>آخر ٣٠ يوماً</span><b>${nf(month)}</b></div>
      <div class="kpi"><span>كل الأجهزة منذ البدء</span><b>${nf(a.total)}</b></div>
      <div class="kpi ok"><span>مثبّت كتطبيق</span><b>${nf(a.installed)}</b><small>${month ? Math.round(a.installed * 100 / month) : 0}٪ من نشطي الشهر</small></div>
      <div class="kpi"><span>بحساب مزامنة</span><b>${nf(a.signed)}</b><small>الباقون يقرؤون محلياً</small></div>
    </div>
    <div class="grid2">
      <div class="panel"><h3>الأجهزة النشطة يومياً <small>آخر ٣٠ يوماً</small></h3>${barChart(daily.map((x) => ({ day: x.day, v: x.active })), 'الأجهزة النشطة يومياً')}</div>
      <div class="panel"><h3>أجهزة جديدة <small>أول زيارة</small></h3>${barChart(daily.map((x) => ({ day: x.day, v: x.new })), 'الأجهزة الجديدة يومياً', 'gold')}</div>
    </div>
    <div class="grid2">
      <div class="panel"><h3>نوع الجهاز <small>نشطو الشهر</small></h3>${split(a.kinds, KIND_AR)}</div>
      <div class="panel"><h3>الإصدارات <small>من لم يحدّث تطبيقه يظهر هنا</small></h3>${split(a.versions)}</div>
    </div>
    <div class="panel"><p style="color:var(--muted);line-height:1.9;margin:0">🔒 العدّاد مجهول: معرّف عشوائي لكل متصفح يُرسَل مرة يومياً، بلا بريد ولا عنوان IP ولا أي محتوى. «المستخدمون» في اللوحة هم أصحاب الحسابات فقط؛ أما هذا العدد فيشمل كل من يفتح التطبيق، ومن يمسح بيانات متصفحه يُعدّ جهازاً جديداً.</p></div>`;
}

/* ═══ الأعطال ═══ */
const ERR_KIND = { open: '📖 فتح كتاب', download: '⬇️ تنزيل من السحابة', upload: '⬆️ رفع للسحابة', sync: '🔄 مزامنة', discover: '🧭 استكشف', js: '⚙️ خطأ برمجي', promise: '⚙️ خطأ برمجي' };
let errGroup = null;
async function viewErrors() {
  const d = state.errors || (state.errors = await api('errors', { limit: 1500 }));
  if (d.setup) { $('#view').innerHTML = `<div class="panel">${needSql}</div>`; return; }
  const list = d.errors || [];
  if (!list.length) { $('#view').innerHTML = '<div class="panel"><div class="empty">✓ لا أعطال مسجّلة — كل شيء يعمل عند المستخدمين.</div></div>'; return; }
  const groups = new Map();
  for (const e of list) {
    const key = e.kind + '|' + e.message;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, kind: e.kind, message: e.message, items: [], devices: new Set(), users: new Set(), vers: new Set() }));
    g.items.push(e); g.devices.add(e.device); if (e.email) g.users.add(e.email); if (e.ver) g.vers.add(e.ver);
  }
  const gs = [...groups.values()].sort((a, b) => Date.parse(b.items[0].at) - Date.parse(a.items[0].at));
  const day = Date.now() - 864e5;
  $('#view').innerHTML = `<div class="toolbar"><span style="color:var(--muted);font-size:13px">${nf(list.length)} عطل في ${nf(gs.length)} نوع · آخر ٢٤ ساعة: ${nf(list.filter((e) => Date.parse(e.at) > day).length)}</span>
      <button class="ad-btn small bad" id="err-clear-all" style="margin-inline-start:auto">🗑 مسح الكل</button></div>
    <div class="err-list">${gs.map((g, i) => `<div class="err-g${errGroup === g.key ? ' open' : ''}" data-i="${i}">
      <button class="err-head"><span class="err-kind">${ERR_KIND[g.kind] || esc(g.kind)}</span><span class="err-msg">${esc(g.message)}</span>
        <span class="err-meta"><b>${nf(g.items.length)}×</b> · ${nf(g.devices.size)} جهاز · ${ago(g.items[0].at)}</span></button>
      <div class="err-body">
        <p>الإصدارات: ${[...g.vers].map(esc).join('، ') || '—'}${g.users.size ? ` · الحسابات: ${[...g.users].slice(0, 5).map(esc).join('، ')}${g.users.size > 5 ? '…' : ''}` : ''}</p>
        <div class="table-wrap"><table><thead><tr><th>الوقت</th><th>الإصدار</th><th>الحساب</th><th>السياق</th></tr></thead><tbody>
        ${g.items.slice(0, 15).map((e) => `<tr><td data-l="الوقت">${esc(new Date(e.at).toLocaleString('ar'))}</td><td data-l="الإصدار">${esc(e.ver || '')}</td><td class="email" data-l="الحساب">${esc(e.email || '—')}</td><td data-l="السياق"><code class="ctx">${esc(Object.entries(e.context || {}).map(([k, v]) => `${k}=${v}`).join(' · '))}</code></td></tr>`).join('')}
        </tbody></table></div>
        <div class="btns" style="margin-top:8px"><button class="ad-btn small" data-clear="${i}">✓ عولج — امسح هذا النوع</button></div>
      </div></div>`).join('')}</div>`;
  document.querySelectorAll('.err-g').forEach((el) => {
    const g = gs[+el.dataset.i];
    el.querySelector('.err-head').onclick = () => { el.classList.toggle('open'); errGroup = el.classList.contains('open') ? g.key : null; };
  });
  document.querySelectorAll('[data-clear]').forEach((b) => (b.onclick = async () => {
    const g = gs[+b.dataset.clear];
    try { await api('errors_clear', { ids: g.items.map((e) => e.id) }); toast('✓ مُسح', 'ok'); state.errors = null; viewErrors(); refreshBadge(); } catch (e) { toast(e.message, 'bad'); }
  }));
  $('#err-clear-all').onclick = async () => {
    if (!confirm('مسح كل الأعطال المسجّلة؟')) return;
    try { await api('errors_clear', {}); toast('✓ مُسحت كل الأعطال', 'ok'); state.errors = null; viewErrors(); refreshBadge(); } catch (e) { toast(e.message, 'bad'); }
  };
}

/* ═══ صحة النظام ═══ */
async function viewHealth() {
  const h = state.health || (state.health = await api('health'));
  const row = (ok, title, desc, fix) => `<div class="hl-row ${ok === true ? 'ok' : ok === 'warn' ? 'warn' : 'bad'}"><span class="hl-ic">${ok === true ? '✓' : ok === 'warn' ? '!' : '✕'}</span><div><b>${title}</b>${desc ? `<p>${desc}</p>` : ''}${ok !== true && fix ? `<p class="fix">${fix}</p>` : ''}</div></div>`;
  const deploy = (fn) => `انشرها: <code>npx supabase functions deploy ${fn} --project-ref ${esc((cfg.url.match(/https:\/\/([^.]+)/) || [])[1] || '')} --no-verify-jwt</code>`;
  const FN = { admin: 'لوحة التحكم', ai: 'المساعد الذكي', alfeker: 'شبكة الفكر ونرجس', gdrive: 'الدخول بحساب Google' };
  const fnRows = Object.entries(h.functions || {}).map(([k, f]) => {
    const st = f.state;
    return row(st === 'ok' ? true : st === 'old' ? 'warn' : false, `الدالة ${k} — ${FN[k] || ''}`,
      st === 'ok' ? `محدّثة (${esc(f.version)})` : st === 'old' ? `منشورة لكنها أقدم من هذا الإصدار${f.version ? ` (${esc(f.version)})` : ''}` : st === 'missing' ? 'غير منشورة' : 'تعذّر فحصها ' + esc(f.detail || ''), deploy(k));
  }).join('');
  const T = h.tables || {}, missingT = Object.keys(T).filter((k) => !T[k]);
  const S = h.secrets || {};
  const schemaOk = h.schema >= h.schemaExpected;
  const okCount = [schemaOk, !missingT.length, h.bucket, ...Object.values(h.functions || {}).map((f) => f.state === 'ok')].filter(Boolean).length;
  const total = 3 + Object.keys(h.functions || {}).length;
  $('#view').innerHTML = `
    <div class="panel hl-sum ${okCount === total ? 'ok' : 'warn'}"><b>${okCount === total ? '✓ كل شيء سليم ومحدّث' : `${nf(total - okCount)} بند يحتاج انتباهك`}</b><span>${nf(okCount)} / ${nf(total)}</span></div>
    <div class="panel"><h3>قاعدة البيانات</h3>
      ${row(schemaOk, 'ملف admin_setup.sql', schemaOk ? `منفَّذ بآخر إصدار (${h.schema})` : `الإصدار المنفَّذ ${h.schema || 'قديم'} والمطلوب ${h.schemaExpected}`, 'أعد تنفيذ الملف كاملاً في SQL Editor — آمن لإعادة التنفيذ.')}
      ${row(!missingT.length, 'الجداول', missingT.length ? 'ناقص: ' + missingT.map(esc).join('، ') : 'كلها موجودة', 'تُنشأ بتنفيذ ملف admin_setup.sql (وجداول الكتب من خطوات إعداد المزامنة).')}
      ${row(h.bucket, 'مخزن الملفات midad-files', h.bucket ? 'موجود' : 'غير موجود', 'أنشئه من Storage ← New bucket باسم midad-files (خاص).')}</div>
    <div class="panel"><h3>دوال الخادم</h3>${fnRows}</div>
    <div class="panel"><h3>الأسرار <small>Supabase ← Edge Functions ← Secrets</small></h3>
      ${row(S.GEMINI ? true : 'warn', 'مفاتيح Gemini (GEMINI_API_KEYS)', S.GEMINI ? 'مضبوطة' : 'غير مضبوطة — المستخدمون يحتاجون مفاتيحهم الخاصة للمساعد')}
      ${row(S.GOOGLE_CLIENT_ID && S.GOOGLE_CLIENT_SECRET ? true : 'warn', 'الدخول بحساب Google', S.GOOGLE_CLIENT_ID && S.GOOGLE_CLIENT_SECRET ? 'مضبوط' : 'غير مضبوط — زرّ Google لا يظهر')}
      ${row(S.RESEND_API_KEY ? true : 'warn', 'الإشعار بالبريد (RESEND_API_KEY)', S.RESEND_API_KEY ? 'مضبوط' : 'اختياري — بدونه تصلك الطلبات كشارة في التطبيق فقط')}
      ${row(true, 'ADMIN_EMAILS', S.ADMIN_EMAILS ? 'مضبوط' : 'غير مضبوط (اختياري — دور «مسؤول» في الجدول يكفي)')}</div>`;
}

const VIEWS = { overview: viewOverview, pending: viewPending, users: viewUsers, activity: viewActivity, errors: viewErrors, health: viewHealth, features: viewFeatures, settings: viewSettings, announce: viewAnnounce, audit: viewAudit };
window.__adminState = state; // للاختبار
boot();
