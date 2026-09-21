// TradeLab — Application entrypoint
// Bootstrap: init modules, wire router routes for each screen, mount main shell.

import { createRouter } from './router.js';
import { createStore, INITIAL_STATE } from './state.js';
import { StorageManager } from './storage.js';
import { applyTheme, initTheme, LOGO_SVG, applyAccent, applyDensity, getAccent, getDensity, getThemeName } from './theme.js';
import { createShortcuts, DEFAULT_SHORTCUT_LIST, IS_MAC, matchesKbd } from './shortcuts.js';
import { HistoryStack } from './history.js';
import { dataProvider } from './data-provider.js';
import { WorkspaceManager } from './workspace.js';
import { WatchlistManager } from './watchlist.js';
import { SetupsManager } from './setups.js';
import { JournalManager } from './journal.js';
import { FileManager } from './file-manager.js';
import { ChartEngine, formatPrice, formatVol, formatTime } from './chart.js';
import { DrawingManager, TOOL_CATEGORIES, Drawing } from './drawings.js';
import { IndicatorManager, INDICATOR_REGISTRY, bollinger, ema, sma } from './indicators.js';
import { computeAnalysis, validateAnalysis } from './trade-analysis.js';
import { openModal, showToast, confirmDialog, downloadBlob, toCSV } from './ui.js';
import { renderLanding as shellRenderLanding, renderWorkspace as shellRenderWorkspace, renderWatchlistScreen as shellRenderWatchlistScreen, renderSetupsScreen as shellRenderSetupsScreen, renderJournalScreen as shellRenderJournalScreen, renderWorkspacesScreen as shellRenderWorkspacesScreen, renderSettingsScreen as shellRenderSettingsScreen, renderHelpScreen as shellRenderHelpScreen } from './shell.js';

// Global debugging namespace
window.TP = window.TP || {};
Object.assign(window.TP, { modules: {} });

const store = createStore(INITIAL_STATE);
const history = new HistoryStack({ depth: 100 });

// Wait DOM
async function boot() {
  try {
    initTheme();
    const shortcuts = createShortcuts();
    await StorageManager.init();

    // Instantiate managers
    const workspace = new WorkspaceManager({ storage: StorageManager, store, onChange: (kind) => { store.mutate(s => { s.saving.status = 'unsaved'; }); } });
    const watchlist = new WatchlistManager({ storage: StorageManager, dataProvider });
    const setups    = new SetupsManager({ storage: StorageManager });
    const journal   = new JournalManager({ storage: StorageManager });
    const files     = new FileManager({ storage: StorageManager });

    await Promise.all([ workspace.init(), watchlist.init(), setups.init(), journal.init(), files.init() ]);
    workspace.startAutoSave(store.getState().settings.autosaveIntervalMs || 3000);

    // Seed state
    store.mutate(s => {
      s.workspaces = workspace.items;
      s.currentWorkspaceId = workspace.currentId;
      s.watchlists = Object.fromEntries(Object.values(watchlist.watchlists).map(w => [w.id, w]));
      s.activeWatchlistId = watchlist.activeId;
    });

    // Shortcut defaults
    const allShortcuts = bindDefaultShortcuts({ workspace, store, shortcuts, history });
    shortcuts.list = () => allShortcuts.map(s => ({ ...s })); // inject visible list
    // Make handlers fire from keydown
    document.addEventListener('keydown', (e) => {
      // Skip while typing in inputs unless explicitly handled
      const tag = e.target?.tagName;
      if (['INPUT','TEXTAREA','SELECT'].includes(tag)) {
        if (['Escape'].includes(e.key)) { if (shortcuts.handleEvent(e, 'View')) return; }
        // Only allow explicit global combos
        for (const entry of allShortcuts.filter(x => x.global)) {
          if (matchesKbd(e, entry.combo)) {
            e.preventDefault(); e.stopPropagation();
            return entry.handler(e);
          }
        }
        return;
      }
      // Chart/tools scope
      for (const entry of allShortcuts) {
        if (matchesKbd(e, entry.combo)) {
          e.preventDefault();
          try { entry.handler(e); } catch (err) { console.error('[TP ERROR] shortcut:', entry.id, err); showToast('Shortcut failed', {kind:'error'}); }
          return;
        }
      }
    });

    // Router
    const router = createRouter({
      '/landing':  (r) => renderLanding({ router, workspace, store, LOGO_SVG }),
      '/workspace':(r) => renderWorkspace({ router, workspace, watchlist, setups, journal, files, store, shortcuts, history, dataProvider, allShortcuts, LOGO_SVG }),
      '/watchlist':(r) => renderWatchlistScreen({ workspace, watchlist, store, router, LOGO_SVG }),
      '/setups':   (r) => renderSetupsScreen({ workspace, setups, store, router, LOGO_SVG }),
      '/journal':  (r) => renderJournalScreen({ workspace, journal, store, router, LOGO_SVG }),
      '/workspaces': (r) => renderWorkspacesScreen({ workspace, store, router, LOGO_SVG }),
      '/settings': (r) => renderSettingsScreen({ store, shortcuts: allShortcuts, StorageManager, workspace, LOGO_SVG, applyTheme, applyAccent, applyDensity }),
      '/help':     (r) => renderHelpScreen({ allShortcuts, LOGO_SVG }),
      '/':         (r) => router.go('/workspace'),
    }, {
      default: '/workspace',
      notFound: '/workspace',
      onChange: (r) => store.mutate(s => { s.router.path = r.path; s.router.params = r.params; }),
    });

    // Expose for debugging
    Object.assign(window.TP, {
      store, history, workspace, watchlist, setups, journal, files, router,
      shortcuts, StorageManager, dataProvider,
      ChartEngine, DrawingManager, IndicatorManager,
      computeAnalysis, validateAnalysis,
      LOGO_SVG, applyTheme, applyAccent, applyDensity, getAccent, getDensity, getThemeName,
      showToast, openModal, confirmDialog, downloadBlob, toCSV, formatPrice, formatVol, formatTime,
      IS_MAC, matchesKbd, TOOL_CATEGORIES, INDICATOR_REGISTRY,
    });

    if (typeof window.__TP_READY__ === 'function') try { window.__TP_READY__(); } catch {}
    window.dispatchEvent(new CustomEvent('tp:ready'));
  } catch (err) {
    console.error('[TP FATAL] bootstrap failed:', err);
    showToast('Failed to start TradeLab. Open DevTools for details.', { kind:'error', timeout: 10000 });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

// ---------- Route renderers delegated to shell module ----------
async function renderLanding(ctx)   { try { await shellRenderLanding(ctx); } catch (err) { console.error(err); showToast('Landing failed to render', {kind:'error'}); } }
async function renderWorkspace(ctx) { try { await shellRenderWorkspace(ctx); } catch (err) { console.error(err); showToast('Workspace failed to render', {kind:'error'}); } }
async function renderWatchlistScreen(ctx) { try { await shellRenderWatchlistScreen(ctx); } catch (err) { console.error(err); } }
async function renderSetupsScreen(ctx)    { try { await shellRenderSetupsScreen(ctx); } catch (err) { console.error(err); } }
async function renderJournalScreen(ctx)   { try { await shellRenderJournalScreen(ctx); } catch (err) { console.error(err); } }
async function renderWorkspacesScreen(ctx){ try { await shellRenderWorkspacesScreen(ctx); } catch (err) { console.error(err); } }
async function renderSettingsScreen(ctx)  { try { await shellRenderSettingsScreen(ctx); } catch (err) { console.error(err); } }
async function renderHelpScreen(ctx)      { try { await shellRenderHelpScreen(ctx); } catch (err) { console.error(err); } }

// ---------- Default shortcut bindings ----------
function bindDefaultShortcuts({ workspace, store, shortcuts, history }) {
  const combos = DEFAULT_SHORTCUT_LIST.slice();
  const byId = {};
  for (const entry of combos) {
    entry.handler = () => showToast(`${entry.label}`, { kind:'info', timeout: 1600 });
    byId[entry.id] = entry;
  }
  byId['save'].handler = async () => { try { await workspace.saveCurrent(); store.mutate(s => { s.saving.status = 'saved'; s.saving.lastSavedAt = Date.now(); }); showToast('Workspace saved', { kind:'success' }); } catch(e){ showToast('Save failed', { kind:'error' }); } };
  byId['save-as'].handler = async () => {
    const exp = workspace.exportFile();
    if (!exp) return showToast('No workspace to export', { kind:'warning' });
    downloadBlob(new Blob([JSON.stringify(exp, null, 2)], { type:'application/json' }), `${(exp.workspace.name || 'workspace').replace(/\s+/g,'_')}.tpworkspace`);
    showToast('Workspace exported', { kind:'success' });
  };
  byId['open'].handler = () => simulateOpenFile({ workspace });
  byId['new-workspace'].handler = async () => { const w = await workspace.create(); showToast(`Created "${w.name}"`, { kind:'success' }); };
  byId['undo'].handler = () => { const lbl = history.undo(); if (lbl) showToast(`Undo: ${lbl}`); else showToast('Nothing to undo', { kind:'info', timeout: 1200 }); };
  byId['redo'].handler = () => { const lbl = history.redo(); if (lbl) showToast(`Redo: ${lbl}`); else showToast('Nothing to redo', { kind:'info', timeout: 1200 }); };
  byId['redo-alt'].handler = byId['redo'].handler;
  byId['delete'].handler = () => window.dispatchEvent(new CustomEvent('tp:action', { detail: 'delete' }));
  byId['cmd-palette'].handler = () => window.dispatchEvent(new CustomEvent('tp:action', { detail: 'cmd-palette' }));
  byId['shortcuts'].handler = () => showShortcutsModal(combos);
  byId['escape'].handler = () => document.querySelectorAll('.tp-modal-mask').forEach(m => m.querySelector('.tp-modal__close')?.click?.());
  byId['zoom-in'].handler = () => window.dispatchEvent(new CustomEvent('tp:action', { detail: 'zoom-in' }));
  byId['zoom-out'].handler = () => window.dispatchEvent(new CustomEvent('tp:action', { detail: 'zoom-out' }));
  byId['zoom-reset'].handler = () => window.dispatchEvent(new CustomEvent('tp:action', { detail: 'zoom-reset' }));
  byId['fullscreen'].handler = () => window.dispatchEvent(new CustomEvent('tp:action', { detail: 'fullscreen' }));
  byId['find'].handler = () => window.dispatchEvent(new CustomEvent('tp:action', { detail: 'symbol-search' }));
  // Letter tools: dispatch via custom event so shell listens
  const toolShortcuts = combos.filter(c => c.group === 'Tools');
  for (const t of toolShortcuts) {
    const toolId = t.id.replace(/^t-/, '');
    t.handler = () => {
      store.mutate(s => { s.ui.activeTool = toolId; });
      window.dispatchEvent(new CustomEvent('tp:tool-changed', { detail: toolId }));
    };
  }
  return combos;
}

function showShortcutsModal(list) {
  const groups = {};
  for (const e of list) (groups[e.group] ||= []).push(e);
  const body = document.createElement('div');
  body.className = 'tp-shortcuts-list';
  body.innerHTML = Object.entries(groups).map(([g, arr]) => `
    <section class="tp-shortcuts-group">
      <h4>${g}</h4>
      <ul>${arr.map(e => `<li><span>${e.label}</span><kbd>${e.combo.replace('Ctrl+',IS_MAC?'⌘':'Ctrl+').replace('+',' + ')}</kbd></li>`).join('')}</ul>
    </section>`).join('');
  openModal({ title: 'Keyboard Shortcuts', body, size: 'lg' });
}

function simulateOpenFile({ workspace }) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.tpworkspace,.json,application/json';
  inp.onchange = async () => {
    const f = inp.files?.[0]; if (!f) return;
    try {
      const txt = await f.text();
      const data = JSON.parse(txt);
      await workspace.importFile(data);
      showToast(`Imported "${data?.workspace?.name || 'workspace'}"`, { kind:'success' });
    } catch (err) {
      console.error(err);
      showToast('Invalid or corrupted workspace file', { kind:'error' });
    }
  };
  inp.click();
}
