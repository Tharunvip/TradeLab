// TradeLab — Trading Journal
// Entries store: date, symbol, direction, entry/stop/target, result, notes, screenshotId
// Stat summary computed over user's own journal data only.

const STATUS_WIN = 'WIN';
const STATUS_LOSS = 'LOSS';
const STATUS_BE = 'BE';
const STATUS_OPEN = 'OPEN';

export class JournalManager {
  constructor({ storage, onChange }) {
    this.storage = storage;
    this.onChange = onChange || (()=>{});
    this.entries = [];
  }
  async init() {
    this.entries = await this.storage.list('journal') || [];
    this._emit('init');
    return this;
  }
  list({ query = '', sort = 'date-desc', filter = {} } = {}) {
    let arr = this.entries.slice();
    if (query) {
      const q = query.toLowerCase();
      arr = arr.filter(e =>
        (e.symbol || '').toLowerCase().includes(q) ||
        (e.notes || '').toLowerCase().includes(q) ||
        (e.direction || '').toLowerCase().includes(q) ||
        (e.status || '').toLowerCase().includes(q));
    }
    if (filter.symbol) arr = arr.filter(e => e.symbol === filter.symbol);
    if (filter.status) arr = arr.filter(e => e.status === filter.status);
    if (filter.direction) arr = arr.filter(e => e.direction === filter.direction);
    if (filter.from)   arr = arr.filter(e => +e.date >= +filter.from);
    if (filter.to)     arr = arr.filter(e => +e.date <= +filter.to);
    const [f, dir] = sort.split('-');
    arr.sort((a,b) => {
      const A = a[f], B = b[f];
      if (typeof A === 'number' && typeof B === 'number') return dir === 'asc' ? A - B : B - A;
      return dir === 'asc' ? String(A).localeCompare(String(B)) : String(B).localeCompare(String(A));
    });
    return arr;
  }
  get(id) { return this.entries.find(e => e.id === id); }

  async create(data = {}) {
    const e = {
      id: 'j_' + Math.random().toString(36).slice(2,10),
      createdAt: Date.now(),
      date: Date.now(),
      symbol: data.symbol || 'NIFTY 50',
      direction: data.direction || 'LONG',
      entry: data.entry ?? null,
      stop: data.stop ?? null,
      target: data.target ?? null,
      exit: data.exit ?? null,
      quantity: data.quantity ?? 1,
      status: data.status || STATUS_OPEN,
      pnl: data.pnl ?? null,
      rr: data.rr ?? null,
      notes: data.notes || '',
      screenshotId: data.screenshotId || null,
      setupId: data.setupId || null,
      tags: data.tags || [],
    };
    if (e.status === STATUS_OPEN && e.exit != null) this._computeStatusAndPnL(e);
    this.entries.push(e);
    await this.storage.set('journal', e.id, e);
    this._emit('create');
    return e;
  }

  async update(id, patch = {}) {
    const e = this.get(id); if (!e) return null;
    Object.assign(e, patch);
    if (patch.exit != null || patch.entry != null || patch.stop != null || patch.target != null) this._computeStatusAndPnL(e);
    e.updatedAt = Date.now();
    await this.storage.set('journal', id, e);
    this._emit('update');
    return e;
  }

  async delete(id) {
    const i = this.entries.findIndex(e => e.id === id);
    if (i < 0) return false;
    this.entries.splice(i,1);
    await this.storage.remove('journal', id);
    this._emit('delete');
    return true;
  }

  _computeStatusAndPnL(e) {
    if (e.exit == null || e.entry == null) return;
    const isLong = String(e.direction).toUpperCase() === 'LONG';
    const diff = +e.exit - +e.entry;
    const pnl = (isLong ? diff : -diff) * (+e.quantity || 1);
    const risk = e.stop != null ? Math.abs(+e.entry - +e.stop) * (+e.quantity || 1) : Math.abs(pnl);
    e.pnl = +pnl.toFixed(2);
    e.rr = risk ? +(pnl / risk).toFixed(2) : 0;
    if (Math.abs(pnl) < 0.01) e.status = STATUS_BE;
    else e.status = pnl > 0 ? STATUS_WIN : STATUS_LOSS;
  }

  stats(filtered) {
    const arr = filtered ?? this.entries;
    const closed = arr.filter(e => e.status === STATUS_WIN || e.status === STATUS_LOSS || e.status === STATUS_BE);
    const wins = closed.filter(e => e.status === STATUS_WIN).length;
    const losses = closed.filter(e => e.status === STATUS_LOSS).length;
    const bes = closed.filter(e => e.status === STATUS_BE).length;
    const total = closed.length || 1;
    const netPnL = closed.reduce((s,e) => s + (+e.pnl || 0), 0);
    const avgRR = closed.filter(e => e.rr != null).reduce((s,e) => s + (+e.rr || 0), 0) / (closed.filter(e => e.rr != null).length || 1);
    const winRate = (wins / total) * 100;
    const avgWin = wins ? closed.filter(e => e.status === STATUS_WIN).reduce((s,e)=>s + (+e.pnl||0),0) / wins : 0;
    const avgLoss = losses ? closed.filter(e => e.status === STATUS_LOSS).reduce((s,e)=>s + Math.abs(+e.pnl||0),0) / losses : 0;
    return {
      totalEntries: arr.length,
      closed, wins, losses, bes,
      winRate: +winRate.toFixed(2),
      netPnL: +netPnL.toFixed(2),
      avgRR: +avgRR.toFixed(2),
      avgWin: +avgWin.toFixed(2),
      avgLoss: +avgLoss.toFixed(2),
      expectancy: +(wins/total*avgWin - losses/total*avgLoss).toFixed(2),
      best: closed.reduce((m,e)=>Math.max(m, +e.pnl||-Infinity), 0),
      worst: closed.reduce((m,e)=>Math.min(m, +e.pnl||Infinity), 0),
    };
  }

  async attachScreenshot(id, canvasOrBlobOrDataUrl) {
    const e = this.get(id); if (!e) return null;
    let blob;
    if (typeof canvasOrBlobOrDataUrl === 'string') {
      const data = canvasOrBlobOrDataUrl.split(',')[1];
      const mime = canvasOrBlobOrDataUrl.match(/data:(.+);base64/)?.[1] || 'image/png';
      const bin = atob(data), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blob = new Blob([bytes], { type: mime });
    } else if (canvasOrBlobOrDataUrl.toDataURL) {
      blob = await new Promise(res => canvasOrBlobOrDataUrl.toBlob(res, 'image/png'));
    } else blob = canvasOrBlobOrDataUrl;
    const sid = 'sc_' + Math.random().toString(36).slice(2,10);
    await this.storage.set('screenshots', sid, { id: sid, journalId: id, createdAt: Date.now(), blob });
    e.screenshotId = sid;
    await this.storage.set('journal', e.id, e);
    this._emit('screenshot');
    return sid;
  }

  async getScreenshot(sid) {
    if (!sid) return null;
    const row = await this.storage.idb.get('screenshots', sid);
    if (!row?.blob) return null;
    return URL.createObjectURL(row.blob);
  }

  exportCSV(rows) {
    const arr = rows ?? this.entries;
    if (!arr.length) return '';
    const fields = ['id','date','symbol','direction','entry','stop','target','exit','quantity','status','pnl','rr','notes','tags','screenshotId','createdAt'];
    const esc = v => { const s = v == null ? '' : (Array.isArray(v) ? v.join('|') : String(v)); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
    return [fields.join(','), ...arr.map(e => fields.map(f => esc(e[f])).join(','))].join('\n');
  }

  _emit(kind) { try { this.onChange?.(kind, this); } catch(err) { console.error('[TP ERROR] journal onChange:', err); } }
}

export const JOURNAL_STATUSES = [STATUS_OPEN, STATUS_WIN, STATUS_LOSS, STATUS_BE];
