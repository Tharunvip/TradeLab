// TradeLab — Demo Data Provider
// Clean provider interface so real market-data API can replace this exactly later.
// Seeded with 20+ realistic symbols. DEMO DATA clearly labeled everywhere.

const SYMBOLS = [
  // Indices
  { symbol: 'NIFTY 50',    name: 'Nifty 50',              exchange: 'NSE',     type: 'INDEX',     basePrice: 24810,  volatility: 0.0085 },
  { symbol: 'BANK NIFTY',  name: 'Nifty Bank',             exchange: 'NSE',     type: 'INDEX',     basePrice: 51400,  volatility: 0.011 },
  { symbol: 'SENSEX',      name: 'BSE Sensex',             exchange: 'BSE',     type: 'INDEX',     basePrice: 81300,  volatility: 0.008 },
  { symbol: 'NASDAQ',      name: 'NASDAQ Composite',       exchange: 'NASDAQ',  type: 'INDEX',     basePrice: 17850,  volatility: 0.012 },
  { symbol: 'S&P 500',     name: 'S&P 500',                exchange: 'NYSE',    type: 'INDEX',     basePrice: 5530,   volatility: 0.009 },
  // Stocks
  { symbol: 'RELIANCE',    name: 'Reliance Industries',    exchange: 'NSE',     type: 'STOCK',     basePrice: 1420,   volatility: 0.013 },
  { symbol: 'TCS',         name: 'Tata Consultancy Svcs',  exchange: 'NSE',     type: 'STOCK',     basePrice: 3880,   volatility: 0.010 },
  { symbol: 'INFY',        name: 'Infosys',                exchange: 'NSE',     type: 'STOCK',     basePrice: 1850,   volatility: 0.012 },
  { symbol: 'HDFCBANK',    name: 'HDFC Bank',              exchange: 'NSE',     type: 'STOCK',     basePrice: 1680,   volatility: 0.011 },
  { symbol: 'AAPL',        name: 'Apple Inc.',             exchange: 'NASDAQ',  type: 'STOCK',     basePrice: 222,    volatility: 0.014 },
  { symbol: 'TSLA',        name: 'Tesla Inc.',             exchange: 'NASDAQ',  type: 'STOCK',     basePrice: 248,    volatility: 0.033 },
  { symbol: 'NVDA',        name: 'NVIDIA Corp.',           exchange: 'NASDAQ',  type: 'STOCK',     basePrice: 112,    volatility: 0.030 },
  // Crypto
  { symbol: 'BTC/USD',     name: 'Bitcoin / USD',          exchange: 'CRYPTO',  type: 'CRYPTO',    basePrice: 63400,  volatility: 0.022 },
  { symbol: 'ETH/USD',     name: 'Ethereum / USD',         exchange: 'CRYPTO',  type: 'CRYPTO',    basePrice: 3150,   volatility: 0.028 },
  { symbol: 'SOL/USD',     name: 'Solana / USD',           exchange: 'CRYPTO',  type: 'CRYPTO',    basePrice: 148,    volatility: 0.038 },
  // Forex
  { symbol: 'EUR/USD',     name: 'Euro / US Dollar',       exchange: 'FX',      type: 'FOREX',     basePrice: 1.087,  volatility: 0.0035 },
  { symbol: 'GBP/USD',     name: 'Pound / US Dollar',      exchange: 'FX',      type: 'FOREX',     basePrice: 1.266,  volatility: 0.0045 },
  { symbol: 'USD/JPY',     name: 'US Dollar / Yen',        exchange: 'FX',      type: 'FOREX',     basePrice: 156.40, volatility: 0.0055 },
  // Commodities
  { symbol: 'GOLD',        name: 'Gold (COMEX)',           exchange: 'COMEX',   type: 'COMMODITY', basePrice: 2338,   volatility: 0.0078 },
  { symbol: 'SILVER',      name: 'Silver (COMEX)',         exchange: 'COMEX',   type: 'COMMODITY', basePrice: 28.5,   volatility: 0.018 },
  { symbol: 'CRUDEOIL',    name: 'Crude Oil WTI',          exchange: 'NYMEX',   type: 'COMMODITY', basePrice: 72.4,   volatility: 0.020 },
];

const TF_STEPS = {
  '1m':   { bars: 180, stepMs: 60 * 1000,          volMul: 0.5 },
  '3m':   { bars: 150, stepMs: 3 * 60 * 1000,      volMul: 0.7 },
  '5m':   { bars: 120, stepMs: 5 * 60 * 1000,      volMul: 0.85 },
  '15m':  { bars: 100, stepMs: 15 * 60 * 1000,     volMul: 1.1 },
  '30m':  { bars: 84,  stepMs: 30 * 60 * 1000,     volMul: 1.4 },
  '1H':   { bars: 60,  stepMs: 60 * 60 * 1000,     volMul: 1.8 },
  '2H':   { bars: 48,  stepMs: 2 * 60 * 60 * 1000, volMul: 2.3 },
  '4H':   { bars: 42,  stepMs: 4 * 60 * 60 * 1000, volMul: 3.0 },
  '1D':   { bars: 280, stepMs: 24 * 60 * 60 * 1000,volMul: 6.0 },
  '1W':   { bars: 260, stepMs: 7 * 24 * 60 * 60 * 1000, volMul: 14.0 },
  '1M':   { bars: 240, stepMs: 30 * 24 * 60 * 60 * 1000,volMul: 30.0 },
};

// Seeded RNG for reproducible symbols
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const dataProvider = {
  async listSymbols() { return SYMBOLS.map(s => ({...s})); },

  async searchSymbols(q) {
    const query = (q ?? '').toLowerCase().trim();
    if (!query) return SYMBOLS.slice(0, 12).map(s => ({...s}));
    return SYMBOLS
      .filter(s =>
        s.symbol.toLowerCase().includes(query) ||
        s.name.toLowerCase().includes(query) ||
        s.exchange.toLowerCase().includes(query))
      .map(s => ({...s}));
  },

  async getSymbolInfo(symbol) {
    return SYMBOLS.find(s => s.symbol === symbol) ?? null;
  },

  async getBars(symbol, timeframe = '5m', from, to) {
    const s = SYMBOLS.find(x => x.symbol === symbol);
    if (!s) return [];
    const tf = TF_STEPS[timeframe] ?? TF_STEPS['5m'];
    const { bars, stepMs, volMul } = tf;
    const rand = mulberry32(hashSeed(symbol + '|' + timeframe));
    const end = to ? new Date(to).getTime() : Date.now();
    const start = end - bars * stepMs;
    let price = s.basePrice * (0.97 + rand() * 0.06); // drift start
    const out = [];
    for (let i = 0; i < bars; i++) {
      const t = start + i * stepMs;
      const wave = Math.sin(i / 6) * s.volatility * 0.3 * s.basePrice;
      const drift = (rand() - 0.48) * s.volatility * s.basePrice * volMul * 0.15;
      const o = price + drift + wave * 0.1;
      const body = (rand() - 0.35) * s.volatility * s.basePrice * volMul * 0.6;
      const c = o + body;
      const hiExt = rand() * s.volatility * s.basePrice * volMul * 0.35;
      const loExt = rand() * s.volatility * s.basePrice * volMul * 0.35;
      const h = Math.max(o, c) + hiExt;
      const l = Math.min(o, c) - loExt;
      const v = Math.round(400 + rand() * 1600 * volMul);
      out.push({ time: t, o, h, l, c, v });
      price = c;
    }
    return out;
  },

  // A single price tick for watchlist simulation
  async getTick(symbol, prev) {
    const s = SYMBOLS.find(x => x.symbol === symbol);
    if (!s) return prev ?? 0;
    const base = prev ?? s.basePrice;
    const delta = (Math.random() - 0.5) * s.volatility * base * 0.005;
    return +(base + delta).toFixed(base < 10 ? 4 : 2);
  },

  tfList() { return Object.keys(TF_STEPS); },
  isSupported(symbol) { return !!SYMBOLS.find(x => x.symbol === symbol); },
};

export default dataProvider;
