// Combat (ctx.combat): melee / projectile hit detection against mobs and remote players, damage & knockback, TNT + explosions.
// Authority model (CONTRACT2 §2): block-carving explosions and primed TNT run on the authority (solo or host); guests send `intent:*`
// messages and render what the authority broadcasts (`combat:explosion`, `it:tnt`, `it:proj`). A hit on a player is resolved by the victim.
import { B, SOLID, LIQUID, BLOCKS, RENDER, RENDER_CROSS } from '../../shared/blocks.js';
import { blockColor } from '../../game/blockColors.js';
import { K } from './entities.js';

/** species table, same order as MobAI (pig, cow, sheep, chicken) */
export const MOB = [{ name: 'Porco', r: 0.42, h: 0.95, hp: 8 }, { name: 'Vaca', r: 0.62, h: 1.4, hp: 10 }, { name: 'Ovelha', r: 0.5, h: 1.3, hp: 8 }, { name: 'Galinha', r: 0.26, h: 0.7, hp: 4 }];
const RESIST = { glass: 0.15, oak_leaves: 0.1, birch_leaves: 0.1, spruce_leaves: 0.1, cherry_leaves: 0.1, dirt: 0.55, grass: 0.55, sand: 0.5, gravel: 0.55, snow: 0.3, planks: 0.7, cactus: 0.3, hay: 0.3, dirt_path: 0.55, tnt: 0.2, ice: 0.3 };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

/** Distance along the ray (a + t*d, 0..len) where it enters the box, or -1. */
function slab(ax, ay, az, dx, dy, dz, len, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = len, t1, t2, t;
  if (Math.abs(dx) < 1e-9) { if (ax < x0 || ax > x1) return -1; } else { t1 = (x0 - ax) / dx; t2 = (x1 - ax) / dx; if (t1 > t2) { t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  if (Math.abs(dy) < 1e-9) { if (ay < y0 || ay > y1) return -1; } else { t1 = (y0 - ay) / dy; t2 = (y1 - ay) / dy; if (t1 > t2) { t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  if (Math.abs(dz) < 1e-9) { if (az < z0 || az > z1) return -1; } else { t1 = (z0 - az) / dz; t2 = (z1 - az) / dz; if (t1 > t2) { t = t1; t1 = t2; t2 = t; } if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2; if (tmin > tmax) return -1; }
  return tmin;
}

export class Combat {
  /** @param {object} S  items runtime (see index.js) */
  constructor(S) {
    this.S = S;
    this.queue = null; this.qi = 0; this.qCount = 0;      // pending block removals: flat [x,y,z,...] sorted by distance
    this.kbT = 0;                                          // > 0 while mobs may be sliding from knockback
    this._o = { x: 0, y: 0, z: 0 }; this._d = { x: 0, y: 0, z: 0 };
    this.budget = 700;
  }

  // ---- targets ---------------------------------------------------------------------------------------------------
  /** Closest living target along the segment a -> a + d*len (d normalised). Returns null or { kind:'mob'|'player', ref, t }. Writes into this._best. */
  sweep(ax, ay, az, dx, dy, dz, len, pad, opts) {
    const S = this.S; let bt = 1e9, kind = null, ref = null;
    const mobs = S.ctx.mobs && S.ctx.mobs.list;
    if (mobs) for (let i = 0; i < mobs.length; i++) {
      const m = mobs[i], sp = MOB[m.sp]; if (!sp) continue;
      const r = sp.r + pad, t = slab(ax, ay, az, dx, dy, dz, len, m.x - r, m.y - pad, m.z - r, m.x + r, m.y + sp.h + pad, m.z + r);
      if (t >= 0 && t < bt) { bt = t; kind = 'mob'; ref = m; }
    }
    const pl = S.net() && S.net().players;
    if (pl && !(opts && opts.noPlayers)) for (const p of pl.values()) {
      if (!p || !p.pos || p.alive === false) continue;
      const r = 0.38 + pad, t = slab(ax, ay, az, dx, dy, dz, len, p.pos.x - r, p.pos.y - pad, p.pos.z - r, p.pos.x + r, p.pos.y + 1.8 + pad, p.pos.z + r);
      if (t >= 0 && t < bt) { bt = t; kind = 'player'; ref = p; }
    }
    if (!kind) return null;
    const b = this._best || (this._best = { kind: '', ref: null, t: 0 });
    b.kind = kind; b.ref = ref; b.t = bt; return b;
  }

  // ---- damage ----------------------------------------------------------------------------------------------------
  damageMob(m, amount, kx, kz, by) {
    const S = this.S, sp = MOB[m.sp]; if (!sp) return;
    if (m.hp === undefined) m.hp = sp.hp;
    m.hp -= amount; m._kx = kx; m._kz = kz; m._kt = 0.4; this.kbT = 0.5;
    m.vy = Math.max(m.vy, 3.5 + Math.min(4, Math.hypot(kx, kz) * 0.25)); m.state = 2; m.fleeT = 2.5; m.timer = 2.5; m.heading = Math.atan2(-kx, -kz);
    S.audio.hit(amount >= 6); S.audio.mob(m.sp, 0);
    S.particles().burst(m.x, m.y + sp.h * 0.6, m.z, [0.85, 0.12, 0.12], 8, 0.8);
    if (amount > 0) { S.hud.floatText(m.x, m.y + sp.h + 0.3, m.z, String(Math.round(amount)), '#ffd24a'); S.hud.hitmarker(m.hp <= 0); }
    if (m.hp <= 0) this.killMob(m, by);
  }

  killMob(m, by) {
    const S = this.S, L = S.ctx.mobs.list, i = L.indexOf(m), sp = MOB[m.sp];
    if (i >= 0) { L[i] = L[L.length - 1]; L.pop(); }
    S.particles().burst(m.x, m.y + sp.h * 0.5, m.z, [0.95, 0.95, 0.95], 16, 1.2);
    S.hud.killFeed(by === 'me' || by == null ? 'Você derrotou ' + sp.name : String(by) + ' derrotou ' + sp.name);
    S.events.emit('item:kill', { target: 'mob', species: sp.name, x: m.x, y: m.y, z: m.z });
    const e = S.ents.spawn(K.DROP, m.x, m.y + 0.5, m.z, (Math.random() - 0.5) * 2, 4, (Math.random() - 0.5) * 2, { data: 'meat', r: 0.2, life: 60 });
    if (e) { e.c[0] = 0.85; e.c[1] = 0.3; e.c[2] = 0.28; }
  }

  /**
   * Hit a remote player (victim-resolved). No-op (returns false) when `id` is not a connected remote player or PvP is off.
   * @param {string} id @param {number} amount hp @param {{knockback?:THREE.Vector3|{x,y,z}, weapon?:string}} [opts]
   */
  hitPlayer(id, amount, opts = {}) {
    const S = this.S, net = S.net();
    if (!net || !net.players || !net.players.has(id) || typeof net.broadcast !== 'function') return false;
    if (!S.permissions.can('pvp', { by: net.localId, target: id })) { S.toast('PvP desativado neste planeta'); return false; }
    const k = opts.knockback || { x: 0, y: 0, z: 0 };
    net.broadcast('combat:hit', { victim: String(id), by: net.localId, byName: S.ctx.identity.name, amount: clamp(num(amount), 0, 40), kb: [num(k.x), num(k.y), num(k.z)], weapon: String(opts.weapon || '') });
    S.hud.hitmarker(false, opts.head); S.audio.hitmark(false);
    return true;
  }

  /** incoming `combat:hit` (we are the victim) */
  onHit(d) {
    const S = this.S, net = S.net();
    if (!d || !net || d.victim !== net.localId || !S.health.alive) return;
    if (!S.permissions.can('pvp', { by: d.by, target: net.localId })) return;
    const kb = Array.isArray(d.kb) ? d.kb : [0, 0, 0], kx = clamp(num(kb[0]), -30, 30), ky = clamp(num(kb[1]), -20, 30), kz = clamp(num(kb[2]), -30, 30);
    const amount = clamp(num(d.amount), 0, 40);
    if (amount > 0) S.health.damage(amount, { kind: 'player', by: String(d.byName || d.by || '?').slice(0, 24), weapon: String(d.weapon || '').slice(0, 24) });
    if (!S.health.invulnerable) S.player.impulse(kx, ky, kz);
  }

  /** Sword-like arc: damages up to 3 targets inside a cone in front of the camera. Returns how many were hit. */
  melee(damage, reach, knock, weapon) {
    const S = this.S, e = S.eye, d = S.dir, cosMin = 0.62;
    let hits = 0;
    const mobs = S.ctx.mobs && S.ctx.mobs.list;
    if (mobs) for (let i = mobs.length - 1; i >= 0 && hits < 3; i--) {
      const m = mobs[i], sp = MOB[m.sp]; if (!sp) continue;
      const tx = m.x - e.x, ty = m.y + sp.h * 0.5 - e.y, tz = m.z - e.z, dist = Math.hypot(tx, ty, tz);
      if (dist > reach + sp.r || dist < 1e-3) continue;
      if ((tx * d.x + ty * d.y + tz * d.z) / dist < cosMin - sp.r / Math.max(dist, 1)) continue;
      if (!this._clear(e, tx, ty, tz, dist)) continue;
      this.damageMob(m, damage, tx / dist * knock, tz / dist * knock, 'me'); hits++;
    }
    const pl = S.net() && S.net().players;
    if (pl) for (const p of pl.values()) {
      if (hits >= 3 || !p || !p.pos || p.alive === false) continue;
      const tx = p.pos.x - e.x, ty = p.pos.y + 0.9 - e.y, tz = p.pos.z - e.z, dist = Math.hypot(tx, ty, tz);
      if (dist > reach + 0.4 || dist < 1e-3) continue;
      if ((tx * d.x + ty * d.y + tz * d.z) / dist < cosMin - 0.4 / Math.max(dist, 1)) continue;
      if (!this._clear(e, tx, ty, tz, dist)) continue;
      if (this.hitPlayer(p.id, damage, { knockback: { x: tx / dist * knock, y: 4.5, z: tz / dist * knock }, weapon })) { hits++; S.audio.hit(damage >= 6); S.hud.floatText(p.pos.x, p.pos.y + 2.1, p.pos.z, String(Math.round(damage)), '#ff8a6a'); }
    }
    return hits;
  }

  _clear(e, tx, ty, tz, dist) {
    const o = this._o, d = this._d; o.x = e.x; o.y = e.y; o.z = e.z; d.x = tx / dist; d.y = ty / dist; d.z = tz / dist;
    const h = this.S.world.raycast(o, d, dist); return !h || h.dist >= dist - 0.6;
  }

  // ---- projectiles -------------------------------------------------------------------------------------------------
  /**
   * Launch a projectile owned by the local player. kind: 'arrow' | 'snowball' | 'pearl' | 'rocket'.
   * @param {{kind:string, x:number,y:number,z:number, dx:number,dy:number,dz:number, speed?:number, damage?:number, knockback?:number, vis?:boolean, owner?:string}} o
   */
  projectile(o) {
    const S = this.S, kind = { arrow: K.ARROW, snowball: K.SNOW, pearl: K.PEARL, rocket: K.ROCKET, missile: K.MISSILE }[o.kind];
    if (!kind) return null;
    const sp = clamp(num(o.speed, 30), 1, 90), l = Math.hypot(o.dx, o.dy, o.dz) || 1;
    const e = S.ents.spawn(kind, o.x, o.y, o.z, o.dx / l * sp, o.dy / l * sp, o.dz / l * sp, { dmg: num(o.damage), kb: num(o.knockback), vis: !!o.vis, owner: o.owner || 'me', life: kind === K.ARROW ? 30 : kind === K.ROCKET ? 1.1 + Math.random() * 0.5 : kind === K.MISSILE ? 7 : 12, hitSet: 0 });
    const net = S.net();
    if (e && !o.vis && net && net.broadcast) net.broadcast('it:proj', { kind: o.kind, by: S.localId, x: o.x, y: o.y, z: o.z, vx: e.vx, vy: e.vy, vz: e.vz }, { reliable: false });
    return e;
  }

  /** Entities hook: projectile moved a -> b; true = it hit something alive and is consumed. */
  onProjectile(e, ax, ay, az, bx, by, bz, maxT) {
    const S = this.S, len = maxT; if (len < 1e-4) return false;
    const dx = (bx - ax) / len, dy = (by - ay) / len, dz = (bz - az) / len;
    if (e.k === K.MISSILE) { if (!this.sweep(ax, ay, az, dx, dy, dz, len, 0.25, null)) return false; this.explode(bx, by, bz, 3.4, { by: S.localId }); return true; }
    const t = this.sweep(ax, ay, az, dx, dy, dz, len, e.k === K.SNOW ? 0.12 : 0.05, null);
    if (!t) return false;
    const sp = Math.hypot(e.vx, e.vz) || 1, kb = e.kb || 3;
    if (t.kind === 'mob') {
      this.damageMob(t.ref, e.dmg, e.vx / sp * kb, e.vz / sp * kb, 'me');
      if (e.k === K.SNOW) { S.audio.snowHit(); S.particles().burst(bx, by, bz, [0.95, 0.97, 1], 8, 0.8); }
    } else {
      const p = t.ref;
      this.hitPlayer(p.id, e.dmg, { knockback: { x: e.vx / sp * kb, y: 2.5, z: e.vz / sp * kb }, weapon: e.k === K.ARROW ? 'arco' : 'bola de neve' });
      if (e.k === K.SNOW) { S.audio.snowHit(); S.particles().burst(bx, by, bz, [0.95, 0.97, 1], 8, 0.8); }
      else { S.audio.hit(true); S.hud.floatText(p.pos.x, p.pos.y + 2.1, p.pos.z, String(Math.round(e.dmg)), '#ff8a6a'); }
    }
    return true;
  }

  /** A fast block (gravity gun throw) overlapping a living thing hurts it and stops. */
  onBody(e) {
    const t = this.sweep(e.x, e.y - 0.5, e.z, 0, 1, 0, 1, 0.45, null);
    if (!t) return;
    const sp = Math.hypot(e.vx, e.vy, e.vz), dmg = clamp(sp * 0.55, 2, 16), nx = e.vx / (sp || 1), nz = e.vz / (sp || 1);
    if (t.kind === 'mob') this.damageMob(t.ref, dmg, nx * 7, nz * 7, 'me');
    else this.hitPlayer(t.ref.id, dmg, { knockback: { x: nx * 9, y: 4, z: nz * 9 }, weapon: 'bloco' });
    this.S.ents._landFall(e);
  }

  // ---- TNT + explosions ------------------------------------------------------------------------------------------
  /** Prime TNT at (x,y,z). Guests ask the authority; everybody else sees a visual copy. */
  prime(x, y, z, fuse = 3, vx = 0, vy = 0, vz = 0, by = null) {
    const S = this.S, net = S.net();
    if (net && net.isAuthority === false) { net.send('intent:tnt', { x, y, z, fuse, vx, vy, vz }); return null; }
    const e = S.ents.spawn(K.TNT, x, y, z, vx, vy, vz, { block: B.TNT, life: clamp(num(fuse, 3), 0.2, 8), r: 0.49, owner: by || 'me' });
    if (e) { S.audio.fuse(); if (net && net.broadcast) net.broadcast('it:tnt', { x, y, z, fuse: e.life, vx, vy, vz }); }
    return e;
  }

  /** Light a TNT block in the world (the block becomes a primed entity). */
  ignite(x, y, z, fuse = 2.4, by = null) {
    const S = this.S, net = S.net();
    if (S.world.getBlock(x, y, z) !== B.TNT) return false;
    if (!S.permissions.can('explode', { x, y, z, by: by || S.localId })) { S.toast('Explosões desativadas aqui'); return false; }
    if (net && net.isAuthority === false) { net.send('intent:ignite', { x, y, z }); return true; }
    S.world.applyEdit(x, y, z, B.AIR, 'game');
    this.prime(x + 0.5, y + 0.5, z + 0.5, fuse, 0, 0, 0, by);
    return true;
  }

  /**
   * Explosion at (x,y,z): sphere carve with falloff (authority only), chain reaction, knockback, particles + shockwave.
   * @param {number} power radius in blocks (TNT = 4) @param {{by?:string, breakBlocks?:boolean}} [opts]
   */
  explode(x, y, z, power, opts = {}) {
    const S = this.S, net = S.net();
    power = clamp(num(power, 3), 0.5, 12); x = num(x); y = num(y); z = num(z);
    if (!S.permissions.can('explode', { x, y, z, power, by: opts.by || S.localId })) return false;
    const brk = opts.breakBlocks !== false;
    if (net && net.isAuthority === false) { net.send('intent:explode', { x, y, z, power, breakBlocks: brk, ns: opts.noSelf ? 1 : 0 }); return true; }
    if (brk) this._carve(x, y, z, power);
    const by = opts.by === 'me' || opts.by == null ? S.localId : opts.by;
    this.fx(x, y, z, power, by, !!opts.noSelf);
    if (net && net.broadcast) net.broadcast('combat:explosion', { x, y, z, power, by: String(by), ns: opts.noSelf ? 1 : 0 });
    return true;
  }

  /** Effects that every client plays locally: sound, particles, shockwave, shake, damage + knockback to us and to nearby mobs / entities. */
  fx(x, y, z, power, by, noSelf = false) {
    const S = this.S, p = S.player, cam = S.camera.position;
    const camD = Math.hypot(cam.x - x, cam.y - y, cam.z - z);
    S.audio.explosion(power, camD);
    const pc = S.particles();
    pc.burst(x, y, z, [1, 0.62, 0.18], 36, 2.4); pc.burst(x, y, z, [0.35, 0.33, 0.32], 30, 1.6); pc.burst(x, y, z, [1, 0.9, 0.5], 14, 3.2);
    S.ents.blast(x, y, z, power * 1.5, 0.45 + power * 0.04, 0); S.ents.blast(x, y, z, power * 0.9, 0.3, 1);
    S.hud.shake(clamp((1 - camD / (power * 6)) * 0.07 * power, 0, 0.35));
    const R = power * 2;
    // us
    const mine = by == null || by === 'me' || by === S.localId, nm = mine ? 'Você' : ((S.net() && S.net().players && S.net().players.get(by) && S.net().players.get(by).name) || String(by).slice(0, 12));
    if (S.health.alive && !(noSelf && mine) && (mine || S.permissions.can('pvp', { by, target: S.localId }))) {
      const dx = p.x - x, dy = p.y + 0.9 - y, dz = p.z - z, d = Math.hypot(dx, dy, dz);
      if (d < R) {
        let f = 1 - d / R; if (!this._clear({ x, y, z }, dx, dy, dz, Math.max(d, 1e-3))) f *= 0.45;
        const k = f * (6 + power * 1.8) / Math.max(d, 0.3);
        if (!S.health.invulnerable) { p.impulse(dx * k, Math.abs(dy) * k * 0.4 + f * 7, dz * k); }
        const dmg = Math.round(f * f * power * 3.4);
        if (dmg > 0) S.health.damage(dmg, { kind: 'explosion', by: nm, weapon: 'explosão' });
      }
    }
    // mobs
    const mobs = S.ctx.mobs && S.ctx.mobs.list;
    if (mobs) for (let i = mobs.length - 1; i >= 0; i--) {
      const m = mobs[i], sp = MOB[m.sp]; if (!sp) continue;
      const dx = m.x - x, dy = m.y + sp.h * 0.5 - y, dz = m.z - z, d = Math.hypot(dx, dy, dz);
      if (d >= R) continue;
      const f = 1 - d / R; this.damageMob(m, Math.round(f * f * power * 4.5) + 1, dx / Math.max(d, 0.3) * f * (8 + power), dz / Math.max(d, 0.3) * f * (8 + power), 'me');
    }
    // loose entities (primed TNT, blocks, drops) get shoved
    for (const e of S.ents.list) {
      if (!e.on || e.stuck || e.k === K.HELD || e.k === K.ARROW) continue;
      const dx = e.x - x, dy = e.y - y, dz = e.z - z, d = Math.hypot(dx, dy, dz);
      if (d >= R || d < 1e-3) continue;
      const f = (1 - d / R) * (10 + power); e.vx += dx / d * f; e.vy += dy / d * f + 3; e.vz += dz / d * f;
    }
  }

  _carve(x, y, z, power) {
    const S = this.S, w = S.world, R = power, ri = Math.ceil(R), R2 = R * R;
    const cx = Math.floor(x), cy = Math.floor(y), cz = Math.floor(z);
    const cells = [];
    let debris = 0;
    for (let dy = -ri; dy <= ri; dy++) for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) {
      const bx = cx + dx, by = cy + dy, bz = cz + dz, ddx = bx + 0.5 - x, ddy = by + 0.5 - y, ddz = bz + 0.5 - z, d2 = ddx * ddx + ddy * ddy + ddz * ddz;
      if (by < 1 || d2 > R2) continue;
      const id = w.getBlock(bx, by, bz);
      if (id === B.AIR || id === B.UNLOADED || id === B.BEDROCK || LIQUID[id]) continue;
      const dn = Math.sqrt(d2) / R, def = BLOCKS[id], res = RESIST[def ? def.name : ''] ?? 1;
      if (id !== B.TNT && dn > 0.55 && Math.random() < (dn - 0.55) / 0.45 * (0.35 + 0.65 * res)) continue;   // ragged crater edge; harder blocks survive more often
      if (!S.permissions.can('break', { x: bx, y: by, z: bz, id, by: S.localId })) continue;
      cells.push(d2, bx, by, bz, id);
      if (id !== B.TNT && ++debris % 7 === 0 && debris < 160) S.particles().burst(bx + 0.5, by + 0.5, bz + 0.5, blockColor(id), 2, 2.5 + power * 0.25);
    }
    // chain reaction: TNT inside the blast ignites with a short random fuse instead of vanishing
    const n = cells.length / 5, order = new Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    order.sort((a, b) => cells[a * 5] - cells[b * 5]);
    const q = new Int32Array(n * 3 + 3); let qn = 0;
    for (const i of order) {
      const bx = cells[i * 5 + 1], by = cells[i * 5 + 2], bz = cells[i * 5 + 3], id = cells[i * 5 + 4];
      if (id === B.TNT) {
        w.applyEdit(bx, by, bz, B.AIR, 'game');
        const dx = bx + 0.5 - x, dz = bz + 0.5 - z, l = Math.hypot(dx, dz) || 1;
        this.prime(bx + 0.5, by + 0.5, bz + 0.5, 0.3 + Math.random() * 0.6, dx / l * 3, 4 + Math.random() * 3, dz / l * 3);
        continue;
      }
      q[qn++] = bx; q[qn++] = by; q[qn++] = bz;
    }
    // queue the removals (processed over a few frames so a huge blast never hitches)
    if (this.queue && this.qi < this.qCount) { const old = this.queue.subarray(this.qi, this.qCount), m = new Int32Array(old.length + qn); m.set(old); m.set(q.subarray(0, qn), old.length); this.queue = m; this.qCount = m.length; }
    else this.queue = q.subarray(0, qn), this.qCount = qn;
    this.qi = 0;
    const q2 = S.ctx.settings && S.ctx.settings.quality; this.budget = q2 === 'potato' ? 360 : q2 === 'low' ? 600 : 1100;
  }

  // ---- hitscan weapons (rifle, shotgun, railgun) --------------------------------------------------------------------
  /**
   * Instant-hit shot(s) from the camera. Damage is dealt per target once per call (pellets are summed) so the network sees one hit.
   * @param {{range?:number, dmg?:number, head?:number, pellets?:number, spread?:number, falloff?:number, kb?:number, pierce?:boolean, carve?:number,
   *          color?:number[], thick?:number, weapon?:string, from?:{x:number,y:number,z:number}}} o
   * @returns {{hits:number, dist:number}}
   */
  hitscan(o) {
    const S = this.S, w = S.world, e = S.eye, base = S.dir, range = clamp(num(o.range, 80), 4, 160), pellets = clamp(o.pellets | 0 || 1, 1, 14);
    const from = o.from || e, acc = new Map(); let hits = 0, farthest = 0;
    // orthonormal frame around the aim direction (right, up) for spread
    const hl = Math.hypot(base.x, base.z) || 1, rx = base.z / hl, rz = -base.x / hl, ux2 = -base.x * base.y / hl, uy2 = hl, uz2 = -base.z * base.y / hl;
    const o3 = this._o, d3 = this._d;
    for (let n = 0; n < pellets; n++) {
      let dx = base.x, dy = base.y, dz = base.z;
      if (o.spread) { const a = Math.random() * 6.2832, r = Math.sqrt(Math.random()) * o.spread, cx = Math.cos(a) * r, cy = Math.sin(a) * r; dx += rx * cx + ux2 * cy; dy += uy2 * cy; dz += rz * cx + uz2 * cy; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l; }
      o3.x = e.x; o3.y = e.y; o3.z = e.z; d3.x = dx; d3.y = dy; d3.z = dz;
      const bh = w.raycast(o3, d3, range); let end = bh ? bh.dist : range;
      if (o.carve && bh) end = this._tunnel(e, dx, dy, dz, bh.dist, o.carve, range);
      // targets along [0, end]
      let best = null;
      const consider = (kind, ref, t, hy) => { if (t < 0 || t > end) return; if (o.pierce) { this._dmgAcc(acc, kind, ref, hy, o, t); hits++; } else if (!best || t < best.t) best = { kind, ref, t, hy }; };
      const mobs = S.ctx.mobs && S.ctx.mobs.list;
      if (mobs) for (let i = 0; i < mobs.length; i++) { const m = mobs[i], sp = MOB[m.sp]; if (!sp) continue; const r = sp.r + 0.08; consider('mob', m, slab(e.x, e.y, e.z, dx, dy, dz, end, m.x - r, m.y - 0.05, m.z - r, m.x + r, m.y + sp.h + 0.05, m.z + r), 0); }
      const pl = S.net() && S.net().players;
      if (pl) for (const p of pl.values()) { if (!p || !p.pos || p.alive === false) continue; const r = 0.38 + 0.08, t = slab(e.x, e.y, e.z, dx, dy, dz, end, p.pos.x - r, p.pos.y - 0.05, p.pos.z - r, p.pos.x + r, p.pos.y + 1.88, p.pos.z + r); consider('player', p, t, t >= 0 ? e.y + dy * t - p.pos.y : 0); }
      if (best) { this._dmgAcc(acc, best.kind, best.ref, best.hy, o, best.t); hits++; end = best.t; }
      farthest = Math.max(farthest, end);
      // visuals: tracer + impact
      const px = e.x + dx * end, py = e.y + dy * end, pz = e.z + dz * end;
      if ((pellets <= 4 || n % 3 === 0) && S.ents) this.beam(from.x, from.y, from.z, px, py, pz, o.color || [1, 0.85, 0.4], o.thick || 0.03, true);
      if (bh && !best && !o.carve) { const id = bh.block; S.particles().burst(px, py, pz, blockColor(id) || [0.6, 0.6, 0.6], 3, 0.6); if (n === 0) S.audio.arrowHit(id); }
    }
    // apply accumulated damage
    for (const a of acc.values()) {
      const kx = a.dx * (o.kb || 3), kz = a.dz * (o.kb || 3);
      if (a.kind === 'mob') this.damageMob(a.ref, a.dmg, kx, kz, 'me');
      else { this.hitPlayer(a.ref.id, a.dmg, { knockback: { x: kx, y: 2 + (o.kb || 3) * 0.3, z: kz }, weapon: o.weapon, head: a.head }); S.hud.floatText(a.ref.pos.x, a.ref.pos.y + 2.1, a.ref.pos.z, String(Math.round(a.dmg)) + (a.head ? '!' : ''), a.head ? '#ff4a3a' : '#ff8a6a'); }
    }
    return { hits, dist: farthest };
  }

  _dmgAcc(acc, kind, ref, hy, o, t) {
    const S = this.S;
    let a = acc.get(kind === 'player' ? 'p' + ref.id : ref);
    if (!a) { a = { kind, ref, dmg: 0, head: false, dx: S.dir.x, dz: S.dir.z }; acc.set(kind === 'player' ? 'p' + ref.id : ref, a); }
    let d = num(o.dmg, 3); if (o.falloff) d *= Math.max(0.35, 1 - t / (o.falloff * 2));
    if (kind === 'player' && hy > 1.4 && o.head) { d *= o.head; a.head = true; }
    a.dmg += d;
  }

  /** railgun: remove up to `n` solid blocks along the ray; returns the distance where the beam ends. */
  _tunnel(e, dx, dy, dz, from, n, range) {
    const S = this.S, w = S.world; let t = from - 0.05, removed = 0, lastKey = '';
    const step = 0.2;
    while (t < range && removed < n) {
      t += step; const x = Math.floor(e.x + dx * t), y = Math.floor(e.y + dy * t), z = Math.floor(e.z + dz * t), k = x + ',' + y + ',' + z;
      if (k === lastKey) continue; lastKey = k;
      const id = w.getBlock(x, y, z);
      if (id === B.UNLOADED || y < 1 || y > 190) break;
      if (id === B.AIR || LIQUID[id] || RENDER[id] === RENDER_CROSS) continue;
      if (id === B.BEDROCK) break;
      if (!S.permissions.can('break', { x, y, z, id, by: S.localId })) break;
      if (!w.setBlock(x, y, z, B.AIR, 'local')) w.applyEdit(x, y, z, B.AIR, 'local');
      S.particles().burst(x + 0.5, y + 0.5, z + 0.5, blockColor(id), 3, 1.4); removed++;
    }
    return Math.min(range, t + 0.4);
  }

  /** a short-lived tracer line (local) and, when `net`, the same tracer on everybody else's screen */
  beam(ax, ay, az, bx, by, bz, color, thick = 0.03, net = false) {
    const S = this.S, e = S.ents.spawn(K.BEAM, ax, ay, az, 0, 0, 0, { life: 0.11, r: thick, data: [bx, by, bz], vis: true });
    if (e) { e.c[0] = color[0] * 2.4; e.c[1] = color[1] * 2.4; e.c[2] = color[2] * 2.4; }
    const n = S.net(); if (net && n && n.broadcast) n.broadcast('it:beam', { a: [ax, ay, az], b: [bx, by, bz], c: color, w: thick }, { reliable: false });
  }

  // ---- grenades + mines ------------------------------------------------------------------------------------------------
  grenade(x, y, z, vx, vy, vz, fuse = 2.3, vis = false, by = null) {
    const S = this.S, e = S.ents.spawn(K.GRENADE, x, y, z, vx, vy, vz, { life: clamp(num(fuse, 2.3), 0.3, 5), r: 0.14, vis, owner: by || 'me' });
    const n = S.net(); if (e && !vis && n && n.broadcast) n.broadcast('it:gren', { x, y, z, vx, vy, vz, f: e.life, by: S.localId });
    return e;
  }

  placeMine(x, y, z) {
    const S = this.S, e = S.ents.spawn(K.MINE, x, y, z, 0, 0, 0, { life: 1e9, r: 0.3, owner: 'me' });
    const n = S.net(); if (e && n && n.broadcast) n.broadcast('it:mine', { x, y, z, by: S.localId });
    if (e) e.by = S.localId;
    return e;
  }

  /** per-frame mine logic (entities hook): arming, proximity to us / local animals, countdown, detonation */
  mineTick(e, dt) {
    const S = this.S, p = S.player;
    if (e.hitSet > 0) { // countdown after being triggered
      const before = Math.floor(e.hitSet * 10); e.hitSet -= dt; if (Math.floor(e.hitSet * 10) !== before && before % 2 === 0) S.audio.beep(true);
      if (e.hitSet <= 0) this.detonateMine(e);
      return;
    }
    const mineOwn = e.owner === 'me', armed = e.age > (mineOwn ? 3 : 1.2); if (!armed) return;
    if (S.health.alive && !S.health.invulnerable) {
      const dx = p.x - e.x, dz = p.z - e.z, dy = p.y - e.y;
      if (dx * dx + dz * dz < 2.6 && dy > -1.2 && dy < 2 && (mineOwn || S.permissions.can('pvp', { by: e.by, target: S.localId }))) { e.hitSet = 0.4; S.audio.beep(false); return; }
    }
    if (mineOwn) { const L = S.ctx.mobs && S.ctx.mobs.list; if (L) for (let i = 0; i < L.length; i++) { const m = L[i], dx = m.x - e.x, dz = m.z - e.z; if (dx * dx + dz * dz < 2.3 && Math.abs(m.y - e.y) < 1.6) { e.hitSet = 0.3; S.audio.beep(false); return; } } }
  }

  detonateMine(e) {
    const S = this.S, n = S.net(), x = e.x, y = e.y + 0.3, z = e.z, by = e.by || S.localId;
    S.ents.kill(e);
    this.explode(x, y, z, 3.2, { by });
    if (n && n.broadcast) n.broadcast('it:mineoff', { x: e.x, y: e.y, z: e.z });
  }

  update(dt) {
    const S = this.S, w = S.world;
    if (this.qi < this.qCount) {
      const q = this.queue; let n = this.budget * 3;
      while (this.qi < this.qCount && n > 0) {
        const bx = q[this.qi], by = q[this.qi + 1], bz = q[this.qi + 2]; this.qi += 3; n -= 3;
        w.applyEdit(bx, by, bz, B.AIR, 'game');
        const above = w.getBlock(bx, by + 1, bz);
        if (RENDER[above] === RENDER_CROSS) w.applyEdit(bx, by + 1, bz, B.AIR, 'game');
      }
      if (this.qi >= this.qCount) this.queue = null;
    }
    if (this.kbT > 0) {
      this.kbT -= dt;
      const L = S.ctx.mobs && S.ctx.mobs.list;
      if (L) for (let i = 0; i < L.length; i++) {
        const m = L[i]; if (!(m._kt > 0)) continue;
        m._kt -= dt; const f = Math.exp(-5 * dt); m._kx *= f; m._kz *= f;
        const sp = MOB[m.sp], nx = m.x + m._kx * dt, nz = m.z + m._kz * dt;
        if (!SOLID[w.getBlock(Math.floor(nx + Math.sign(m._kx) * sp.r), Math.floor(m.y + 0.4), Math.floor(m.z))]) m.x = nx;
        if (!SOLID[w.getBlock(Math.floor(m.x), Math.floor(m.y + 0.4), Math.floor(nz + Math.sign(m._kz) * sp.r))]) m.z = nz;
      }
    }
  }

  /** Registers the incoming network handlers (call when ctx.net is final). Returns a disposer. */
  bindNet() {
    const S = this.S, net = S.net(); if (!net || typeof net.on !== 'function') return () => {};
    const offs = [];
    offs.push(net.on('combat:hit', (d) => this.onHit(d)));
    offs.push(net.on('combat:explosion', (d) => { if (d && net.isAuthority !== true) this.fx(clamp(num(d.x), -1e7, 1e7), clamp(num(d.y), -64, 400), clamp(num(d.z), -1e7, 1e7), clamp(num(d.power, 3), 0.5, 12), d.by, !!d.ns); }));
    offs.push(net.on('it:proj', (d) => {
      if (!d || !{ arrow: 1, snowball: 1, pearl: 1, rocket: 1, missile: 1 }[d.kind]) return;
      const l = Math.hypot(num(d.vx), num(d.vy), num(d.vz)) || 1;
      this.projectile({ kind: d.kind, x: num(d.x), y: num(d.y), z: num(d.z), dx: num(d.vx) / l, dy: num(d.vy) / l, dz: num(d.vz) / l, speed: l, vis: true, owner: 'remote' });
    }));
    offs.push(net.on('it:tnt', (d) => {
      if (!d || net.isAuthority === true) return;
      S.ents.spawn(K.TNT, num(d.x), num(d.y), num(d.z), clamp(num(d.vx), -20, 20), clamp(num(d.vy), -20, 20), clamp(num(d.vz), -20, 20), { block: B.TNT, life: clamp(num(d.fuse, 3), 0.2, 8), r: 0.49, vis: true, owner: 'remote' });
      S.audio.fuse();
    }));
    offs.push(net.on('it:beam', (d) => { if (d && Array.isArray(d.a) && Array.isArray(d.b) && Array.isArray(d.c)) this.beam(num(d.a[0]), num(d.a[1]), num(d.a[2]), num(d.b[0]), num(d.b[1]), num(d.b[2]), [clamp(num(d.c[0], 1), 0, 1), clamp(num(d.c[1], 1), 0, 1), clamp(num(d.c[2], 1), 0, 1)], clamp(num(d.w, 0.03), 0.01, 0.2), false); }));
    offs.push(net.on('it:gren', (d) => { if (d && net.isAuthority !== undefined) this.grenade(num(d.x), num(d.y), num(d.z), clamp(num(d.vx), -40, 40), clamp(num(d.vy), -40, 40), clamp(num(d.vz), -40, 40), clamp(num(d.f, 2.3), 0.3, 5), true, String(d.by || 'remote').slice(0, 40)); }));
    offs.push(net.on('it:mine', (d, from) => { if (!d) return; const e = S.ents.spawn(K.MINE, num(d.x), num(d.y), num(d.z), 0, 0, 0, { life: 1e9, r: 0.3, owner: 'remote' }); if (e) e.by = String(from || d.by || 'remote').slice(0, 40); }));
    offs.push(net.on('it:mineoff', (d) => { if (!d) return; for (const e of S.ents.list) if (e.on && e.k === K.MINE && Math.abs(e.x - num(d.x)) < 0.5 && Math.abs(e.y - num(d.y)) < 0.5 && Math.abs(e.z - num(d.z)) < 0.5) S.ents.kill(e); }));
    // guest -> authority intents
    offs.push(net.on('intent:explode', (d, from) => { if (net.isAuthority === true && d) this.explode(num(d.x), num(d.y), num(d.z), clamp(num(d.power, 3), 0.5, 8), { by: from, breakBlocks: d.breakBlocks !== false, noSelf: !!d.ns }); }));
    offs.push(net.on('intent:tnt', (d) => { if (net.isAuthority === true && d && S.permissions.can('explode', { x: num(d.x), y: num(d.y), z: num(d.z) })) this.prime(num(d.x), num(d.y), num(d.z), clamp(num(d.fuse, 3), 0.2, 6), clamp(num(d.vx), -20, 20), clamp(num(d.vy), -20, 20), clamp(num(d.vz), -20, 20)); }));
    offs.push(net.on('intent:ignite', (d, from) => { if (net.isAuthority === true && d) this.ignite(Math.floor(num(d.x)), Math.floor(num(d.y)), Math.floor(num(d.z)), 2.4, from); }));
    return () => offs.forEach((o) => { try { o && o(); } catch { /* ignore */ } });
  }
}
