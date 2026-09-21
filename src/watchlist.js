// TradeLab — Watchlists manager
// Supports multiple watchlists, each with symbol array; supports reorder / rename / add / remove; tick simulation.

export class WatchlistManager {
  constructor({ storage, onChange, dataProvider }) {
    this.storage = storage;
    this.onChange = onChange || (()=>{});
    this.dataProvider = dataProvider;
    this.watchlists = {};
    this.activeId = 'main';
    this.timer = null;
    this._symbolPrices = {};
  }

  async init() {
    let list = [];
    try { list = await this.storage.list('watchlists'); } catch {}
    if (!list || !list.length) {
      // Seed defaults
      this.watchlists = {
        main:   { id:'main',   name: 'Main Watchlist', symbols: ['NIFTY 50','BANK NIFTY','RELIANCE','TCS','BTC/USD','ETH/USD'] },
        stocks: { id:'stocks', name: 'Stocks',         symbols: ['RELIANCE','TCS','INFY','HDFCBANK','AAPL','TSLA','NVDA'] },
        crypto: { id:'crypto', name: 'Crypto',         symbols: ['BTC/USD','ETH/USD','SOL/USD'] },
        fx:     { id:'fx',     name: 'Forex & Commodities', symbols: ['EUR/USD','GBP/USD','GOLD','CRUDEOIL'] },
      };
      for (const w of Object.values(this.watchlists)) await this.storage.set('watchlists', w.id, w);
    } else {
      for (const w of list) this.watchlists[w.id] = w;
      if (!this.watchlists.main) this.activeId = Object.keys(this.watchlists)[0];
    }
    await this._seedPrices();
    this.startTicks();
    this._emit('init');
    return this;
  }

  async _seedPrices() {
    const all = new Set();
    for (const w of Object.values(this.watchlists)) w.symbols.forEach(s => all.add(s));
    for (const s of all) {
      const info = await this.dataProvider.getSymbolInfo(s);
      this._symbolPrices[s] = { symbol: s, info, price: info?.basePrice ?? 100, prev: info?.basePrice ?? 100, change: 0, changePct: 0 };
    }
  }

  startTicks(ms = 1500) {
    this.stopTicks();
    this.timer = setInterval(async () => {
      const all = Object.keys(this._symbolPrices);
      for (const s of all) {
        const prev = this._symbolPrices[s]?.price;
        const p = await this.dataProvider.getTick(s, prev);
        const first = this._symbolPrices[s];
        const change = p - first.prev;
        const pct = first.prev ? 100 * change / first.prev : 0;
        this._symbolPrices[s] = { ...first, price: p, change, changePct: pct };
      }
      this._emit('tick');
    }, ms);
  }

  stopTicks() { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  list() { return Object.values(this.watchlists); }
  getActive() { return this.watchlists[this.activeId] || Object.values(this.watchlists)[0]; }
  setActive(id) { if (this.watchlists[id]) { this.activeId = id; this._emit('active'); return true; } return false; }
  getPrice(symbol) { return this._symbolPrices[symbol]; }
  allPrices() { return Object.values(this._symbolPrices); }

  async create(name) {
    const id = 'wl_' + Math.random().toString(36).slice(2,8);
    const w = { id, name: name || 'New Watchlist', symbols: [] };
    this.watchlists[id] = w;
    await this.storage.set('watchlists', id, w);
    this._emit('create');
    return w;
  }

  async rename(id, name) {
    const w = this.watchlists[id]; if (!w) return false;
    w.name = name;
    await this.storage.set('watchlists', id, w);
    this._emit('rename');
    return true;
  }

  async delete(id) {
    if (Object.keys(this.watchlists).length <= 1) return false;
    delete this.watchlists[id];
    await this.storage.remove('watchlists', id);
    if (this.activeId === id) this.activeId = Object.keys(this.watchlists)[0];
    this._emit('delete');
    return true;
  }

  async addSymbol(watchlistId, symbol) {
    const w = this.watchlists[watchlistId]; if (!w) return false;
    if (w.symbols.includes(symbol)) return false;
    w.symbols.push(symbol);
    if (!this._symbolPrices[symbol]) {
      const info = await this.dataProvider.getSymbolInfo(symbol);
      this._symbolPrices[symbol] = { symbol, info, price: info?.basePrice ?? 100, prev: info?.basePrice ?? 100, change: 0, changePct: 0 };
    }
    await this.storage.set('watchlists', watchlistId, w);
    this._emit('addSymbol');
    return true;
  }

  async removeSymbol(watchlistId, symbol) {
    const w = this.watchlists[watchlistId]; if (!w) return false;
    const i = w.symbols.indexOf(symbol); if (i<0) return false;
    w.symbols.splice(i,1);
    await this.storage.set('watchlists', watchlistId, w);
    this._emit('removeSymbol');
    return true;
  }

  async reorder(watchlistId, fromIdx, toIdx) {
    const w = this.watchlists[watchlistId]; if (!w) return false;
    const [item] = w.symbols.splice(fromIdx,1);
    w.symbols.splice(toIdx, 0, item);
    await this.storage.set('watchlists', watchlistId, w);
    this._emit('reorder');
    return true;
  }

  exportCSV(watchlistId) {
    const w = this.watchlists[watchlistId]; if (!w) return '';
    const rows = w.symbols.map(s => {
      const p = this._symbolPrices[s] || {};
      return { symbol: s, name: p.info?.name || '', exchange: p.info?.exchange || '',
        price: p.price, change: +(p.change||0).toFixed(2), changePct: +(p.changePct||0).toFixed(2) };
    });
    if (!rows.length) return 'symbol,name,exchange,price,change,changePct\n';
    const headers = Object.keys(rows[0]);
    const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
    return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
  }

  _emit(kind){ try { this.onChange?.(kind, this); } catch(err) { console.error('[TP ERROR] watchlist onChange:', err); } }
}
