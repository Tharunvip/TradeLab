// TradeLab — Indicator math + IndicatorManager
// Math: EMA / SMA / WMA / VWAP / RSI / MACD / Stoch / Bollinger / ATR / OBV / Keltner
// Manager: add/remove/edit/hide/show, overlays and sub-panes, configurable settings

// -------- Pure math --------
export function sma(values, n) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    sum += v;
    if (i >= n) sum -= values[i - n] ?? 0;
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

export function ema(values, n) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) continue;
    if (prev == null) { if (i >= n - 1) prev = values.slice(i - n + 1, i + 1).reduce((a, b) => a + (b ?? 0), 0) / n; }
    else prev = k * v + (1 - k) * prev;
    if (i >= n - 1) out[i] = prev;
  }
  return out;
}

export function wma(values, n) {
  const out = new Array(values.length).fill(null);
  const denom = n * (n + 1) / 2;
  for (let i = n - 1; i < values.length; i++) {
    let sum = 0, w = n;
    for (let j = i; j > i - n; j--) sum += (values[j] ?? 0) * (w--);
    out[i] = sum / denom;
  }
  return out;
}

export function vwap(bars) {
  const out = new Array(bars.length).fill(null);
  let cumPV = 0, cumV = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const tp = (b.h + b.l + b.c) / 3;
    cumPV += tp * (b.v || 0);
    cumV += (b.v || 0);
    if (cumV) out[i] = cumPV / cumV;
  }
  return out;
}

export function rsi(bars, n = 14) {
  const values = bars.map(b => b.c);
  const out = new Array(values.length).fill(null);
  let gains = 0, losses = 0;
  for (let i = 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    if (i <= n) { gains += g; losses += l; if (i === n) { out[i] = (losses === 0 ? 100 : 100 - 100 / (1 + gains / losses)); } }
    else {
      gains = (gains * (n - 1) + g) / n;
      losses = (losses * (n - 1) + l) / n;
      out[i] = losses === 0 ? 100 : 100 - 100 / (1 + gains / losses);
    }
  }
  return out;
}

export function macd(bars, fast = 12, slow = 26, signal = 9) {
  const closes = bars.map(b => b.c);
  const f = ema(closes, fast);
  const s = ema(closes, slow);
  const line = f.map((x, i) => (x != null && s[i] != null) ? x - s[i] : null);
  const sig = ema(line.map(x => x ?? 0), signal);
  const hist = line.map((x, i) => (x != null && sig[i] != null) ? x - sig[i] : null);
  return { macd: line, signal: sig, histogram: hist };
}

export function stoch(bars, k = 14, d = 3, smooth = 3) {
  const rawK = new Array(bars.length).fill(null);
  for (let i = k - 1; i < bars.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - k + 1; j <= i; j++) { hi = Math.max(hi, bars[j].h); lo = Math.min(lo, bars[j].l); }
    rawK[i] = hi === lo ? 50 : 100 * (bars[i].c - lo) / (hi - lo);
  }
  const kLine = sma(rawK, smooth);
  const dLine = sma(kLine, d);
  return { k: kLine, d: dLine };
}

export function bollinger(bars, n = 20, k = 2) {
  const closes = bars.map(b => b.c);
  const mid = sma(closes, n);
  const up = new Array(bars.length).fill(null), low = new Array(bars.length).fill(null);
  for (let i = n - 1; i < bars.length; i++) {
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(s / n);
    up[i] = mid[i] + k * sd;
    low[i] = mid[i] - k * sd;
  }
  return { upper: up, middle: mid, lower: low };
}

export function atr(bars, n = 14) {
  const tr = new Array(bars.length).fill(null);
  for (let i = 1; i < bars.length; i++) {
    tr[i] = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
  }
  const out = new Array(bars.length).fill(null);
  let prev = null;
  for (let i = 1; i < bars.length; i++) {
    if (prev == null) { if (i >= n) prev = tr.slice(i - n + 1, i + 1).reduce((a,b)=>a+b,0)/n; }
    else prev = (prev * (n - 1) + tr[i]) / n;
    if (i >= n) out[i] = prev;
  }
  return out;
}

export function obv(bars) {
  const out = new Array(bars.length).fill(null);
  let running = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i > 0) {
      if (bars[i].c > bars[i - 1].c) running += (bars[i].v || 0);
      else if (bars[i].c < bars[i - 1].c) running -= (bars[i].v || 0);
    }
    out[i] = running;
  }
  return out;
}

export function keltner(bars, n = 20, mult = 2, atrN = 14) {
  const closes = bars.map(b => b.c);
  const mid = ema(closes, n);
  const a = atr(bars, atrN);
  const up = mid.map((v,i) => v != null && a[i] != null ? v + mult * a[i] : null);
  const low = mid.map((v,i) => v != null && a[i] != null ? v - mult * a[i] : null);
  return { upper: up, middle: mid, lower: low };
}

export const INDICATOR_REGISTRY = {
  ema:    { id:'ema',    category:'Trend',     label:'EMA',         overlay:true,  defaults:{length:20, source:'close', width:1.5, color:'#14b8a6'} },
  sma:    { id:'sma',    category:'Trend',     label:'SMA',         overlay:true,  defaults:{length:20, source:'close', width:1.5, color:'#f59e0b'} },
  wma:    { id:'wma',    category:'Trend',     label:'WMA',         overlay:true,  defaults:{length:20, source:'close', width:1.5, color:'#a78bfa'} },
  vwap:   { id:'vwap',   category:'Volume',    label:'VWAP',        overlay:true,  defaults:{width:1.4, color:'#22d3ee'} },
  bollinger:{id:'bollinger',category:'Volatility',label:'Bollinger Bands',overlay:true,defaults:{length:20, mult:2, width:1.3, color:'#f472b6'}},
  keltner:{ id:'keltner',category:'Volatility',label:'Keltner Channels',overlay:true,defaults:{length:20, atr:14, mult:2, width:1.2, color:'#818cf8'}},
  rsi:    { id:'rsi',    category:'Momentum',  label:'RSI',         overlay:false, defaults:{length:14, width:1.4, color:'#22d3ee'} },
  macd:   { id:'macd',   category:'Momentum',  label:'MACD',        overlay:false, defaults:{fast:12, slow:26, signal:9, width:1.4} },
  stoch:  { id:'stoch',  category:'Momentum',  label:'Stochastic',  overlay:false, defaults:{k:14, d:3, smooth:3, width:1.3} },
  atr:    { id:'atr',    category:'Volatility',label:'ATR',         overlay:false, defaults:{length:14, width:1.3, color:'#f59e0b'} },
  obv:    { id:'obv',    category:'Volume',    label:'OBV',         overlay:false, defaults:{width:1.3, color:'#34d399'} },
};

export class IndicatorManager {
  constructor({ chart, state, store, onChange }) {
    this.chart = chart;
    this.state = state;
    this.store = store;
    this.onChange = onChange || (()=>{});
    this.items = []; // [{id, type, settings, hidden}]
    this.recompute();
  }
  add(type, settings = {}) {
    const reg = INDICATOR_REGISTRY[type]; if (!reg) return null;
    const item = { id: 'ind_'+Math.random().toString(36).slice(2,10), type, settings: {...reg.defaults, ...settings}, hidden: false };
    this.items.push(item);
    this.recompute();
    this.onChange?.(item, 'add');
    return item;
  }
  remove(id) {
    const i = this.items.findIndex(x => x.id === id);
    if (i < 0) return false;
    const [it] = this.items.splice(i,1);
    this.recompute();
    this.onChange?.(it, 'remove');
    return true;
  }
  update(id, patch = {}) {
    const it = this.items.find(x => x.id === id); if (!it) return null;
    Object.assign(it.settings, patch.settings ?? {});
    if ('hidden' in patch) it.hidden = !!patch.hidden;
    this.recompute();
    this.onChange?.(it, 'update');
    return it;
  }
  list(){ return this.items.slice(); }
  clear(){ this.items = []; this.recompute(); }

  recompute() {
    const chart = this.chart;
    const bars = chart.bars || [];
    chart.overlays = [];
    chart.subpaneLayers = [];
    for (const it of this.items) {
      if (it.hidden) continue;
      this._apply(chart, bars, it);
    }
    chart._layout();
    chart.invalidate();
  }
  _apply(chart, bars, it) {
    const s = it.settings;
    const src = v => bars.map(b => b[v] ?? b.c);
    switch (it.type) {
      case 'ema': case 'sma': case 'wma': {
        const vals = it.type === 'ema' ? ema(src('c'), s.length) : it.type === 'sma' ? sma(src('c'), s.length) : wma(src('c'), s.length);
        chart.overlays.push({ color: s.color, width: s.width, data: vals.map((y,i)=>({ y, i })) });
        break;
      }
      case 'vwap': {
        const v = vwap(bars);
        chart.overlays.push({ color: s.color, width: s.width, data: v.map((y,i)=>({ y, i })) });
        break;
      }
      case 'bollinger': {
        const r = bollinger(bars, s.length, s.mult);
        for (const [k,v] of Object.entries(r)) chart.overlays.push({ color: s.color, width: s.width, data: v.map((y,i)=>({ y, i })) });
        break;
      }
      case 'keltner': {
        const r = keltner(bars, s.length, s.mult, s.atr);
        for (const [k,v] of Object.entries(r)) chart.overlays.push({ color: s.color, width: s.width, data: v.map((y,i)=>({ y, i })) });
        break;
      }
      case 'rsi': {
        const r = rsi(bars, s.length);
        chart.subpaneLayers.push({
          label: `RSI (${s.length})`,
          bands: [{ level: 70, color: 'var(--red,#ef4444)' }, { level: 30, color: 'var(--green,#10b981)' }, { level: 50, color: 'var(--muted,#7a8796)' }],
          series: [{ label: 'RSI', color: s.color, width: s.width, data: r.map(y => ({ y })), min: 0, max: 100 }]
        });
        break;
      }
      case 'macd': {
        const { macd: ml, signal: sl, histogram: hl } = macd(bars, s.fast, s.slow, s.signal);
        const mmax = Math.max(1, ...ml.concat(sl).concat(hl).filter(v=>v!=null).map(v=>Math.abs(v)));
        chart.subpaneLayers.push({
          label: `MACD (${s.fast},${s.slow},${s.signal})`,
          series: [
            { label: 'MACD',   color: s.color || '#14b8a6', width: s.width, data: ml.map(y=>({y})), min: -mmax, max: mmax },
            { label: 'Signal', color: '#f59e0b', width: s.width, data: sl.map(y=>({y})), min: -mmax, max: mmax },
          ],
          histogram: { data: hl.map(y=>({y})), min: -mmax, max: mmax, positive: 'var(--green,#10b981)aa', negative: 'var(--red,#ef4444)aa' }
        });
        break;
      }
      case 'stoch': {
        const { k: kL, d: dL } = stoch(bars, s.k, s.d, s.smooth);
        chart.subpaneLayers.push({
          label: `Stoch (${s.k},${s.d},${s.smooth})`,
          bands: [{ level: 80, color: 'var(--red,#ef4444)' }, { level: 20, color: 'var(--green,#10b981)' }],
          series: [
            { label: '%K', color: s.color || '#14b8a6', width: s.width, data: kL.map(y=>({y})), min: 0, max: 100 },
            { label: '%D', color: '#f59e0b', width: s.width, data: dL.map(y=>({y})), min: 0, max: 100 },
          ]
        });
        break;
      }
      case 'atr': {
        const a = atr(bars, s.length);
        const mx = Math.max(1, ...a.filter(v=>v!=null));
        chart.subpaneLayers.push({ label: `ATR (${s.length})`, series: [{ color: s.color, width: s.width, data: a.map(y=>({y})), min: 0, max: mx*1.1 }] });
        break;
      }
      case 'obv': {
        const v = obv(bars);
        const mn = Math.min(...v.filter(x=>x!=null)), mx = Math.max(...v.filter(x=>x!=null));
        chart.subpaneLayers.push({ label: `OBV`, series: [{ color: s.color, width: s.width, data: v.map(y=>({y})), min: mn, max: mx }] });
        break;
      }
    }
  }
}
