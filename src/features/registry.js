// Feature plugins: every folder src/features/<id>/index.js whose default export is defineFeature({...}) is loaded automatically.
//
//   export default defineFeature({
//     id: 'net', order: 50,                       // lower order = earlier; ids must be unique
//     menu(api) {},                               // BEFORE a game exists (main menu): api = { ui, identity, settings, events, startGame(opts) }
//     async resolvePlanet(req) {},                // optional: return a PlanetInfo to override the world about to be created (first non-null wins)
//     init(ctx) {},                               // game objects exist (world is still loading); build UI/hotkeys/listeners here
//     ready(ctx) {},                              // world is ready, the player can move
//     update(dt, ctx) {},                         // every frame while a game exists
//     dispose(ctx) {},
//   });
// A feature that throws in any hook is logged and skipped for that hook; it can never take the game down.
const modules = import.meta.glob('./*/index.js');

export const defineFeature = (def) => def;

export class FeatureRegistry {
  constructor() { this.features = []; this.loaded = false; this.failed = []; }

  load() { return this._p || (this._p = this._load()); }   // idempotent + safe to call concurrently (menu phase and startGame both call it)

  async _load() {
    for (const [path, loader] of Object.entries(modules)) {
      try { const m = await loader(); const f = m.default; if (f && f.id) this.features.push(f); else console.warn('[HZ] feature without id:', path); }
      catch (e) { console.warn('[HZ] feature failed to load:', path, e); this.failed.push(path); }
    }
    this.features.sort((a, b) => (a.order || 100) - (b.order || 100));
    this.loaded = true;
  }

  _each(hook, fn) { for (const f of this.features) if (f[hook] && !f._dead) { try { fn(f); } catch (e) { console.error(`[HZ] feature "${f.id}" ${hook} failed:`, e); } } }

  menu(api) { this._each('menu', (f) => f.menu(api)); }
  async resolvePlanet(req) {
    for (const f of this.features) if (f.resolvePlanet) { try { const r = await f.resolvePlanet(req); if (r) return r; } catch (e) { console.error(`[HZ] feature "${f.id}" resolvePlanet failed:`, e); } }
    return null;
  }
  init(ctx) { this._each('init', (f) => f.init(ctx)); }
  ready(ctx) { this._each('ready', (f) => f.ready(ctx)); }
  update(dt, ctx) { this._each('update', (f) => f.update(dt, ctx)); }
  dispose(ctx) { this._each('dispose', (f) => f.dispose(ctx)); }
  get(id) { return this.features.find((f) => f.id === id) || null; }
}
