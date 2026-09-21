// TradeLab — Chart Engine
// Canvas chart with candle/line/area/bar renderers, anchored zoom, panning,
// crosshair, hover tooltip, grid, price/time scales, volume and indicator panes.
//
// View model: (visStart, visSpan) describe the visible window in bar-index space.
//   barToX(i) = chartX + ((i - visStart) / visSpan) * chartW
//   xToBar(x) = visStart + ((x - chartX) / chartW) * visSpan
// Drawings store (i, y) anchors so they track pan/zoom automatically.

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export class ChartEngine {
  constructor(canvas, { getBars, symbol = 'NIFTY 50', timeframe = '5m', chartType = 'candle', ui = null, demo = true } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getBars = getBars || (async () => []);
    this.symbol = symbol;
    this.timeframe = timeframe;
    this.chartType = chartType;
    this.demo = demo;
    // Mutable UI preferences updated by shell (grid/crosshair/volume/…)
    this.ui = ui || { grid: true, crosshair: true, volume: true, tooltip: true, candleStyle: 'filled' };

    this.bars = [];
    this.visStart = 0;
    this.visSpan = 88;

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.hover = null;
    this.onHover = null;
    this.onRangeChange = null;
    this._raf = null;
    this._listeners = [];
    this._ptrs = new Map();

    this.drawings = [];
    this.overlays = [];
    this.subpaneLayers = [];

    // layout metrics (computed on resize)
    this.width = 0; this.height = 0;
    this.chartX = 0; this.chartY = 0; this.chartW = 200; this.chartH = 200;
    this.priceW = 74; this.timeH = 24; this.volH = 56; this.subH = 96;
    this.volY = 0; this.timeY = 0;

    this._pal = null;
    this._watch();
    this.resize();
  }

  // ---- lifecycle ----
  async loadBars({ symbol, timeframe, keepView = false } = {}) {
    if (symbol) this.symbol = symbol;
    if (timeframe) this.timeframe = timeframe;
    this.bars = await this.getBars(this.symbol, this.timeframe);
    if (!keepView) {
      this.visSpan = clamp(88, 20, Math.max(20, this.bars.length));
      this.visStart = Math.max(0, this.bars.length - this.visSpan);
    }
    this._clampView();
    this.invalidate();
    return this.bars;
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.width = Math.max(180, r.width);
    this.height = Math.max(140, r.height);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._layout();
    this.invalidate();
  }

  _layout() {
    const w = this.width, h = this.height;
    this.priceW = w < 640 ? 62 : 74;
    this.timeH = 24;
    this.volH = Math.max(36, Math.min(96, h * 0.16));
    this.subH = 82;
    const nSub = this.subpaneLayers.length;
    this.chartX = 0;
    this.chartY = 0;
    this.chartW = w - this.priceW;
    this.chartH = Math.max(120, h - this.timeH - this.volH - nSub * this.subH);
    this.volY = this.chartY + this.chartH;
    this.timeY = this.chartY + this.chartH + this.volH + nSub * this.subH;
  }
  subPaneCount() { return this.subpaneLayers.length; }

  // ---- coordinate / view helpers ----
  barToX(i) { return this.chartX + ((i - this.visStart) / Math.max(0.001, this.visSpan)) * this.chartW; }
  xToBar(x) {
    const i = this.visStart + ((x - this.chartX) / Math.max(0.001, this.chartW)) * this.visSpan;
    return clamp(Math.round(i), 0, Math.max(0, this.bars.length - 1));
  }
  xToBarF(x) { return this.visStart + ((x - this.chartX) / Math.max(0.001, this.chartW)) * this.visSpan; }
  pixelToBars(dx) { return (dx / Math.max(0.001, this.chartW)) * this.visSpan; }

  priceToY(price) {
    const bars = this.visibleBars();
    if (!bars.length) return this.chartY + this.chartH / 2;
    const st = this._priceRange(bars);
    return this.chartY + this.chartH * (1 - (price - st.min) / (st.max - st.min || 1));
  }
  yToPrice(y) {
    const bars = this.visibleBars();
    if (!bars.length) return 0;
    const st = this._priceRange(bars);
    return st.min + (1 - (y - this.chartY) / Math.max(1, this.chartH)) * (st.max - st.min || 1);
  }

  screenToChart(e) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    return { x, y, barIdx: this.xToBar(x), barF: this.xToBarF(x), price: this.yToPrice(y) };
  }
  getBarAt(i) { return i == null ? null : this.bars[i] || null; }
  visibleBars() { const v = this._effectiveVisible(); return this.bars.slice(v.start, v.end); }

  _effectiveVisible() {
    const s = Math.max(0, Math.floor(this.visStart));
    const e = clamp(Math.ceil(this.visStart + this.visSpan), s, this.bars.length);
    return { start: s, end: e };
  }

  _clampView() {
    const total = Math.max(1, this.bars.length);
    this.visSpan = clamp(this.visSpan, 4, Math.max(8, total + 8));
    this.visStart = clamp(this.visStart, -total * 0.3, Math.max(0, total - 2));
  }

  panPixels(dx) { this.visStart -= this.pixelToBars(dx); this._clampView(); this.invalidate(); }
  zoomAt(screenX, factor) {
    const anchorBar = this.xToBarF(screenX);
    const frac = (screenX - this.chartX) / Math.max(0.001, this.chartW);
    this.visSpan = clamp(this.visSpan * factor, 4, Math.max(8, this.bars.length + 8));
    this.visStart = anchorBar - frac * this.visSpan;
    this._clampView();
    this.invalidate();
  }
  zoomIn(factor = 0.82) { const c = this.chartW / 2; this.zoomAt(c, factor); return this.visSpan; }
  zoomOut(factor = 1.22) { const c = this.chartW / 2; this.zoomAt(c, factor); return this.visSpan; }
  resetZoom() { this.loadBars({ keepView: false }); }
  setChartType(t) { this.chartType = t; this.invalidate(); }

  // ---- events ----
  _watch() {
    const c = this.canvas;
    const onDown = e => this._onDown(e);
    const onMove = e => this._onMove(e);
    const onUp = e => this._onUp(e);
    const onWheel = e => { e.preventDefault(); this._onWheel(e); };
    const onResize = () => this.resize();
    c.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    c.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);
    this._listeners = [
      ['pointerdown', c, onDown], ['pointermove', window, onMove],
      ['pointerup', window, onUp], ['pointercancel', window, onUp],
      ['wheel', c, onWheel, { passive: false }], ['resize', window, onResize],
    ];
  }
  destroy() {
    for (const [type, target, h, opts] of this._listeners) {
      try { target.removeEventListener(type, h, opts); } catch {}
    }
    this._listeners = [];
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  _onDown(e) {
    this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this._ptrs.size === 1) {
      this._panning = { x: e.clientX, y: e.clientY, visStart: this.visStart };
    } else if (this._ptrs.size === 2) {
      this._pinch = this._pinchDist();
    }
    try { this.canvas.setPointerCapture?.(e.pointerId); } catch {}
  }
  _onMove(e) {
    const pos = this.screenToChart(e);
    this.hover = pos;
    this.onHover?.(pos, this.getBarAt(pos.barIdx));

    // pinch zoom
    if (this._ptrs.has(e.pointerId)) {
      this._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._ptrs.size === 2 && this._pinch) {
        const d = this._pinchDist();
        if (this._pinch > 0 && d > 0) {
          const f = this._pinch / d;
          this.zoomAt(this.chartW / 2, f);
          this._pinch = d;
        }
        return;
      }
    }
    if (this._panning && this._ptrs.size < 2) {
      const dx = e.clientX - this._panning.x;
      this.panPixels(dx);
    } else {
      this.invalidate();
    }
  }
  _onUp(e) {
    this._ptrs.delete(e.pointerId);
    this._panning = null;
    this._pinch = null;
  }
  _pinchDist() {
    const p = [...this._ptrs.values()];
    if (p.length < 2) return 0;
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }
  _onWheel(e) {
    const factor = Math.exp(e.deltaY * 0.0016);
    this.zoomAt(e.offsetX ?? this.chartW / 2, factor);
  }

  // ---- palette (resolved CSS tokens for canvas) ----
  _ensurePalette() {
    if (this._pal) return this._pal;
    const g = s => { const v = getComputedStyle(document.documentElement).getPropertyValue(s).trim(); return v || 'inherit'; };
    this._pal = {
      bg: g('--canvas'), grid: g('--grid'), grid2: g('--grid2'),
      text: g('--text'), muted: g('--muted'), border: g('--border'), border2: g('--border2'),
      accent: g('--accent'), green: g('--green'), red: g('--red'), amber: g('--amber'),
      panel: g('--elev'), panel2: g('--panel'),
    };
    return this._pal;
  }
  refreshPalette() { this._pal = null; this.invalidate(); }

  invalidate() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = null; this.render(); });
  }

  // ---- render ----
  render() {
    const ctx = this.ctx, w = this.width, h = this.height;
    ctx.clearRect(0, 0, w, h);
    const pal = this._ensurePalette();
    ctx.fillStyle = pal.bg;
    ctx.fillRect(0, 0, w, h);
    if (this.ui.grid !== false) this._drawGrid();
    if (this.ui.volume !== false) this._drawVolume();
    this._drawBars();
    this._drawOverlays();
    this._drawSubPanes();
    this._drawPriceScale();
    this._drawTimeScale();
    if (typeof this.onDrawOverlay === 'function') this.onDrawOverlay(ctx);
    if (this.ui.crosshair !== false) this._drawCrosshair();
    this._drawLastPrice();
    this._drawDividers();
    if (this.demo) this._drawDemoBadge();
    this.onRangeChange?.(this._effectiveVisible());
  }

  _drawDividers() {
    const ctx = this.ctx, pal = this._ensurePalette();
    ctx.strokeStyle = pal.border; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.chartW + 0.5, this.chartY); ctx.lineTo(this.chartW + 0.5, this.chartY + this.chartH);
    ctx.moveTo(this.chartX, this.volY + 0.5); ctx.lineTo(this.chartW, this.volY + 0.5);
    ctx.moveTo(this.chartX, this.timeY + 0.5); ctx.lineTo(this.chartW, this.timeY + 0.5);
    ctx.stroke();
  }

  _drawGrid() {
    const ctx = this.ctx, pal = this._ensurePalette();
    ctx.strokeStyle = pal.grid; ctx.lineWidth = 1; ctx.setLineDash([]);
    const bars = this.visibleBars();
    if (bars.length) {
      const st = this._priceRange(bars);
      const steps = 7;
      for (let i = 0; i <= steps; i++) {
        const p = st.min + (st.max - st.min) * (i / steps);
        const y = this.priceToY(p);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.chartW, y); ctx.stroke();
      }
    }
    const range = this._effectiveVisible();
    const cols = 8;
    for (let i = 0; i <= cols; i++) {
      const x = this.chartX + (i / cols) * this.chartW;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.chartY + this.chartH); ctx.stroke();
    }
  }

  _drawVolume() {
    const ctx = this.ctx, pal = this._ensurePalette();
    const bars = this.visibleBars();
    const max = Math.max(1, ...bars.map(b => b.v || 0));
    const range = this._effectiveVisible();
    const slot = this.chartW / Math.max(1, range.end - range.start);
    const bw = Math.max(1, slot * 0.7);
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const idx = range.start + i;
      const x = this.barToX(idx);
      const h = ((b.v || 0) / max) * Math.max(8, this.volH - 6);
      ctx.fillStyle = b.c >= b.o ? pal.green + '77' : pal.red + '77';
      ctx.fillRect(x - bw / 2, this.volY + this.volH - h, bw, h);
    }
    ctx.fillStyle = pal.muted; ctx.font = '9px system-ui'; ctx.textAlign = 'left';
    ctx.fillText('VOLUME', 6, this.volY + 11);
  }

  _drawBars() {
    const bars = this.visibleBars();
    if (!bars.length) return;
    const range = this._effectiveVisible();
    const slot = this.chartW / Math.max(1, range.end - range.start);
    const bw = Math.max(1, slot * 0.72);
    const ctx = this.ctx, pal = this._ensurePalette();

    if (this.chartType === 'line' || this.chartType === 'area') {
      ctx.beginPath(); ctx.strokeStyle = pal.accent; ctx.lineWidth = 1.6;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      for (let i = 0; i < bars.length; i++) {
        if (bars[i].c == null) continue;
        const x = this.barToX(range.start + i), y = this.priceToY(bars[i].c);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      if (this.chartType === 'area') {
        const lastX = this.barToX(range.end - 1), firstX = this.barToX(range.start);
        const baseY = this.chartY + this.chartH;
        ctx.lineTo(lastX, baseY); ctx.lineTo(firstX, baseY); ctx.closePath();
        ctx.fillStyle = pal.accentSoft; ctx.fill();
      }
      return;
    }
    if (this.chartType === 'bar') {
      for (let i = 0; i < bars.length; i++) {
        const b = bars[i], idx = range.start + i;
        const x = this.barToX(idx);
        const yO = this.priceToY(b.o), yC = this.priceToY(b.c), yH = this.priceToY(b.h), yL = this.priceToY(b.l);
        const col = b.c >= b.o ? pal.green : pal.red;
        ctx.strokeStyle = col; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x - bw / 3, yO); ctx.lineTo(x, yO); ctx.moveTo(x, yC); ctx.lineTo(x + bw / 3, yC); ctx.stroke();
      }
      return;
    }
    // candles
    const hollow = this.ui.candleStyle === 'hollow';
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i], idx = range.start + i;
      const x = this.barToX(idx);
      const yO = this.priceToY(b.o), yC = this.priceToY(b.c), yH = this.priceToY(b.h), yL = this.priceToY(b.l);
      const up = b.c >= b.o;
      const col = up ? pal.green : pal.red;
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();
      const bodyTop = Math.min(yO, yC), bodyH = Math.max(1, Math.abs(yO - yC));
      if (hollow && bodyH > 1) { ctx.fillStyle = pal.bg; ctx.strokeRect(x - bw / 2, bodyTop, bw, bodyH); }
      else ctx.fillRect(x - bw / 2, bodyTop, bw, bodyH);
    }
  }

  _drawOverlays() {
    const ctx = this.ctx;
    for (const ov of this.overlays || []) {
      if (!ov.data || !ov.data.length) continue;
      ctx.beginPath();
      ctx.strokeStyle = ov.color || 'var(--amber,#f59e0b)';
      ctx.lineWidth = ov.width || 1.3;
      let started = false;
      for (let i = 0; i < ov.data.length; i++) {
        if (ov.data[i].y == null) { started = false; continue; }
        const x = this.barToX(ov.data[i].i ?? i);
        const y = this.priceToY(ov.data[i].y);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  _drawSubPanes() {
    if (!this.subpaneLayers.length) return;
    const ctx = this.ctx, pal = this._ensurePalette();
    for (let li = 0; li < this.subpaneLayers.length; li++) {
      const lyr = this.subpaneLayers[li];
      const y0 = this.chartY + this.chartH + this.volH + li * this.subH;
      ctx.save();
      ctx.strokeStyle = pal.border;
      ctx.strokeRect(this.chartX + 0.5, y0 + 0.5, this.chartW - 1, this.subH - 1);
      ctx.fillStyle = pal.muted; ctx.font = '9px system-ui';
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(lyr.label || 'INDICATOR', this.chartX + 6, y0 + 12);

      for (const s of lyr.series || []) {
        ctx.beginPath();
        ctx.strokeStyle = s.color || pal.accent;
        ctx.lineWidth = s.width || 1.2;
        let started = false;
        for (let i = 0; i < s.data.length; i++) {
          if (s.data[i].y == null) { started = false; continue; }
          const x = this.barToX(i);
          const lo = s.min ?? 0, hi = s.max ?? 100;
          const y = y0 + this.subH - ((s.data[i].y - lo) / Math.max(1e-9, hi - lo)) * (this.subH - 12);
          if (!started) { ctx.moveTo(x, y); started = true; }
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      if (lyr.bands) for (const b of lyr.bands) {
        if (!lyr.series?.[0]) continue;
        const lo = lyr.series[0].min ?? 0, hi = lyr.series[0].max ?? 100;
        const y = y0 + this.subH - ((b.level - lo) / Math.max(1e-9, hi - lo)) * (this.subH - 12);
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.strokeStyle = b.color || pal.muted;
        ctx.moveTo(this.chartX, y); ctx.lineTo(this.chartW, y); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (lyr.histogram) {
        const lo = lyr.histogram.min ?? -1, hi = lyr.histogram.max ?? 1;
        const mid = y0 + (this.subH - 12) / 2;
        for (let i = 0; i < lyr.histogram.data.length; i++) {
          const x = this.barToX(i);
          const slot = this.chartW / Math.max(1, this.visSpan);
          const bw = Math.max(1, slot * 0.5);
          const v = lyr.histogram.data[i].y || 0;
          const height = (v / Math.max(1e-9, hi - lo)) * (this.subH - 12);
          ctx.fillStyle = v >= 0 ? (lyr.histogram.positive || pal.green + 'aa') : (lyr.histogram.negative || pal.red + 'aa');
          if (v >= 0) ctx.fillRect(x - bw / 2, mid - Math.abs(height), bw, Math.abs(height));
          else ctx.fillRect(x - bw / 2, mid, bw, Math.abs(height));
        }
      }
      ctx.restore();
    }
  }

  _priceRow(ctx, x, y, w, label, bg = null) {
    const pal = this._ensurePalette();
    ctx.save();
    ctx.fillStyle = bg ?? pal.panel;
    ctx.fillRect(x, y - 9, w, 18);
    ctx.strokeStyle = pal.border2;
    ctx.strokeRect(x + 0.5, y - 8.5, w - 1, 17);
    ctx.fillStyle = pal.text;
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w - 6, y + 0.5);
    ctx.restore();
  }

  _drawPriceScale() {
    const ctx = this.ctx, pal = this._ensurePalette();
    const bars = this.visibleBars();
    if (!bars.length) return;
    const st = this._priceRange(bars);
    const steps = 7;
    ctx.fillStyle = pal.muted; ctx.font = '9px system-ui';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= steps; i++) {
      const p = st.min + (st.max - st.min) * (i / steps);
      const y = this.priceToY(p);
      this._priceRow(ctx, this.chartW, y, this.priceW, formatPrice(p));
    }
    ctx.textAlign = 'start';
  }

  _drawTimeScale() {
    const ctx = this.ctx, pal = this._ensurePalette();
    const range = this._effectiveVisible();
    const total = Math.max(1, range.end - range.start);
    const cols = 8;
    ctx.fillStyle = pal.muted; ctx.font = '9px system-ui';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= cols; i++) {
      const bi = clamp(range.start + Math.floor(i / cols * total), 0, this.bars.length - 1);
      const x = this.chartX + (i / cols) * this.chartW;
      const t = this.bars[bi]?.time;
      ctx.fillText(t ? formatTime(t, this.timeframe) : '', x, this.timeY + 13);
    }
    ctx.textAlign = 'start';
  }

  _drawCrosshair() {
    if (!this.hover) return;
    const ctx = this.ctx, pal = this._ensurePalette();
    const { x, y, barIdx, price } = this.hover;
    const inX = x >= this.chartX && x <= this.chartX + this.chartW;
    const inY = y >= this.chartY && y <= this.chartY + this.chartH;
    if (!inX && !inY) return;
    ctx.strokeStyle = pal.muted; ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    if (inY) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.chartW, y); ctx.stroke(); }
    if (inX) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.chartY + this.chartH); ctx.stroke(); }
    ctx.setLineDash([]);
    if (inY) this._priceRow(ctx, this.chartW, y, this.priceW, formatPrice(price));
    const b = this.getBarAt(barIdx);
    if (b && inX) {
      const label = formatTime(b.time, this.timeframe);
      ctx.save();
      ctx.fillStyle = pal.panel;
      const w = Math.max(70, ctx.measureText(label).width + 14);
      const bx = clamp(x - w / 2, 0, this.chartW - w);
      ctx.fillRect(bx, this.timeY + 4, w, 18);
      ctx.strokeStyle = pal.border2; ctx.strokeRect(bx + 0.5, this.timeY + 4.5, w - 1, 17);
      ctx.fillStyle = pal.text; ctx.fillText(label, bx + w / 2, this.timeY + 13);
      ctx.restore();
      if (this.ui.tooltip !== false) this._drawTooltip(x, y, b);
    }
  }

  _drawTooltip(x, y, b) {
    const ctx = this.ctx, pal = this._ensurePalette();
    const lines = [
      ['O', formatPrice(b.o), b.c >= b.o ? pal.green : pal.text],
      ['H', formatPrice(b.h), pal.text],
      ['L', formatPrice(b.l), pal.text],
      ['C', formatPrice(b.c), b.c >= b.o ? pal.green : pal.red],
      ['V', formatVol(b.v), pal.muted],
    ];
    const labelW = Math.max(...lines.map(l => ctx.measureText(l[0]).width));
    const valW = Math.max(...lines.map(l => ctx.measureText(l[1]).width));
    const w = 12 + labelW + 10 + valW + 12;
    const h = 8 + lines.length * 15 + 8;
    const bx = clamp(x + 16, 4, this.chartW - w - 4);
    const by = clamp(y + 16, 6, (this.chartY + this.chartH) - h - 6);
    ctx.save();
    ctx.fillStyle = 'rgba(12,17,23,0.96)';
    ctx.fillRect(bx, by, w, h);
    ctx.strokeStyle = pal.border; ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
    ctx.font = '10px system-ui'; ctx.textBaseline = 'middle';
    for (let i = 0; i < lines.length; i++) {
      ctx.fillStyle = pal.muted;
      ctx.fillText(lines[i][0], bx + 12, by + 10 + i * 15);
      ctx.fillStyle = lines[i][2];
      ctx.textAlign = 'right';
      ctx.fillText(lines[i][1], bx + w - 12, by + 10 + i * 15);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  _drawLastPrice() {
    const bars = this.visibleBars();
    if (!bars.length) return;
    const last = bars[bars.length - 1];
    const pal = this._ensurePalette();
    const ctx = this.ctx;
    const y = this.priceToY(last.c);
    const up = last.c >= last.o;
    const col = up ? pal.green : pal.red;
    // price peg on the axis
    ctx.save();
    ctx.fillStyle = col;
    ctx.fillRect(this.chartW + 1, y - 9, this.priceW - 2, 18);
    ctx.fillStyle = '#0b0f12'; ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(formatPrice(last.c), this.chartW + this.priceW - 6, y + 0.5);
    ctx.restore();
  }

  _drawDemoBadge() {
    const ctx = this.ctx, pal = this._ensurePalette();
    ctx.save();
    ctx.fillStyle = 'rgba(245,158,11,0.12)';
    ctx.fillRect(this.chartX, this.chartY, 104, 18);
    ctx.strokeStyle = 'rgba(245,158,11,0.35)';
    ctx.strokeRect(this.chartX + 0.5, this.chartY + 0.5, 103, 17);
    ctx.fillStyle = pal.amber;
    ctx.font = 'bold 9px system-ui';
    ctx.textBaseline = 'middle';
    ctx.fillText('DEMO DATA', this.chartX + 9, this.chartY + 9);
    ctx.restore();
  }

  _priceRange(bars) {
    let min = Infinity, max = -Infinity;
    for (const b of bars) {
      min = Math.min(min, b.l); max = Math.max(max, b.h);
      if (b.v) max = Math.max(max, b.h);
    }
    if (min === Infinity) { min = 0; max = 100; }
    const pad = (max - min) * 0.05 || 1;
    return { min: min - pad, max: max + pad };
  }
}

export function formatPrice(p, base = 0) {
  if (p == null) return '—';
  const abs = Math.abs(base || p);
  const f = abs >= 1000 ? 2 : abs >= 100 ? 2 : abs >= 10 ? 2 : abs >= 1 ? 3 : 5;
  return (+p).toLocaleString(undefined, { minimumFractionDigits: Math.min(2, f), maximumFractionDigits: f });
}
export function formatVol(v) { if (v == null) return '—'; if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'; if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K'; return String(v); }
export function formatTime(t, tf) {
  const d = new Date(t);
  const pad = n => String(n).padStart(2, '0');
  if (['1D', '1W', '1M'].includes(tf)) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}