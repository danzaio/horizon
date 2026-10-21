// Inventory (ctx.inventory): a thin, authoritative layer over the hotbar array owned by main.js (ctx.hotbar = { slots, sel }).
// Slot values: number = block id · string = item id · null = empty. `creative` (default) = unlimited; otherwise slots carry counts.

export class Inventory {
  /** @param {{hotbar:{slots:any[],sel:number}, items:object, ui:object, events:object}} o */
  constructor({ hotbar, items, ui, events }) {
    this.hb = hotbar; this.items = items; this.ui = ui; this.events = events;
    this.creative = true; this.locked = false;
    this.counts = new Array(9).fill(0);          // used when !creative
    this._cbs = new Set(); this._snap = new Array(9).fill(undefined); this._snapSel = -1;
  }

  get slots() { return this.hb.slots; }
  get sel() { return this.hb.sel; }
  /** value in the selected slot (number | string | null) */
  selected() { const v = this.hb.slots[this.hb.sel]; return v === undefined ? null : v; }
  onChange(fn) { this._cbs.add(fn); return () => this._cbs.delete(fn); }

  _valid(v) { return v === null || (typeof v === 'number' && v >= 0 && v < 256 && Number.isInteger(v)) || (typeof v === 'string' && this.items.get(v) !== null); }

  /** Replace unknown ids (old saves, items from a feature that failed to load) by empty slots. */
  sanitize() {
    const s = this.hb.slots;
    for (let i = 0; i < 9; i++) { if (s[i] === undefined || s[i] === 0 || !this._valid(s[i])) s[i] = null; }
    this.refresh(false);
  }

  /** Put a value in a slot (UI picks, drag & drop). Ignored while locked. */
  setSlot(i, v, count = 1) {
    if (this.locked || i < 0 || i > 8 || !this._valid(v === undefined ? null : v)) return false;
    this.hb.slots[i] = v === undefined ? null : v; this.counts[i] = v === null ? 0 : count;
    this.refresh(true); return true;
  }

  /** Give an item id (string) or block id (number). Stacks onto an existing slot, then fills an empty one, then replaces the selected slot (creative). */
  give(id, n = 1) {
    if (!this._valid(id) || id === null) return false;
    const s = this.hb.slots, max = typeof id === 'string' ? this.items.get(id).stack : 64;
    let left = n;
    if (!this.creative) {
      for (let i = 0; i < 9 && left > 0; i++) if (s[i] === id && this.counts[i] < max) { const a = Math.min(left, max - this.counts[i]); this.counts[i] += a; left -= a; }
      for (let i = 0; i < 9 && left > 0; i++) if (s[i] === null) { const a = Math.min(left, max); s[i] = id; this.counts[i] = a; left -= a; }
      this.refresh(true); return left === 0;
    }
    if (s.includes(id)) { this.hb.sel = s.indexOf(id); this.refresh(true); return true; }
    let i = s.indexOf(null); if (i < 0) i = this.hb.sel;
    if (this.locked && s[i] !== null) return false;
    s[i] = id; this.counts[i] = 1; this.hb.sel = i; this.refresh(true); return true;
  }

  /** Consume n of an item. Always succeeds in creative mode. */
  take(id, n = 1) {
    if (this.creative) return true;
    if (!this.has(id, n)) return false;                // all or nothing
    const s = this.hb.slots; let left = n;
    for (let i = 0; i < 9 && left > 0; i++) if (s[i] === id) { const a = Math.min(left, this.counts[i]); this.counts[i] -= a; left -= a; if (this.counts[i] <= 0) { s[i] = null; this.counts[i] = 0; } }
    this.refresh(true); return left === 0;
  }

  has(id, n = 1) {
    const s = this.hb.slots; let c = 0;
    for (let i = 0; i < 9; i++) if (s[i] === id) c += this.creative ? 99 : this.counts[i];
    return c >= n;
  }

  clear() { for (let i = 0; i < 9; i++) { this.hb.slots[i] = null; this.counts[i] = 0; } this.refresh(true); }

  /** Replace the whole hotbar (minigame loadouts): ids may be block ids or item ids; `{id, n}` objects set a count. */
  setLoadout(list) {
    const s = this.hb.slots; this.clear();
    (Array.isArray(list) ? list : []).slice(0, 9).forEach((e, i) => {
      const id = e && typeof e === 'object' ? e.id : e;
      if (this._valid(id)) { s[i] = id; this.counts[i] = e && e.n ? e.n | 0 : 1; }
    });
    this.hb.sel = 0; this.refresh(true);
  }

  lock(on = true) { this.locked = !!on; this.events.emit('inventory:lock', { locked: this.locked }); }

  /** Redraw the hotbar and notify listeners when something changed. */
  refresh(emit) {
    this.ui.setHotbar(this.hb.slots, this.hb.sel, false);
    if (emit) this._fire();
  }

  /** Cheap per-frame change check (the hotbar array is also written by main.js and the block picker). Allocation-free. */
  poll() {
    const s = this.hb.slots, c = this._snap;
    let dirty = this._snapSel !== this.hb.sel;
    for (let i = 0; i < 9 && !dirty; i++) if (c[i] !== s[i]) dirty = true;
    if (dirty) this._fire();
  }

  _fire() {
    const s = this.hb.slots;
    for (let i = 0; i < 9; i++) this._snap[i] = s[i];
    this._snapSel = this.hb.sel;
    const p = { slots: s.slice(), sel: this.hb.sel, item: this.selected() };
    this.events.emit('inventory:change', p);
    for (const fn of this._cbs) { try { fn(p); } catch (e) { console.error(e); } }
  }
}
