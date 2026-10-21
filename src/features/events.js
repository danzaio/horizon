/** Tiny synchronous pub/sub shared by the engine and every feature. Handlers must not throw: errors are logged, never propagated. */
export class EventBus {
  constructor() { this._m = new Map(); }
  /** @returns {() => void} unsubscribe */
  on(type, fn) { let s = this._m.get(type); if (!s) this._m.set(type, s = new Set()); s.add(fn); return () => s.delete(fn); }
  once(type, fn) { const off = this.on(type, (p) => { off(); fn(p); }); return off; }
  off(type, fn) { const s = this._m.get(type); if (s) s.delete(fn); }
  emit(type, payload) {
    const s = this._m.get(type); if (!s) return;
    for (const fn of [...s]) { try { fn(payload); } catch (e) { console.error(`[HZ] event handler for "${type}" failed:`, e); } }
  }
}
