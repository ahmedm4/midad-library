/* ═══════ مِداد — طبقة التخزين (IndexedDB) ═══════ */
const Store = (() => {
  const DB_NAME = 'midad-db', DB_VER = 1;
  let db = null;

  function init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files');
        if (!d.objectStoreNames.contains('states')) d.createObjectStore('states', { keyPath: 'bookId' });
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
  }
  const getPayload = (id) => p(os('files').get(id));
  const updatePayload = (id, payload) => p(os('files', 'readwrite').put(payload, id));

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
    flip: 'flip', spread: false, ttsRate: 100,
  };
  function getSettings() {
    try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
    catch { return { ...DEFAULT_SETTINGS }; }
  }
  function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }
  function resetSettings() { localStorage.removeItem(SETTINGS_KEY); return { ...DEFAULT_SETTINGS }; }

  return { init, addBook, getBooks, getBook, updateBook, deleteBook, getPayload, updatePayload, getState, saveState, getSettings, saveSettings, resetSettings };
})();
window.Store = Store;
