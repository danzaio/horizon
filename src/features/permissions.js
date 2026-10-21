// Shared permission checks. Features register predicates; an action is allowed unless some predicate returns false.
//   const off = ctx.permissions.add('break', (info) => info.y > 5 ? undefined : false);   // undefined = no opinion
//   ctx.permissions.can('break', { x, y, z, id, by: playerId })  -> boolean
// Actions in use: 'break' | 'place' | 'pvp' | 'fly' | 'use-item' (info.item) | 'explode' (info.x,y,z)
export class Permissions {
  constructor() { this._m = new Map(); }
  add(action, fn) { let s = this._m.get(action); if (!s) this._m.set(action, s = new Set()); s.add(fn); return () => s.delete(fn); }
  can(action, info = {}) {
    const s = this._m.get(action); if (!s) return true;
    for (const fn of s) { try { if (fn(info) === false) return false; } catch (e) { console.error('[HZ] permission check failed:', e); } }
    return true;
  }
}
