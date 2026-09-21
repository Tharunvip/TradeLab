// TradeLab — Shortcut registry + Command definitions
// Parses "Ctrl+S", "Ctrl+Shift+Z", "Space" combos. Register -> matches.

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
const NORM_CTRL = IS_MAC ? 'meta' : 'ctrl';

function parseKbd(combo) {
  const raw = combo.toLowerCase().trim();
  const parts = raw.split('+').map(s => s.trim());
  const mods = new Set();
  let key = '';
  for (const p of parts) {
    if (p === 'ctrl' || p === 'cmd' || p === 'command' || p === 'mod') mods.add(NORM_CTRL);
    else if (p === 'shift') mods.add('shift');
    else if (p === 'alt' || p === 'option') mods.add('alt');
    else key = p;
  }
  return { mods, key };
}

export function matchesKbd(e, combo) {
  const { mods, key } = parseKbd(combo);
  if (mods.has('ctrl') && !e.ctrlKey && !e.metaKey) return false;
  if (mods.has(NORM_CTRL) && !(e.ctrlKey || e.metaKey)) return false;
  if (mods.has('shift') && !e.shiftKey) return false;
  if (mods.has('alt') && !e.altKey) return false;
  if (!key) return true;
  const k = e.key.toLowerCase();
  if (key === k) return true;
  if (key === 'space' && k === ' ') return true;
  if (key === 'del' && (k === 'delete' || k === 'backspace')) return true;
  if (key === 'escape' && k === 'escape') return true;
  if (key === 'slash' && k === '/') return true;
  if (/^f[0-9]+$/.test(key) && k === key) return true;
  if (key.length === 1 && k === key) return true;
  return false;
}

export function createShortcuts() {
  const list = [];
  return {
    register(combo, handler, { id, label, group = 'Misc', global = false } = {}) {
      const entry = { id: id || combo, combo, handler, label: label || combo, group, global };
      list.push(entry);
      return () => { const i = list.indexOf(entry); if (i>=0) list.splice(i,1); };
    },
    list() { return list.slice(); },
    handleEvent(e, scope = null) {
      for (const entry of list) {
        if (!entry.global && scope && entry.group !== scope) continue;
        if (matchesKbd(e, entry.combo)) {
          let prevent = true;
          // Don't prevent while typing in inputs unless it's a global combo
          if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName) && !entry.global && !['Ctrl+S','Ctrl+Z','Ctrl+Y','Escape'].includes(entry.combo)) {
            prevent = false;
          }
          try { entry.handler(e); } catch (err) { console.error('[TP ERROR] Shortcut handler:', entry.id, err); }
          if (prevent) { e.preventDefault(); e.stopPropagation(); }
          return true;
        }
      }
      return false;
    },
  };
}

export const DEFAULT_SHORTCUT_LIST = [
  { id: 'save',         combo: 'Ctrl+S',        label: 'Save Workspace',          group: 'File',      global: true },
  { id: 'save-as',      combo: 'Ctrl+Shift+S',  label: 'Save Workspace As…',      group: 'File',      global: true },
  { id: 'open',         combo: 'Ctrl+O',        label: 'Open Workspace…',         group: 'File',      global: true },
  { id: 'new-workspace',combo: 'Ctrl+N',        label: 'New Workspace',           group: 'File',      global: true },
  { id: 'undo',         combo: 'Ctrl+Z',        label: 'Undo',                    group: 'Edit',      global: true },
  { id: 'redo',         combo: 'Ctrl+Y',        label: 'Redo',                    group: 'Edit',      global: true },
  { id: 'redo-alt',     combo: 'Ctrl+Shift+Z',  label: 'Redo (alt)',              group: 'Edit',      global: true },
  { id: 'delete',       combo: 'Delete',        label: 'Delete Selected',         group: 'Edit',      global: false },
  { id: 'find',         combo: 'Ctrl+F',        label: 'Search',                  group: 'Edit',      global: true },
  { id: 'cmd-palette',  combo: 'Ctrl+K',        label: 'Open Command Palette',    group: 'View',      global: true },
  { id: 'shortcuts',    combo: 'Ctrl+/',        label: 'Keyboard Shortcuts',      group: 'View',      global: true },
  { id: 'escape',       combo: 'Escape',        label: 'Cancel / Deselect',       group: 'View',      global: true },
  { id: 'fullscreen',   combo: 'F',             label: 'Toggle Fullscreen',       group: 'View',      global: false },
  { id: 'pan',          combo: 'Space',         label: 'Pan (hold)',              group: 'Chart',     global: false },
  { id: 'zoom-reset',   combo: '0',             label: 'Zoom to 100%',            group: 'Chart',     global: false },
  { id: 'zoom-in',      combo: '=',             label: 'Zoom In',                 group: 'Chart',     global: false },
  { id: 'zoom-out',     combo: '-',             label: 'Zoom Out',                group: 'Chart',     global: false },
  { id: 't-pointer',    combo: 'V',             label: 'Pointer',                 group: 'Tools',     global: false },
  { id: 't-crosshair',  combo: 'C',             label: 'Crosshair',               group: 'Tools',     global: false },
  { id: 't-pan',        combo: 'H',             label: 'Pan Tool',                group: 'Tools',     global: false },
  { id: 't-zoom',       combo: 'Z',             label: 'Zoom Tool',               group: 'Tools',     global: false },
  { id: 't-pencil',     combo: 'P',             label: 'Pencil',                  group: 'Tools',     global: false },
  { id: 't-brush',      combo: 'B',             label: 'Brush',                   group: 'Tools',     global: false },
  { id: 't-eraser',     combo: 'E',             label: 'Eraser',                  group: 'Tools',     global: false },
  { id: 't-text',       combo: 'T',             label: 'Text',                    group: 'Tools',     global: false },
  { id: 't-trendline',  combo: 'L',             label: 'Trend Line',              group: 'Tools',     global: false },
  { id: 't-rect',       combo: 'R',             label: 'Rectangle',               group: 'Tools',     global: false },
  { id: 't-circle',     combo: 'O',             label: 'Circle',                  group: 'Tools',     global: false },
  { id: 't-arrow',      combo: 'A',             label: 'Arrow',                   group: 'Tools',     global: false },
  { id: 't-fib_retrace',combo: 'G',             label: 'Fibonacci Retracement',   group: 'Tools',     global: false },
];

export { IS_MAC };
