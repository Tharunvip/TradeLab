// TradeLab single-file build: bundles src/*.js (ES modules) into one classic
// script inlined into index.html, so double-clicking index.html (file://) runs.
const fs = require('fs');
const path = require('path');
const ROOT = __dirname;
const BUILD = path.join(ROOT, 'index.html');

const files = fs.readdirSync(path.join(ROOT, 'src')).filter(f => f.endsWith('.js'));
const src = {};
for (const f of files) src[f] = fs.readFileSync(path.join(ROOT, 'src', f), 'utf8');

const IMPORT_RE = /^\s*import\s+([^;]*?)\s*from\s*['"]\.\/([^'"]+)['"];?/gm;
const EXPORT_DEFAULT_RE = /^(\s*)export\s+default\s+([^;]+);?\s*$/gm;
const EXPORT_BRACE_RE = /^(\s*)export\s*\{([^}]*)\};\s*$/gm;
const EXPORT_DECL_RE = /^(\s*)export\s+(async\s+)?(function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;

function depsOf(code) {
  const deps = [];
  let m;
  while ((m = IMPORT_RE.exec(code))) deps.push(m[2]);
  return deps;
}

// topo sort (no cycles in this repo)
const order = [];
const done = new Set();
const visiting = new Set();
function visit(f) {
  if (done.has(f)) return;
  if (visiting.has(f)) throw new Error('cycle at ' + f);
  visiting.add(f);
  for (const d of depsOf(src[f])) visit(d);
  visiting.delete(f);
  done.add(f);
  order.push(f);
}
for (const f of files) visit(f);

function transformModule(f) {
  let code = src[f];
  const key = "'" + f + "'";

  const prelude = [];
  code = code.replace(IMPORT_RE, (full, clause, file) => {
    clause = clause.trim();
    const modKey = "'" + file + "'";
    if (clause.startsWith('* as ')) {
      prelude.push('const ' + clause.slice(5) + ' = __TP_MODS[' + modKey + '];');
    } else if (clause.startsWith('{')) {
      const inner = clause.slice(1, -1);
      const bindings = inner.split(',').map(s => s.trim()).filter(Boolean);
      const parts = bindings.map(b => {
        const [orig, alias] = b.split(/\s+as\s+/);
        return orig + (alias ? ': ' + alias : '');
      });
      prelude.push('const { ' + parts.join(', ') + ' } = __TP_MODS[' + modKey + '];');
    } else {
      prelude.push('const ' + clause + ' = __TP_MODS[' + modKey + '].default;');
    }
    return '';
  });

  const regs = [];
  code = code.replace(EXPORT_BRACE_RE, (full, ws, inner) => {
    for (const b of inner.split(',').map(s => s.trim()).filter(Boolean)) {
      const [orig, alias] = b.split(/\s+as\s+/);
      regs.push(alias ? (alias + ': ' + orig) : orig);
    }
    return '';
  });
  code = code.replace(EXPORT_DEFAULT_RE, (full, ws, value) => {
    value = value.trim();
    if (/^[A-Za-z_$][\w$]*$/.test(value)) {
      regs.push('default: ' + value);
      return '';
    }
    regs.push('default: __def0');
    return ws + 'const __def0 = ' + value + ';';
  });
  code = code.replace(EXPORT_DECL_RE, (full, ws, asyn, kw, name) => {
    regs.push(name);
    return ws + (asyn || '') + kw + ' ' + name;
  });

  const regLine = regs.length
    ? '  ' + regs.map(r => {
        const [k, v] = r.includes(':') ? r.split(/\s*:\s*/, 2) : [r, r];
        return "if (typeof " + v + " !== 'undefined') __TP_MODS[" + key + "]." + k + " = " + v + ";";
      }).join('\n  ')
    : '';

  return (
    "__TP_MODS['" + f + "'] = __TP_MODS['" + f + "'] || {};\n" +
    '(function(__M){ "use strict";\n' +
    prelude.map(p => '  ' + p).join('\n') +
    (prelude.length ? '\n' : '') +
    code +
    (regLine ? '\n' + regLine : '') +
    '\n})(__TP_MODS[\'' + f + '\']);'
  );
}

const modules = order.map(transformModule).join('\n\n');

const script = [
  'var __TP_MODS = typeof globalThis !== "undefined" ? (globalThis.__TP_MODS = globalThis.__TP_MODS || {}) : {};',
  modules,
].join('\n');

// syntax check
try {
  new Function(script);
} catch (err) {
  console.error('BUILD SYNTAX ERROR:', err.message);
  process.exit(1);
}

const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="description" content="TradeLab — a professional visual trading-analysis workspace. Draw. Analyze. Plan. Trade Smarter.">
  <meta name="color-scheme" content="dark light">
  <meta name="theme-color" content="#0b0f12">
  <title>TradeLab — Professional Chart Analysis Workspace</title>
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='12' y='12' width='10' height='13' rx='2' fill='%2314b8a6'/%3E%3Crect x='15' y='4' width='2' height='8' fill='%2314b8a6' opacity='.7'/%3E%3Crect x='15' y='25' width='2' height='5' fill='%2314b8a6' opacity='.7'/%3E%3Cpath d='M9 24 C 13 19, 18 15, 24 11' stroke='%23f59e0b' stroke-width='2.6' stroke-linecap='round' fill='none'/%3E%3C/svg%3E">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app" class="tp-app-root"></div>
  <noscript><p class="tp-nojs">TradeLab requires JavaScript to run. Please enable it in your browser.</p></noscript>
  <script>
${script}
  </script>
</body>
</html>
`;

fs.writeFileSync(BUILD, html);
console.log('Built', BUILD, '(' + (script.length / 1024).toFixed(1) + ' KB inline script,', order.length, 'modules)');

// save a copy for node-side syntax verification too
fs.writeFileSync(path.join(process.env.TEMP || '.', 'opencode', 'tp-bundle-check.js'), script);