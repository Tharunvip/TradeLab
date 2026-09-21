// TradeLab — Shell UI
// Renders: Landing page, application shell (titlebar/menubar/ribbon/explorer/
// chart/inspector/statusbar), feature screens, and modals. Listens for
// 'tp:action' events fired by app.js shortcut handlers and provides TP.actions.

import { ChartEngine, formatPrice, formatVol, formatTime } from './chart.js';
import { DrawingManager, TOOL_CATEGORIES, toolLabel } from './drawings.js';
import { IndicatorManager, INDICATOR_REGISTRY } from './indicators.js';
import { computeAnalysis, validateAnalysis } from './trade-analysis.js';
import { openModal, showToast, confirmDialog, downloadBlob, toCSV } from './ui.js';
import { IS_MAC } from './shortcuts.js';
import { JOURNAL_STATUSES } from './journal.js';

// ---------------- tiny DOM helpers ----------------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'data' && typeof v === 'object') Object.assign(el.dataset, v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = ts => { const d = new Date(ts); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
const fmtTimeShort = ts => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const fmtNum = (n, d = 2) => (n == null ? '—' : (+n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: d }));

// ---------------- app shell state (per-render instance) ----------------
let shell = {
  ctx: null, chart: null, drawings: null, indicators: null, canvas: null,
  unsubs: [], ro: null, host: null,
};

function destroyShell() {
  for (const u of shell.unsubs) { try { u(); } catch {} }
  shell.unsubs = [];
  shell.chart?.destroy?.();
  shell.drawings = shell.indicators = shell.chart = null;
  shell.ro?.disconnect?.(); shell.ro = null;
}

// ================= LANDING PAGE =================
export function renderLanding(ctx) {
  destroyShell();
  const root = document.getElementById('app');
  root.innerHTML = '';
  const dp = ctx.dataProvider;
  const app = h('div', { class: 'tp-landing' });

  const nav = h('header', { class: 'tp-landing-nav' },
    h('div', { class: 'tp-landing-nav__brand' }, hSpan(ctx.LOGO_SVG), h('div', { class: 'tp-landing-nav__name' },
      h('strong', { class: 'tp-brand-name' }, 'TradeLab'),
      h('span', { class: 'tp-landing-nav__badge' }, 'DEMO DATA'))),
    h('nav', { class: 'tp-landing-nav__links' },
      h('a', { class: 'tp-link', href: '#/workspace' }, 'Workspace'),
      h('a', { class: 'tp-link', href: '#/watchlist' }, 'Watchlist'),
      h('a', { class: 'tp-link', href: '#/setups' }, 'Setups'),
      h('a', { class: 'tp-link', href: '#/journal' }, 'Journal'),
      h('a', { class: 'tp-link', href: '#/help' }, 'Help')),
    h('button', { class: 'tp-btn tp-btn--primary', onclick: () => ctx.router.go('/workspace') }, 'Launch App'));

  const hero = h('section', { class: 'tp-hero' },
    h('div', { class: 'tp-hero__copy' },
      h('div', { class: 'tp-hero__eyebrow' }, 'Professional charting workspace'),
      h('h1', { class: 'tp-hero__title' }, h('span', {}, 'Draw. Analyze.'), ' ', h('span', { class: 'tp-hero__accent' }, 'Plan. Trade Smarter.')),
      h('p', { class: 'tp-hero__sub' }, 'A complete trading workspace in your browser — multi-chart canvas, 26+ drawing tools, indicators, workspaces, watchlists, trade analysis, and a research journal. Everything runs locally. No accounts, no fees.'),
      h('div', { class: 'tp-hero__actions' },
        h('button', { class: 'tp-btn tp-btn--primary tp-btn--lg', onclick: () => ctx.router.go('/workspace') }, 'Open Workspace →'),
        h('a', { class: 'tp-btn tp-btn--ghost tp-btn--lg', href: '#/help' }, 'View Shortcuts'),
        h('span', { class: 'tp-hero__hint' }, '⌘/Ctrl + K — Command palette')),
      h('div', { class: 'tp-hero__demo' }, hSpan(ctx.LOGO_SVG), ' Powered by synthetic DEMO DATA — perfect for paper trading and backtesting setups.')),
    h('div', { class: 'tp-hero__stage' }, h('div', { class: 'tp-hero__chartstage', }, miniChart(ctx))));

  const why = h('section', { class: 'tp-section tp-section--alt' },
    h('div', { class: 'tp-section__head' },
      h('h2', {}, 'Everything you need to plan a trade'),
      h('p', { class: 'tp-section__sub' }, 'Built for screen-based traders who live in the chart window — fast, keyboard-driven, and completely yours.')),
    h('div', { class: 'tp-feature-grid' },
      fCard('🎯', '26+ Drawing Tools', 'Trends, channels, fibs, zones, position tools and annotations — all editable, lockable, layered, and undo-able.'),
      fCard('📊', 'Indicators', 'EMA, SMA, VWAP, Bollinger, RSI, MACD, Stoch, ATR and more — overlay and sub-pane, fully configurable.'),
      fCard('💼', 'Trade Analysis', 'Position sizing, risk & reward, targets, and visible long/short plans drawn right on the chart.'),
      fCard('🗂️', 'Workspaces & Tabs', 'Multiple workspaces, chart tabs per symbol and timeframe, saved and auto-synced to your browser storage.'),
      fCard('📓', 'Journal & Setups', 'Track every idea, planning call, live trade and review. Journal stats stay with your own data.'),
      fCard('🔍', 'Watchlists', 'Live-updating demo watchlists with working symbol search and one-click chart jumps.')));

  const workflow = h('section', { class: 'tp-section' },
    h('div', { class: 'tp-section__head' },
      h('h2', {}, 'From idea to execution — in one window'),
      h('p', { class: 'tp-section__sub' }, 'A simple loop that keeps your process honest.')),
    h('div', { class: 'tp-steps' },
      step('1', 'Scan', 'Browse watchlists, search any symbol, switch timeframes instantly.'),
      step('2', 'Draw', 'Mark structure with trend lines, fibs, and zones. Everything stays editable.'),
      step('3', 'Plan', 'Build a long/short plan with entry, stop, and targets; compute risk and size.'),
      step('4', 'Review', 'Save the setup, journal the result, and let the numbers keep score.')));

  const features = h('section', { class: 'tp-section tp-section--alt' },
    h('div', { class: 'tp-section__head' }, h('h2', {}, 'Made for screen', ), h('p', { class: 'tp-section__sub' }, 'Dense, fast, and respectful of your desk space.')),
    h('div', { class: 'tp-feature-col' },
      listItem('⌨️', 'Keyboard first', 'Every tool has a shortcut. Ctrl+K for commands, F1 shortcuts reference.'),
      listItem('🧊', 'Layered drawings', 'Reorder, lock, hide, restyle, and duplicate any object — with full undo/redo.'),
      listItem('📸', 'Share ready', 'Export charts as PNG or the workspace as JSON; import workspaces back.'),
      listItem('🖥️', 'Responsive', 'Three-panel desktop layout, collapsible panels, and a bottom dock on mobile.'),
      listItem('🌓', 'Themes', 'Dark, light, and system themes with an accent picker and density control.')));

  const shots = h('section', { class: 'tp-section' },
    h('div', { class: 'tp-section__head' }, h('h2', {}, 'In action'), ),
    h('div', { class: 'tp-shots' },
      shot(`${ctx.LOGO_SVG}`, 'Chart canvas with candles, indicators, and layered drawings'),
      shot('📊', 'Watchlists that jump straight into the chart'),
      shot('🎯', 'Trade plans with risk/reward drawn on screen')));

  const cta = h('section', { class: 'tp-cta' },
    h('h2', {}, 'Start trading your process, not your impulses.'),
    h('p', {}, 'Launch the workspace. Draw your first plan in under a minute.'),
    h('button', { class: 'tp-btn tp-btn--primary tp-btn--lg', onclick: () => ctx.router.go('/workspace') }, 'Launch TradeLab'));

  const footer = h('footer', { class: 'tp-landing-footer' },
    h('div', { class: 'tp-landing-footer__inner' },
      h('div', { class: 'tp-landing-nav__brand' }, hSpan(ctx.LOGO_SVG), h('strong', { class: 'tp-brand-name' }, 'TradeLab')),
      h('p', {}, 'Demo application. All chart data is synthetic and clearly labeled. Not financial advice.'),
      h('p', { class: 'tp-landing-footer__links' },
        h('a', { href: '#/workspace' }, 'Workspace'), ' · ',
        h('a', { href: '#/settings' }, 'Settings'), ' · ',
        h('a', { href: '#/help' }, 'Help & Shortcuts'))));

  app.append(nav, hero, why, workflow, features, shots, cta, footer);
  root.append(app);
}

function hSpan(html) { const el = h('span', { class: 'tp-logo-mount' }); el.innerHTML = html; return el; }
function fCard(icon, title, body) {
  return h('article', { class: 'tp-feature-card' }, h('div', { class: 'tp-feature-card__icon' }, icon), h('h3', {}, title), h('p', {}, body));
}
function listItem(icon, title, body) {
  return h('div', { class: 'tp-feature-item' }, h('span', { class: 'tp-feature-item__icon' }, icon), h('div', {}, h('strong', {}, title), h('p', {}, body)));
}
function step(n, title, body) {
  return h('div', { class: 'tp-step' }, h('div', { class: 'tp-step__num' }, n), h('div', {}, h('h3', {}, title), h('p', {}, body)));
}
function shot(media, caption) {
  const frame = h('div', { class: 'tp-shot' }, h('div', { class: 'tp-shot__media tp-shot__media--sym' }, media));
  frame.append(h('p', { class: 'tp-shot__caption' }, caption));
  return frame;
}

// Mini animated chart for the landing hero (logo-red, decorative)
function miniChart(ctx) {
  const wrap = h('div', { class: 'tp-minichart' });
  const canvas = h('canvas');
  wrap.append(canvas);
  let c = new ChartEngine(canvas, { getBars: (s, tf) => ctx.dataProvider.getBars('BTC/USD', '1H'), ui: { grid: true, crosshair: false, volume: true, tooltip: false }, demo: true });
  c.loadBars({ symbol: 'BTC/USD', timeframe: '1H' });
  registerTick((dt) => {
    const bars = c.bars;
    if (!bars.length) return;
    const last = bars[bars.length - 1];
    const b = { ...last, time: Date.now(), o: last.c,
      c: last.c * (1 + (Math.random() - 0.49) * 0.006),
      h: 0, l: 0, v: Math.round(last.v * (0.8 + Math.random() * 0.6)) };
    b.h = Math.max(b.o, b.c) * 1.003; b.l = Math.min(b.o, b.c) * 0.997;
    bars.push(b);
    if (bars.length > 240) bars.shift();
    c.visStart += 1; c._clampView(); c.invalidate();
    if (dt > 40000) c.loadBars({ keepView: false });
  }, 1400, 40);
  return wrap;
}

// lightweight tick registry for decorative widgets
const tickers = [];
function registerTick(fn, interval, maxRuns) {
  let runs = 0;
  const t = setInterval(() => { runs++; if (runs > (maxRuns ?? 60)) return clearInterval(t); fn(runs); }, interval);
  tickers.push(() => clearInterval(t));
}
window.addEventListener('pagehide', () => { for (const c of tickers.splice(0)) c(); });

// ================= WORKSPACE SHELL =================
export async function renderWorkspace(ctx) {
  destroyShell();
  const root = document.getElementById('app');
  root.innerHTML = '';
  shell.ctx = ctx;
  const store = ctx.store;
  const workspace = ctx.workspace;
  const dp = ctx.dataProvider;
  const w = workspace.current;
  if (window.innerWidth <= 860 && store.getState().ui.leftPanelOpen) {
    store.mutate(s => { s.ui.leftPanelOpen = false; s.ui.rightPanelOpen = false; });
  }

  ensureTabExtras(w);

  // ---- actions dispatch table (also invoked by tp:action events) ----
  const acts = {
    'new-workspace': async () => { const nw = await workspace.create(); ctx.router.go('/workspace'); showToast(`Workspace "${nw.name}" created`); },
    'save': async () => { persistTab(); const s = await workspace.saveCurrent(); if (s) showToast('Workspace saved', { kind: 'success' }); },
    'save-as': () => exportWorkspaceFile(ctx),
    'open': () => importWorkspaceFile(ctx),
    'undo': () => { const l = ctx.history.undo(); showToast(l ? `Undo: ${l}` : 'Nothing to undo', { timeout: 1200 }); },
    'redo': () => { const l = ctx.history.redo(); showToast(l ? `Redo: ${l}` : 'Nothing to redo', { timeout: 1200 }); },
    'delete': () => { const seld = shell.drawings?.selected(); if (seld) { shell.drawings.remove(seld.id); persistTab(); drawLayers(); } },
    'escape': () => { shell.drawings?.deselect(); closeMenus(); },
    'cmd-palette': () => cmdPalette(ctx),
    'shortcuts': () => createShortcutsModal(ctx),
    'fullscreen': () => { if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(()=>{}); else document.exitFullscreen?.(); },
    'zoom-reset': () => shell.chart?.resetZoom(),
    'zoom-in': () => shell.chart?.zoomIn(),
    'zoom-out': () => shell.chart?.zoomOut(),
    'symbol-search': () => symbolSearchModal(ctx),
    'indicators': () => indicatorsModal(ctx),
    'analysis': () => openAnalysisTab(),
    'position-long': () => { setTool('long_position'); },
    'position-short': () => { setTool('short_position'); },
    'snapshot': () => snapshotPNG(ctx),
    'export-json': () => exportWorkspaceFile(ctx),
    'toggle-explorer': () => store.mutate(s => { s.ui.leftPanelOpen = !s.ui.leftPanelOpen; }),
    'toggle-inspector': () => store.mutate(s => { s.ui.rightPanelOpen = !s.ui.rightPanelOpen; }),
    'grid-t': () => { store.mutate(s => { s.ui.showGrid = !s.ui.showGrid; }); if (shell.chart) { shell.chart.ui.grid = store.getState().ui.showGrid; shell.chart.invalidate(); } },
    'focus-symbol': () => symbolSearchModal(ctx),
    'go-workspaces': () => ctx.router.go('/workspaces'),
    'go-watchlist': () => ctx.router.go('/watchlist'),
    'go-setups': () => ctx.router.go('/setups'),
    'go-journal': () => ctx.router.go('/journal'),
    'go-settings': () => ctx.router.go('/settings'),
    'go-help': () => ctx.router.go('/help'),
    'go-landing': () => ctx.router.go('/landing'),
  };

  const fire = (id) => { try { acts[id]?.(); } catch (err) { console.error('[TP ERROR] action:', id, err); showToast('Action failed', { kind: 'error' }); } };
  window.TP = window.TP || {};
  window.TP.actions = acts;

  // ---- chart + managers ----
  const canvas = h('canvas', { class: 'tp-chart-canvas' });
  shell.canvas = canvas;
  const host = h('div', { class: 'tp-chart-host' }, canvas);
  shell.host = host;

  const chart = new ChartEngine(canvas, {
    getBars: (s, tf) => dp.getBars(s, tf),
    demo: true,
  });
  shell.chart = chart;
  chart.ui = {
    grid: store.getState().ui.showGrid !== false,
    crosshair: store.getState().ui.showCrosshair !== false,
    volume: store.getState().ui.showVolume !== false,
    tooltip: store.getState().ui.showTooltip !== false,
    candleStyle: store.getState().settings.candleStyle || 'filled',
  };
  const drawings = new DrawingManager({
    chart, state: store, store,
    history: ctx.history,
    onChange: (kind) => { if (kind !== 'select') { persistTab(); drawLayers(); } else syncPropsPanel(); shell._statusUpdater?.(); },
  });
  const indicators = new IndicatorManager({ chart, state: store, store, onChange: () => { persistTab(); drawLayers(); shell._statusUpdater?.(); } });
  const onHistory = ctx.history.on(() => { drawLayers(); syncPropsPanel(); shell._statusUpdater?.(); });
  shell.unsubs.push(onHistory);
  shell.drawings = drawings;
  shell.indicators = indicators;

  // (tab helpers live at module scope so modals/screens can reuse them)

  // ---- titlebar / menubar / ribbon ----
  const titlebar = h('header', { class: 'tp-titlebar' },
    h('div', { class: 'tp-titlebar__brand', onclick: () => ctx.router.go('/landing') }, hSpan(ctx.LOGO_SVG),
      h('span', { class: 'tp-brand-name' }, 'TradeLab'),
      h('span', { class: 'tp-titlebar__ws' }, w.name || '') ),
    h('div', { class: 'tp-titlebar__tabs', id: 'tp-title-tabs' }),
    h('div', { class: 'tp-titlebar__right' },
      h('button', { class: 'tp-iconbtn', onclick: () => setTool('pointer') }, '↖'),
      h('button', { class: 'tp-iconbtn', onclick: () => acts.undo() }, '↶'),
      h('button', { class: 'tp-iconbtn', onclick: () => acts.redo() }, '↷'),
      h('button', { class: 'tp-iconbtn', onclick: () => acts['symbol-search']() }, '⌕'),
      h('button', { class: 'tp-iconbtn', onclick: () => snapshotPNG(ctx) }, '📸'),
      h('button', { class: 'tp-iconbtn', onclick: () => ctx.router.go('/workspaces') }, '🗂'),
      h('button', { class: 'tp-iconbtn', onclick: () => routerHome(ctx) }, '🏠')));

  const menubar = buildMenubar(ctx, fire);

  const ribbon = h('div', { class: 'tp-ribbon', id: 'tp-ribbon' });

  const explorer = buildExplorer(ctx, { loadSymbol: changeSymbol, fire });
  const center = h('main', { class: 'tp-center' },
    h('div', { class: 'tp-chartbar', id: 'tp-chartbar' }),
    host,
    h('div', { class: 'tp-crumb', id: 'tp-crumb' }));

  const inspector = buildInspector(ctx, { changeSymbol, fire });
  const body = h('div', { class: 'tp-body' }, explorer, center, inspector);
  const statusbar = buildStatusbar(ctx, chart, drawings);
  const mobileDock = buildMobileDock(ctx, fire, setTool);
  const app = h('div', { class: 'tp-shell-workspace' }, titlebar, menubar, ribbon, body, statusbar, mobileDock);
  root.append(app);

  // ---- subscriptions ----
  shell.unsubs.push(store.subscribe((s) => {
    updateSaveStatus();
    shell._statusUpdater?.();
    document.querySelectorAll('.tp-savestatus').forEach(el => { el.textContent = s.saving?.status === 'saved' ? 'Saved' : s.saving?.status === 'saving' ? 'Saving…' : 'Unsaved'; });
    document.querySelectorAll('.tp-panel-toggle').forEach(b => {
      if (b.dataset.side === 'left') b.classList.toggle('is-on', !!s.ui.leftPanelOpen);
      if (b.dataset.side === 'right') b.classList.toggle('is-on', !!s.ui.rightPanelOpen);
    });
    const ws = document.querySelector('.tp-shell-workspace');
    if (ws) { ws.classList.toggle('tp-left-closed', !s.ui.leftPanelOpen); ws.classList.toggle('tp-right-closed', !s.ui.rightPanelOpen); }
  }));

  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(host);
  shell.ro = ro;

  // chart tooltip / hover handoff
  chart.onHover = (pos, bar) => {
    const el = document.getElementById('tp-status-price');
    if (el) el.textContent = bar ? `${formatPrice(bar.c)}   O ${formatPrice(bar.o)}  H ${formatPrice(bar.h)}  L ${formatPrice(bar.l)}` : textOf;
  };
  chart.onRangeChange = (r) => {
    const z = document.getElementById('tp-status-zoom');
    if (z) z.textContent = `${r.end - r.start} bars view`;
  };

  // global tp:action listener for shortcut events
  const onAction = (e) => fire(e.detail);
  window.addEventListener('tp:action', onAction);
  shell.unsubs.push(() => window.removeEventListener('tp:action', onAction));

  // tp:tool-changed from app.js letter shortcuts
  const onTool = (e) => setTool(e.detail);
  window.addEventListener('tp:tool-changed', onTool);
  shell.unsubs.push(() => window.removeEventListener('tp:tool-changed', onTool));

  // boot
  const first = tab() || tabs()[0];
  await loadTab(first, { scrollToEnd: true });
  renderRibbon();
  setupDragDrop();
  if (ctx.watchlist) ctx.watchlist.onChange = (kind) => { if (kind === 'tick') { const el = document.getElementById('tp-watchlist-rows'); if (el) drawWatchlist(); } };
}

function routerHome(ctx) { ctx.router.go('/workspace'); }
function textOf() { return ''; }

// ---------------- menubar ----------------
function buildMenubar(ctx, fire) {
  const menus = [
    { label: 'File', items: [
      ['new-workspace', 'New Workspace', 'Ctrl+N'], ['open', 'Open…', 'Ctrl+O'], ['save', 'Save', 'Ctrl+S'], ['save-as', 'Save As…', 'Ctrl+Shift+S'], '-',
      ['export-json', 'Export Workspace (.json)'], ['importFile', 'Import Workspace…'], ['snapshot', 'Export Chart as PNG'], '-', ['go-landing', 'Exit to Landing']] },
    { label: 'Edit', items: [
      ['undo', 'Undo', 'Ctrl+Z'], ['redo', 'Redo', 'Ctrl+Y'], ['redo', 'Redo (Alt)', 'Ctrl+Shift+Z'], '-',
      ['duplicateSel', 'Duplicate Selected'], ['delete', 'Delete Selected', 'Del'], '-', ['go-settings', 'Settings']] },
    { label: 'View', items: [
      ['toggle-explorer', 'Toggle Explorer'], ['toggle-inspector', 'Toggle Inspector'], ['symbol-search', 'Symbol Search…', '⌕'], ['cmd-palette', 'Command Palette', 'Ctrl+K'], ['shortcuts', 'Keyboard Shortcuts', 'Ctrl+/'],
      ['fullscreen', 'Fullscreen', 'F'], '-', ['zoom-reset', 'Zoom 100%', '0'], ['zoom-in', 'Zoom In', '='], ['zoom-out', 'Zoom Out', '-']] },
    { label: 'Chart', items: [
      ['symbol-search', 'Change Symbol…'], ['tf-modal', 'Timeframe ▸', null, true], ['type-modal', 'Chart Type ▸', null, true], '-', ['indicators', 'Indicators…'], '-', ['position-long', 'Place Long Plan'], ['position-short', 'Place Short Plan'], ['analysis', 'Trade Analysis']] },
    { label: 'Tools', items: TOOL_CATEGORIES.flatMap(cat => [{ label: cat.label, head: true }, ...cat.tools.map(t => [`tool:${t.id}`, t.label, shortcutForTool(t.id)])]) },
    { label: 'Window', items: [
      ['go-workspaces', 'Workspaces'], ['go-watchlist', 'Watchlists'], ['go-setups', 'Setups'], ['go-journal', 'Journal'], '-', ['go-help', 'Help & Shortcuts']] },
    { label: 'Help', items: [
      ['cmd-palette', 'Command Palette', 'Ctrl+K'], ['shortcuts', 'Keyboard Shortcuts', 'Ctrl+/'], '-', ['go-landing', 'About TradeLab'], ['snapshot', 'Export Chart PNG']] },
  ];
  const bar = h('nav', { class: 'tp-menubar' });
  for (const m of menus) {
    const b = h('button', { class: 'tp-menu-btn', onclick: (e) => toggleMenu(bar, m, b, e) }, m.label);
    bar.append(b);
  }
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.tp-menu')) closeMenus(); }, { capture: true });
  return bar;
}
function shortcutForTool(id) {
  const map = { pointer: 'V', crosshair: 'C', pan: 'H', zoom: 'Z', pencil: 'P', brush: 'B', eraser: 'E', text: 'T', trendline: 'L', rect: 'R', circle: 'O', arrow: 'A', fib_retrace: 'G' };
  return map[id] || '';
}
function toggleMenu(bar, m, btn, e) {
  e?.stopPropagation();
  closeMenus();
  document.querySelectorAll('.tp-menubar .tp-menu-btn').forEach(x => x.classList.remove('is-open'));
  btn.classList.add('is-open');
  const dd = h('div', { class: 'tp-menu is-open' });
  for (const it of m.items) {
    if (it === '-') { dd.append(h('div', { class: 'tp-menu__sep' })); continue; }
    const [id, label, kbd, sub] = it;
    if (it.head) { dd.append(h('div', { class: 'tp-menu__head' }, label)); continue; }
    const el = h('button', { class: 'tp-menu__item', onclick: (ev) => { ev.stopPropagation(); closeMenus(); runMenuAction(m.label, id); } },
      h('span', {}, label), kbd ? h('kbd', {}, kbd) : null);
    dd.append(el);
  }
  const rect = btn.getBoundingClientRect();
  dd.style.top = (rect.bottom + 2) + 'px';
  dd.style.left = rect.left + 'px';
  bar.append(dd);
  dd._bar = bar;
  function runMenuAction(_menu, id) {
    if (id.startsWith('tool:')) { const toolId = id.slice(5); setToolGlobal(toolId); return; }
    const f = shell.ctx ? shell.ctx : null;
    if (id === 'importFile') importWorkspaceFile(shell.ctx);
    else if (id === 'duplicateSel') { const d = shell.drawings?.selected(); if (d) { shell.drawings.duplicate(d.id); persistTabNow(); } else showToast('Nothing selected', { timeout: 1200 }); }
    else if (id === 'tf-modal') openTfModal(shell.ctx);
    else if (id === 'type-modal') openTypeModal(shell.ctx);
    else if (shell.ctx) dispatchAction(shell.ctx, id);
  }
}
function dispatchAction(ctx, id) { ctx && fireAction(ctx, id); }
function fireAction(ctx, id) { window.dispatchEvent(new CustomEvent('tp:action', { detail: id })); setTimeout(() => {}, 0); }
function persistTabNow() { shell.drawings && shell.ctx && persistTab(); }
function setToolGlobal(toolId) {
  if (shell.ctx?.store) { shell.ctx.store.mutate(s => { s.ui.activeTool = toolId; }); fireAction(shell.ctx, 'tool:' + toolId); }
}
function closeMenus() { document.querySelectorAll('.tp-menu').forEach(m => m.remove()); document.querySelectorAll('.tp-menubar .tp-menu-btn').forEach(x => x.classList.remove('is-open')); document.querySelectorAll('.tp-ctxmenu').forEach(m => m.remove()); }

// ---------------- ribbon ----------------
function renderRibbon() {
  const ribbon = document.getElementById('tp-ribbon');
  if (!ribbon) return;
  const st = shell.ctx?.store?.getState?.() ?? {};
  const active = st.ui?.activeTool ?? 'pointer';
  ribbon.innerHTML = '';
  ribbon.append(h('div', { class: 'tp-ribbon__drag', onclick: () => shell.ctx?.store.mutate(s => { s.ui.ribbonCollapsed = !s.ui.ribbonCollapsed; }) }, '≡'));
  for (const cat of TOOL_CATEGORIES) {
    const group = h('div', { class: 'tp-ribbon__group' });
    group.append(h('div', { class: 'tp-ribbon__glabel' }, cat.label));
    const row = h('div', { class: 'tp-ribbon__tools' });
    for (const t of cat.tools) {
      row.append(h('button', { class: 'tp-toolbtn' + (active === t.id ? ' is-active' : ''), dataset: { tool: t.id }, title: `${t.label}${shortcutForTool(t.id) ? '  (' + shortcutForTool(t.id) + ')' : ''}` },
        h('span', { class: 'tp-toolbtn__icon' }, t.icon), h('span', { class: 'tp-toolbtn__label' }, t.label), h('span', { class: 'tp-toolbtn__key' }, shortcutForTool(t.id))));
      row.lastChild.addEventListener('click', () => setTool(t.id));
    }
    group.append(row);
    ribbon.append(group);
  }
  const colors = shell.ctx?.store.getState()?.ui || {};
  const colorRow = h('div', { class: 'tp-ribbon__group tp-ribbon__colors' },
    h('label', {}, 'Color'),
    h('input', { type: 'color', value: colors.color1 ?? '#14b8a6', oninput: (e) => { shell.ctx.store.mutate(s => { s.ui.color1 = e.target.value; s.ui.color2 = e.target.value; }); } }),
    h('input', { type: 'number', min: '1', max: '10', value: colors.lineWidth ?? 2, title: 'Line width', oninput: (e) => shell.ctx.store.mutate(s => { s.ui.lineWidth = +e.target.value || 2; }) }),
    h('input', { type: 'range', min: '0.1', max: '1', step: '0.05', value: colors.opacity ?? 0.85, title: 'Opacity', oninput: (e) => shell.ctx.store.mutate(s => { s.ui.opacity = +e.target.value; }) }));
  ribbon.append(colorRow);
}

// ---------------- titlebar tabs ----------------
function renderTabs() {
  const wrap = document.getElementById('tp-title-tabs');
  if (!wrap) return;
  const tbs = shell.ctx.workspace.current?.tabs || [];
  wrap.innerHTML = '';
  for (const t of tbs) {
    const isActive = t.id === shell.tabId;
    const el = h('div', { class: 'tp-charttab' + (isActive ? ' is-active' : '') }, 
      h('span', { class: 'tp-charttab__name', onclick: () => loadTabShim(t.id) }, `${t.symbol} · ${t.timeframe}`),
      h('span', { class: 'tp-charttab__close', title: 'Close tab', onclick: (e) => { e.stopPropagation(); closeTabShim(t.id); } }, '×'));
    wrap.append(el);
  }
}
function loadTabShim(id) { const t = shell.ctx.workspace.current?.tabs.find(x => x.id === id); if (t) loadTab(t); }
function closeTabShim(id) { closeTab(id); }

// ---------------- chartbar ----------------
function renderChartbar() {
  const bar = document.getElementById('tp-chartbar');
  if (!bar) return;
  const t = tab();
  const store = shell.ctx.store;
  bar.innerHTML = '';
  bar.append(h('div', { class: 'tp-chartbar__left' },
    h('div', { class: 'tp-sym-btn', onclick: () => symbolSearchModal(shell.ctx) }, t?.symbol || '—'),
    h('select', { class: 'tp-tf-select', onchange: (e) => changeTimeframe(e.target.value) },
      shell.ctx.dataProvider.tfList().map(tf => h('option', { value: tf, selected: t?.timeframe === tf }, tf))),
    h('div', { class: 'tp-charttype' }, ['candle', 'line', 'area', 'bar'].map(ct =>
      h('button', { class: 'tp-charttype__btn' + (t?.chartType === ct ? ' is-active' : ''), onclick: () => changeChartType(ct) }, ct[0].toUpperCase() + ct.slice(1))))));
  const st = store.getState();
  bar.append(h('div', { class: 'tp-chartbar__right' },
    h('button', { class: 'tp-iconbtn', title: 'Indicators', onclick: () => indicatorsModal(shell.ctx) }, 'ƒ'),
    h('button', { class: 'tp-iconbtn', title: 'Grid', onclick: () => { store.mutate(s => { s.ui.showGrid = !s.ui.showGrid; }); shell.chart.ui.grid = store.getState().ui.showGrid; shell.chart.invalidate(); } }, '▦'),
    h('button', { class: 'tp-iconbtn', title: 'Crosshair', onclick: () => { store.mutate(s => { s.ui.showCrosshair = !s.ui.showCrosshair; }); shell.chart.ui.crosshair = store.getState().ui.showCrosshair; shell.chart.invalidate(); } }, '✚'),
    h('button', { class: 'tp-iconbtn', title: 'Volume', onclick: () => { store.mutate(s => { s.ui.showVolume = !s.ui.showVolume; }); shell.chart.ui.volume = store.getState().ui.showVolume; } }, '▁'),
    h('button', { class: 'tp-iconbtn', title: 'Zoom in', onclick: () => shell.chart.zoomIn() }, '+'),
    h('button', { class: 'tp-iconbtn', title: 'Zoom out', onclick: () => shell.chart.zoomOut() }, '−'),
    h('button', { class: 'tp-iconbtn', title: 'Reset zoom', onclick: () => shell.chart.resetZoom() }, '⤢')));
}

// ---------------- explorer ----------------
function buildExplorer(ctx, { loadSymbol }) {
  const files = ctx.files;
  const box = h('aside', { class: 'tp-explorer panel' },
    h('div', { class: 'tp-panel-head' },
      h('span', {}, 'Files'),
      h('div', { class: 'tp-panel-head__actions' },
        h('button', { class: 'tp-iconbtn', title: 'New chart file', onclick: () => newChartFile(ctx, box) }, '＋'),
        h('button', { class: 'tp-iconbtn', onclick: () => setExplorerSort(files, box) }, '⇅'))),
    h('div', { class: 'tp-explorer__search' }, h('input', { type: 'search', placeholder: 'Search files…', oninput: (e) => { files.setQuery(e.target.value); drawTree(box, files); } })),
    h('div', { class: 'tp-explorer__group' }, 'Charts', h('div', { class: 'tp-explorer__quicklinks' },
      h('button', { class: 'tp-quick', onclick: () => symbolSearchModal(ctx) }, '⌕ Open Symbol'),
      h('button', { class: 'tp-quick', onclick: () => addTabShim() }, '＋ New Chart'))),
    h('div', { class: 'tp-tree', id: 'tp-tree' }));
  shell.unsubs.push(filesOnChange());
  drawTree(box, files);
  return box;
}
function filesOnChange() {
  const files = shell.ctx.files;
  const fn = () => { const box = document.querySelector('.tp-explorer'); if (box) drawTree(box, files); };
  // subscribe via manual hook: FileManager emits through onChange only if provided
  return () => {};
}
function addTabShim() { addTab(); }
async function newChartFile(ctx, box) {
  const name = prompt('Chart file name', 'Chart ' + Date.now().toString().slice(-4));
  if (!name) return;
  const f = await ctx.files.createFile('charts', name, { kind: 'chart', meta: {} });
  showToast(`Created "${f.name}"`, { kind: 'success' });
  redrawTreeNow();
}
function toggleExplorerTree(box) { box.classList.toggle('tp-explorer--collapsed'); }
function setExplorerSort(files, box) {
  files.sort = files.sort === 'name-asc' ? 'name-desc' : 'name-asc';
  drawTree(box, files);
}
function drawTree(box, files) {
  const tree = box.querySelector('#tp-tree');
  if (!tree) return;
  tree.innerHTML = '';
  const flat = files.listFlat();
  const groups = files.groups();
  const root = h('div', { class: 'tp-tree__root' });
  root.append(h('div', { class: 'tp-tree__sort' }, `Sort: ${files.sort.replace('-', ' ')} · ${flat.length} items`));
  for (const g of groups) {
    const gEl = h('div', { class: 'tp-tree__grp' });
    gEl.append(h('div', { class: 'tp-tree__grphead', onclick: () => files.toggleExpand(g.id) },
      h('span', { class: 'tp-tree__caret' }, '▸'), h('span', { class: 'tp-tree__grpicon' }, g.icon), h('span', {}, `${g.name} (${g.count})`)));
    const filesIn = flat.filter(f => f._group === g.id || f._parent === g.id);
    const listEl = h('div', { class: 'tp-tree__files' });
    if (filesIn.length) {
      for (const f of filesIn) {
        const row = h('div', { class: 'tp-tree__file' + (f.id === files.selected ? ' is-selected' : ''), draggable: true,
          onclick: () => { files.select(f.id); fileRowClicked(f); }, contextmenu: (e) => { e.preventDefault(); fileCtxMenu(e, f); },
          ondragstart: (e) => { e.dataTransfer.setData('text/plain', f.id); }, draggable: 'true' },
          h('span', { class: 'tp-tree__ficon' }, f.type === 'folder' ? '🗀' : symbolGlyph(f)),
          h('span', { class: 'tp-tree__fname' }, f.name || (f.type === 'file' ? (f.meta?.symbol ? `${f.meta.symbol} ${f.meta.timeframe}` : 'Chart') : f.name)));
        if (f.type === 'folder') row.addEventListener('dragover', (e) => e.preventDefault());
        row.addEventListener('drop', (e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) shell.ctx.files.move(id, f.id); redrawTreeNow(); });
        listEl.append(row);
      }
    } else listEl.append(h('div', { class: 'tp-tree__empty' }, 'Empty — right-click to add'));
    gEl.append(listEl);
    root.append(gEl);
  }
  tree.append(root);
}
function symbolGlyph(f) {
  if (f.kind === 'chart') return '📈';
  if (f.kind === 'setup') return '🎯';
  if (f.kind === 'strategy') return '🧠';
  if (f.kind === 'template') return '📑';
  if (f.kind === 'journal') return '📓';
  return '📄';
}
function redrawTreeNow() { const b = document.querySelector('.tp-explorer'); if (b) drawTree(b, shell.ctx.files); }
function fileRowClicked(f) {
  if (f.type !== 'file') return;
  if (f.kind === 'chart') { showToast(`Opened chart "${f.name}"`, { timeout: 1200 }); }
  else showToast(`Opened ${f.kind} "${f.name}"`, { timeout: 1200 });
}
function fileCtxMenu(e, f) {
  const ctx = shell.ctx;
  const files = ctx.files;
  const menu = h('div', { class: 'tp-ctxmenu' });
  if (f.type === 'folder') {
    menu.append(menuItem('New Chart', async () => { closeMenus(); const file = await files.createFile(f.id, prompt('Chart name') || `Chart ${Date.now().toString().slice(-4)}`, { kind: 'chart', meta: {} }); showToast(`Created ${file.name}`); redrawTreeNow(); }));
    menu.append(menuItem('New Folder', async () => { closeMenus(); const d = await files.createFolder(f.id, prompt('Folder name') || 'Folder'); showToast(`Created ${d.name}`); redrawTreeNow(); }));
  } else {
    menu.append(menuItem('Open', () => { closeMenus(); fileRowClicked(f); }));
  }
  menu.append(menuItem('Rename…', async () => { closeMenus(); const nn = prompt('Rename', f.name); if (nn) { await files.rename(f.id, nn); redrawTreeNow(); } }));
  menu.append(menuItem('Duplicate', async () => { closeMenus(); await files.duplicate(f.id); redrawTreeNow(); }));
  menu.append(menuItem('Export JSON', () => { closeMenus(); const p = files.exportJSON(f.id); if (p) downloadBlob(new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' }), (f.name || 'file').replace(/\s+/g, '_') + '.tpfile.json'); }));
  menu.append(menuItem('Delete', async () => { closeMenus(); if (await confirmDialog({ title: 'Delete', message: `Delete "${f.name}"?`, danger: true })) { await files.remove(f.id); redrawTreeNow(); } }, true));
  positionMenu(menu, e.clientX, e.clientY);
}
function menuItem(label, fn, danger = false) { return h('button', { class: 'tp-menu__item' + (danger ? ' is-danger' : ''), onclick: fn }, label); }
function positionMenu(menu, x, y) {
  menu.classList.add('is-open');
  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - rect.width - 8) + 'px';
  menu.style.top = Math.min(y, window.innerHeight - rect.height - 8) + 'px';
}
function setupDragDrop() {
  // explorer drag handled per-row; here we also allow dropping a symbol from anywhere
  document.querySelectorAll('.tp-chart-host').forEach(hh => {
    hh.addEventListener('dragover', e => e.preventDefault());
    hh.addEventListener('drop', e => { const s = e.dataTransfer.getData('text/plain'); if (s && shell.ctx?.dataProvider.isSupported(s)) changeSymbol(s); });
  });
}

// ---------------- inspector ----------------
function buildInspector(ctx, { changeSymbol, fire }) {
  const aside = h('aside', { class: 'tp-inspector panel', id: 'tp-inspector' });
  const tabs = ['watchlist', 'properties', 'layers', 'analysis'];
  const labels = { watchlist: 'Watchlist', properties: 'Properties', layers: 'Layers', analysis: 'Analysis' };
  const head = h('div', { class: 'tp-inspector__tabs' });
  const panes = h('div', { class: 'tp-inspector__panes' });
  let current = ctx.store.getState().ui.rightPanelTab || 'watchlist';
  function activate(which) {
    current = which;
    ctx.store.mutate(s => { s.ui.rightPanelTab = which; });
    head.querySelectorAll('button').forEach((b, i) => b.classList.toggle('is-active', tabs[i] === which));
    [...panes.children].forEach(p => p.classList.remove('is-visible'));
    const pane = panes.querySelector(`[data-pane="${which}"]`);
    pane?.classList.add('is-visible');
    refreshPane(which);
  }
  for (const t of tabs) head.append(h('button', { class: 'tp-inspector__tab' + (t === current ? ' is-active' : ''), onclick: () => activate(t) }, labels[t]));
  const plist = h('div', { data: { pane: 'watchlist' }, class: 'tp-pane' });
  const props = h('div', { data: { pane: 'properties' }, class: 'tp-pane' });
  const layers = h('div', { data: { pane: 'layers' }, class: 'tp-pane' });
  const an = h('div', { data: { pane: 'analysis' }, class: 'tp-pane' });
  panes.append(plist, props, layers, an);
  aside.append(head, panes);
  shell._inspector = { plist, props, layers, an, current: () => current, activate, changeSymbol };
  setTimeout(() => activate(current), 0);
  return aside;
}
function refreshPane(which) {
  if (which === 'watchlist') drawWatchlist();
  else if (which === 'properties') syncPropsPanel();
  else if (which === 'layers') drawLayers();
  else if (which === 'analysis') fillAnalysis();
}
function openAnalysisTab() { const ins = shell._inspector; if (ins) ins.activate('analysis'); document.querySelector('.tp-inspector')?.classList.add('is-open'); }

const _activePane = () => shell._inspector?.current() || 'watchlist';
function drawWatchlist() {
  const pane = shell._inspector?.plist;
  if (!pane) return;
  const ctx = shell.ctx;
  const wl = ctx.watchlist;
  const active = wl.getActive();
  if (!active) { pane.innerHTML = ''; pane.append(h('p', { class: 'tp-empty' }, 'No watchlist')); return; }
  pane.innerHTML = '';
  pane.append(h('div', { class: 'tp-wl-head' },
    h('select', { class: 'tp-wl-select', onchange: (e) => { wl.setActive(e.target.value); drawWatchlist(); } },
      wl.list().map(w => h('option', { value: w.id, selected: w.id === wl.activeId }, w.name))),
    h('button', { class: 'tp-iconbtn', title: 'Add symbol', onclick: () => wlAddSymbol(active) }, '＋')));
  const rows = h('div', { class: 'tp-wl-rows', id: 'tp-watchlist-rows' });
  for (const sym of active.symbols) {
    const p = wl.getPrice(sym);
    const up = (p?.changePct ?? 0) >= 0;
    const row = h('div', { class: 'tp-wl-row', onclick: () => { shell._inspector?.changeSymbol(sym); } },
      h('div', { class: 'tp-wl-sym' }, h('strong', {}, sym), h('span', {}, p?.info?.exchange || '')),
      h('div', { class: 'tp-wl-price' }, fmtNum(p?.price, (p?.price ?? 0) < 10 ? 4 : 2)),
      h('div', { class: 'tp-wl-chg ' + (up ? 'up' : 'down') }, `${up ? '+' : ''}${fmtNum(p?.changePct, 2)}%`),
      h('button', { class: 'tp-iconbtn tp-wl-x', title: 'Remove', onclick: (e) => { e.stopPropagation(); wl.removeSymbol(active.id, sym).then(drawWatchlist); } }, '×'));
    rows.append(row);
  }
  pane.append(rows);
  pane.append(h('button', { class: 'tp-btn tp-btn--ghost tp-btn--block', onclick: () => exportWatchlistCSV(ctx, active) }, 'Export CSV'));
}
function wlAddSymbol(active) {
  const ctx = shell.ctx;
  symbolSearchModal(ctx, (sym) => { ctx.watchlist.addSymbol(active.id, sym); drawWatchlist(); });
}
function exportWatchlistCSV(ctx, active) {
  const csv = ctx.watchlist.exportCSV(active.id);
  downloadBlob(new Blob([csv], { type: 'text/csv' }), active.name.replace(/\s+/g, '_') + '.csv');
  showToast('Watchlist exported as CSV', { kind: 'success' });
}

function syncPropsPanel() {
  const pane = shell._inspector?.props;
  if (!pane) return;
  pane.innerHTML = '';
  const d = shell.drawings?.selected();
  const ctx = shell.ctx;
  const st = ctx.store.getState();
  if (d) {
    const style = (label, control) => h('label', { class: 'tp-prop' }, h('span', {}, label), control);
    pane.append(h('div', { class: 'tp-prop__title' }, `${toolLabel(d.tool)}`), h('div', { class: 'tp-prop__hint' }, 'Object properties'));
    pane.append(style('Color', h('input', { type: 'color', value: d.color, oninput: (e) => shell.drawings.update(d.id, { color: e.target.value, fill: e.target.value + '33' }) })));
    pane.append(style('Width', h('input', { type: 'number', min: 1, max: 10, value: d.lineWidth || 2, oninput: (e) => shell.drawings.update(d.id, { lineWidth: +e.target.value || 2 }) })));
    pane.append(style('Style', h('select', { onchange: (e) => shell.drawings.update(d.id, { lineStyle: e.target.value }) },
      ['solid', 'dashed', 'dotted'].map(s => h('option', { value: s, selected: (d.lineStyle || 'solid') === s }, s)))));
    pane.append(style('Opacity', h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: d.opacity ?? 0.9, oninput: (e) => shell.drawings.update(d.id, { opacity: +e.target.value }) })));
    if (d.props.entry != null) {
      pane.append(style('Entry', h('input', { type: 'number', step: 'any', value: d.props.entry, oninput: (e) => shell.drawings.update(d.id, { props: { ...d.props, entry: +e.target.value } }) })));
      pane.append(style('Stop', h('input', { type: 'number', step: 'any', value: d.props.stop, oninput: (e) => shell.drawings.update(d.id, { props: { ...d.props, stop: +e.target.value } }) })));
      pane.append(style('Target', h('input', { type: 'number', step: 'any', value: d.props.target, oninput: (e) => shell.drawings.update(d.id, { props: { ...d.props, target: +e.target.value } }) })));
    }
    const actions = h('div', { class: 'tp-prop__actions' },
      h('button', { class: 'tp-btn', onclick: () => shell.drawings.duplicate(d.id) }, 'Duplicate'),
      h('button', { class: 'tp-btn', onclick: () => shell.drawings.setLocked(d.id, !d.locked) }, d.locked ? '🔒' : '🔓'),
      h('button', { class: 'tp-btn', onclick: () => shell.drawings.setHidden(d.id, !d.hidden) }, '👁'),
      h('button', { class: 'tp-btn tp-btn--danger', onclick: () => { shell.drawings.remove(d.id); persistTabNow(); } }, 'Delete'));
    pane.append(actions);
  } else {
    pane.append(h('div', { class: 'tp-prop__title' }, 'Chart & Drawing Defaults'));
    pane.append(propRow('Drawing color', h('input', { type: 'color', value: st.ui.color1 || '#14b8a6', oninput: (e) => ctx.store.mutate(s => { s.ui.color1 = e.target.value; }) })));
    pane.append(propRow('Line width', h('input', { type: 'number', min: 1, max: 10, value: st.ui.lineWidth || 2, oninput: (e) => ctx.store.mutate(s => { s.ui.lineWidth = +e.target.value || 2; }) })));
    const toggles = (label, key, uiKey) => h('label', { class: 'tp-prop' }, h('span', {}, label),
      h('input', { type: 'checkbox', checked: st.ui[uiKey], onchange: (e) => { ctx.store.mutate(s => { s.ui[uiKey] = e.target.checked; }); if (shell.chart) { shell.chart.ui[key] = e.target.checked; shell.chart.invalidate(); } } }));
    pane.append(toggles('Show grid', 'grid', 'showGrid'));
    pane.append(toggles('Crosshair', 'crosshair', 'showCrosshair'));
    pane.append(toggles('Volume', 'volume', 'showVolume'));
    pane.append(toggles('Hover tooltip', 'tooltip', 'showTooltip'));
    pane.append(propRow('Candle style', h('select', { onchange: (e) => { ctx.store.mutate(s => { s.settings.candleStyle = e.target.value; }); if (shell.chart) { shell.chart.ui.candleStyle = e.target.value; shell.chart.invalidate(); } } },
      ['filled', 'hollow'].map(v => h('option', { value: v, selected: (st.settings.candleStyle || 'filled') === v }, v)))));
    pane.append(h('p', { class: 'tp-prop__hint' }, 'Select a drawing to edit it.'));
  }
}
function propRow(label, control) { return h('label', { class: 'tp-prop' }, h('span', {}, label), control); }

function drawLayers() {
  const pane = shell._inspector?.layers;
  if (!pane) return;
  pane.innerHTML = '';
  const ctx = shell.ctx;
  const list = shell.drawings.list();
  const inds = shell.indicators?.list?.() ?? [];
  const sections = h('div', { class: 'tp-layers' });
  sections.append(h('div', { class: 'tp-layer-head' }, h('span', {}, 'Objects'), h('span', {}, list.length)));
  if (!list.length) sections.append(h('p', { class: 'tp-empty' }, 'No drawings yet. Pick a tool from the ribbon.'));
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    const row = h('div', { class: 'tp-layer-row' + (d.id === shell.drawings.selectedId ? ' is-selected' : '') + (d.hidden ? ' is-hidden' : '') },
      h('button', { class: 'tp-layer-btn', onclick: () => shell.drawings.select(d.id) }, h('span', { class: 'tp-layer-dot', style: { background: d.color } }), h('span', {}, toolLabel(d.tool))),
      h('span', { class: 'tp-layer-actions' },
        h('button', { class: 'tp-iconbtn', title: d.hidden ? 'Show' : 'Hide', onclick: () => shell.drawings.setHidden(d.id, !d.hidden) }, d.hidden ? '◉' : '○'),
        h('button', { class: 'tp-iconbtn', title: d.locked ? 'Unlock' : 'Lock', onclick: () => shell.drawings.setLocked(d.id, !d.locked) }, d.locked ? '🔒' : '🔓'),
        h('button', { class: 'tp-iconbtn', title: 'Delete', onclick: () => { shell.drawings.remove(d.id); persistTabNow(); drawLayers(); } }, '×')));
    sections.append(row);
  }
  sections.append(h('div', { class: 'tp-layer-head' }, h('span', {}, 'Indicators'), h('span', {}, inds.length)));
  for (const ind of inds) {
    const reg = INDICATOR_REGISTRY[ind.type];
    const row = h('div', { class: 'tp-layer-row' + (ind.hidden ? ' is-hidden' : '') },
      h('span', { class: 'tp-layer-btn' }, h('span', { class: 'tp-layer-dot' }, 'ƒ'), h('span', {}, reg?.label || ind.type)),
      h('span', { class: 'tp-layer-actions' },
        h('button', { class: 'tp-iconbtn', title: ind.hidden ? 'Show' : 'Hide', onclick: () => { shell.indicators.update(ind.id, { hidden: !ind.hidden }); drawLayers(); } }, ind.hidden ? '◉' : '○'),
        h('button', { class: 'tp-iconbtn', title: 'Delete', onclick: () => { shell.indicators.remove(ind.id); persistTabNow(); drawLayers(); } }, '×')));
    sections.append(row);
  }
  pane.append(sections);
  pane.append(h('span', { class: 'tp-prop__hint' }, 'Drag objects? Pick any drawing: select → move.'));
  const c = document.querySelector('.tp-statusbar__count');
  if (c) c.textContent = list.length + ' drawings';
}

// ---------------- analysis ----------------
function fillAnalysis() {
  const pane = shell._inspector?.an;
  if (!pane) return;
  const ctx = shell.ctx;
  const t = tab();
  const a = t?.analysis || {};
  const lastC = shell.chart?.bars?.at(-1)?.c;
  const st = ctx.store.getState().analysis || {};
  pane.innerHTML = '';
  const row = (l, c) => h('label', { class: 'tp-prop' }, h('span', {}, l), c);
  const input = (num, val, on) => h('input', { type: 'number', step: 'any', value: val ?? '', oninput: (e) => on(+e.target.value) });
  pane.append(h('div', { class: 'tp-prop__title' }, 'Trade Plan'));
  const modeRow = h('div', { class: 'tp-analysis-mode' },
    ['LONG', 'SHORT'].map(m => h('button', { class: 'tp-modebtn' + ((a.mode ?? 'LONG') === m ? ' is-active' : ''), onclick: () => { saveAnalysisPatch({ mode: m }); fillAnalysis(); } }, m)));
  pane.append(modeRow);
  pane.append(row('Entry (last close ' + (lastC != null ? fmtNum(lastC) : '—') + ')', input('entry', a.entry ?? st.entry, v => saveAnalysisPatch({ entry: v }))));
  pane.append(row('Stop loss', input('stop', a.stop ?? st.stop, v => saveAnalysisPatch({ stop: v }))));
  pane.append(row('Target 1', input('t1', a.t1 ?? st.t1, v => saveAnalysisPatch({ t1: v }))));
  pane.append(row('Target 2 (opt)', input('t2', a.t2 ?? st.t2, v => saveAnalysisPatch({ t2: v }))));
  pane.append(row('Target 3 (opt)', input('t3', a.t3 ?? st.t3, v => saveAnalysisPatch({ t3: v }))));
  pane.append(row('Account ₹', input('account', st.account ?? 100000, v => { saveAnalysisPatch({ account: v }); ctx.store.mutate(s => s.analysis.account = v); fillAnalysis(); })));
  pane.append(row('Risk %', input('riskPct', st.riskPct ?? 1, v => { saveAnalysisPatch({ riskPct: v }); ctx.store.mutate(s => s.analysis.riskPct = v); fillAnalysis(); })));

  const res = computeAnalysisSafe(a, st.entry);
  const card = h('div', { class: 'tp-analysis-result' },
    h('div', { class: 'tp-ares' }, h('span', {}, 'Size (units)'), h('strong', {}, res ? fmtNum(res.positionSize, 3) : '—')),
    h('div', { class: 'tp-ares' }, h('span', {}, 'Risk ₹'), h('strong', {}, res ? fmtNum(res.risk) : '—')),
    h('div', { class: 'tp-ares' }, h('span', {}, 'Reward ₹'), h('strong', {}, res ? fmtNum(res.reward) : '—')),
    h('div', { class: 'tp-ares tp-ares--rr' }, h('span', {}, 'R:R'), h('strong', {}, res ? res.rr : '—')));
  pane.append(card);
  if (res?.errors?.length) {
    for (const err of res.errors) pane.append(h('p', { class: 'tp-analysis-err' }, err));
  }
  const actions = h('div', { class: 'tp-prop__actions' },
    h('button', { class: 'tp-btn tp-btn--primary', onclick: () => placePositionFromAnalysis() }, 'Place on chart'),
    h('button', { class: 'tp-btn', onclick: () => saveSetupFromAnalysis(ctx) }, 'Save Setup'));
  pane.append(actions);
}
function computeAnalysisSafe(a, fallbackEntry) {
  const direction = a.mode || 'LONG';
  const entry = a.entry ?? fallbackEntry ?? 0;
  const res = { positionSize: 0, risk: 0, reward: 0, rr: 0, errors: [] };
  if (!entry || !a.stop || !a.t1) { res.errors.push('Fill entry, stop, and at least one target.'); return res; }
  const errors = validateAnalysis({ direction, entry, stop: a.stop, t1: a.t1 });
  if (errors.length) { res.errors = errors; return res; }
  const full = computeAnalysis({ direction, entry, stop: a.stop, t1: a.t1, t2: a.t2, t3: a.t3, account: a.account ?? 100000, riskPct: a.riskPct ?? 1 });
  full.errors = [];
  return full;
}
function placePositionFromAnalysis() {
  const t = tab(); if (!t) return;
  shell.drawings.beginTool(t.analysis.mode === 'SHORT' ? 'short_position' : 'long_position', shell.ctx.store.getState().ui.color1);
  const d = shell.drawings.current;
  if (!d) return;
  const p = { i: shell.chart.bars.length - 1, y: (t.analysis.entry ?? shell.chart.bars.at(-1)?.c ?? 0) };
  d.props.entry = t.analysis.entry; d.props.stop = t.analysis.stop; d.props.target = t.analysis.t1;
  d.props.direction = (t.analysis.mode || 'LONG').toUpperCase();
  d.points = [p];
  shell.drawings.finalize();
  persistTabNow();
  showToast('Position placed on chart', { kind: 'success' });
}
function saveSetupFromAnalysis(ctx) {
  const t = tab(); if (!t || !t.analysis?.entry) { showToast('Complete the trade plan first', { kind: 'warning' }); return; }
  ctx.setups.create({
    title: `${t.symbol} ${t.analysis.mode || 'LONG'} plan`,
    symbol: t.symbol, direction: t.analysis.mode || 'LONG', timeframe: t.timeframe,
    entry: t.analysis.entry, stop: t.analysis.stop, t1: t.analysis.t1, t2: t.analysis.t2, t3: t.analysis.t3,
  });
  showToast('Setup saved', { kind: 'success' });
}

// ---------------- statusbar ----------------
function buildStatusbar(ctx, chart, drawings) {
  const st = ctx.store.getState();
  const elTab = h('span', { id: 'tp-status-tab' }, '—');
  const elCount = h('span', { class: 'tp-statusbar__count' }, '0 drawings');
  const bar = h('footer', { class: 'tp-statusbar' },
    h('span', { class: 'tp-statusbar__demo' }, 'DEMO DATA'),
    elTab,
    h('span', { id: 'tp-status-price', class: 'tp-statusbar__price' }, ''),
    h('span', { id: 'tp-status-zoom' }, ''),
    elCount,
    h('span', { class: 'tp-statusbar__spacer' }, ''),
    h('span', { class: 'tp-statusbar__save', id: 'tp-status-save' }, h('span', { class: 'tp-savestatus' }, 'Saved')));
  const upd = () => {
    const t = tab();
    elTab.textContent = t ? `· ${t.symbol}  ${t.timeframe}  ${t.chartType[0].toUpperCase() + t.chartType.slice(1)}` : '· —';
    elCount.textContent = drawCount() + ' drawings';
  };
  upd();
  shell._statusUpdater = upd;
  return bar;
}
function drawCount() { return shell.drawings ? shell.drawings.count() : 0; }

// ---------------- mobile bottom dock ----------------
function buildMobileDock(ctx, fire, setTool) {
  const dock = h('div', { class: 'tp-mobile-dock' });
  const tools = ['pointer', 'pan', 'trendline', 'rect', 'fib_retrace', 'long_position', 'buy_zone', 'text'];
  for (const id of tools) {
    const t = TOOL_CATEGORIES.flatMap(c => c.tools).find(x => x.id === id);
    if (t) dock.append(h('button', { class: 'tp-toolbtn', title: t.label, onclick: () => setTool(id) }, h('span', { class: 'tp-toolbtn__icon' }, t.icon)));
  }
  dock.append(h('button', { class: 'tp-iconbtn', title: 'Explorer', dataset: { side: 'left' }, onclick: () => ctx.store.mutate(s => { s.ui.leftPanelOpen = !s.ui.leftPanelOpen; }) }, '🗀'));
  dock.append(h('button', { class: 'tp-iconbtn', title: 'Inspector', dataset: { side: 'right' }, onclick: () => ctx.store.mutate(s => { s.ui.rightPanelOpen = !s.ui.rightPanelOpen; }) }, '☰'));
  return dock;
}

// ================= MODALS & COMMANDS =================
export function symbolSearchModal(ctx, onPick) {
  const listEl = h('div', { class: 'tp-symlist' });
  const input = h('input', { type: 'search', placeholder: 'Search NIFTY 50, RELIANCE, BTC/USD…', autofocus: true, oninput: async (e) => row(e.target.value) });
  const body = h('div', { class: 'tp-sym-modal' }, input, listEl);
  const m = openModal({ title: 'Symbol Search', body, size: 'md' });
  async function row(q) {
    listEl.innerHTML = '<p class="tp-empty">Searching…</p>';
    const res = await ctx.dataProvider.searchSymbols(q);
    listEl.innerHTML = '';
    if (!res.length) { listEl.append(h('p', { class: 'tp-empty' }, 'No symbols found')); return; }
    for (const s of res) {
      listEl.append(h('button', { class: 'tp-sym-row', onclick: () => { m.close(); if (onPick) onPick(s.symbol); else { showToast(`${s.symbol} · ${s.name}`); changeSymbol(s.symbol); } } },
        h('span', { class: 'tp-sym-row__sym' }, s.symbol),
        h('span', { class: 'tp-sym-row__name' }, s.name),
        h('span', { class: 'tp-sym-row__ex' }, s.exchange)));
    }
  }
  setTimeout(() => row(''), 30);
}

export function indicatorsModal(ctx) {
  const cur = shell.indicators?.list?.() ?? [];
  const listEl = h('div', { class: 'tp-ind-list' });
  const regEl = h('div', { class: 'tp-ind-registry' });
  const body = h('div', { class: 'tp-ind-modal' }, regEl, listEl);
  const m = openModal({ title: 'Indicators', body, size: 'lg' });
  function drawCur() {
    listEl.innerHTML = '';
    if (!cur.length) listEl.append(h('p', { class: 'tp-empty' }, 'No indicators on this tab'));
    for (const ind of cur) {
      const reg = INDICATOR_REGISTRY[ind.type];
      listEl.append(h('div', { class: 'tp-ind-row' },
        h('span', {}, reg?.label || ind.type), h('span', { class: 'tp-ind-row__settings' }, JSON.stringify(ind.settings || {}).slice(0, 40)),
        h('button', { class: 'tp-iconbtn', title: 'Remove', onclick: () => { shell.indicators.remove(ind.id); cur.length = 0; cur.push(...shell.indicators.list()); persistTabNow(); drawCur(); } }, '×')));
    }
  }
  function drawReg() {
    regEl.innerHTML = '';
    const cats = {};
    for (const it of Object.values(INDICATOR_REGISTRY)) (cats[it.category] ||= []).push(it);
    for (const [cat, items] of Object.entries(cats)) {
      const sec = h('div', { class: 'tp-ind-cat' }, h('div', { class: 'tp-ind-cat__t' }, cat));
      for (const it of items) sec.append(h('button', { class: 'tp-ind-add', onclick: () => { shell.indicators.add(it.id); persistTabNow(); cur.length = 0; cur.push(...shell.indicators.list()); drawCur(); showToast(it.label + ' added', { kind: 'success', timeout: 1000 }); } }, '+ ' + it.label));
      regEl.append(sec);
    }
  }
  drawReg(); drawCur();
}

export function quickChartExport(ctx) { snapshotPNG(ctx); }

export function openTfModal(ctx) {
  const tfs = ctx.dataProvider.tfList();
  const body = h('div', { class: 'tp-grid-modal' }, tfs.map(tf =>
    h('button', { class: 'tp-grid-btn' + (tab()?.timeframe === tf ? ' is-active' : ''), onclick: () => { changeTimeframe(tf); document.querySelector('.tp-modal__close')?.click(); } }, tf)));
  openModal({ title: 'Timeframe', body, size: 'sm' });
}
export function openTypeModal(ctx) {
  const body = h('div', { class: 'tp-grid-modal' }, ['candle', 'line', 'area', 'bar'].map(ct =>
    h('button', { class: 'tp-grid-btn' + (tab()?.chartType === ct ? ' is-active' : ''), onclick: () => { changeChartType(ct); document.querySelector('.tp-modal__close')?.click(); } }, ct)));
  openModal({ title: 'Chart Type', body, size: 'sm' });
}

export function createShortcutsModal(ctx) {
  const list = ctx.allShortcuts || [];
  if (!list.length) return showToast('No shortcuts registered', { timeout: 1200 });
  const groups = {};
  for (const e of list) (groups[e.group] ||= []).push(e);
  const body = h('div', { class: 'tp-shortcuts-list' });
  for (const [g, arr] of Object.entries(groups)) {
    const sec = h('section', { class: 'tp-shortcuts-group' });
    sec.append(h('h4', {}, g));
    const ul = h('ul');
    for (const e of arr) ul.append(h('li', {}, h('span', {}, e.label), h('kbd', {}, kbdText(e.combo))));
    sec.append(ul);
    body.append(sec);
  }
  openModal({ title: 'Keyboard Shortcuts', body, size: 'lg' });
}
function kbdText(combo) {
  return combo.replace(/Ctrl\+/g, IS_MAC ? '⌘' : 'Ctrl+').replace(/\+/g, ' + ');
}
export function cmdPalette(ctx) {
  const input = h('input', { type: 'search', placeholder: 'Type a command…', autofocus: true });
  const list = h('div', { class: 'tp-cmd-list' });
  const body = h('div', { class: 'tp-cmd-modal' }, input, list);
  const m = openModal({ title: 'Command Palette', body, size: 'md' });
  const items = [
    ['Change Symbol…', () => { m.close(); symbolSearchModal(ctx); }], ['Add Indicator…', () => { m.close(); indicatorsModal(ctx); }],
    ['New Chart Tab', () => { m.close(); addTab(); }], ['Save Workspace', () => { m.close(); dispatchAction(ctx, 'save'); }],
    ['Export Chart PNG', () => { m.close(); snapshotPNG(ctx); }], ['Export Workspace', () => { m.close(); exportWorkspaceFile(ctx); }],
    ['Place Long Plan', () => { m.close(); setTool('long_position'); }], ['Place Short Plan', () => { m.close(); setTool('short_position'); }],
    ['Trade Analysis', () => { m.close(); openAnalysisTab(); }], ['Go to Watchlists', () => { m.close(); ctx.router.go('/watchlist'); }],
    ['Go to Setups', () => { m.close(); ctx.router.go('/setups'); }], ['Go to Journal', () => { m.close(); ctx.router.go('/journal'); }],
    ['Go to Workspaces', () => { m.close(); ctx.router.go('/workspaces'); }], ['Go to Settings', () => { m.close(); ctx.router.go('/settings'); }],
    ['Keyboard Shortcuts', () => { m.close(); createShortcutsModal(ctx); }], ['Toggle Grid', () => { m.close(); dispatchAction(ctx, 'grid-t'); }], ['Undo', () => { m.close(); dispatchAction(ctx, 'undo'); }], ['Redo', () => { m.close(); dispatchAction(ctx, 'redo'); }], ['Toggle Explorer', () => { m.close(); dispatchAction(ctx, 'toggle-explorer'); }], ['Toggle Inspector', () => { m.close(); dispatchAction(ctx, 'toggle-inspector'); }],
  ].map(([label, fn]) => ({ label, fn, match: label.toLowerCase() }));
  function draw(q) {
    list.innerHTML = '';
    const qq = q.toLowerCase();
    for (const it of items) {
      if (!it.match.includes(qq)) continue;
      list.append(h('button', { class: 'tp-cmd-item', onclick: it.fn }, it.label));
    }
    if (!list.children.length) list.append(h('p', { class: 'tp-empty' }, 'No matching command'));
  }
  input.addEventListener('input', (e) => draw(e.target.value));
  draw('');
}

export function snapshotPNG(ctx) {
  const c = shell.chart;
  if (!c) { showToast('No chart to capture', { kind: 'warning' }); return; }
  const t = tab();
  const dataURL = c.canvas.toDataURL('image/png');
  downloadBlob(dataURLToBlob(dataURL), `${(t?.symbol || 'chart').replace(/\//g, '_')}_${t?.timeframe || ''}_${Date.now()}.png`);
  showToast('Chart exported as PNG', { kind: 'success' });
}
function dataURLToBlob(d) {
  const [mimePart, b64] = d.split(',');
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimePart.match(/data:(.+);base64/)?.[1] || 'image/png' });
}

export function exportWorkspaceFile(ctx) {
  const exp = ctx.workspace.exportFile();
  if (!exp) return showToast('Nothing to export', { kind: 'warning' });
  downloadBlob(new Blob([JSON.stringify(exp, null, 2)], { type: 'application/json' }), (exp.workspace.name || 'workspace').replace(/\s+/g, '_') + '.tpworkspace.json');
  showToast('Workspace exported', { kind: 'success' });
}
export function importWorkspaceFile(ctx) {
  const inp = h('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  document.body.append(inp);
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      await ctx.workspace.importFile(data);
      showToast(`Imported "${data?.workspace?.name || 'workspace'}"`, { kind: 'success' });
      ctx.router.go('/workspace');
    } catch (err) { console.error(err); showToast('Invalid workspace file', { kind: 'error' }); }
  };
  inp.click();
}

// ================= FEATURE SCREENS =================
function screenFrame(ctx, title, subtitle, ...body) {
  const root = document.getElementById('app');
  root.innerHTML = '';
  const frame = h('div', { class: 'tp-screen' },
    h('header', { class: 'tp-screen-head' },
      h('div', { class: 'tp-titlebar__brand', onclick: () => ctx.router.go('/landing') }, hSpan(ctx.LOGO_SVG), h('span', { class: 'tp-brand-name' }, 'TradeLab')),
      h('nav', { class: 'tp-screen-nav' },
        h('a', { href: '#/workspace' }, 'Workspace'), h('a', { href: '#/watchlist' }, 'Watchlist'), h('a', { href: '#/setups' }, 'Setups'),
        h('a', { href: '#/journal' }, 'Journal'), h('a', { href: '#/workspaces' }, 'Workspaces'), h('a', { href: '#/settings' }, 'Settings'), h('a', { href: '#/help' }, 'Help'))),
    h('main', { class: 'tp-screen-main' },
      h('div', { class: 'tp-screen-title' }, h('h1', {}, title), subtitle ? h('p', {}, subtitle) : null,
        h('span', { class: 'tp-screen-demo' }, 'DEMO DATA')),
      ...body));
  root.append(frame);
  return frame;
}
function statCard(label, value) { return h('div', { class: 'tp-stat' }, h('strong', {}, value), h('span', {}, label)); }

export function renderWatchlistScreen(ctx) {
  const wl = ctx.watchlist;
  let mode = 'main';
  const cols = h('div', { class: 'tp-collection-cols' });
  const listEl = h('div', { class: 'tp-list-card' });
  const frame = screenFrame(ctx, 'Watchlists', 'Live demo prices across your watchlists.', cols);
  function drawCols() {
    cols.innerHTML = '';
    for (const w of wl.list()) {
      const card = h('div', { class: 'tp-wlcard' },
        h('div', { class: 'tp-wlcard__head' }, h('strong', {}, w.name),
          h('div', {}, h('button', { class: 'tp-iconbtn', title: 'Load', onclick: () => { ctx.watchlist.setActive(w.id); ctx.router.go('/workspace'); } }, '📈'))),
        h('div', { class: 'tp-wlcard__rows' }));
      for (const s of w.symbols) {
        const p = wl.getPrice(s);
        const up = (p?.changePct ?? 0) >= 0;
        card.querySelector('.tp-wlcard__rows').append(h('button', { class: 'tp-wlcard-row', onclick: () => { ctx.watchlist.setActive(w.id); ctx.router.go('/workspace'); } },
          h('span', {}, s), h('span', {}, fmtNum(p?.price, (p?.price ?? 0) < 10 ? 4 : 2)), h('span', { class: up ? 'up' : 'down' }, `${up ? '+' : ''}${fmtNum(p?.changePct, 2)}%`)));
      }
      cols.append(card);
    }
    cols.append(h('button', { class: 'tp-btn tp-btn--ghost', onclick: () => wlCreate() }, '＋ New watchlist'));
  }
  async function wlCreate() {
    const name = prompt('Watchlist name');
    if (!name) return;
    const w = await wl.create(name);
    wlAddPrompt(ctx, w);
    drawCols();
  }
  drawCols();
  if (!ctx.watchlist.onChange) ctx.watchlist.onChange = (k) => { if (k === 'tick' && mode === 'main') drawCols(); };
}

function wlAddPrompt(ctx, w) {
  const inp = h('input', { type: 'search', placeholder: 'Search symbol…', autofocus: true });
  const results = h('div', { class: 'tp-symlist' });
  const m = openModal({ title: `Add to ${w.name}`, body: h('div', { class: 'tp-sym-modal' }, inp, results), size: 'sm' });
  inp.oninput = async () => {
    results.innerHTML = '';
    const res = await ctx.dataProvider.searchSymbols(inp.value);
    for (const s of res.slice(0, 8)) results.append(h('button', { class: 'tp-sym-row', onclick: () => { ctx.watchlist.addSymbol(w.id, s.symbol); m.close(); } },
      h('span', { class: 'tp-sym-row__sym' }, s.symbol), h('span', { class: 'tp-sym-row__name' }, s.name)));
  };
}

export function renderSetupsScreen(ctx) {
  const frames = h('div', { class: 'tp-list-card' });
  const filter = h('select', { class: 'tp-toolbar-select', onchange: (e) => draw(e.target.value) },
    ['All', ...ctx.setups.statuses()].map(s => h('option', { value: s }, s)));
  const toolbar = h('div', { class: 'tp-toolbar' }, h('strong', {}, 'Trade Setups'), h('span', { class: 'tp-toolbar__spacer' }, ''), filter,
    h('button', { class: 'tp-btn tp-btn--primary', onclick: () => setupModal(ctx, null, () => draw('All')) }, '＋ New Setup'));
  const frame = screenFrame(ctx, 'Trade Setups', 'Ideas, plans, active trades, and completed reviews.', toolbar, frames);
  function draw(status) {
    frames.innerHTML = '';
    const arr = ctx.setups.list({ status: status === 'All' ? null : status });
    if (!arr.length) frames.append(h('p', { class: 'tp-empty' }, 'No setups yet. Create your first idea →'));
    for (const s of arr) {
      const card = h('article', { class: 'tp-setupcard' },
        h('div', { class: 'tp-setupcard__top' },
          h('div', {}, h('strong', {}, s.title || 'Untitled'), h('span', {}, `${s.symbol} · ${s.timeframe}`)),
          h('span', { class: 'tp-badge tp-badge--' + (s.status || 'Idea').toLowerCase() }, s.status || 'Idea')),
        h('div', { class: 'tp-setupcard__meta' },
          h('span', { class: (s.direction || 'LONG') === 'LONG' ? 'up' : 'down' }, s.direction || 'LONG'),
          h('span', {}, `E ${fmtNum(s.entry)}`), h('span', {}, `S ${fmtNum(s.stop)}`), h('span', {}, `T1 ${fmtNum(s.t1)}`),
          h('span', { class: 'tp-rr' }, `R:R ${s.rr || '—'}`)),
        s.notes ? h('p', { class: 'tp-setupcard__notes' }, s.notes) : null,
        h('div', { class: 'tp-setupcard__foot' },
          h('span', { class: 'tp-fade' }, fmtDate(s.updatedAt)),
          h('div', {}, h('button', { class: 'tp-btn tp-btn--ghost tp-btn--sm', onclick: () => { ctx.workspace.switch(s.workspaceId || ctx.workspace.currentId); ctx.router.go('/workspace'); } }, 'Open Chart'),
            h('button', { class: 'tp-btn tp-btn--ghost tp-btn--sm', onclick: () => setupModal(ctx, s, () => draw('All')) }, 'Edit'),
            h('button', { class: 'tp-btn tp-btn--ghost tp-btn--sm tp-btn--danger', onclick: async () => { if (await confirmDialog({ title: 'Delete setup', message: 'Delete this setup?', danger: true })) { await ctx.setups.delete(s.id); draw('All'); } } }, 'Delete'))));
      frames.append(card);
    }
  }
  frames.querySelectorAll ? 0 : 0;
  draw('All');
}
function setupModal(ctx, s, cb) {
  const f = v => h('input', { type: 'number', step: 'any', value: v ?? '', class: 'tp-field' });
  const fields = {
    title: h('input', { type: 'text', value: s?.title || '', placeholder: 'Setup title', class: 'tp-field' }),
    symbol: h('input', { type: 'text', value: s?.symbol || 'NIFTY 50', class: 'tp-field' }),
    direction: h('select', { class: 'tp-field' }, ['LONG', 'SHORT'].map(d => h('option', { value: d, selected: (s?.direction || 'LONG') === d }, d))),
    status: h('select', { class: 'tp-field' }, ctx.setups.statuses().map(st => h('option', { value: st, selected: s?.status === st }, st))),
    timeframe: h('input', { type: 'text', value: s?.timeframe || '15m', class: 'tp-field' }),
    entry: f(s?.entry), stop: f(s?.stop), t1: f(s?.t1), t2: f(s?.t2), t3: f(s?.t3),
    notes: h('textarea', { placeholder: 'Notes…', class: 'tp-field' }, s?.notes || ''),
  };
  const label = (t) => (c) => h('label', { class: 'tp-prop' }, h('span', {}, t), c);
  const body = h('div', { class: 'tp-form' },
    label('Title')(fields.title), label('Symbol')(fields.symbol), h('div', { class: 'tp-form__row' }, label('Direction')(fields.direction), label('Status')(fields.status)), label('Timeframe')(fields.timeframe),
    h('div', { class: 'tp-form__row' }, label('Entry')(fields.entry), label('Stop')(fields.stop), label('Target 1')(fields.t1)),
    h('div', { class: 'tp-form__row' }, label('Target 2')(fields.t2), label('Target 3')(fields.t3)), label('Notes')(fields.notes));
  const footer = h('div', { class: 'tp-modal__actions' },
    h('button', { class: 'tp-btn tp-btn--ghost', onclick: () => { document.querySelector('.tp-modal__close')?.click(); } }, 'Cancel'),
    h('button', { class: 'tp-btn tp-btn--primary', onclick: async () => {
      const data = { title: fields.title.value, symbol: fields.symbol.value, direction: fields.direction.value, status: fields.status.value,
        timeframe: fields.timeframe.value, entry: fields.entry.value, stop: fields.stop.value, t1: fields.t1.value, t2: fields.t2.value, t3: fields.t3.value, notes: fields.notes.value };
      if (s) await ctx.setups.update(s.id, data); else await ctx.setups.create(data);
      document.querySelector('.tp-modal__close')?.click(); showToast('Setup saved', { kind: 'success' }); cb?.();
    } }, s ? 'Save' : 'Create'));
  openModal({ title: s ? 'Edit Setup' : 'New Setup', body, footer, size: 'lg' });
}

export function renderJournalScreen(ctx) {
  const statsEl = h('div', { class: 'tp-stats' });
  const entriesEl = h('div', { class: 'tp-list-card' });
  const toolbar = h('div', { class: 'tp-toolbar' }, h('strong', {}, 'Trading Journal'),
    h('span', { class: 'tp-toolbar__spacer' }, ''),
    h('button', { class: 'tp-btn tp-btn--ghost', onclick: () => exportJournalCSV(ctx) }, 'Export CSV'),
    h('button', { class: 'tp-btn tp-btn--primary', onclick: () => journalModal(ctx, null, () => draw()) }, '＋ New Entry'));
  const frame = screenFrame(ctx, 'Trading Journal', 'Your own track record — stats computed from your data only.', toolbar, statsEl, entriesEl);
  function draw() {
    statsEl.innerHTML = '';
    const rows = ctx.journal.list({ sort: 'date-desc' });
    const st = ctx.journal.stats(rows);
    for (const [k, label] of Object.entries({ totalEntries: 'Entries', winRate: 'Win Rate', netPnL: 'Net P&L', avgRR: 'Avg R:R', avgWin: 'Avg Win', avgLoss: 'Avg Loss' })) {
      const val = st[k];
      const fmt = k === 'winRate' ? +val + '%' : k === 'netPnL' || k === 'avgWin' || k === 'avgLoss' ? '₹' + fmtNum(val) : fmtNum(val, 2);
      statsEl.append(statCard(label, fmt));
    }
    entriesEl.innerHTML = '';
    if (!rows.length) entriesEl.append(h('p', { class: 'tp-empty' }, 'Journal is empty. Log your first trade.'));
    for (const e of rows) {
      const badge = h('span', { class: 'tp-badge tp-badge--' + (e.status || 'open').toLowerCase() }, e.status || 'OPEN');
      const card = h('article', { class: 'tp-jcard' },
        h('div', { class: 'tp-jcard__top' }, h('div', {}, h('strong', {}, `${e.symbol} · ${e.direction || 'LONG'}`), h('span', {}, fmtDate(e.date))), badge),
        h('div', { class: 'tp-jcard__meta' },
          h('span', {}, `E ${e.entry ?? '—'}`), h('span', {}, `S ${e.stop ?? '—'}`), h('span', {}, `T ${e.target ?? '—'}`),
          h('span', {}, `Exit ${e.exit ?? '—'}`), h('span', {}, `Qty ${e.quantity ?? 1}`)),
        e.pnl != null ? h('div', { class: 'tp-jcard__pnl ' + (e.pnl >= 0 ? 'up' : 'down') }, `${e.pnl >= 0 ? '+' : '−'}₹${fmtNum(Math.abs(e.pnl))}${e.rr != null ? ` · R:R ${e.rr}` : ''}`) : null,
        e.notes ? h('p', { class: 'tp-setupcard__notes' }, e.notes) : null,
        h('div', { class: 'tp-setupcard__foot' }, h('div', {},
          h('button', { class: 'tp-btn tp-btn--ghost tp-btn--sm', onclick: () => journalModal(ctx, e, () => draw()) }, 'Edit'),
          h('button', { class: 'tp-btn tp-btn--ghost tp-btn--sm tp-btn--danger', onclick: async () => { if (await confirmDialog({ title: 'Delete entry', message: 'Delete this journal entry?', danger: true })) { await ctx.journal.delete(e.id); draw(); } } }, 'Delete'))));
      entriesEl.append(card);
    }
  }
  draw();
}
function exportJournalCSV(ctx) { downloadBlob(new Blob([ctx.journal.exportCSV()], { type: 'text/csv' }), 'journal_' + Date.now() + '.csv'); showToast('Journal exported', { kind: 'success' }); }
function journalModal(ctx, e, cb) {
  const n = v => h('input', { type: 'number', step: 'any', value: v ?? '', class: 'tp-field' });
  const fields = {
    symbol: h('input', { type: 'text', value: e?.symbol || 'NIFTY 50', class: 'tp-field' }),
    direction: h('select', { class: 'tp-field' }, ['LONG', 'SHORT'].map(d => h('option', { value: d, selected: (e?.direction || 'LONG') === d }, d))),
    status: h('select', { class: 'tp-field' }, JOURNAL_STATUSES.map(s => h('option', { value: s, selected: e?.status === s }, s))),
    entry: n(e?.entry), stop: n(e?.stop), target: n(e?.target), exit: n(e?.exit), quantity: n(e?.quantity ?? 1),
    notes: h('textarea', { placeholder: 'Notes…', class: 'tp-field' }, e?.notes || ''),
  };
  const label = (t) => (c) => h('label', { class: 'tp-prop' }, h('span', {}, t), c);
  const body = h('div', { class: 'tp-form' },
    h('div', { class: 'tp-form__row' }, label('Symbol')(fields.symbol), label('Direction')(fields.direction), label('Status')(fields.status)),
    h('div', { class: 'tp-form__row' }, label('Entry')(fields.entry), label('Stop')(fields.stop), label('Target')(fields.target)),
    h('div', { class: 'tp-form__row' }, label('Exit')(fields.exit), label('Quantity')(fields.quantity)), label('Notes')(fields.notes));
  const footer = h('div', { class: 'tp-modal__actions' },
    h('button', { class: 'tp-btn tp-btn--ghost', onclick: () => document.querySelector('.tp-modal__close')?.click() }, 'Cancel'),
    h('button', { class: 'tp-btn tp-btn--primary', onclick: async () => {
      const data = { symbol: fields.symbol.value, direction: fields.direction.value, status: fields.status.value, entry: fields.entry.value || null, stop: fields.stop.value || null, target: fields.target.value || null, exit: fields.exit.value || null, quantity: fields.quantity.value || null, notes: fields.notes.value };
      if (e) await ctx.journal.update(e.id, data); else await ctx.journal.create(data);
      document.querySelector('.tp-modal__close')?.click(); showToast('Journal entry saved', { kind: 'success' }); cb?.();
    } }, e ? 'Save' : 'Add Entry'));
  openModal({ title: e ? 'Edit Entry' : 'New Journal Entry', body, footer, size: 'lg' });
}

export function renderWorkspacesScreen(ctx) {
  const cardsEl = h('div', { class: 'tp-list-card' });
  const frame = screenFrame(ctx, 'Workspaces', 'Switch saved workspaces or manage them.', cardsEl);
  async function draw() {
    cardsEl.innerHTML = '';
    for (const w of ctx.workspace.list()) {
      const card = h('article', { class: 'tp-wscard' + (w.id === ctx.workspace.currentId ? ' is-current' : '') },
        h('div', { class: 'tp-wscard__head' },
          h('div', {}, h('strong', {}, w.name), h('span', {}, `${w.tabs?.length || 0} tabs · updated ${fmtTimeShort(w.updatedAt)}`)),
          h('div', {}, h('button', { class: 'tp-btn tp-btn--sm' + (w.id === ctx.workspace.currentId ? ' tp-btn--ghost' : ' tp-btn--primary'), onclick: async () => { await ctx.workspace.switch(w.id); ctx.router.go('/workspace'); } }, w.id === ctx.workspace.currentId ? 'Current ✓' : 'Open'))),
        h('div', { class: 'tp-wscard__acts' },
          h('button', { class: 'tp-btn tp-btn--ghost tp-btn--sm', onclick: async () => { const nn = prompt('Rename workspace', w.name); if (nn) { await ctx.workspace.rename(w.id, nn); draw(); } } }, 'Rename'),
          h('button', { class: 'tp-btn tp-btn--ghost tp-btn--sm', onclick: async () => { await ctx.workspace.duplicate(w.id); draw(); } }, 'Duplicate'),
          h('button', { class: 'tp-btn tp-btn--ghost tp-btn--sm tp-btn--danger', onclick: async () => { if (await confirmDialog({ title: 'Delete workspace', message: `Delete "${w.name}"?`, danger: true })) { await ctx.workspace.delete(w.id); draw(); } } }, 'Delete')));
      cardsEl.append(card);
    }
    cardsEl.append(h('button', { class: 'tp-btn tp-btn--ghost', onclick: async () => { const w = await ctx.workspace.create(); ctx.router.go('/workspace'); } }, '＋ New workspace'));
  }
  draw();
}

export function renderSettingsScreen(ctx) {
  const list = [];
  const add = (title, row) => list.push({ title, row });
  const s = ctx.store.getState();
  const field = (l, c) => h('label', { class: 'tp-prop' }, h('span', {}, l), c);

  add('Appearance', h('div', { class: 'tp-form' },
    field('Theme', h('div', { class: 'tp-seg' }, ['dark', 'light', 'system'].map(th => h('button', { class: 'tp-segbtn' + ((s.theme.name || 'dark') === th ? ' is-active' : ''), onclick: () => { ctx.applyTheme(th); showToast(`Theme: ${th}`); } }, th[0].toUpperCase() + th.slice(1))))),
    field('Accent', h('input', { type: 'color', value: ctx.getAccent?.() || '#14b8a6', oninput: (e) => ctx.applyAccent(e.target.value) })),
    field('Density', h('div', { class: 'tp-seg' }, ['compact', 'comfortable'].map(d => h('button', { class: 'tp-segbtn' + ((ctx.getDensity?.() || 'compact') === d ? ' is-active' : ''), onclick: () => { ctx.applyDensity(d); } }, d))))));
  add('Defaults', h('div', { class: 'tp-form' },
    field('Default symbol', h('input', { type: 'text', value: s.settings.defaultSymbol || '', onchange: (e) => { s.settings.defaultSymbol = e.target.value; ctx.store.mutate(x => x.settings.defaultSymbol = e.target.value); } })),
    field('Default timeframe', h('select', { class: 'tp-field', onchange: (e) => ctx.store.mutate(x => x.settings.defaultTimeframe = e.target.value) }, ctx.dataProvider.tfList().map(tf => h('option', { value: tf, selected: s.settings.defaultTimeframe === tf }, tf))),
    )));
  add('Trading', h('div', { class: 'tp-form' },
    field('Account size', h('input', { type: 'number', step: 'any', value: s.analysis.account || 100000, onchange: (e) => ctx.store.mutate(x => { x.analysis.account = +e.target.value; }) })),
    field('Risk per trade %', h('input', { type: 'number', step: 'any', value: s.analysis.riskPct || 1, onchange: (e) => ctx.store.mutate(x => { x.analysis.riskPct = +e.target.value; }) }))));
  add('Data', h('div', { class: 'tp-form' },
    h('button', { class: 'tp-btn', onclick: () => exportAllData(ctx) }, 'Export all data (backup)'),
    h('button', { class: 'tp-btn', onclick: () => importAllData(ctx) }, 'Import data backup'),
    h('button', { class: 'tp-btn tp-btn--danger', onclick: async () => { if (await confirmDialog({ title: 'Erase all data', message: 'This deletes workspaces, setups, journal and files. Continue?', danger: true })) { await ctx.StorageManager.clearAll(); location.hash = '#/landing'; location.reload(); } } }, 'Erase all data')));
  add('Buttons', h('div', { class: 'tp-form' }, h('button', { class: 'tp-btn tp-btn--primary', onclick: () => createShortcutsModal(ctx) }, 'Keyboard Shortcuts')));

  const frame = screenFrame(ctx, 'Settings', 'Preferences are stored in your browser.', h('div', { class: 'tp-settings' }, list.map(section =>
    h('section', { class: 'tp-settings-section' }, h('h2', {}, section.title), section.row))));
}
export function exportAllData(ctx) {
  ctx.StorageManager.exportAll().then(payload => downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'trading-paint-backup.json'));
  showToast('Backup exported', { kind: 'success' });
}
export async function importAllData(ctx) {
  const inp = h('input', { type: 'file', accept: '.json', style: { display: 'none' } });
  document.body.append(inp);
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    try { await ctx.StorageManager.importAll(JSON.parse(await f.text())); showToast('Data imported — reloading', { kind: 'success' }); setTimeout(() => location.reload(), 800); }
    catch { showToast('Invalid backup file', { kind: 'error' }); }
  };
  inp.click();
}

export function renderHelpScreen(ctx) {
  const l = (k) => h('kbd', {}, kbdText(k));
  const groups = [
    { t: 'File', items: [
      ['Save workspace', 'Ctrl+S'], ['Save as / export', 'Ctrl+Shift+S'], ['Open', 'Ctrl+O'], ['New workspace', 'Ctrl+N']] },
    { t: 'Edit', items: [['Undo', 'Ctrl+Z'], ['Redo', 'Ctrl+Y'], ['Delete selected', 'Delete']] },
    { t: 'View', items: [['Command palette', 'Ctrl+K'], ['Shortcuts reference', 'Ctrl+/'], ['Zoom in', '='], ['Zoom out', '-'], ['Zoom 100%', '0'], ['Fullscreen', 'F']] },
    { t: 'Drawing tools', items: [['Pointer', 'V'], ['Crosshair', 'C'], ['Pan', 'H or hold Space'], ['Zoom tool', 'Z'], ['Pencil', 'P'], ['Brush', 'B'], ['Eraser', 'E'], ['Text', 'T'], ['Trend line', 'L'], ['Rectangle', 'R'], ['Circle', 'O'], ['Arrow', 'A'], ['Fib retracement', 'F'], ['Select all', 'Ctrl+A']] },
  ];
  const body = h('div', { class: 'tp-help' },
    h('section', { class: 'tp-help-get' },
      h('h2', {}, 'Quick start'), h('p', {}, 'Pick a symbol with Ctrl+K → “Change Symbol”, add a trend line with L, click-drag on the chart. Click the arrow tool in the top-right to return to the pointer. Everything you draw is saved in your browser automatically.'),
      h('ul', {}, [
        h('li', {}, h('b', {}, 'Draw'), ' — choose a tool in the ribbon (or its hotkey), then drag on the chart.'),
        h('li', {}, h('b', {}, 'Edit'), ' — pick the pointer, click an object, drag it or drag its handles. Use Properties to restyle.'),
        h('li', {}, h('b', {}, 'Layers'), ' — hide, lock, reorder, or delete objects and indicators in the right panel.'),
        h('li', {}, h('b', {}, 'Analyze'), ' — build a plan in the Analysis tab, then “Place on chart” and save as a setup.'),
        h('li', {}, h('b', {}, 'Save'), ' — autosaves to your browser every few seconds. Export PNG for sharing.')])),
    groups.map(g => h('section', { class: 'tp-help-group' }, h('h2', {}, g.t),
      h('table', { class: 'tp-keytable' }, g.items.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, l(b))))))));
  screenFrame(ctx, 'Help & Shortcuts', 'Everything keyboard-driven, everything yours.', body);
}

// ================= MODULE-SCOPE WORKSPACE HELPERS =================
function tabs() { return shell.ctx?.workspace.current?.tabs || []; }
function tab() { return tabs().find(t => t.id === shell.tabId) || tabs()[0] || null; }
function ensureTabExtras(ws) {
  for (const t of ws.tabs) {
    if (!t.drawings) t.drawings = [];
    if (!t.indicators) t.indicators = [];
    if (!t.analysis) t.analysis = { mode: null, entry: null, stop: null, t1: null, t2: null, t3: null };
  }
  if (!ws.tabs.length) ws.tabs = [shell.ctx.workspace.createDefault()].map(x => ({ ...x, drawings: [], indicators: [] }));
}
function persistTab() {
  const t = tab(); if (!t) return;
  t.drawings = shell.drawings.list();
  t.indicators = shell.indicators.items;
  shell.ctx.workspace.markDirty();
  updateSaveStatus();
}
function updateSaveStatus() {
  const st = shell.ctx?.store?.getState?.()?.saving?.status || 'saved';
  document.querySelectorAll('.tp-savestatus').forEach(el => { el.textContent = st === 'saved' ? 'Saved' : st === 'saving' ? 'Saving…' : 'Unsaved'; el.classList.toggle('tp-savestatus--dirty', st !== 'saved'); });
}
async function loadTab(t, opts = {}) {
  const ctx = shell.ctx;
  const w = ctx.workspace.current;
  shell.tabId = t.id;
  w.activeTabId = t.id;
  const chart = shell.chart, drawings = shell.drawings, indicators = shell.indicators;
  const TR = (l) => { try { window.__tr = ((window.__tr || []).concat(['LT:' + l])); } catch {} };
  await chart.loadBars({ symbol: t.symbol, timeframe: t.timeframe, keepView: opts.keepView });
  chart.setChartType(t.chartType);
  indicators.items = (t.indicators || []).map(x => ({ ...x }));
  drawings.setAll((t.drawings || []).slice());
  indicators.recompute();
  chart.invalidate();
  renderTabs(); renderChartbar(); drawWatchlist(); drawLayers(); syncPropsPanel(); fillAnalysis();
  if (opts.scrollToEnd !== false) chart.resetZoom();
}
async function addTab({ symbol, timeframe } = {}) {
  const ctx = shell.ctx, w = ctx.workspace.current;
  const prev = tab();
  const t = {
    id: 't_' + Math.random().toString(36).slice(2, 8),
    chartId: 'c_' + Math.random().toString(36).slice(2, 8),
    symbol: symbol || (prev?.symbol ?? (ctx.store.getState().settings.defaultSymbol || 'NIFTY 50')),
    timeframe: timeframe || (prev?.timeframe ?? (ctx.store.getState().settings.defaultTimeframe || '5m')),
    chartType: (prev?.chartType) || 'candle',
    drawings: [], indicators: [], analysis: { mode: null },
  };
  w.tabs.push(t); persistTab();
  await loadTab(t);
  showToast(`${t.symbol} · ${t.timeframe}`, { timeout: 1200 });
}
function closeTab(id) {
  const arr = tabs();
  const idx = arr.findIndex(t => t.id === id);
  if (idx < 0 || arr.length === 1) return;
  arr.splice(idx, 1); persistTab();
  loadTab(arr[Math.max(0, idx - 1)]);
}
async function changeSymbol(sym, tf) {
  const t = tab(); if (!t) return;
  t.symbol = sym; if (tf) t.timeframe = tf;
  persistTab(); await loadTab(t);
}
async function changeTimeframe(tf) {
  const t = tab(); if (!t) return;
  t.timeframe = tf; persistTab();
  await loadTab(t);
  renderChartbar();
}
function changeChartType(type) {
  const t = tab(); if (!t) return;
  t.chartType = type; shell.chart.setChartType(type); persistTab(); renderChartbar();
}
function setTool(toolId) {
  shell.ctx?.store.mutate(s => { s.ui.activeTool = toolId; });
  document.querySelectorAll('.tp-toolbtn').forEach(b => b.classList.toggle('is-active', b.dataset.tool === toolId));
  renderRibbon();
}
function saveAnalysisPatch(patch) {
  const t = tab(); if (!t) return;
  t.analysis = { ...t.analysis, ...patch };
  shell.ctx.store.mutate(s => { s.analysis = { ...s.analysis, ...patch }; });
  persistTab();
}