// TradeLab — UI Helpers: toast stack, modal wrapper, shell renderer stubs.
// Filled in by Task 5 but exposed early so app.js can call showToast() on init.

const MAX_TOASTS = 3;
let toastRegion = null;

function ensureRegion() {
  if (toastRegion) return toastRegion;
  toastRegion = document.createElement('div');
  toastRegion.id = 'tp-toast-region';
  toastRegion.setAttribute('aria-live', 'polite');
  toastRegion.setAttribute('aria-atomic', 'true');
  document.body.appendChild(toastRegion);
  return toastRegion;
}

export function showToast(message, { kind = 'info', timeout = 2600, icon = null } = {}) {
  const region = ensureRegion();
  // trim oldest
  while (region.children.length >= MAX_TOASTS) region.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'tp-toast tp-toast--' + kind;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `<span class="tp-toast__icon">${iconFor(kind, icon)}</span><span class="tp-toast__msg"></span>`;
  el.querySelector('.tp-toast__msg').textContent = message;
  region.appendChild(el);
  requestAnimationFrame(() => el.classList.add('tp-toast--in'));
  setTimeout(() => {
    el.classList.remove('tp-toast--in');
    el.classList.add('tp-toast--out');
    setTimeout(() => el.remove(), 220);
  }, timeout);
  return el;
}

function iconFor(kind, custom) {
  if (custom) return custom;
  if (kind === 'success') return '✓';
  if (kind === 'error') return '!';
  if (kind === 'warning') return '⚠';
  return 'ⓘ';
}

// Modal base utility with focus trap + ESC close + click-outside close
export function openModal({ title, body, footer = null, size = 'md', onClose = null, mount = document.body }) {
  const mask = document.createElement('div');
  mask.className = 'tp-modal-mask tp-fade-in';
  mask.innerHTML = `
    <div class="tp-modal tp-modal--${size} tp-scale-in" role="dialog" aria-modal="true" aria-label="${title.replace(/"/g,'&quot;')}" tabindex="-1">
      <header class="tp-modal__header">
        <h3 class="tp-modal__title"></h3>
        <button class="tp-modal__close" aria-label="Close modal">✕</button>
      </header>
      <div class="tp-modal__body"></div>
      ${footer ? `<footer class="tp-modal__footer"></footer>` : ''}
    </div>`;
  mask.querySelector('.tp-modal__title').textContent = title;
  mask.querySelector('.tp-modal__body').append(...(body instanceof Node ? [body] : typeof body === 'string' ? [Object.assign(document.createElement('div'),{innerHTML:body})] : body || []));
  if (footer) {
    const f = mask.querySelector('.tp-modal__footer');
    f.append(...(footer instanceof Node ? [footer] : [Object.assign(document.createElement('div'),{innerHTML:footer})]));
  }
  mount.appendChild(mask);

  // Focus trap
  const focusable = () => [...mask.querySelectorAll('a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])')];
  const first = focusable()[0], last = focusable().at(-1);
  setTimeout(() => first?.focus?.(), 30);

  function onKey(e) {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') {
      const els = focusable();
      if (els.length === 0) return;
      if (e.shiftKey && document.activeElement === els[0]) { e.preventDefault(); els.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === els.at(-1)) { e.preventDefault(); els[0].focus(); }
    }
  }
  function onClickMask(e) { if (e.target === mask) close(); }

  function close() {
    mask.classList.remove('tp-fade-in'); mask.classList.add('tp-fade-out');
    const m = mask.querySelector('.tp-modal'); if (m) { m.classList.remove('tp-scale-in'); m.classList.add('tp-scale-out'); }
    setTimeout(() => { mask.remove(); document.removeEventListener('keydown', onKey); mask.removeEventListener('click', onClickMask); onClose?.(); }, 160);
  }
  mask.addEventListener('click', onClickMask);
  mask.querySelector('.tp-modal__close').addEventListener('click', close);
  document.addEventListener('keydown', onKey);

  return { el: mask, close };
}

// Confirm dialog
export function confirmDialog({ title = 'Confirm', message = '', confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
  return new Promise(resolve => {
    const footer = document.createElement('div');
    footer.className = 'tp-modal__actions';
    const cancel = document.createElement('button');
    cancel.className = 'tp-btn tp-btn--ghost'; cancel.textContent = cancelText;
    const ok = document.createElement('button');
    ok.className = 'tp-btn ' + (danger ? 'tp-btn--danger' : 'tp-btn--primary'); ok.textContent = confirmText;
    footer.append(cancel, ok);
    const body = Object.assign(document.createElement('div'), { className: 'tp-modal__content', textContent: message });
    const m = openModal({ title, body, footer, size: 'sm' });
    cancel.addEventListener('click', () => { m.close(); resolve(false); });
    ok.addEventListener('click', () => { m.close(); resolve(true); });
  });
}

// Download blob helper
export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

// CSV serializer
export function toCSV(rows) {
  if (!rows || !rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
}
