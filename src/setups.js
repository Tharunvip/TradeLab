// TradeLab — Trade Setups manager
// Setup cards store: symbol, direction, status (idea/planning/active/completed/invalidated), entry/stop/targets, rr, notes.

const STATUSES = ['Idea','Planning','Active','Completed','Invalidated'];

export class SetupsManager {
  constructor({ storage, onChange }) {
    this.storage = storage;
    this.onChange = onChange || (()=>{});
    this.items = [];
  }
  async init() {
    this.items = await this.storage.list('setups') || [];
    this._emit('init');
    return this;
  }
  list({ query = '', status = null, sort = 'updatedAt-desc' } = {}) {
    let arr = this.items.slice();
    if (status) arr = arr.filter(s => s.status === status);
    if (query) {
      const q = query.toLowerCase();
      arr = arr.filter(s =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.symbol || '').toLowerCase().includes(q) ||
        (s.notes || '').toLowerCase().includes(q) ||
        (s.tags || []).some(t => String(t).toLowerCase().includes(q)));
    }
    const [f, dir] = sort.split('-');
    arr.sort((a,b) => {
      const A = a[f] ?? 0, B = b[f] ?? 0;
      if (typeof A === 'number' && typeof B === 'number') return dir === 'asc' ? A - B : B - A;
      return dir === 'asc' ? String(A).localeCompare(String(B)) : String(B).localeCompare(String(A));
    });
    return arr;
  }
  get(id){ return this.items.find(s => s.id === id); }
  statuses(){ return STATUSES.slice(); }

  async create(data = {}) {
    const entry = +(data.entry ?? 0);
    const stop  = +(data.stop  ?? 0);
    const t1    = +(data.t1    ?? data.target ?? 0);
    const rr = computeRR(data.direction || 'LONG', { entry, stop, target: t1 });
    const s = {
      id: 's_' + Math.random().toString(36).slice(2,10),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      title: data.title || 'New Setup',
      symbol: data.symbol || 'NIFTY 50',
      direction: data.direction || 'LONG',
      status: data.status || 'Planning',
      entry, stop,
      t1, t2: +(data.t2 ?? 0), t3: +(data.t3 ?? 0),
      rr,
      timeframe: data.timeframe || '15m',
      notes: data.notes || '',
      tags: data.tags || [],
      workspaceId: data.workspaceId || null,
      chartTabId: data.chartTabId || null,
    };
    this.items.push(s);
    await this.storage.set('setups', s.id, s);
    this._emit('create');
    return s;
  }

  async update(id, patch = {}) {
    const s = this.get(id); if (!s) return null;
    Object.assign(s, patch);
    s.updatedAt = Date.now();
    if ('entry' in patch || 'stop' in patch || 't1' in patch || 'direction' in patch) {
      s.rr = computeRR(s.direction, { entry: +s.entry||0, stop: +s.stop||0, target: +(s.t1||patch.target||0) });
    }
    await this.storage.set('setups', id, s);
    this._emit('update');
    return s;
  }

  async delete(id) {
    const i = this.items.findIndex(s => s.id === id); if (i<0) return false;
    this.items.splice(i,1);
    await this.storage.remove('setups', id);
    this._emit('delete');
    return true;
  }

  _emit(kind){ try { this.onChange?.(kind, this); } catch(err) { console.error('[TP ERROR] setups onChange:', err); } }
}

export function computeRR(direction, { entry, stop, target }) {
  if (!entry || !stop || !target) return 0;
  const long = String(direction).toUpperCase() === 'LONG';
  const risk   = Math.abs(entry - stop);
  if (!risk) return 0;
  const reward = long ? Math.abs(target - entry) : Math.abs(entry - target);
  return +(reward / risk).toFixed(2);
}
