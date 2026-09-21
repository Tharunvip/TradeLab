// TradeLab — Theming module
// Applies dark/light/system theme, accent color, density modes, and persists them.

const STORAGE_KEY = 'tp.settings.theme';

const THEMES = {
  dark: {
    name: 'dark',
    bg: '#0e1114',
    canvas: '#0b0f12',
    panel: '#141920',
    elev:  '#1a2028',
    chrome:'#12161b',
    chrome2:'#0f1317',
    border:'#232b36',
    border2:'#1c232c',
    text:  '#e6edf3',
    muted: '#7a8796',
    accent:'#14b8a6',
    accentSoft:'#0f766e33',
    select:'#0f766e26',
    green: '#10b981',
    red:   '#ef4444',
    amber: '#f59e0b',
    grid:  '#171d24',
    grid2: '#1f2832',
  },
  light: {
    name: 'light',
    bg: '#f5f7fa',
    canvas: '#ffffff',
    panel: '#ffffff',
    elev:  '#ffffff',
    chrome:'#f1f4f7',
    chrome2:'#e9edf1',
    border:'#e2e8f0',
    border2:'#edf0f4',
    text:  '#0f172a',
    muted: '#64748b',
    accent:'#0d9488',
    accentSoft:'#0d948820',
    select:'#0d948818',
    green: '#059669',
    red:   '#dc2626',
    amber: '#d97706',
    grid:  '#eef2f7',
    grid2: '#e5ebf1',
  }
};

let currentTheme = 'dark';
let currentAccent = '#14b8a6';
let density = 'compact';

export function applyTheme(name) {
  if (name === 'system') {
    const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    name = dark ? 'dark' : 'light';
  }
  const t = THEMES[name] ?? THEMES.dark;
  currentTheme = name;
  const root = document.documentElement;
  for (const [k,v] of Object.entries(t)) if (k !== 'name') root.style.setProperty('--'+k, cssVal(v));
  root.dataset.theme = name;
  document.body.classList.toggle('dark', name === 'dark');
  document.body.classList.toggle('light', name === 'light');
  applyAccent(currentAccent);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ name, accent: currentAccent, density })); } catch {}
  return name;
}

export function initTheme() {
  let cfg;
  try { cfg = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch {}
  currentAccent = cfg?.accent ?? '#14b8a6';
  density = cfg?.density ?? 'compact';
  applyTheme(cfg?.name ?? 'dark');
  applyDensity(density);
  // System listener
  try {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      const cur = JSON.parse(localStorage.getItem(STORAGE_KEY)||'{}')?.name;
      if (cur === 'system' || !cur) applyTheme('system');
    });
  } catch {}
}

export function applyAccent(hex) {
  currentAccent = hex;
  const root = document.documentElement;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accentSoft', hex + '33');
  root.style.setProperty('--select', hex + '18');
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: currentTheme, accent: hex, density })); } catch {}
}

export function applyDensity(mode) {
  density = mode;
  document.documentElement.dataset.density = mode;
  const px = mode === 'comfortable' ? 13 : 12;
  document.documentElement.style.setProperty('--ui-font-size', px + 'px');
  document.documentElement.style.setProperty('--ui-line', (mode === 'comfortable' ? 18 : 15) + 'px');
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ name: currentTheme, accent: currentAccent, density: mode })); } catch {}
}

export function getDensity() { return density; }
export function getAccent() { return currentAccent; }
export function getThemeName() { return currentTheme; }

function cssVal(v) { return v; }

// Inline SVG logo mark — stylized candlestick body with diagonal paint stroke.
export const LOGO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" aria-label="TradeLab logo" class="tp-logo">
  <defs>
    <linearGradient id="tp-lg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#14b8a6"/>
      <stop offset="100%" stop-color="#0ea5e9"/>
    </linearGradient>
  </defs>
  <!-- upper wick -->
  <rect x="15" y="3" width="2" height="8" fill="currentColor" opacity=".85"/>
  <!-- candle body -->
  <rect x="11" y="11" width="10" height="13" rx="1.5" fill="url(#tp-lg)"/>
  <!-- lower wick -->
  <rect x="15" y="24" width="2" height="6" fill="currentColor" opacity=".85"/>
  <!-- diagonal paint stroke swoosh on body -->
  <path d="M10 22 C 14 18, 18 16, 23 12" stroke="#f59e0b" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".95"/>
  <circle cx="23.5" cy="11.5" r="1.8" fill="#f59e0b" opacity=".95"/>
</svg>`;
