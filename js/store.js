/* ═══════ مِداد — طبقة التخزين (IndexedDB) ═══════ */
const Store = (() => {
  const DB_NAME = 'midad-db', DB_VER = 2;
  let db = null;

  function init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
        if (!d.objectStoreNames.contains('states')) d.createObjectStore('states', { keyPath: 'bookId' });
        if (!d.objectStoreNames.contains('fulltext')) d.createObjectStore('fulltext'); // نص مُستخرج للبحث الشامل
      };
      req.onsuccess = () => { db = req.result; resolve(); };
      req.onerror = () => reject(req.error);
    });
  }

  const os = (name, mode = 'readonly') => db.transaction(name, mode).objectStore(name);
  const p = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

  /* ── الكتب ── */
  async function addBook(meta, payload) {
    meta.id = meta.id || (crypto.randomUUID ? crypto.randomUUID() : 'b' + Date.now() + Math.random().toString(36).slice(2));
    meta.addedAt = meta.addedAt || Date.now();
    await p(os('books', 'readwrite').put(meta));
    if (payload != null) await p(os('files', 'readwrite').put(payload, meta.id));
    return meta.id;
  }
  const getBooks = () => p(os('books').getAll());
  const getBook = (id) => p(os('books').get(id));
  async function updateBook(id, patch) {
    const b = await getBook(id);
    if (!b) return;
    Object.assign(b, patch);
    await p(os('books', 'readwrite').put(b));
    return b;
  }
  async function deleteBook(id) {
    await p(os('books', 'readwrite').delete(id));
    await p(os('files', 'readwrite').delete(id));
    await p(os('states', 'readwrite').delete(id));
    try { await p(os('fulltext', 'readwrite').delete(id)); } catch {}
  }
  const getPayload = (id) => p(os('files').get(id));
  const updatePayload = (id, payload) => p(os('files', 'readwrite').put(payload, id));
  const getFulltext = (id) => p(os('fulltext').get(id));
  const saveFulltext = (id, text) => p(os('fulltext', 'readwrite').put(text, id));

  /* ── حالة القراءة (الموضع، العلامات، الملاحظات، الوقت) ── */
  async function getState(bookId) {
    const s = await p(os('states').get(bookId));
    return s || {
      bookId, pct: 0, page: 0, scrollTop: 0,
      bookmarks: [],       // {id, page, pct, label, at}
      highlights: [],      // {id, start, end, color, note, text, at}  (نصي)
      pageNotes: [],       // {id, page, note, at}                     (PDF)
      drawings: {},        // {pageNum: [{tool, color, size, pts:[[nx,ny]..]}]} (PDF)
      seconds: 0, lastRead: 0, finished: false,
    };
  }
  const saveState = (state) => p(os('states', 'readwrite').put(state));

  /* ── إعدادات القارئ (عامة) ── */
  const SETTINGS_KEY = 'midad-settings';
  const DEFAULT_SETTINGS = {
    theme: 'sepia', customPaper: null,
    brightness: 100, warmth: 0, bg: 'dusk',
    font: "'Noto Naskh Arabic', serif", fontSize: 20, lineHeight: 190, width: 680,
    flip: 'flip', spread: false, ttsRate: 100, paperFx: 'none',
  };
  function getSettings() {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return { ...DEFAULT_SETTINGS }; }
  }
  function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
  function resetSettings() { localStorage.removeItem(SETTINGS_KEY); return { ...DEFAULT_SETTINGS }; }

  /* ── سجلّ القراءة اليومي (سلسلة أيام + هدف) ── */
  const LOG_KEY = 'midad-log', GOAL_KEY = 'midad-goal';
  const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  function getLog() { try { return JSON.parse(localStorage.getItem(LOG_KEY) || '{}'); } catch { return {}; } }
  function logAddSeconds(sec) {
    const log = getLog();
    const k = todayKey();
    log[k] = (log[k] || 0) + sec;
    // احتفظ بآخر ٤٠٠ يوم فقط
    const keys = Object.keys(log).sort();
    while (keys.length > 400) delete log[keys.shift()];
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  }
  function getGoal() { return parseInt(localStorage.getItem(GOAL_KEY) || '20', 10); }
  function setGoal(min) { localStorage.setItem(GOAL_KEY, String(Math.max(1, min | 0))); }
  function getStreak() {
    const log = getLog();
    const thr = 60; // ثانية واحدة على الأقل تُعدّ… نعدّ من قرأ ولو دقيقة
    let streak = 0;
    const d = new Date();
    // اسمح بأن يبدأ العدّ من اليوم أو أمس (كي لا تنكسر السلسلة قبل قراءة اليوم)
    if (!(log[todayKey(d)] >= 1)) d.setDate(d.getDate() - 1);
    while ((log[todayKey(d)] || 0) >= 1) { streak++; d.setDate(d.getDate() - 1); }
    return streak;
  }

  return { init, addBook, getBooks, getBook, updateBook, deleteBook, getPayload, updatePayload, getFulltext, saveFulltext, getState, saveState, getSettings, saveSettings, resetSettings, logAddSeconds, getLog, getGoal, setGoal, getStreak, todayKey };
})();
window.Store = Store;
