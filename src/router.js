// TradeLab — Hash Router
// Routes: / /landing /workspace /watchlist /setups /journal /workspaces /settings /help
// Guards + params + back/forward support

export function createRouter(routes, opts = {}) {
  const ctx = {
    routes,
    notFound: opts.notFound ?? '/landing',
    onBeforeEach: opts.onBeforeEach ?? ((from, to) => true),
    onChange: opts.onChange ?? (() => {}),
    current: { path: '/', params: {} },
  };

  function parse() {
    const h = location.hash.replace(/^#/, '') || '/';
    const [rawPath, rawQ = ''] = h.split('?');
    const params = {};
    for (const kv of rawQ.split('&').filter(Boolean)) {
      const [k, v = ''] = kv.split('=');
      params[decodeURIComponent(k)] = decodeURIComponent(v);
    }
    const path = rawPath.endsWith('/') && rawPath.length > 1 ? rawPath.slice(0, -1) : rawPath;
    return { path, params };
  }

  function resolve(path) {
    if (ctx.routes[path]) return { handler: ctx.routes[path], path };
    // exact / -> /landing if user onboarded route provided (caller decides)
    return { handler: ctx.routes[ctx.notFound], path: ctx.notFound };
  }

  async function fire() {
    const next = parse();
    const ok = await ctx.onBeforeEach(ctx.current, next);
    if (ok === false) { return; }
    const { handler, path } = resolve(next.path);
    const resolved = { path, params: next.params };
    ctx.current = resolved;
    document.body.dataset.route = path;
    document.documentElement.dataset.route = path;
    await handler?.(resolved);
    ctx.onChange?.(resolved);
    window.dispatchEvent(new CustomEvent('tp:route', { detail: resolved }));
  }

  function go(path) {
    if (typeof path !== 'string') return;
    const target = path.startsWith('#') ? path : '#' + path;
    if (location.hash === target) fire(); else location.hash = target;
  }

  function back() { history.back(); }

  let started = false;
  function initRoute() {
    if (started) return;
    started = true;
    if (!location.hash) location.hash = opts.default ?? '/';
    else fire();
  }

  window.addEventListener('hashchange', fire);
  window.addEventListener('DOMContentLoaded', initRoute);
  if (document.readyState !== 'loading') initRoute();

  return { fire, go, back, get current() { return ctx.current; } };
}

// Quick URL helpers
export function getHash() { return location.hash.slice(1) || '/'; }
