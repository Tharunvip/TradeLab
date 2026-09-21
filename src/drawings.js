// TradeLab — Drawing Manager + 30+ drawing tools + object model
// Tools hook into ChartEngine; objects are stored per chart tab, are selectable,
// movable, resizable via handles, lockable, hideable, restyled, and history-tracked.

export class Drawing {
  constructor(tool, props = {}) {
    this.id = props.id || 'd_' + Math.random().toString(36).slice(2, 10);
    this.tool = tool;
    this.points = props.points || [];
    this.color = props.color ?? '#14b8a6';
    this.lineWidth = props.lineWidth ?? 2;
    this.lineStyle = props.lineStyle ?? 'solid'; // solid | dashed | dotted
    this.opacity = props.opacity ?? 0.9;
    this.fill = props.fill ?? (props.color ?? '#14b8a6') + '33';
    this.locked = !!props.locked;
    this.hidden = !!props.hidden;
    this.label = props.label ?? null;
    this.props = props.props || {};
    this.type = 'drawing';
  }
  toJSON() { return { ...this }; }
}

export class DrawingManager {
  constructor({ chart, state, store, onAdd, onRemove, onChange, history }) {
    this.chart = chart;
    this.state = state;
    this.store = store;
    this.drawings = [];
    this.selectedId = null;
    this.current = null;
    this.onAdd = onAdd || (() => {});
    this.onRemove = onRemove || (() => {});
    this.onChange = onChange || (() => {});
    this.history = history;
    this._drag = null;
    this._freehand = false;
    this._bind();
  }

  list() { return this.drawings.slice(); }
  count() { return this.drawings.length; }

  add(d) { this.drawings.push(d); this._after(d, 'add'); this.onChange?.('add'); this.invalidate(); return d; }

  remove(id) {
    const i = this.drawings.findIndex(x => x.id === id);
    if (i < 0) return false;
    const [removed] = this.drawings.splice(i, 1);
    if (this.selectedId === id) this.selectedId = null;
    this._after(removed, 'remove');
    this.onChange?.('remove');
    this.invalidate();
    return true;
  }

  clear() {
    const all = this.drawings.slice();
    if (!all.length) return false;
    const prev = this.drawings;
    this.drawings = [];
    this.selectedId = null;
    for (const d of all) this.onRemove?.(d);
    this.history?.operation({
      label: 'Clear drawings',
      do: () => { this.drawings = prev.slice(); this.invalidate(); },
      undo: () => { this.drawings = []; this.selectedId = null; this.onChange?.('clear'); this.invalidate(); },
    });
    this.onChange?.('clear');
    this.invalidate();
    return true;
  }
  get(id) { return this.drawings.find(d => d.id === id); }
  select(id) { this.selectedId = id; this.invalidate(); this.onChange?.('select'); }
  deselect() { this.selectedId = null; this.invalidate(); this.onChange?.('select'); }
  selected() { return this.get(this.selectedId); }

  reorder(fromIdx, toIdx) {
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= this.drawings.length || toIdx === fromIdx) return false;
    const [moved] = this.drawings.splice(fromIdx, 1);
    this.drawings.splice(toIdx, 0, moved);
    this.invalidate();
    this.onChange?.('reorder');
    return true;
  }

  update(id, patch) {
    const d = this.get(id); if (!d) return null;
    const before = structuredClone(d);
    Object.assign(d, patch);
    this.history?.operation({
      label: `Style ${toolLabel(d.tool)}`,
      do: () => { Object.assign(d, structuredClone(patch)); this.invalidate(); },
      undo: () => { Object.assign(d, before); this.invalidate(); },
    });
    this.invalidate();
    this.onChange?.('edit');
    return d;
  }

  duplicate(id) {
    const d = this.get(id); if (!d) return null;
    const copy = structuredClone(d);
    copy.id = 'd_' + Math.random().toString(36).slice(2, 10);
    copy.points = (copy.points || []).map(p => ({ ...p, i: (p.i ?? 0) + 6, y: (p.y ?? 0) * 1 + 0 }));
    this.add(copy);
    this.select(copy.id);
    return copy;
  }

  setLocked(id, locked) { const d = this.get(id); if (d) { d.locked = locked; this.invalidate(); this.onChange?.('edit'); } return d; }
  setHidden(id, hidden) { const d = this.get(id); if (d) { d.hidden = hidden; this.invalidate(); this.onChange?.('edit'); } return d; }
  bringForward(id) {
    const d = this.get(id), i = this.drawings.indexOf(d);
    if (d && i < this.drawings.length - 1) { this.drawings.splice(i, 1); this.drawings.push(d); this.invalidate(); this.onChange?.('reorder'); }
  }
  sendBackward(id) {
    const d = this.get(id), i = this.drawings.indexOf(d);
    if (d && i > 0) { this.drawings.splice(i, 1); this.drawings.unshift(d); this.invalidate(); this.onChange?.('reorder'); }
  }

  findAt(x, y) {
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (d.hidden || d.locked) continue;
      if (hitTest(d, { x, y }, this.chart)) return d;
    }
    return null;
  }

  setAll(arr) { this.drawings = arr.slice(); this.invalidate(); }

  // ---------------- tool lifecycle ----------------
  beginTool(tool, color = this.state?.getState?.()?.ui?.color1 ?? '#14b8a6') {
    const ui = this.state?.getState?.()?.ui ?? {};
    this.cancel();
    const d = new Drawing(tool, {
      color, lineWidth: ui.lineWidth ?? 2, opacity: ui.opacity ?? 0.9,
      fill: color + '33', points: [],
    });
    this.current = d;
    if (tool === 'text' || tool === 'callout') {
      const txt = prompt(tool === 'callout' ? 'Callout text:' : 'Text annotation:', 'Trade note');
      if (txt === null) { this.current = null; return d; }
      d.props.text = txt || ' ';
    }
    return d;
  }
  cancel() { this.current = null; this._freehand = false; this.invalidate(); }

  finalize() {
    const d = this.current;
    this.current = null;
    this._freehand = false;
    if (!d || !validDrawing(d)) return null;
    this.add(d);
    if (this.state?.getState?.()?.settings?.autoSelectNewDrawings !== false) this.select(d.id);
    return d;
  }

  _bind() {
    const c = this.chart;
    c.onDrawOverlay = (ctx) => this.renderAll(ctx);
    const oldDown = c._onDown ? c._onDown.bind(c) : null;
    c._onDown = (e) => this._pointerDown(e, oldDown);
    const oldMove = c._onMove ? c._onMove.bind(c) : null;
    c._onMove = (e) => { this._pointerMove(e); oldMove?.(e); };
    const oldUp = c._onUp ? c._onUp.bind(c) : null;
    c._onUp = (e) => { this._pointerUp(e); oldUp?.(e); };
    c.canvas.addEventListener('dblclick', () => this._dblclick());
    c.canvas.addEventListener('pointercancel', () => this._freehand ? this.cancel() : 0);
  }

  _pointerDown(e, fallback) {
    const ui = this.state?.getState?.()?.ui ?? {};
    const tool = ui.activeTool ?? 'pointer';
    const pos = this.chart.screenToChart(e);
    const isSel = ['pointer', 'crosshair'].includes(tool);

    if (tool === 'pan') { this.cancel(); return fallback?.(e); }
    if (tool === 'zoom') {
      const factor = (e.shiftKey || e.button === 2) ? 1.2 : 0.82;
      this.chart.zoomAt(pos.x, factor);
      return;
    }
    if (isSel) {
      const handle = this._hitHandle(pos);
      if (handle) { this._drag = { type: 'handle', id: handle.id, hIdx: handle.hIdx }; return; }
      const d = this.findAt(pos.x, pos.y);
      if (d) {
        this.select(d.id);
        this._drag = { type: 'move', id: d.id, start: pos, origPoints: d.points.map(p => ({ ...p })) };
        return;
      }
      this.deselect();
      return fallback?.(e);
    }

    // Drawing tools
    const need = neededPoints(tool);
    if (!this.current) {
      this.beginTool(tool, ui.color1);
      if (!this.current) return; // cancelled (text prompt declined)
      const p = chartPointFromScreen(this.chart, pos);
      if (tool === 'long_position' || tool === 'short_position') this._seedPositionProps(this.current, p);
      if (freehand(tool)) { this._freehand = true; this.current.points.push(p); this.invalidate(); return; }
      if (need === Infinity) { this.current.points.push(p); this.invalidate(); return; }
      this.current.points.push(p);
      if (need === 1) { this.finalize(); return; }
      this.invalidate();
      return;
    }

    // In-progress fixed-point drawing: commit current preview as a click point
    const cur = this.current;
    if (cur.preview) { cur.points.push(cur.preview); cur.preview = null; }
    else cur.points.push(chartPointFromScreen(this.chart, pos));
    if (cur.points.length >= need) this.finalize();
    else this.invalidate();
  }

  _seedPositionProps(d, p) {
    const st = this.state?.getState?.() ?? {};
    const analysis = st.analysis || {};
    const info = this.chart.bars[p.i];
    const atr = info ? (info.h - info.l) : (Math.abs(p.y) * 0.005);
    const long = d.tool === 'long_position';
    let entry = analysis.entry > 0 ? analysis.entry : p.y;
    let stop = analysis.stop > 0 ? analysis.stop : (long ? entry - atr * 3 : entry + atr * 3);
    let target = analysis.t1 > 0 ? analysis.t1 : (long ? entry + atr * 6 : entry - atr * 6);
    if (long) {
      if (stop >= entry) { stop = entry * 0.985; target = entry * 1.03; }
      if (target <= entry) target = entry * 1.03;
    } else {
      if (stop <= entry) { stop = entry * 1.015; target = entry * 0.97; }
      if (target >= entry) target = entry * 0.97;
    }
    d.props.entry = +entry.toFixed(2);
    d.props.stop = +stop.toFixed(2);
    d.props.target = +target.toFixed(2);
    d.props.direction = long ? 'LONG' : 'SHORT';
  }

  _pointerMove(e) {
    const pos = this.chart.screenToChart(e);

    if (this._drag) {
      const d = this.get(this._drag.id);
      if (d && !d.locked) {
        if (this._drag.type === 'move') {
          const start = this._drag.start;
          const db = this.chart.pixelToBars(pos.x - start.x);
          const dp = pos.price - start.price;
          d.points = this._drag.origPoints.map(p => ({ ...p, i: (p.i ?? 0) + db, y: (p.y ?? 0) + dp }));
          this.onChange?.('edit');
        } else if (this._drag.type === 'handle') {
          d.points[this._drag.hIdx] = chartPointFromScreen(this.chart, pos);
          this.onChange?.('edit');
        }
        this.invalidate();
      }
      return;
    }

    if (this.current) {
      const p = chartPointFromScreen(this.chart, pos);
      if (freehand(this.current.tool)) {
        if (this._freehand && this.current.points.length) this.current.points.push(p);
      } else {
        this.current.preview = p;
      }
      this.invalidate();
    }
  }

  _pointerUp() {
    if (this._drag) {
      const d = this.get(this._drag?.id);
      if (this._drag.type === 'move' && d) {
        const orig = this._drag.origPoints;
        const moved = d.points.map(p => ({ ...p }));
        if (!samePoints(orig, moved)) {
          this.history?.operation({
            label: 'Move drawing',
            do: () => { d.points = moved.map(p => ({ ...p })); this.invalidate(); },
            undo: () => { d.points = orig.map(p => ({ ...p })); this.invalidate(); },
          });
        }
      }
      this._drag = null;
    }
    if (this._freehand) this.finalize();
  }

  _dblclick() {
    if (this.current && neededPoints(this.current.tool) === Infinity) this.finalize();
  }

  _hitHandle(pos) {
    const d = this.get(this.selectedId);
    if (!d) return null;
    for (let i = 0; i < d.points.length; i++) {
      const pt = this.chartPointToScreen(d.points[i]);
      if (Math.hypot(pt.x - pos.x, pt.y - pos.y) <= 7) return { id: d.id, hIdx: i };
    }
    return null;
  }

  chartPointToScreen(p) { return { x: this.chart.barToX(p.i ?? 0), y: this.chart.priceToY(p.y ?? 0) }; }
  invalidate() { this.chart.invalidate(); }

  _after(d, op) {
    if (op === 'add') {
      this.history?.operation({
        label: `Draw ${toolLabel(d.tool)}`,
        do: () => { if (!this.drawings.includes(d)) { this.drawings.push(d); this.invalidate(); } },
        undo: () => { const i = this.drawings.indexOf(d); if (i >= 0) this.drawings.splice(i, 1); this.invalidate(); },
      });
    } else if (op === 'remove') {
      this.history?.operation({
        label: 'Delete drawing',
        do: () => { const i = this.drawings.indexOf(d); if (i >= 0) this.drawings.splice(i, 1); this.invalidate(); },
        undo: () => { this.drawings.push(d); this.invalidate(); },
      });
    }
    this.onAdd?.(d);
  }

  // ---------------- RENDER ----------------
  renderAll(ctx) {
    const sel = this.get(this.selectedId);
    for (const d of this.drawings) if (!d.hidden) renderDrawing(ctx, this.chart, d);
    if (this.current) {
      const cur = this.current;
      const pts = (!freehand(cur.tool) && cur.preview && neededPoints(cur.tool) !== Infinity) ? [...cur.points, cur.preview] : cur.points.slice();
      if (pts.length) renderDrawing(ctx, this.chart, { ...cur, points: pts }, { inProgress: true });
    }
    if (sel) this._renderSelectionHandles(ctx, sel);
  }
  _renderSelectionHandles(ctx, d) {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = this.chart._ensurePalette().accent;
    ctx.lineWidth = 1.5;
    for (const p of d.points) {
      const { x, y } = this.chartPointToScreen(p);
      if (x < -20 || x > this.chart.width + 20 || y < -20 || y > this.chart.height + 20) continue;
      ctx.beginPath(); ctx.rect(x - 4, y - 4, 8, 8); ctx.fill(); ctx.stroke();
    }
    ctx.restore();
  }
}

function chartPointFromScreen(chart, pos) {
  return { i: chart.xToBar(pos.x), y: chart.yToPrice(pos.y) };
}

export function neededPoints(tool) {
  if (freehand(tool)) return Infinity;
  if (['hline', 'vline', 'text', 'price_label', 'callout', 'long_position', 'short_position'].includes(tool)) return 1;
  if (['channel', 'pitchfork'].includes(tool)) return 3;
  return 2;
}
function freehand(tool) { return ['pencil', 'brush', 'marker', 'eraser', 'polygon'].includes(tool); }

function validDrawing(d) {
  const need = neededPoints(d.tool);
  if (need === Infinity) return d.points.length >= (d.tool === 'polygon' ? 3 : 2);
  return d.points.length >= need;
}

function samePoints(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i].i - b[i].i) > 0.001 || Math.abs(a[i].y - b[i].y) > 0.0001) return false;
  return true;
}

function hitTest(d, pos, chart) {
  if (!d.points.length) return false;
  const P = (p) => ({ x: chart.barToX(p.i ?? 0), y: chart.priceToY(p.y ?? 0) });
  switch (d.tool) {
    case 'trendline':
    case 'ray': return distToSeg(pos, P(d.points[0]), P(d.points[1] || d.points[0])) < 7;
    case 'hline': return Math.abs(pos.y - P(d.points[0]).y) < 7;
    case 'vline': return Math.abs(pos.x - P(d.points[0]).x) < 7;
    case 'channel':
    case 'pitchfork':
    case 'polygon': {
      const pts = d.points.map(P);
      return pointInPoly(pts, pos) || pts.some((p, i) => i > 0 && distToSeg(pos, pts[i - 1], p) < 7);
    }
    case 'rect':
    case 'buy_zone':
    case 'sell_zone': {
      const a = P(d.points[0]), b = P(d.points[1] || d.points[0]);
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
      if (pos.x >= x1 - 4 && pos.x <= x2 + 4 && pos.y >= y1 - 4 && pos.y <= y2 + 4) return true;
      return false;
    }
    case 'circle': {
      const a = P(d.points[0]), b = P(d.points[1] || d.points[0]);
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      return Math.hypot(pos.x - a.x, pos.y - a.y) <= Math.max(7, r) && Math.abs(Math.hypot(pos.x - a.x, pos.y - a.y) - r) < 7;
    }
    case 'long_position':
    case 'short_position': {
      const a = P(d.points[0]);
      return Math.abs(pos.y - a.y) < 8;
    }
    case 'triangle': {
      const pts = d.points.map(P);
      if (pts.length >= 2) return pointInTri(pts[0], pts[1], pos);
      return distToSeg(pos, pts[0], pts[0]) < 10;
    }
    case 'arrow':
    case 'pencil':
    case 'brush':
    case 'marker':
    case 'eraser':
    case 'fib_retrace':
    case 'fib_extension':
    case 'fib_fan': {
      const pts = d.points.map(P);
      if (pts.length === 1) return Math.hypot(pos.x - pts[0].x, pos.y - pts[0].y) < 14;
      return pts.some((p, i) => i > 0 && distToSeg(pos, pts[i - 1], p) < 7);
    }
    case 'text':
    case 'callout': {
      const p = P(d.points[0] || { i: 0, y: 0 });
      const w = Math.max(60, String(d.props?.text || 'Text').length * 6 + 14);
      return pos.x >= p.x - 6 && pos.x <= p.x + w + 6 && pos.y >= p.y - 6 && pos.y <= p.y + 28;
    }
    case 'price_label': {
      const p = P(d.points[0] || { i: 0, y: 0 });
      return pos.x >= 0 && pos.x <= chart.chartW && Math.abs(pos.y - p.y) < 8;
    }
    default: {
      let minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
      for (const p of d.points) { const sp = P(p); minx = Math.min(minx, sp.x); miny = Math.min(miny, sp.y); maxx = Math.max(maxx, sp.x); maxy = Math.max(maxy, sp.y); }
      return pos.x >= minx - 5 && pos.x <= maxx + 5 && pos.y >= miny - 5 && pos.y <= maxy + 5;
    }
  }
}

function distToSeg(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, wx = p.x - a.x, wy = p.y - a.y;
  const c1 = vx * wx + vy * wy;
  if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
  const t = c1 / c2;
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}
function pointInPoly(pts, p) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
    if ((yi > p.y) !== (yj > p.y) && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function pointInTri(a, b, p) {
  const c = { x: (a.x + b.x) / 2, y: b.y };
  const d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
  const neg = (d1 < 0) || (d2 < 0) || (d3 < 0), pos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(neg && pos);
  function sign(p1, p2, p3) { return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y); }
}

const FIB_RET = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_EXT = [0, 0.382, 0.618, 1, 1.272, 1.618, 2.618];

export const TOOL_LABELS = {
  pointer: 'Pointer', crosshair: 'Crosshair', pan: 'Pan', zoom: 'Zoom',
  pencil: 'Pencil', brush: 'Brush', marker: 'Marker', eraser: 'Eraser',
  trendline: 'Trend Line', hline: 'Horizontal Line', vline: 'Vertical Line', ray: 'Ray',
  channel: 'Parallel Channel', pitchfork: 'Pitchfork',
  rect: 'Rectangle', circle: 'Circle', triangle: 'Triangle', polygon: 'Polygon', arrow: 'Arrow',
  fib_retrace: 'Fib Retracement', fib_extension: 'Fib Extension', fib_fan: 'Fib Fan',
  long_position: 'Long Position', short_position: 'Short Position',
  buy_zone: 'Buy Zone', sell_zone: 'Sell Zone',
  text: 'Text', price_label: 'Price Label', callout: 'Callout',
};
function toolLabel(tool) { return TOOL_LABELS[tool] || tool; }
export { toolLabel };

export function renderDrawing(ctx, chart, d, { inProgress = false } = {}) {
  ctx.save();
  const pal = chart._ensurePalette();
  ctx.strokeStyle = d.color;
  ctx.fillStyle = d.fill;
  ctx.lineWidth = d.lineWidth ?? 2;
  ctx.globalAlpha = d.opacity ?? 0.9;
  ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : d.lineStyle === 'dotted' ? [2, 4] : []);
  const P = (p) => ({ x: chart.barToX(p.i ?? 0), y: chart.priceToY(p.y ?? 0) });
  const pts = d.points;

  switch (d.tool) {
    case 'pencil':
    case 'brush':
    case 'marker':
    case 'eraser': {
      ctx.lineWidth = d.tool === 'brush' ? (d.lineWidth + 3) : d.tool === 'marker' ? (d.lineWidth + 5) : (d.lineWidth + (d.tool === 'eraser' ? 8 : 0));
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      for (const p of pts) { const sp = P(p); if (!started) { ctx.moveTo(sp.x, sp.y); started = true; } else ctx.lineTo(sp.x, sp.y); }
      if (d.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out';
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'trendline': lineExt(ctx, P(pts[0]), P(pts[1] || pts[0]), { left: d.props.extendLeft, right: d.props.extendRight }); break;
    case 'ray': lineExt(ctx, P(pts[0]), P(pts[1] || pts[0]), { right: true }); break;
    case 'hline': {
      const a = P(pts[0] || { i: 0, y: 0 });
      ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(chart.chartW, a.y); ctx.stroke(); break;
    }
    case 'vline': {
      const a = P(pts[0] || { i: 0, y: 0 });
      ctx.beginPath(); ctx.moveTo(a.x, 0); ctx.lineTo(a.x, chart.chartY + chart.chartH); ctx.stroke(); break;
    }
    case 'channel': {
      const a = P(pts[0]), b = P(pts[1] || pts[0]);
      lineExt(ctx, a, b, { right: true });
      if (pts.length >= 3) {
        const c = P(pts[2]);
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
        const off = ((c.x - a.x) * -dy / len) + ((c.y - a.y) * dx / len);
        lineExt(ctx, { x: a.x + -dy / len * off, y: a.y + dx / len * off }, { x: b.x + -dy / len * off, y: b.y + dx / len * off }, { right: true });
      }
      break;
    }
    case 'pitchfork': {
      if (pts.length >= 3) {
        const a = P(pts[0]), b = P(pts[1]), c = P(pts[2]);
        const m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
        const xFar = Math.max(chart.chartW, a.x + 5000);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y); ctx.lineTo(xFar, a.y + (xFar - a.x) * ((m.y - a.y) / Math.max(0.001, m.x - a.x)));
        ctx.moveTo(b.x, b.y); ctx.lineTo(xFar, b.y + (xFar - b.x) * ((m.y - b.y) / Math.max(0.001, m.x - b.x)));
        ctx.moveTo(a.x, a.y); ctx.lineTo(xFar, a.y + (xFar - a.x) * ((b.y - a.y) / Math.max(0.001, b.x - a.x)));
        ctx.stroke();
      } else {
        lineExt(ctx, P(pts[0]), P(pts[1] || pts[0]), { right: true });
      }
      break;
    }
    case 'rect': {
      const a = P(pts[0]), b = P(pts[1] || pts[0]);
      ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      break;
    }
    case 'buy_zone':
    case 'sell_zone': {
      const a = P(pts[0]), b = P(pts[1] || pts[0]);
      const top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
      const col = d.tool === 'buy_zone' ? pal.green : pal.red;
      ctx.globalAlpha = (d.opacity ?? 0.9) * 0.18;
      ctx.fillStyle = col;
      ctx.fillRect(0, top, chart.chartW, bottom - top);
      ctx.globalAlpha = d.opacity ?? 0.9;
      ctx.strokeStyle = col;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(chart.chartW, top); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, bottom); ctx.lineTo(chart.chartW, bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col;
      ctx.font = 'bold 10px system-ui';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillText(`${d.tool === 'buy_zone' ? 'BUY ZONE' : 'SELL ZONE'} ${chartFormat(chart.yToPrice((top + bottom) / 2))}`, 8, top + 4);
      break;
    }
    case 'circle': {
      const a = P(pts[0]), b = P(pts[1] || pts[0]);
      const r = Math.hypot(b.x - a.x, b.y - a.y);
      ctx.beginPath(); ctx.arc(a.x, a.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
    case 'triangle': {
      const a = P(pts[0]), b = P(pts[1] || pts[0]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, a.y); ctx.lineTo((a.x + b.x) / 2, b.y); ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'polygon': {
      ctx.beginPath();
      let started = false;
      for (const p of pts) { const sp = P(p); if (!started) { ctx.moveTo(sp.x, sp.y); started = true; } else ctx.lineTo(sp.x, sp.y); }
      if (!inProgress) ctx.closePath();
      ctx.fill(); ctx.stroke();
      break;
    }
    case 'arrow': {
      ctx.setLineDash([]);
      const a = P(pts[0]), b = P(pts[1] || pts[0]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const ang = Math.atan2(b.y - a.y, b.x - a.x), size = 10;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - size * Math.cos(ang - Math.PI / 6), b.y - size * Math.sin(ang - Math.PI / 6));
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - size * Math.cos(ang + Math.PI / 6), b.y - size * Math.sin(ang + Math.PI / 6));
      ctx.stroke();
      break;
    }
    case 'fib_retrace':
    case 'fib_extension': {
      const a = P(pts[0]), b = P(pts[1] || pts[0]);
      const span = Math.abs(b.y - a.y);
      const levels = d.tool === 'fib_retrace' ? FIB_RET : FIB_EXT;
      for (const lv of levels) {
        const y = d.tool === 'fib_retrace' ? a.y + span * lv : b.y + (b.y >= a.y ? 1 : -1) * span * lv;
        ctx.strokeStyle = d.color;
        ctx.globalAlpha = 0.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chart.chartW, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = d.opacity ?? 0.9;
        ctx.fillStyle = d.color;
        ctx.font = '9px system-ui'; ctx.textAlign = 'left';
        const pct = d.tool === 'fib_retrace' ? `${(lv * 100).toFixed(1)}%` : `${(lv * 100).toFixed(1)}%`;
        ctx.fillText(pct, 4, y - 2);
        ctx.textAlign = 'right';
        ctx.fillText(chartFormat(chart.yToPrice(y)), chart.chartW - 4, y - 2);
        ctx.textAlign = 'left';
      }
      ctx.setLineDash([]);
      const aa = P(pts[0]), bb = P(pts[1] || pts[0]);
      ctx.strokeStyle = d.color; ctx.lineWidth = d.lineWidth;
      ctx.beginPath(); ctx.moveTo(aa.x, aa.y); ctx.lineTo(bb.x, bb.y); ctx.stroke();
      break;
    }
    case 'fib_fan': {
      const a = P(pts[0]), b = P(pts[1] || pts[0]);
      for (const lv of [0.382, 0.5, 0.618]) {
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, a.y + (b.y - a.y) * lv); ctx.stroke();
      }
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      break;
    }
    case 'text':
    case 'callout': {
      const p = P(pts[0] || { i: 0, y: 0 });
      const msg = d.props.text || 'Text';
      const fs = d.props.fontSize || 13;
      ctx.setLineDash([]);
      ctx.font = `${fs}px system-ui`;
      const w = Math.max(36, ctx.measureText(msg).width + 14);
      const h2 = fs + 12;
      ctx.fillStyle = 'rgba(14,19,26,0.92)';
      ctx.fillRect(p.x, p.y, w, h2);
      ctx.strokeStyle = d.color; ctx.strokeRect(p.x + 0.5, p.y + 0.5, w - 1, h2 - 1);
      ctx.fillStyle = d.color;
      ctx.fillText(msg, p.x + 7, p.y + h2 - 7);
      if (d.tool === 'callout') {
        ctx.beginPath(); ctx.moveTo(p.x, p.y + h2); ctx.lineTo(p.x - 12, p.y + h2 + 16); ctx.lineTo(p.x + 16, p.y + h2);
        ctx.fillStyle = 'rgba(14,19,26,0.92)'; ctx.fill(); ctx.stroke();
      }
      break;
    }
    case 'price_label': {
      const p = P(pts[0] || { i: 0, y: 0 });
      const label = chartFormat(p.y);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = d.color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, p.y); ctx.lineTo(chart.chartW - chart.priceW, p.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = d.color;
      ctx.fillRect(chart.chartW - chart.priceW, p.y - 9, chart.priceW, 18);
      ctx.fillStyle = '#0b0f12'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'right';
      ctx.fillText(label, chart.chartW - 6, p.y + 3);
      ctx.textAlign = 'start';
      break;
    }
    case 'long_position':
    case 'short_position': {
      ctx.setLineDash([]);
      const p = P(pts[0] || { i: 0, y: 0 });
      const long = d.tool === 'long_position';
      const entry = +d.props.entry || chart.yToPrice(p.y);
      const stop = +d.props.stop || entry * (long ? 0.985 : 1.015);
      const target = +d.props.target || entry * (long ? 1.03 : 0.97);
      const eY = chart.priceToY(entry), sY = chart.priceToY(stop), tY = chart.priceToY(target);
      ctx.globalAlpha = (d.opacity ?? 0.9) * 0.16;
      ctx.fillStyle = long ? pal.green : pal.red;
      ctx.fillRect(0, Math.min(eY, sY), chart.chartW, Math.abs(sY - eY));
      ctx.fillRect(0, Math.min(eY, tY), chart.chartW, Math.abs(eY - tY));
      ctx.globalAlpha = d.opacity ?? 0.9;
      ctx.setLineDash([5, 3]);
      ctx.strokeStyle = pal.text; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(0, eY); ctx.lineTo(chart.chartW, eY); ctx.stroke();
      ctx.setLineDash([2, 4]);
      ctx.strokeStyle = long ? pal.red : pal.green;
      ctx.beginPath(); ctx.moveTo(0, sY); ctx.lineTo(chart.chartW, sY); ctx.stroke();
      ctx.strokeStyle = long ? pal.green : pal.red;
      ctx.beginPath(); ctx.moveTo(0, tY); ctx.lineTo(chart.chartW, tY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'left';
      ctx.fillStyle = pal.text;
      ctx.fillText(`${long ? 'LONG' : 'SHORT'}  ENTRY ${chartFormat(entry)}`, 8, eY - 4);
      ctx.fillStyle = long ? pal.red : pal.green;
      ctx.fillText(`STOP ${chartFormat(stop)}`, 8, Math.min(sY + 12, chart.chartY + chart.chartH - 4));
      ctx.fillStyle = long ? pal.green : pal.red;
      ctx.fillText(`TARGET ${chartFormat(target)}`, 8, Math.max(tY - 4, chart.chartY + 12));
      break;
    }
    default: {
      ctx.setLineDash([]);
      for (const p of pts) { const sp = P(p); ctx.fillRect(sp.x - 1, sp.y - 1, 2, 2); }
    }
  }
  ctx.restore();
}

function lineExt(ctx, a, b, { left = false, right = false } = {}) {
  let A = a, B = b;
  if (left || right) {
    const dx = B.x - A.x, dy = B.y - A.y;
    const f = 50000;
    if (right) B = { x: B.x + dx * f, y: B.y + dy * f };
    if (left) A = { x: A.x - dx * f, y: A.y - dy * f };
    if (!left && !right) { /* no-op */ }
  }
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
}
function chartFormat(p) { return (+p).toLocaleString(undefined, { maximumFractionDigits: 2 }); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export const TOOL_CATEGORIES = [
  { id: 'select', label: 'Select', tools: [
    { id: 'pointer', label: 'Pointer', icon: '↖' },
    { id: 'crosshair', label: 'Crosshair', icon: '✚' },
    { id: 'pan', label: 'Pan', icon: '✥' },
    { id: 'zoom', label: 'Zoom', icon: '⊞' },
  ]},
  { id: 'freehand', label: 'Freehand', tools: [
    { id: 'pencil', label: 'Pencil', icon: '✎' },
    { id: 'brush', label: 'Brush', icon: '🖌' },
    { id: 'marker', label: 'Marker', icon: '🖍' },
    { id: 'eraser', label: 'Eraser', icon: '⌫' },
  ]},
  { id: 'lines', label: 'Lines', tools: [
    { id: 'trendline', label: 'Trend Line', icon: '╱' },
    { id: 'hline', label: 'Horizontal', icon: '━' },
    { id: 'vline', label: 'Vertical', icon: '┃' },
    { id: 'ray', label: 'Ray', icon: '⇢' },
    { id: 'channel', label: 'Channel', icon: '⋕' },
    { id: 'pitchfork', label: 'Pitchfork', icon: '⟁' },
  ]},
  { id: 'shapes', label: 'Shapes', tools: [
    { id: 'rect', label: 'Rectangle', icon: '▭' },
    { id: 'circle', label: 'Circle', icon: '◯' },
    { id: 'triangle', label: 'Triangle', icon: '△' },
    { id: 'polygon', label: 'Polygon', icon: '⬠' },
    { id: 'arrow', label: 'Arrow', icon: '→' },
  ]},
  { id: 'fib', label: 'Fibonacci', tools: [
    { id: 'fib_retrace', label: 'Retracement', icon: 'Ḟ' },
    { id: 'fib_extension', label: 'Extension', icon: 'Ē' },
    { id: 'fib_fan', label: 'Fan', icon: '⋋' },
  ]},
  { id: 'trade', label: 'Trade', tools: [
    { id: 'long_position', label: 'Long Position', icon: '▲' },
    { id: 'short_position', label: 'Short Position', icon: '▼' },
    { id: 'buy_zone', label: 'Buy Zone', icon: '⬇' },
    { id: 'sell_zone', label: 'Sell Zone', icon: '⬆' },
  ]},
  { id: 'text', label: 'Text', tools: [
    { id: 'text', label: 'Text', icon: 'A' },
    { id: 'price_label', label: 'Price Label', icon: '$' },
    { id: 'callout', label: 'Callout', icon: '💬' },
  ]},
];