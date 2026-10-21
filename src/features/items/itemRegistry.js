// Item registry (ctx.items): ItemDefs registered by this feature and by others (minigames may add category 'minigame').
//
// ItemDef = {
//   id: string, name: string (pt-BR), category: 'tool'|'weapon'|'special'|'block'|'minigame', desc?: string,
//   icon?: (canvas32) => void | string (tile / model name) | number (block id),   // default: the first-person model, if any
//   stack?: number (max count per slot, default 1), cooldown?: seconds,
//   model?: first-person model spec (see models.js) — registered with the Hand,
//   use?(S, st, inp): primary click · useSecondary?(S, st, inp): secondary click · onHold?(S, st, inp): every frame while selected
//   onSelect?(S, st) · onDeselect?(S, st) · mining?: { speed } (lets the player break blocks faster) · outline?: boolean
// }
// `S` is the items runtime (player, world, combat, entities, audio, …) — see index.js.
const ID_RE = /^[a-z0-9_.:-]{1,40}$/i;
const CATS = new Set(['tool', 'weapon', 'special', 'block', 'minigame']);

export class ItemRegistry {
  constructor() { this.map = new Map(); this.list = []; this.onRegister = null; }

  /** Adds (or replaces) an item. Returns the stored def, or null when the def is invalid. */
  register(def) {
    if (!def || typeof def.id !== 'string' || !ID_RE.test(def.id)) { console.warn('[HZ] item rejected (bad id):', def && def.id); return null; }
    const d = Object.assign({ stack: 1, cooldown: 0, category: 'special' }, def);
    d.name = String(d.name || d.id).slice(0, 40);
    if (!CATS.has(d.category)) d.category = 'special';
    d.stack = Math.max(1, Math.min(99, d.stack | 0 || 1));
    const old = this.map.get(d.id);
    if (old) this.list[this.list.indexOf(old)] = d; else this.list.push(d);
    this.map.set(d.id, d);
    if (this.onRegister) this.onRegister(d);
    return d;
  }

  get(id) { return typeof id === 'string' ? this.map.get(id) || null : null; }
  all() { return this.list.slice(); }
  byCategory(cat) { return this.list.filter((d) => d.category === cat); }
}
