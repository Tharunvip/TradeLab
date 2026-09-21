// TradeLab — Undo / Redo History Stack
// Push reversible {do, undo} patches or snapshot current object tree with structuredClone.
// Covers: drawings add/remove/move/edit, text content, indicators, tab create/delete, workspace rename.

export class HistoryStack {
  constructor({ depth = 100 } = {}) {
    this.depth = depth;
    this.undoStack = [];
    this.redoStack = [];
    this.transaction = null;
    this.listeners = new Set();
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit() { for (const f of this.listeners) try { f(this.canUndo, this.canRedo); } catch {} }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  beginTransaction(label) {
    if (this.transaction) this.commitTransaction();
    this.transaction = { label, ops: [] };
  }

  operation({ do: opDo, undo: opUndo, label = 'Change' }) {
    const entry = { do: opDo, undo: opUndo, label };
    if (this.transaction) this.transaction.ops.push(entry);
    else this._push(entry);
  }

  commitTransaction() {
    if (!this.transaction) return;
    const t = this.transaction; this.transaction = null;
    if (t.ops.length === 0) return;
    const composed = {
      label: t.label || t.ops[t.ops.length - 1].label,
      do: () => t.ops.forEach(o => o.do()),
      undo: () => [...t.ops].reverse().forEach(o => o.undo()),
    };
    this._push(composed);
  }

  _push(entry) {
    this.undoStack.push(entry);
    if (this.undoStack.length > this.depth) this.undoStack.shift();
    this.redoStack = [];
    this._emit();
  }

  undo() {
    if (!this.canUndo) return null;
    const e = this.undoStack.pop();
    try { e.undo?.(); } catch (err) { console.error('[TP ERROR] History undo:', err); }
    this.redoStack.push(e);
    this._emit();
    return e.label;
  }

  redo() {
    if (!this.canRedo) return null;
    const e = this.redoStack.pop();
    try { e.do?.(); } catch (err) { console.error('[TP ERROR] History redo:', err); }
    this.undoStack.push(e);
    this._emit();
    return e.label;
  }

  clear() { this.undoStack = []; this.redoStack = []; this._emit(); }

  // Convenience: capture a reversible snapshot of an object tree.
  // Call AFTER the change has already been applied; `before` is cloned at
  // push time, `after` is cloned lazily on first undo so redo replays both
  // the before and after states cleanly. Both sides must be read-only closures
  // (setState takes a full immutable snapshot).
  pushSnapshot({ getState, setState, label }) {
    const before = structuredClone(getState());
    let after = null;
    this.operation({
      label,
      do: () => { if (after !== null) setState(structuredClone(after)); },
      undo: () => {
        if (after === null) after = structuredClone(getState());
        setState(structuredClone(before));
      },
    });
  }
}

// Build a reversible patch for adding / removing a value from a collection
export function reversiblePatch({ add, remove, update }) {
  return { do: add ?? (() => {}), undo: remove ?? (() => {}) };
}
