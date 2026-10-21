// Wild creatures in the world: spawn by biome near the player, wander, hover (fliers), stay put when nothing is around. Cheap: <= 8 alive, a few block lookups each.
import { B, SOLID, LIQUID } from '../../shared/blocks.js';
import { BIOME } from '../../world/terrain.js';
import { SPECIES, speciesById } from './data.js';

const TAU = Math.PI * 2, BIOME_NAME = Object.fromEntries(Object.entries(BIOME).map(([k, v]) => [v, k]));
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };

export class Wild {
  constructor(ctx) { this.ctx = ctx; this.world = ctx.world; this.terrain = ctx.world.terrain; this.list = []; this.nextId = 1; this.spawnT = 2; this.max = 8; }

  _solid(x, y, z) { const b = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); return b === B.UNLOADED || SOLID[b] === 1; }
  _liquid(x, y, z) { return LIQUID[this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] === 1; }

  /** pick a species for a biome + player strength */
  pick(biome, level) {
    const st = level < 16 ? 0 : level < 34 ? 1 : 2;
    let pool = SPECIES.filter((s) => !s.legend && s.hab.includes(biome) && s.stage === st);
    if (!pool.length || Math.random() < 0.3) pool = SPECIES.filter((s) => !s.legend && s.hab.includes(biome) && s.stage <= st);
    if (Math.random() < 0.012) { const L = SPECIES.filter((s) => s.legend && s.hab.includes(biome)); if (L.length) return L[(Math.random() * L.length) | 0]; }
    return pool.length ? pool[(Math.random() * pool.length) | 0] : null;
  }

  spawn(px, py, pz, spawnX, spawnZ) {
    const w = this.world, a = Math.random() * TAU, d = 14 + Math.random() * 28, x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
    const ci = this.terrain.columnInfo(Math.floor(x), Math.floor(z), 4, {}), biome = BIOME_NAME[ci.biome] || 'PLAINS';
    const lvl = Math.max(2, Math.min(40, 3 + Math.floor(Math.hypot(x - spawnX, z - spawnZ) / 140) + ((Math.random() * 4) | 0))), sp = this.pick(biome, lvl); if (!sp) return false;
    const y0 = w.getSurfaceY(Math.floor(x), Math.floor(z)) + 1.02, fly = sp.plan === 'flier', y = fly ? y0 + 2 + Math.random() * 3 : y0;
    if (w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === B.UNLOADED || this._solid(x, y, z) || this._liquid(x, y0 - 1, z) || this._liquid(x, y0, z)) return false;
    const L = sp.legend ? 40 + ((Math.random() * 8) | 0) : lvl;
    this.list.push({ id: this.nextId++, sp: sp.id, lvl: L, x, y, z, vy: 0, yaw: Math.random() * TAU, heading: Math.random() * TAU, state: 0, timer: 1 + Math.random() * 3, phase: Math.random() * 6, moving: 0, flash: 0, ground: false, fly, big: sp.legend ? 1.15 : 1, busy: false, born: 0 });
    return true;
  }

  update(dt, p, spawnX, spawnZ) {
    dt = Math.min(dt, 0.1); this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 1.6; if (this.list.length < this.max) this.spawn(p.x, p.y, p.z, spawnX, spawnZ); }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const c = this.list[i], dx = c.x - p.x, dz = c.z - p.z;
      if (dx * dx + dz * dz > 90 * 90) { this.list[i] = this.list[this.list.length - 1]; this.list.pop(); continue; }
      if (c.busy) continue; this._step(c, dt);
    }
  }

  _step(c, dt) {
    const w = this.world; if (w.getBlock(Math.floor(c.x), Math.floor(c.y), Math.floor(c.z)) === B.UNLOADED) return;
    c.born += dt; c.timer -= dt; c.flash = Math.max(0, c.flash - dt * 3);
    if (c.timer <= 0) { if (c.state === 0) { c.state = 1; c.timer = 2 + Math.random() * 4; c.heading += (Math.random() - 0.5) * 2.6; } else { c.state = 0; c.timer = 1 + Math.random() * 4; } }
    c.yaw += angDiff(c.yaw, c.heading) * Math.min(1, dt * 4);
    const sp = c.fly ? 2.6 : 1.7, walking = c.state === 1; let moved = 0;
    if (walking) {
      const vx = -Math.sin(c.yaw) * sp, vz = -Math.cos(c.yaw) * sp, nx = c.x + vx * dt, nz = c.z + vz * dt, r = 0.45;
      const blocked = this._solid(nx + Math.sign(vx) * r, c.y + 0.2, c.z) || this._solid(c.x, c.y + 0.2, nz + Math.sign(vz) * r);
      if (blocked) { if (!c.fly && c.ground && !this._solid(nx, c.y + 1.2, nz) && !this._solid(nx, c.y + 2.2, nz)) c.vy = 6.2; else { c.heading += Math.PI * (0.6 + Math.random() * 0.8); c.state = 0; c.timer = 1; } }
      else { // do not walk into water or off tall cliffs
        let drop = 0; if (!c.fly) for (let k = 1; k <= 4; k++) { if (this._solid(nx, c.y - k + 0.5, nz)) break; drop = k; }
        if (!c.fly && (drop >= 3 || this._liquid(nx, c.y - drop - 0.5, nz))) { c.heading += Math.PI; c.state = 0; c.timer = 1; } else { c.x = nx; c.z = nz; moved = sp; }
      }
    }
    if (c.fly) { const gy = w.getSurfaceY(Math.floor(c.x), Math.floor(c.z)) + 3.2 + Math.sin(c.born * 1.4 + c.id) * 0.8; c.y += (gy - c.y) * Math.min(1, dt * 1.5); }
    else {
      if (this._liquid(c.x, c.y + 0.2, c.z)) c.vy = Math.max(c.vy, 1.6); else c.vy -= 22 * dt; c.y += c.vy * dt; c.ground = false;
      if (c.vy <= 0 && this._solid(c.x, c.y - 0.02, c.z)) { c.y = Math.floor(c.y - 0.02) + 1; c.vy = 0; c.ground = true; } else if (c.vy > 0 && this._solid(c.x, c.y + 1, c.z)) c.vy = 0;
    }
    c.moving = Math.min(1, moved / 2.5); c.phase += dt * (3 + moved * 3) * (c.moving > 0.02 ? 1 : 0.2);
  }

  /** nearest wild creature along a ray (feet-based capsule). returns the creature or null */
  aim(o, d, range) {
    let best = null, bt = range;
    for (const c of this.list) {
      const sp = speciesById(c.sp), sc = [0.8, 1, 1.3][sp.stage] * c.big, r = 0.55 * sc, h = 1.1 * sc, x0 = c.x - r, x1 = c.x + r, y0 = c.y, y1 = c.y + h, z0 = c.z - r, z1 = c.z + r;
      let tmin = 0, tmax = bt, ok = true; for (const [ao, dv, lo, hi] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) { if (Math.abs(dv) < 1e-9) { if (ao < lo || ao > hi) { ok = false; break; } } else { let a = (lo - ao) / dv, b = (hi - ao) / dv; if (a > b) [a, b] = [b, a]; if (a > tmin) tmin = a; if (b < tmax) tmax = b; if (tmin > tmax) { ok = false; break; } } }
      if (ok && tmin < bt) { bt = tmin; best = c; }
    }
    return best ? { c: best, t: bt } : null;
  }
  remove(c) { const i = this.list.indexOf(c); if (i >= 0) { this.list[i] = this.list[this.list.length - 1]; this.list.pop(); } }
}
