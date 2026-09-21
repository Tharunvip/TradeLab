// TradeLab — Workspace manager
// Workspace stores: charts (tabs), drawings per chart, indicators per chart, name, id, updatedAt, createdAt, themeAccent.

export class WorkspaceManager {
  constructor({ storage, onChange, store }) {
    this.storage = storage;
    this.store = store;
    this.onChange = onChange || (()=>{});
    this.items = [];
    this.currentId = null;
    this._auto = null;
  }

  async init() {
    this.items = await this.storage.list('workspaces') || [];
    if (!this.items.length) {
      const d = this.createDefault();
      await this.save(d);
    }
    const last = (await this.storage.ls.get('currentWorkspaceId')) || this.items[0]?.id;
    this.currentId = last ?? this.items[0]?.id;
    this._emit('init');
    return this;
  }

  createDefault() {
    return {
      id: 'ws_' + Math.random().toString(36).slice(2,10),
      name: 'My Workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tabs: [{
        id: 't_' + Math.random().toString(36).slice(2,8),
        chartId: 'c_main',
        symbol: 'NIFTY 50',
        timeframe: '5m',
        chartType: 'candle',
        panX: 0, panY: 0, zoom: 1,
        indicatorIds: [],
        drawingIds: [],
        analysis: { mode: null, entry:null, stop:null, t1:null, t2:null, t3:null, account:100000, riskPct:1 },
      }],
      activeTabId: null,
      watchlistsActive: 'main',
      settings: {},
      accent: '#14b8a6',
    };
  }

  list() { return this.items.slice(); }
  get current() { return this.items.find(w => w.id === this.currentId) || null; }

  async create(name) {
    const w = this.createDefault();
    w.name = name || `New Workspace ${this.items.length+1}`;
    w.tabs[0].id = 't_' + Math.random().toString(36).slice(2,8);
    await this.save(w);
    this.items.push(w);
    this.currentId = w.id;
    await this.storage.ls.set('tp.settings.currentWorkspaceId', w.id);
    this._emit('create');
    return w;
  }

  async rename(id, name) {
    const w = this.byId(id); if (!w) return false;
    w.name = name; w.updatedAt = Date.now();
    await this.save(w);
    this._emit('rename');
    return true;
  }

  async duplicate(id) {
    const w = structuredClone(this.byId(id)); if (!w) return null;
    w.id = 'ws_' + Math.random().toString(36).slice(2,10);
    w.name = (w.name || 'Workspace') + ' Copy';
    w.createdAt = Date.now(); w.updatedAt = Date.now();
    w.tabs = w.tabs.map(t => ({ ...t, id: 't_' + Math.random().toString(36).slice(2,8) }));
    await this.save(w);
    this.items.push(w);
    this._emit('duplicate');
    return w;
  }

  async delete(id) {
    if (this.items.length <= 1) return false;
    const i = this.items.findIndex(w => w.id === id);
    if (i<0) return false;
    this.items.splice(i,1);
    await this.storage.remove('workspaces', id);
    if (this.currentId === id) {
      this.currentId = this.items[0].id;
      await this.storage.ls.set('tp.settings.currentWorkspaceId', this.currentId);
    }
    this._emit('delete');
    return true;
  }

  async switch(id) {
    if (!this.byId(id)) return false;
    this.currentId = id;
    await this.storage.ls.set('tp.settings.currentWorkspaceId', id);
    this._emit('switch');
    return true;
  }

  async save(w) {
    const t = w ?? this.current;
    if (!t) return;
    t.updatedAt = Date.now();
    await this.storage.set('workspaces', t.id, t);
    // Make sure items list is accurate
    if (!this.items.find(x => x.id === t.id)) this.items.push(t);
    this._emit('save');
  }

  async saveCurrent() { if (this.current) await this.save(this.current); return this.current; }

  byId(id){ return this.items.find(w => w.id === id); }

  exportFile(workspaceId) {
    const w = this.byId(workspaceId) ?? this.current;
    if (!w) return null;
    return {
      __type: 'tp.workspace',
      version: 1,
      exportedAt: Date.now(),
      workspace: structuredClone(w),
    };
  }

  async importFile(payload) {
    if (!payload || payload.__type !== 'tp.workspace' || !payload.workspace) throw new Error('Invalid TradeLab workspace file');
    const w = structuredClone(payload.workspace);
    w.id = 'ws_' + Math.random().toString(36).slice(2,10);
    w.name = (w.name || 'Imported') + ' (Imported)';
    w.createdAt = Date.now(); w.updatedAt = Date.now();
    w.tabs = (w.tabs || []).map(t => ({ ...t, id: 't_' + Math.random().toString(36).slice(2,8) }));
    await this.save(w);
    this.items.push(w);
    this.currentId = w.id;
    this._emit('import');
    return w;
  }

  // Autosave
  startAutoSave(ms = 3000) {
    this.stopAutoSave();
    let dirty = false;
    const mark = () => { dirty = true; };
    this.onChangeAuto = mark;
    this._auto = setInterval(async () => {
      if (!dirty || !this.current) return;
      try {
        this.store?.mutate?.(s => { if (s.saving) s.saving.status = 'saving'; });
        await this.saveCurrent();
        this.store?.mutate?.(s => { if (s.saving) { s.saving.status = 'saved'; s.saving.lastSavedAt = Date.now(); } });
        dirty = false;
      } catch (err) {
        this.store?.mutate?.(s => { if (s.saving) s.saving.status = 'error'; });
        console.error('[TP ERROR] autosave:', err);
      }
    }, ms);
  }
  markDirty(){ this.onChangeAuto?.(); this.store?.mutate?.(s => { if (s.saving && s.saving.status === 'saved') s.saving.status = 'unsaved'; }); }
  stopAutoSave(){ if (this._auto) { clearInterval(this._auto); this._auto = null; } }

  _emit(kind){ try { this.onChange?.(kind, this); } catch(err) { console.error('[TP ERROR] workspace onChange:', err); } this.markDirty?.(); }
}
