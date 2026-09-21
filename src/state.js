// TradeLab — Reactive State Store
// Small pub/sub store with subscribe / select / mutate helpers. No framework.

export function createStore(initial) {
  let state = structuredClone(initial ?? {});
  const listeners = new Set();
  const selectors = new Map();
  let ticking = false;

  function getState() {
    return state;
  }

  function subscribe(fn, selector) {
    if (selector) selectors.set(fn, { fn, selector, last: selector(state) });
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
      selectors.delete(fn);
    };
  }

  function select(fn) {
    return fn(state);
  }

  function publish() {
    if (ticking) return;
    ticking = true;
    queueMicrotask(() => {
      ticking = false;
      for (const fn of listeners) {
        const sel = selectors.get(fn);
        if (!sel) { fn(state); continue; }
        const next = sel.selector(state);
        if (next !== sel.last && !shallowEqual(next, sel.last)) {
          sel.last = next;
          fn(next, state);
        }
      }
    });
  }

  function mutate(patch) {
    if (typeof patch === 'function') {
      patch(state);
    } else {
      Object.assign(state, patch);
    }
    publish();
    return state;
  }

  function replace(next) {
    state = structuredClone(next);
    publish();
    return state;
  }

  return { getState, subscribe, select, mutate, replace, _publish: publish };
}

function shallowEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (a[k] !== b[k]) return false;
  return true;
}

// Root initial state shape (per spec)
export const INITIAL_STATE = {
  router: { path: '/', params: {} },
  ui: {
    activeTool: 'pointer',
    color1: '#14b8a6',
    color2: '#f59e0b',
    opacity: 0.85,
    lineWidth: 2,
    leftPanelOpen: true,
    rightPanelOpen: true,
    rightPanelTab: 'watchlist',
    showGrid: true,
    showCrosshair: true,
    showVolume: true,
    showTooltip: true,
    chartType: 'candle',
    ribbonCollapsed: false,
    demoBadgeDismissed: false,
    mobileLeftSheet: false,
    mobileRightSheet: false,
    mobileDockCategory: null,
  },
  theme: { name: 'dark', accent: '#14b8a6', density: 'compact', animations: true },
  workspaces: [],
  currentWorkspaceId: null,
  charts: {},                // chartId -> chart metadata
  currentChartId: null,
  tabs: [],                  // [{id, chartId, symbol, timeframe, chartType, zoom:{panX,panY,zoom}, indicatorIds:[], drawingIds:[]}]
  activeTabId: null,
  drawings: {},              // drawingId -> drawing object
  watchlists: {},            // wlId -> { id, name, symbols:[...] }
  activeWatchlistId: 'main',
  setups: [],
  journal: [],
  files: { tree: [], selected: null, sort: 'name-asc', query: '' },
  indicators: {},            // per chartId indicator cache
  settings: {
    autosave: true,
    autosaveIntervalMs: 3000,
    confirmOnClose: true,
    defaultSymbol: 'NIFTY 50',
    defaultTimeframe: '5m',
    rememberLastTab: true,
    defaultDrawingColor: '#14b8a6',
    defaultLineWidth: 2,
    defaultOpacity: 0.85,
    snapToPriceLevels: false,
    autoSelectNewDrawings: true,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    candleStyle: 'filled',
    priceScaleDensity: 'normal',
    timeScaleDensity: 'normal',
    crosshairStyle: 'dashed',
  },
  saving: { status: 'saved', lastSavedAt: null },
  analysis: {
    mode: null, // 'long' | 'short' | null
    entry: null, stop: null, t1: null, t2: null, t3: null,
    account: 100000, riskPct: 1,
  },
};
