import { B, SOLID, isWatery } from '../shared/blocks.js';
import { SPECIES } from '../render/Mobs.js';

// Wandering farm animals: spawn near the player on grass (by biome), idle / graze / wander, flee when approached, step up 1-block ledges,
// avoid cliffs and deep water, despawn when far. Pure CPU, ~10 block lookups per animal per frame; rendering is 1 draw call per species.

const SPEC = [
  { name: 'pig', r: 0.42, h: 0.95, speed: 1.15 },
  { name: 'cow', r: 0.62, h: 1.4, speed: 1.0 },
  { name: 'sheep', r: 0.5, h: 1.3, speed: 1.0 },
  { name: 'chicken', r: 0.26, h: 0.7, speed: 1.3 },
];
const P = SPECIES;
const BIOME_MOBS = {
  PLAINS: [P.COW, P.SHEEP, P.PIG, P.CHICKEN, P.COW, P.SHEEP], FOREST: [P.PIG, P.COW, P.CHICKEN], BIRCH: [P.SHEEP, P.PIG, P.COW], CHERRY: [P.SHEEP, P.PIG, P.CHICKEN],
  SAVANNA: [P.COW, P.SHEEP], SWAMP: [P.PIG, P.CHICKEN], TAIGA: [P.SHEEP, P.CHICKEN], SNOWY: [P.SHEEP], RIVER: [P.PIG, P.COW, P.CHICKEN], BEACH: [P.CHICKEN],
};
const GRAVITY = 22, TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };

export class MobAI {
  /** @param {{world:object, gr:object, audio?:object, biomeAt?:(x:number,z:number)=>string}} o */
  constructor({ world, gr, audio, biomeAt }) {
    this.world = world; this.gr = gr; this.audio = audio; this.biomeAt = biomeAt || (() => 'PLAINS');
    this.list = []; this.spawnT = 1; this.max = 20; this.counts = [0, 0, 0, 0];
    this.rnd = (() => { let s = 0x9e3779b9; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); })();
  }

  get count() { return this.list.length; }

  /** @param {number} dt @param {{x:number,y:number,z:number}} camPos @param {{x:number,y:number,z:number,vx:number,vz:number}} player */
  update(dt, camPos, player) {
    const w = this.world; dt = Math.min(dt, 0.05);
    this.max = this.gr.quality && this.gr.quality.mobs !== undefined ? this.gr.quality.mobs : 20;
    this.spawnT -= dt;
    if (this.spawnT <= 0) { this.spawnT = 0.5; if (this.list.length < this.max) this._trySpawn(player); }
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const a = L[i], dx = a.x - player.x, dz = a.z - player.z, d2 = dx * dx + dz * dz;
      if (d2 > 100 * 100 || a.y < 2 || L.length > this.max + 4) { L[i] = L[L.length - 1]; L.pop(); continue; }
      this._step(a, dt, player, d2);
    }
    // push to the renderer (positions relative to the camera, computed in float64)
    const m = this.gr.mobs, cnt = this.counts; cnt[0] = cnt[1] = cnt[2] = cnt[3] = 0;
    if (!m) return;
    for (let i = 0; i < L.length; i++) {
      const a = L[i], s = a.sp;
      m.put(s, cnt[s]++, a.x - camPos.x, a.y - camPos.y, a.z - camPos.z, a.yaw, a.phase, a.anim, a.graze, a.rnd);
    }
    for (let s = 0; s < 4; s++) m.commit(s, cnt[s]);
  }

  _solid(x, y, z) { const b = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); return b === B.UNLOADED || SOLID[b]; }
  _liquid(x, y, z) { return isWatery(this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))); }

  _trySpawn(player) {
    const rnd = this.rnd, w = this.world, ang = rnd() * TAU, dist = 26 + rnd() * 40;
    const x = Math.floor(player.x + Math.cos(ang) * dist), z = Math.floor(player.z + Math.sin(ang) * dist);
    const y = w.getSurfaceY(x, z);
    const g = w.getBlock(x, y, z);
    if (g !== B.GRASS && g !== B.SNOW_GRASS && g !== B.SAND) return;
    if (this._solid(x, y + 1, z) || this._solid(x, y + 2, z) || this._liquid(x, y + 1, z)) return;
    const table = BIOME_MOBS[this.biomeAt(x, z)]; if (!table) return;
    const sp = table[(rnd() * table.length) | 0], n = sp === P.CHICKEN ? 2 + ((rnd() * 2) | 0) : 1 + ((rnd() * 3) | 0);
    for (let k = 0; k < n && this.list.length < this.max; k++) {
      const px = x + 0.5 + (rnd() - 0.5) * 3.5, pz = z + 0.5 + (rnd() - 0.5) * 3.5, py = w.getSurfaceY(Math.floor(px), Math.floor(pz)) + 1.01;
      if (this._solid(px, py, pz) || this._solid(px, py + 1, pz)) continue;
      this.list.push({ sp, x: px, y: py, z: pz, vy: 0, yaw: rnd() * TAU, heading: rnd() * TAU, state: 0, timer: 1 + rnd() * 3, phase: rnd() * 6, anim: 0, graze: 0, grazeT: 0,
        rnd: rnd(), ground: true, voice: 6 + rnd() * 24, fleeT: 0 });
    }
  }

  _step(a, dt, player, d2) {
    const S = SPEC[a.sp], rnd = this.rnd;
    // --- decisions
    a.timer -= dt; a.voice -= dt;
    if (a.fleeT > 0) a.fleeT -= dt;
    const near = d2 < 3.4 * 3.4;
    if (near && a.fleeT <= 0 && a.state !== 2) { a.state = 2; a.fleeT = 2.2; a.heading = Math.atan2(player.x - a.x, player.z - a.z) + (rnd() - 0.5) * 0.8; a.timer = 2.2; } // forward = (-sin, -cos): the heading points away from the player
    else if (a.timer <= 0) {
      if (a.state === 1 || a.state === 2) { a.state = 0; a.timer = 1.5 + rnd() * 4.5; a.graze = 0; a.grazeT = rnd() < 0.55 && a.sp !== P.CHICKEN ? 1 : 0; }
      else { a.state = 1; a.timer = 2 + rnd() * 5; a.heading += (rnd() - 0.5) * 2.4; a.grazeT = 0; }
    }
    const walking = a.state > 0;
    const sp = a.state === 2 ? S.speed * 2.3 : S.speed * 0.8;
    // --- horizontal motion
    const want = a.heading, ya = angDiff(a.yaw, want);
    a.yaw += Math.max(-1, Math.min(1, ya)) * Math.min(1, dt * (a.state === 2 ? 9 : 4));
    let moved = 0;
    if (walking) {
      const f = Math.cos(Math.min(Math.abs(ya), 1.4)); // turn first, then walk
      const vx = -Math.sin(a.yaw) * sp * f, vz = -Math.cos(a.yaw) * sp * f;
      const nx = a.x + vx * dt, nz = a.z + vz * dt;
      const ax = nx + Math.sign(vx) * S.r * 0.9, az = nz + Math.sign(vz) * S.r * 0.9;
      let blocked = false;
      for (const [cx, cz] of [[ax, a.z], [a.x, az], [ax, az]]) {
        if (this._solid(cx, a.y + 0.1, cz) || this._solid(cx, a.y + S.h * 0.8, cz)) {
          // 1-block ledge: hop if the space above is free
          if (a.ground && !this._solid(cx, a.y + 1.1, cz) && !this._solid(cx, a.y + 2.1, cz) && !this._solid(a.x, a.y + 2.1, a.z)) a.vy = 6.4;
          else blocked = true;
          break;
        }
      }
      // do not walk off tall cliffs or into deep water
      if (!blocked && a.ground) {
        let drop = 0; for (let k = 1; k <= 4; k++) { if (this._solid(nx, a.y - k + 0.5, nz)) break; drop = k; }
        if (drop >= 3 || (drop >= 1 && this._liquid(nx, a.y - drop - 0.5, nz))) blocked = true;
      }
      if (blocked) { a.heading = a.yaw + Math.PI * (0.55 + rnd() * 0.9); a.state = 1; a.timer = 1.5 + rnd() * 2; }
      else { a.x = nx; a.z = nz; moved = sp * f; }
    }
    // --- vertical
    if (this._liquid(a.x, a.y + 0.2, a.z)) a.vy = Math.max(a.vy, 1.6);
    else a.vy -= GRAVITY * dt;
    if (a.vy < -30) a.vy = -30;
    a.y += a.vy * dt;
    a.ground = false;
    if (a.vy <= 0 && this._solid(a.x, a.y - 0.02, a.z)) { a.y = Math.floor(a.y - 0.02) + 1.0; a.vy = 0; a.ground = true; }
    else if (a.vy > 0 && this._solid(a.x, a.y + S.h, a.z)) a.vy = 0;
    // --- animation state
    const target = moved > 0.05 ? Math.min(1, moved / 1.2) : 0;
    a.anim += (target - a.anim) * Math.min(1, dt * 8);
    a.phase += dt * (3 + moved * 5.5) * (a.anim > 0.02 ? 1 : 0);
    a.graze += (a.grazeT - a.graze) * Math.min(1, dt * 3);
    // --- voice
    if (a.voice <= 0) { a.voice = 12 + rnd() * 28; if (this.audio && this.audio.mob) this.audio.mob(a.sp, Math.sqrt(d2)); }
  }
}
