/* ═══════ مِداد — المزامنة عبر Google Drive الخاص بالمستخدم ═══════
   للمستخدم البسيط: زر «المزامنة بحساب Google» فقط — بلا مشروع ولا أوامر SQL ولا مساحة من صاحب التطبيق.
   تُحفظ المكتبة في «مجلد بيانات التطبيق» المخفي في Drive المستخدم (appDataFolder): لا يراه بين ملفاته
   ولا يحذفه خطأً، ويُحتسب من مساحته المجانية (15 غ.ب).

   هذه الوحدة تقدّم واجهة مطابقة للجزء الذي تستعمله cloud.js من عميل Supabase
   (from/storage/auth)، فيعمل منطق المزامنة والدمج نفسه — المُختبَر — على Drive دون تكرار.

   تخطيط الملفات في appDataFolder:
     b_<id>.json            صفّ الكتاب {id, meta, state, deck, has_file, deleted, updated_at}
     c_<id>.txt             عمود content (نص الكتاب النصي أو نص الـOCR) — يُجلب كسولاً
     f_<id>                 ملف PDF
     a_<id>__<name>         صور كتاب EPUB
     s_<device>.json        سجلّ قراءة جهاز
     settings.json          الإعدادات المُزامَنة
   الدخول: رمز تفويض (code) عبر نافذة Google، تبادله دالة الخادم «gdrive» (تحمل سرّ العميل)
   فنحصل على رمز تحديث طويل الأمد ⇒ مزامنة خلفية صامتة بلا نوافذ متكرّرة. */
const DriveClient = (() => {
  const TOK_KEY = 'midad-gdrive';
  const ROWS_KEY = 'midad-gdrive-rows';
  const API = 'https://www.googleapis.com/drive/v3';
  const UP = 'https://www.googleapis.com/upload/drive/v3';
  const SCOPE = 'openid email https://www.googleapis.com/auth/drive.appdata';
  const GSI = 'https://accounts.google.com/gsi/client';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function create({ callFn }) {
    let tok = null; try { tok = JSON.parse(localStorage.getItem(TOK_KEY) || 'null'); } catch {}
    const authCbs = [];
    const saveTok = () => { try { if (tok) localStorage.setItem(TOK_KEY, JSON.stringify(tok)); else localStorage.removeItem(TOK_KEY); } catch {} };
    const userOf = () => (tok && tok.refresh ? { id: 'g_' + (tok.sub || 'me'), email: tok.email || '', provider: 'google' } : null);
    const fireAuth = () => { const u = userOf(); authCbs.forEach((cb) => { try { cb('change', u ? { user: u, access_token: tok.access } : null); } catch {} }); };

    async function fnJSON(body) {
      const r = await callFn('gdrive', body);
      let d = null; try { d = await r.json(); } catch {}
      if (!r.ok || !d || d.error) throw Object.assign(new Error((d && d.error) || `gdrive ${r.status}`), { status: r.status, code: d && d.code });
      return d;
    }
    const jwtPayload = (t) => { try { return JSON.parse(decodeURIComponent(escape(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return {}; } };

    /* ── الرمز: تحديث صامت عند قرب انتهائه (طلب واحد في الطيران) ── */
    let refreshing = null;
    async function accessToken(force) {
      if (!tok || !tok.refresh) throw Object.assign(new Error('لم يُسجَّل الدخول بحساب Google'), { status: 401 });
      if (!force && tok.access && tok.exp > Date.now() + 60000) return tok.access;
      if (!refreshing) refreshing = (async () => {
        try {
          const d = await fnJSON({ action: 'refresh', refresh_token: tok.refresh });
          tok.access = d.access_token; tok.exp = Date.now() + (d.expires_in || 3600) * 1000; saveTok();
        } catch (e) {
          // رمز التحديث أُلغي (سحب المستخدم الإذن من حسابه) ⇒ خروج نظيف
          if (e.code === 'invalid_grant' || /invalid_grant/i.test(e.message)) { tok = null; saveTok(); fireAuth(); }
          throw e;
        } finally { refreshing = null; }
      })();
      await refreshing;
      return tok.access;
    }

    async function gfetch(url, opts = {}, retry = true) {
      const t = await accessToken();
      const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${t}` } });
      if (res.status === 401 && retry) { await accessToken(true); return gfetch(url, opts, false); }
      if ((res.status === 429 || res.status >= 500) && retry) { await sleep(1200); return gfetch(url, opts, false); }
      return res;
    }
    async function gjson(url, opts) {
      const r = await gfetch(url, opts);
      if (!r.ok) { let m = ''; try { m = (await r.json()).error.message; } catch {} throw Object.assign(new Error(m || `Drive ${r.status}`), { status: r.status }); }
      return r.status === 204 ? null : r.json();
    }

    /* ── فهرس الملفات (الاسم ⇒ {id, size, t}) ── */
    let index = null;
    async function loadIndex() {
      const map = new Map(); let page = '';
      do {
        const q = new URLSearchParams({ spaces: 'appDataFolder', pageSize: '1000', fields: 'nextPageToken,files(id,name,size,modifiedTime)' });
        if (page) q.set('pageToken', page);
        const d = await gjson(`${API}/files?${q}`);
        for (const f of d.files || []) {
          const prev = map.get(f.name);
          const rec = { id: f.id, size: +f.size || 0, t: f.modifiedTime };
          // نسخ مكرّرة بالاسم نفسه (كتابتان متزامنتان من جهازين): أبقِ الأحدث واحذف الأقدم بهدوء
          if (prev) { const older = prev.t < rec.t ? prev : rec; map.set(f.name, older === prev ? rec : prev); gfetch(`${API}/files/${older.id}`, { method: 'DELETE' }).catch(() => {}); }
          else map.set(f.name, rec);
        }
        page = d.nextPageToken || '';
      } while (page);
      index = map;
      return map;
    }
    const ensureIndex = async () => index || loadIndex();

    /* ── كتابة ملف (إنشاء أو استبدال) ── */
    async function putFile(name, body, type, onProgress) {
      await ensureIndex();
      const ex = index.get(name);
      const size = body.size != null ? body.size : new Blob([body]).size;
      let f;
      if (size > 5 * 1048576) f = await resumable(name, ex, body, type, onProgress);
      else if (ex) {
        f = await gjson(`${UP}/files/${ex.id}?uploadType=media&fields=id,size,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': type }, body });
      } else {
        const b = 'midad' + Math.random().toString(36).slice(2);
        const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
        const mp = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${b}\r\nContent-Type: ${type}\r\n\r\n`, body, `\r\n--${b}--`]);
        f = await gjson(`${UP}/files?uploadType=multipart&fields=id,size,modifiedTime`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body: mp });
      }
      index.set(name, { id: f.id, size: +f.size || size, t: f.modifiedTime });
      return f;
    }
    // رفع على قطع 8 م.ب، لكلٍّ منها محاولاتها؛ يصمد أمام انقطاع الاتصال مع الكتب الكبيرة
    async function resumable(name, ex, blob, type, onProgress) {
      const total = blob.size, CH = 8 * 1048576;
      const startSession = async () => {
        const url = ex ? `${UP}/files/${ex.id}?uploadType=resumable&fields=id,size,modifiedTime` : `${UP}/files?uploadType=resumable&fields=id,size,modifiedTime`;
        const r = await gfetch(url, {
          method: ex ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(total) },
          body: JSON.stringify(ex ? {} : { name, parents: ['appDataFolder'] }),
        });
        const loc = r.headers.get('Location');
        if (!r.ok || !loc) throw Object.assign(new Error(`Drive upload session ${r.status}`), { status: r.status });
        return loc;
      };
      let loc = await startSession(), off = 0, fails = 0;
      while (true) {
        const end = Math.min(total, off + CH);
        try {
          const r = await fetch(loc, { method: 'PUT', headers: { 'Content-Range': `bytes ${off}-${end - 1}/${total}` }, body: blob.slice(off, end) });
          if (r.status === 200 || r.status === 201) { if (onProgress) onProgress(1); return r.json(); }
          if (r.status === 308) {
            const rg = r.headers.get('Range'); // bytes=0-N إن كُشفت؛ وإلا فالقطعة وصلت كاملة
            off = rg ? (+rg.split('-')[1] + 1) : end; fails = 0;
            if (onProgress) onProgress(off / total);
            continue;
          }
          if (r.status === 404 || r.status === 410) { loc = await startSession(); off = 0; continue; } // انتهت الجلسة
          throw Object.assign(new Error(`Drive upload ${r.status}`), { status: r.status });
        } catch (e) {
          if (++fails > 5) throw e;
          await sleep(800 * fails);
          // اسأل الخادم عمّا وصله فعلاً ثم تابع من هناك
          try {
            const q = await fetch(loc, { method: 'PUT', headers: { 'Content-Range': `bytes */${total}` } });
            if (q.status === 200 || q.status === 201) return q.json();
            if (q.status === 308) { const rg = q.headers.get('Range'); off = rg ? (+rg.split('-')[1] + 1) : 0; }
            else { loc = await startSession(); off = 0; }
          } catch {}
        }
      }
    }
    async function getText(name) {
      await ensureIndex();
      const f = index.get(name); if (!f) return null;
      const r = await gfetch(`${API}/files/${f.id}?alt=media`);
      if (r.status === 404) { index.delete(name); return null; }
      if (!r.ok) throw Object.assign(new Error(`Drive ${r.status}`), { status: r.status });
      return r.text();
    }
    async function delFile(name) {
      await ensureIndex();
      const f = index.get(name); if (!f) return;
      const r = await gfetch(`${API}/files/${f.id}`, { method: 'DELETE' });
      if (r.ok || r.status === 404) index.delete(name);
    }
    // تنزيل على قطع 2 م.ب بطلبات Range (يصمد أمام الانقطاع ويُظهر التقدّم)
    async function downloadRanged(name, onProgress) {
      await ensureIndex();
      let f = index.get(name);
      if (!f) { await loadIndex(); f = index.get(name); }
      if (!f) throw Object.assign(new Error('Object not found'), { status: 404 });
      const size = f.size, CH = 2 * 1048576, parts = [];
      if (!size) { const r = await gfetch(`${API}/files/${f.id}?alt=media`); if (!r.ok) throw Object.assign(new Error(`Drive ${r.status}`), { status: r.status }); return r.blob(); }
      let got = 0;
      while (got < size) {
        const end = Math.min(size, got + CH) - 1;
        let part = null, err = null;
        for (let a = 0; a < 5 && !part; a++) {
          try {
            const r = await gfetch(`${API}/files/${f.id}?alt=media`, { headers: { Range: `bytes=${got}-${end}` } });
            if (r.status === 404) throw Object.assign(new Error('Object not found'), { status: 404 });
            if (r.status === 200) { const w = await r.blob(); if (w.size === size) return w; throw new Error('range ignored'); }
            if (r.status !== 206) throw Object.assign(new Error(`Drive ${r.status}`), { status: r.status });
            part = await r.blob(); if (!part.size) { part = null; throw new Error('empty chunk'); }
          } catch (e) { err = e; if (e.status === 404) throw e; if (!navigator.onLine) break; await sleep(600 * (a + 1)); }
        }
        if (!part) throw err || new Error('chunk failed');
        parts.push(part); got += part.size;
        if (onProgress) onProgress(got / size);
      }
      return new Blob(parts, { type: 'application/pdf' });
    }

    /* ── صفوف الكتب: ذاكرة محلية بحسب وقت التعديل (لا نعيد تنزيل ما لم يتغيّر) ── */
    let rowCache = {}; try { rowCache = JSON.parse(localStorage.getItem(ROWS_KEY) || '{}') || {}; } catch {}
    let cacheTimer = null;
    const saveCache = () => { clearTimeout(cacheTimer); cacheTimer = setTimeout(() => { try { localStorage.setItem(ROWS_KEY, JSON.stringify(rowCache)); } catch {} }, 500); };
    async function readRow(id) {
      const name = `b_${id}.json`, f = index && index.get(name);
      if (!f) return null;
      const c = rowCache[id];
      if (c && c.t === f.t) return c.row;
      const txt = await getText(name);
      if (txt == null) return null;
      let row = null; try { row = JSON.parse(txt); } catch { return null; }
      rowCache[id] = { t: f.t, row }; saveCache();
      return row;
    }
    async function writeRow(row) {
      const { content, ...rest } = row;
      const f = await putFile(`b_${row.id}.json`, JSON.stringify(rest), 'application/json');
      rowCache[row.id] = { t: f.modifiedTime, row: rest }; saveCache();
      if (content !== undefined) {
        if (content == null) await delFile(`c_${row.id}.txt`);
        else await putFile(`c_${row.id}.txt`, String(content), 'text/plain; charset=UTF-8');
      }
    }
    async function allRows() {
      await loadIndex(); // بداية كل مزامنة: فهرس طازج
      const ids = [...index.keys()].filter((n) => /^b_.+\.json$/.test(n)).map((n) => n.slice(2, -5));
      const out = [];
      for (let i = 0; i < ids.length; i += 6) { // ستة طلبات متوازية على الأكثر
        const got = await Promise.all(ids.slice(i, i + 6).map((id) => readRow(id).catch(() => null)));
        got.forEach((r) => { if (r) out.push(r); });
      }
      for (const id in rowCache) if (!ids.includes(id)) delete rowCache[id];
      saveCache();
      return out;
    }

    /* ── باني الاستعلامات (المجموعة الجزئية التي تستعملها cloud.js) ── */
    function from(table) {
      const st = { op: 'select', cols: '*', filt: {}, val: null, wantSelect: false };
      const api = {
        select(cols) { if (st.op === 'select') st.cols = cols || '*'; else st.wantSelect = true; return api; },
        eq(k, v) { st.filt[k] = v; return api; },
        limit() { return api; },
        update(v) { st.op = 'update'; st.val = v; return api; },
        upsert(v) { st.op = 'upsert'; st.val = v; return api; },
        delete() { st.op = 'delete'; return api; },
        then(res, rej) { return run().then(res, rej); },
      };
      async function run() {
        try {
          if (table === 'midad_stats') {
            if (st.op === 'select') {
              await loadIndex();
              const names = [...index.keys()].filter((n) => /^s_.+\.json$/.test(n));
              const rows = (await Promise.all(names.map((n) => getText(n).then((t) => { try { return JSON.parse(t); } catch { return null; } }).catch(() => null)))).filter(Boolean);
              return { data: rows, error: null };
            }
            if (st.op === 'upsert') { const { owner, ...r } = st.val; await putFile(`s_${r.device}.json`, JSON.stringify(r), 'application/json'); return { data: null, error: null }; }
            return { data: null, error: null };
          }
          // midad_books
          const id = st.filt.id;
          if (st.op === 'select') {
            if (id != null) {
              await ensureIndex();
              if (/content/.test(st.cols)) { const c = await getText(`c_${id}.txt`); return { data: c == null ? [] : [{ content: c }], error: null }; }
              const r = await readRow(id); return { data: r ? [r] : [], error: null };
            }
            return { data: await allRows(), error: null };
          }
          if (st.op === 'upsert') { await writeRow({ ...st.val }); return { data: null, error: null }; }
          if (st.op === 'update') {
            await ensureIndex();
            const cur = await readRow(id);
            if (!cur) return { data: [], error: null };
            const { content, ...patch } = st.val;
            const row = { ...cur, ...patch };
            if (content !== undefined) row.content = content;
            await writeRow(row);
            return { data: [{ id }], error: null };
          }
          if (st.op === 'delete') { await delFile(`b_${id}.json`); await delFile(`c_${id}.txt`); delete rowCache[id]; saveCache(); return { data: null, error: null }; }
          return { data: null, error: null };
        } catch (e) { return { data: null, error: e }; }
      }
      return api;
    }

    /* ── المخزن: مسارات cloud.js («uid/id» و«uid/assets/id/name») ⇒ أسماء Drive ── */
    function fileName(path) {
      const p = String(path).split('/').slice(1); // أسقط uid
      if (p[0] === 'assets') return `a_${p[1]}__${p.slice(2).join('/')}`;
      return `f_${p.join('/')}`;
    }
    const storage = {
      from: () => ({
        async upload(path, blob, opts = {}) {
          try { await putFile(fileName(path), blob, (opts && opts.contentType) || blob.type || 'application/octet-stream', opts.onProgress); return { error: null }; }
          catch (e) { return { error: e }; }
        },
        async download(path) {
          try { return { data: await downloadRanged(fileName(path)), error: null }; }
          catch (e) { return { data: null, error: e }; }
        },
        downloadRanged: (path, onProgress) => downloadRanged(fileName(path), onProgress),
        async list(prefix, opts = {}) {
          try {
            await loadIndex();
            const parts = String(prefix).split('/');
            const out = [];
            if (parts[1] === 'assets') {
              const pre = `a_${parts[2]}__`;
              for (const [n, f] of index) if (n.startsWith(pre)) out.push({ name: n.slice(pre.length), id: f.id, metadata: { size: f.size } });
            } else {
              for (const [n, f] of index) if (n.startsWith('f_')) { const nm = n.slice(2); if (!opts.search || nm.includes(opts.search)) out.push({ name: nm, id: f.id, metadata: { size: f.size } }); }
            }
            return { data: out, error: null };
          } catch (e) { return { data: null, error: e }; }
        },
        async remove(paths) {
          try { for (const p of paths) await delFile(fileName(p)); return { data: null, error: null }; }
          catch (e) { return { data: null, error: e }; }
        },
        async createSignedUrl() { return { data: null, error: new Error('unsupported') }; },
      }),
    };

    /* ── المصادقة ── */
    function loadGsi() {
      if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
      return new Promise((res, rej) => {
        const s = document.createElement('script'); s.src = GSI; s.async = true;
        s.onload = () => res(); s.onerror = () => rej(new Error('تعذّر تحميل تسجيل الدخول من Google — تحقّق من الاتصال'));
        document.head.appendChild(s);
      });
    }
    async function signIn(clientId) {
      await loadGsi();
      const code = await new Promise((res, rej) => {
        const c = google.accounts.oauth2.initCodeClient({
          client_id: clientId, scope: SCOPE, ux_mode: 'popup', select_account: true,
          callback: (r) => (r && r.code ? res(r.code) : rej(new Error((r && r.error) || 'أُلغي تسجيل الدخول'))),
          error_callback: (e) => rej(new Error(e && e.type === 'popup_closed' ? 'أُغلقت نافذة Google قبل إتمام الدخول' : 'تعذّر فتح نافذة Google (اسمح بالنوافذ المنبثقة)')),
        });
        c.requestCode();
      });
      const d = await fnJSON({ action: 'exchange', code });
      if (!d.refresh_token) throw new Error('لم تمنح Google إذناً دائماً — أعد المحاولة');
      const idt = jwtPayload(d.id_token || '');
      // نتحقّق أن الإذن يشمل Drive (قد يُلغي المستخدم مربّع الصلاحية في نافذة Google)
      if (d.scope && !/drive\.appdata/.test(d.scope)) throw new Error('يلزم السماح للتطبيق بحفظ بياناته في Google Drive — أعد المحاولة وفعّل المربّع');
      tok = { refresh: d.refresh_token, access: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000, email: idt.email || '', sub: idt.sub || '' };
      saveTok(); index = null; fireAuth();
    }

    const auth = {
      async getSession() { const u = userOf(); return { data: { session: u ? { user: u, access_token: tok.access } : null } }; },
      onAuthStateChange(cb) { authCbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async refreshSession() { try { await accessToken(true); } catch {} return {}; },
      async signOut() {
        const r = tok && tok.refresh;
        tok = null; saveTok(); index = null; rowCache = {}; try { localStorage.removeItem(ROWS_KEY); } catch {}
        if (r) fnJSON({ action: 'revoke', token: r }).catch(() => {});
        fireAuth(); return { error: null };
      },
      // الإعدادات المُزامَنة: ملف settings.json بدل user_metadata
      async getUser() {
        try {
          await ensureIndex();
          const t = await getText('settings.json');
          const s = t ? JSON.parse(t) : {};
          return { data: { user: { ...userOf(), user_metadata: { midad_settings: s.data, midad_settings_at: s.at } } }, error: null };
        } catch (e) { return { data: null, error: e }; }
      },
      async updateUser({ data }) {
        try { await putFile('settings.json', JSON.stringify({ data: data.midad_settings, at: data.midad_settings_at }), 'application/json'); return { data: {}, error: null }; }
        catch (e) { return { data: null, error: e }; }
      },
    };

    async function quota() {
      const d = await gjson(`${API}/about?fields=storageQuota`);
      const q = d.storageQuota || {};
      return { used: +q.usage || 0, limit: +q.limit || 0 };
    }

    const noopChannel = () => { const c = { on() { return c; }, subscribe() { return c; } }; return c; };
    return { isDrive: true, from, storage, auth, signIn, quota, channel: noopChannel, removeChannel() {} };
  }

  return { create };
})();
window.DriveClient = DriveClient;
