// TradeLab — Storage Abstraction
// IndexedDBStore for large payloads (workspaces/drawings/journal/blobs)
// LocalStorageStore for small settings (theme, preferences)
// Swap StorageManager backend later to Firebase/Supabase by replacing impl.

const DB_NAME = 'TradingPaintDB';
const DB_VERSION = 1;
const STORES = ['workspaces','charts','drawings','setups','journal','files','screenshots','watchlists'];

export const StorageManager = {
  ls: new LocalStorageStore(),
  idb: null,
  legacyMigrated: false,

  async init() {
    try {
      this.idb = await withTimeout(IndexedDBStore.open(DB_NAME, DB_VERSION, STORES), 4000, 'IndexedDB open timed out');
    } catch (err) {
      console.warn('[TP] IndexedDB unavailable — using in-memory fallback (data will not persist):', err);
      this.idb = createMemoryIDB(STORES);
    }
    this._fallback = !(this.idb instanceof IDB);
    try { await this.migrateLegacy(); } catch {}
    return this;
  },

  inMemory() { return this._fallback; },

  async migrateLegacy() {
    const legacy = localStorage.getItem('trading-paint-state');
    if (!legacy) return;
    const parsed = JSON.parse(legacy);
    if (!parsed) return;
    if (parsed.files) await this.set('files','tree',parsed.files);
    if (parsed.drawings?.length) for (const d of parsed.drawings) await this.set('drawings', d.id || uid(), d);
    if (parsed.theme) await this.ls.set('tp.settings.theme', parsed.theme);
    await this.ls.set('tp.settings.legacyMigrated', Date.now());
    localStorage.removeItem('trading-paint-state');
    this.legacyMigrated = true;
  },

  // Uniform accessor routes to correct backend
  get(store, id) { return STORES.includes(store) ? this.idb.get(store, id) : this.ls.get(store+'.'+id); },
  set(store, id, val) { return STORES.includes(store) ? this.idb.set(store, id, val) : this.ls.set(store+'.'+id, val); },
  list(store) { return STORES.includes(store) ? this.idb.list(store) : this.ls.prefix(store); },
  remove(store, id) { return STORES.includes(store) ? this.idb.remove(store, id) : this.ls.remove(store+'.'+id); },

  async clearAll() {
    await this.idb.clearAll();
    [...localStorage.keys?.() ?? Object.keys(localStorage)]
      .filter(k => k.startsWith('tp.'))
      .forEach(k => localStorage.removeItem(k));
  },

  async exportAll() {
    const payload = { schema: 1, exportedAt: Date.now() };
    for (const s of STORES) payload[s] = await this.idb.list(s);
    payload.settings = await this.ls.prefix('tp.settings');
    return payload;
  },

  async importAll(payload, { merge = false } = {}) {
    if (!merge) await this.clearAll();
    for (const s of STORES) {
      const arr = payload[s] ?? [];
      for (const row of arr) await this.idb.set(s, row.id || uid(), row);
    }
    const settings = payload.settings || {};
    for (const [k,v] of Object.entries(settings)) await this.ls.set(k,v);
  },

  storageUsage() {
    // Best-effort approximation
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), v = localStorage.getItem(k) ?? '';
      total += (k.length + v.length) * 2;
    }
    // IndexedDB usage via estimate - best effort
    return navigator.storage?.estimate?.()
      .then(e => ({ quota: e.quota ?? 50 * 1024 * 1024, used: (e.usage ?? total) + total, localStorage: total }))
      .catch(() => ({ quota: 50 * 1024 * 1024, used: total, localStorage: total }));
  }
};

// ---------- LocalStorageStore ----------
function LocalStorageStore() {}
LocalStorageStore.prototype.get = function(k){ try { const v = localStorage.getItem(k); return v==null?null:JSON.parse(v); } catch { return localStorage.getItem(k); } };
LocalStorageStore.prototype.set = function(k,v){ return localStorage.setItem(k, JSON.stringify(v)), Promise.resolve(v); };
LocalStorageStore.prototype.remove = function(k){ localStorage.removeItem(k); return Promise.resolve(); };
LocalStorageStore.prototype.prefix = function(pref){
  const out = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(pref)) out[k.slice(pref.length+1)] = this.get(k);
  }
  return Promise.resolve(out);
};

// ---------- IndexedDBStore ----------
export const IndexedDBStore = {
  open(name, version, stores) {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(name, version);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of stores) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(new IDB(req.result, stores));
      req.onerror = () => reject(req.error);
    });
  }
};
class IDB {
  constructor(db, stores) { this.db = db; this.stores = stores; }
  tx(store, mode='readonly') { return this.db.transaction(store, mode).objectStore(store); }
  get(store, id) { return wrap(this.tx(store).get(id)); }
  async set(store, id, value) {
    if (!value || typeof value !== 'object') value = { id, value };
    if (value.id !== id) value = { ...value, id };
    return wrap(this.tx(store,'readwrite').put(value));
  }
  remove(store, id) { return wrap(this.tx(store,'readwrite').delete(id)); }
  list(store) {
    return new Promise((res, rej) => {
      const out = [], req = this.tx(store).openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out.push(c.value); c.continue(); } else res(out); };
      req.onerror = () => rej(req.error);
    });
  }
  async clearAll() {
    for (const s of this.stores) await wrap(this.tx(s,'readwrite').clear());
  }
}
function wrap(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}
function withTimeout(p, ms, msg) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(msg)), ms);
    p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
  });
}
function createMemoryIDB(stores) {
  const mem = new Map();
  for (const s of stores) mem.set(s, new Map());
  return {
    get(store, id) { const v = mem.get(store).get(id); return Promise.resolve(v ?? null); },
    set(store, id, val) {
      const m = mem.get(store);
      if (!val || typeof val !== 'object') val = { id, value: val };
      else if (val.id !== id) val = { ...val, id };
      m.set(id, val); return Promise.resolve(val);
    },
    remove(store, id) { mem.get(store).delete(id); return Promise.resolve(); },
    list(store) { return Promise.resolve([...mem.get(store).values()]); },
    clearAll() { for (const m of mem.values()) m.clear(); return Promise.resolve(); },
  };
}
function uid(){return 'id_'+Math.random().toString(36).slice(2,10);}
