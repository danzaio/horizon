// Horde mode (Helldivers-style): waves of alien bugs spawn around the players; fight on foot, or one friend flies the ship while the other
// mans the guns. The authority (solo / host) simulates the monsters; guests render them from `hd:s` snapshots and send `hd:hit` when they shoot.
// Public: ctx.horde = { list, authority, running, wave, kills, damage(m, amount, kx, kz, by, lift), start(diff), stop() }  (combat.js targets ctx.horde.list).
import './horde.css';
import { defineFeature } from '../registry.js';
import { B, SOLID, LIQUID } from '../../shared/blocks.js';
import { TYPES, HordeRender } from './render.js';

const TAU = Math.PI * 2;
const num = (v, d = 0, lo = -1e7, hi = 1e7) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
const DIFF = { 0: { n: 'Fácil', count: 0.7, hp: 0.8, dmg: 0.7, spd: 0.9 }, 1: { n: 'Normal', count: 1, hp: 1, dmg: 1, spd: 1 }, 2: { n: 'Difícil', count: 1.4, hp: 1.4, dmg: 1.3, spd: 1.12 } };
let H = null;

class Horde {
  constructor(ctx) {
    this.ctx = ctx; this.world = ctx.world; this.list = []; this.byId = new Map(); this.nextId = 1;
    this.running = false; this.wave = 0; this.kills = 0; this.state = 0; this.breakT = 0; this.queue = []; this.spawnT = 0; this.diff = 1;
    this.render = new HordeRender(ctx.gr.shared, ctx.gr.scene);
    this.sendT = 0; this.tg = []; this.hudT = 0; this.snap = null;
    this._buildHud();
  }

  get authority() { const n = this.ctx.net; return !n || n.role !== 'guest'; }

  // ---- HUD ---------------------------------------------------------------------------------------------------------
  _buildHud() {
    const r = this.hud = document.createElement('div'); r.id = 'hz-horde-hud'; r.className = 'hidden';
    r.innerHTML = '<div class="hd-top"><b class="hd-wave">ONDA 1</b><span class="hd-left"></span><span class="hd-kills"></span></div><div class="hd-bar"><i></i></div><div class="hd-banner"></div>';
    document.body.appendChild(r);
    this.el = { wave: r.querySelector('.hd-wave'), left: r.querySelector('.hd-left'), kills: r.querySelector('.hd-kills'), bar: r.querySelector('i'), banner: r.querySelector('.hd-banner') };
  }
  banner(text, ms = 2600) { const b = this.el.banner; b.textContent = text; b.classList.add('on'); clearTimeout(this._bt); this._bt = setTimeout(() => b.classList.remove('on'), ms); }
  _hudTick(dt) {
    this.hudT -= dt; if (this.hudT > 0) return; this.hudT = 0.2;
    this.hud.classList.toggle('hidden', !this.running);
    if (!this.running) return;
    const alive = this.list.reduce((n, m) => n + (m.dead ? 0 : 1), 0), left = alive + (this.authority ? this.queue.length : this.snapQ || 0);
    this.el.wave.textContent = 'ONDA ' + this.wave; this.el.kills.textContent = '☠ ' + this.kills;
    this.el.left.textContent = this.state === 2 ? 'Próxima onda em ' + Math.max(0, Math.ceil(this.breakT)) + 's' : left + ' monstros';
    this.el.bar.style.width = (this.state === 2 ? 0 : Math.min(100, 100 * (1 - left / Math.max(1, this.waveSize)))) + '%';
  }

  // ---- control -----------------------------------------------------------------------------------------------------
  start(diff = 1) {
    if (!this.authority) { this.ctx.ui.toast('Só o anfitrião inicia a horda'); return; }
    this.clear(); this.running = true; this.diff = diff; this.wave = 0; this.kills = 0; this.ctx.events.emit('horde:start', { diff });
    this._nextWave(); this.sendT = 0; this._send(true);
  }
  stop(silent) {
    if (!this.authority && !silent) return;
    const was = this.running; this.running = false; this.clear(); this.queue.length = 0; this.state = 0;
    if (was && !silent) { this.banner('Horda encerrada · ' + this.kills + ' abates', 3500); this._send(true); this.ctx.events.emit('horde:stop', { wave: this.wave, kills: this.kills }); }
  }
  clear() { this.list.length = 0; this.byId.clear(); }

  _nextWave() {
    this.wave++; const D = DIFF[this.diff], w = this.wave, n = Math.max(4, Math.round((5 + 4 * w) * D.count)), q = [];
    const players = 1 + (this.ctx.net ? this.ctx.net.players.size : 0), total = Math.round(n * (1 + 0.45 * (players - 1)));
    for (let i = 0; i < total; i++) { const r = Math.random(); q.push(w >= 3 && r < 0.12 ? 1 : w >= 2 && r < 0.38 ? 2 : 0); }
    if (w % 5 === 0) for (let i = 0; i < Math.floor(w / 5) * players; i++) q.push(3);
    for (let i = q.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [q[i], q[j]] = [q[j], q[i]]; }
    this.queue = q; this.waveSize = q.length; this.state = 1; this.spawnT = 1.5;
    this.banner(w % 5 === 0 ? 'ONDA ' + w + ' · ⚠ TITÃ' : 'ONDA ' + w, 3000); this.ctx.audio.respawn();
  }

  // ---- targets (players) --------------------------------------------------------------------------------------------
  _targets() {
    const ctx = this.ctx, ir = ctx.itemsRuntime, out = this.tg; out.length = 0;
    const p = ctx.player; if (!ir || ir.health.alive) out.push({ id: 'me', local: true, x: p.x, y: p.y, z: p.z });
    const n = ctx.net; if (n && n.players) for (const q of n.players.values()) if (q && q.pos && q.alive !== false && q.hasPos !== false) out.push({ id: q.id, local: false, x: q.pos.x, y: q.pos.y, z: q.pos.z });
    return out;
  }

  // ---- damage ------------------------------------------------------------------------------------------------------
  damage(m, amount, kx = 0, kz = 0, by = 'me', lift = 3) {
    if (!m || m.dead || !(amount > 0)) return;
    const ctx = this.ctx, ir = ctx.itemsRuntime, net = ctx.net;
    if (!this.authority) {
      if (net && net.send) net.send('hd:hit', { id: m.id, d: Math.min(80, amount), kx, kz });
      m.hp -= amount; m.flash = 1; if (m.hp <= 0) m.dead = true;
    } else this._apply(m, amount, kx, kz, lift, by);
    if (by === 'me' && ir) { ir.hud.floatText(m.x, m.y + m.h + 0.3, m.z, String(Math.round(amount)), '#9dff6a'); ir.hud.hitmarker(m.dead); ctx.audio.hitmark(m.dead); }
  }

  _apply(m, amount, kx, kz, lift, by) {
    m.hp -= amount; m.flash = 1; m.kx += kx * 0.5; m.kz += kz * 0.5; m.vy = Math.max(m.vy, Math.min(lift, 9));
    if (m.hp <= 0 && !m.dead) this._kill(m, by);
  }

  _kill(m, by) {
    m.dead = true; this.kills++; const ctx = this.ctx, T = TYPES[m.t];
    ctx.interaction.particles.burst(m.x, m.y + m.h * 0.5, m.z, [0.45, 0.95, 0.3], 14, 1.6); ctx.interaction.particles.burst(m.x, m.y + m.h * 0.5, m.z, [0.35, 0.15, 0.4], 8, 1.1);
    if (by === 'me' && ctx.itemsRuntime && (m.t >= 1)) ctx.itemsRuntime.hud.killFeed('Abate: ' + T.name);
    ctx.events.emit('horde:kill', { type: T.id, x: m.x, y: m.y, z: m.z });
  }

  // ---- simulation (authority) ----------------------------------------------------------------------------------------
  _solid(x, y, z) { const b = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); return b === B.UNLOADED || SOLID[b] === 1; }
  _liquid(x, y, z) { return LIQUID[this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))] === 1; }

  _spawn(t) {
    const w = this.world, tg = this._targets(); if (!tg.length) return false;
    const T = TYPES[t], D = DIFF[this.diff];
    for (let tries = 0; tries < 8; tries++) {
      const base = tg[(Math.random() * tg.length) | 0], a = Math.random() * TAU, d = (T.fly ? 22 : 28) + Math.random() * 22;
      const x = base.x + Math.cos(a) * d, z = base.z + Math.sin(a) * d;
      let y;
      if (T.fly) y = base.y + 7 + Math.random() * 12; else { y = w.getSurfaceY(Math.floor(x), Math.floor(z)) + 1.02; if (this._liquid(x, y - 1, z) || this._liquid(x, y, z)) continue; }
      if (w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === B.UNLOADED || this._solid(x, y, z) || this._solid(x, y + T.h, z)) continue;
      const hp = T.hp * D.hp * (1 + 0.06 * this.wave) * (t === 3 ? 1 + 0.35 * (this.wave / 5 - 1) : 1);
      const m = { id: this.nextId++, t, x, y, z, vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, yaw: Math.random() * TAU, hp, max: hp, r: T.r * T.scale, h: T.h, phase: Math.random() * 6, moving: 0, flash: 0, cd: 1, dead: false, ground: false, tgt: null, tgtT: 0, tx: x, ty: y, tz: z, born: 0 };
      this.list.push(m); this.byId.set(m.id, m); return true;
    }
    return false;
  }

  _step(m, dt, tg) {
    const T = TYPES[m.t], D = DIFF[this.diff], w = this.world;
    if (w.getBlock(Math.floor(m.x), Math.floor(m.y), Math.floor(m.z)) === B.UNLOADED) return;
    m.born += dt; m.cd -= dt; m.flash = Math.max(0, m.flash - dt * 4);
    m.tgtT -= dt; if (m.tgtT <= 0 || !m.tgt) { m.tgtT = 0.5; let best = null, bd = 1e12; for (const t of tg) { const d = (t.x - m.x) ** 2 + (t.z - m.z) ** 2 + (t.y - m.y) ** 2 * 0.5; if (d < bd) { bd = d; best = t; } } m.tgt = best; m.tgtD = Math.sqrt(bd); }
    const tt = m.tgt; if (!tt) return;
    if (m.tgtD > 150) { this.byId.delete(m.id); m.dead = true; m.silent = true; this.queue.push(m.t); return; }   // wandered off: re-queue it near the players
    const dx = tt.x - m.x, dz = tt.z - m.z, dy = (tt.y + 0.9) - (m.y + m.h * 0.5), d2 = Math.hypot(dx, dz), d3 = Math.hypot(dx, dy, dz);
    const sp = T.speed * D.spd * (1 + 0.015 * this.wave) * (m.t === 3 ? 1 : 1);
    const want = Math.atan2(-dx, -dz); m.yaw += angDiff(m.yaw, want) * Math.min(1, dt * (T.fly ? 7 : 5));
    let moved = 0;
    if (T.fly) {
      const wob = Math.sin(m.born * 2.2 + m.id) * 0.9, tyy = tt.y + 1.7 + wob;
      const hs = d2 > T.reach * 0.7 ? sp : sp * 0.35, cs = Math.cos(m.yaw), sn = Math.sin(m.yaw);
      m.vx += ((-sn * hs + cs * wob * 1.5) - m.vx) * Math.min(1, dt * 4); m.vz += ((-cs * hs - sn * wob * 1.5) - m.vz) * Math.min(1, dt * 4);
      m.vy += (Math.max(-6, Math.min(6, (tyy - m.y) * 2)) - m.vy) * Math.min(1, dt * 4);
      if (this._solid(m.x + m.vx * 0.3, m.y, m.z + m.vz * 0.3)) m.vy = Math.max(m.vy, 7);
      const nx = m.x + (m.vx + m.kx) * dt, ny = m.y + m.vy * dt, nz = m.z + (m.vz + m.kz) * dt;
      if (!this._solid(nx, m.y + 0.3, m.z)) m.x = nx; if (!this._solid(m.x, m.y + 0.3, nz)) m.z = nz; if (!this._solid(m.x, ny + 0.3, m.z) || ny > m.y) m.y = ny;
      moved = Math.hypot(m.vx, m.vz);
    } else {
      const cs = Math.cos(m.yaw), sn = Math.sin(m.yaw), face = Math.cos(Math.min(Math.abs(angDiff(m.yaw, want)), 1.4));
      if (d2 > T.reach * 0.75) {
        const vx = -sn * sp * face, vz = -cs * sp * face, nx = m.x + vx * dt, nz = m.z + vz * dt, r = m.r;
        const bx = this._solid(nx + Math.sign(vx) * r, m.y + 0.1, m.z) || this._solid(nx + Math.sign(vx) * r, m.y + T.h * 0.8, m.z);
        const bz = this._solid(m.x, m.y + 0.1, nz + Math.sign(vz) * r) || this._solid(m.x, m.y + T.h * 0.8, nz + Math.sign(vz) * r);
        if ((bx || bz) && m.ground && !this._solid(m.x + Math.sign(vx) * (r + 0.4), m.y + 1.1, m.z + Math.sign(vz) * (r + 0.4)) && !this._solid(m.x, m.y + T.h + 1.1, m.z)) m.vy = 7.6 + (m.t === 3 ? 2 : 0);   // hop a 1-block ledge
        if (!bx) m.x = nx; if (!bz) m.z = nz; moved = sp * face * (bx && bz ? 0.2 : 1);
      }
      if (this._liquid(m.x, m.y + 0.2, m.z)) m.vy = Math.max(m.vy, 2.2); else m.vy -= 26 * dt;
      m.y += m.vy * dt; m.ground = false;
      if (m.vy <= 0 && this._solid(m.x, m.y - 0.02, m.z)) { m.y = Math.floor(m.y - 0.02) + 1; m.vy = 0; m.ground = true; }
      else if (m.vy > 0 && this._solid(m.x, m.y + T.h, m.z)) m.vy = 0;
      const nx = m.x + m.kx * dt, nz = m.z + m.kz * dt; if (!this._solid(nx, m.y + 0.5, m.z)) m.x = nx; if (!this._solid(m.x, m.y + 0.5, nz)) m.z = nz;
    }
    const f = Math.exp(-5 * dt); m.kx *= f; m.kz *= f;
    m.moving = Math.min(1, moved / 5); m.phase += dt * (4 + moved * 1.6);
    if (m.y < 2) { m.dead = true; m.silent = true; }
    // attack
    if (m.cd <= 0 && d3 < T.reach + 0.5 && Math.abs(dy) < T.h + 1.4) {
      m.cd = T.fly ? 0.9 : 1.2; const k = T.kb, l = d2 || 1, dmg = T.dmg * D.dmg * (1 + 0.03 * this.wave);
      this._hurt(tt, dmg, dx / l * k, dz / l * k, T.name);
    }
  }

  _hurt(t, dmg, kx, kz, who) {
    const ctx = this.ctx, ir = ctx.itemsRuntime;
    if (t.local) { if (ir && ir.health.alive) { ir.health.damage(dmg, { kind: 'monster', by: who, weapon: 'garras' }); if (!ir.health.invulnerable) ctx.player.impulse(kx * 0.5, 3, kz * 0.5); } }
    else if (ctx.net && ctx.net.broadcast) ctx.net.broadcast('hd:dmg', { to: t.id, d: Math.round(dmg * 10) / 10, kx, kz, w: who });
  }

  _director(dt) {
    if (!this.running) return;
    const q = this.ctx.settings && this.ctx.settings.quality, cap = (q === 'potato' ? 16 : q === 'low' ? 24 : 38) + Math.min(10, (this.ctx.net ? this.ctx.net.players.size : 0) * 4);
    let alive = 0; for (const m of this.list) if (!m.dead) alive++;
    if (this.state === 1) {
      this.spawnT -= dt;
      if (this.queue.length && alive < cap && this.spawnT <= 0) { if (this._spawn(this.queue[this.queue.length - 1])) this.queue.pop(); this.spawnT = Math.max(0.2, 1.1 - this.wave * 0.06); }
      if (!this.queue.length && alive === 0) {
        this.state = 2; this.breakT = 7; this.banner('ONDA ' + this.wave + ' CONCLUÍDA', 3000);
        const ir = this.ctx.itemsRuntime; if (ir && ir.health.alive) ir.health.heal(10); if (this.ctx.net && this.ctx.net.broadcast) this.ctx.net.broadcast('hd:heal', { n: 10 });
        this.ctx.events.emit('horde:wave', { wave: this.wave, kills: this.kills });
      }
    } else if (this.state === 2) { this.breakT -= dt; if (this.breakT <= 0) this._nextWave(); }
  }

  update(dt) {
    dt = Math.min(dt, 0.1);
    if (this.running || this.list.length) {
      if (this.authority) {
        if (this.running) {
          this._director(dt); const tg = this._targets();
          for (let i = 0; i < this.list.length; i++) { const m = this.list[i]; if (!m.dead) this._step(m, dt, tg); }
          this.sendT -= dt; if (this.sendT <= 0) this._send();
        }
      } else {
        const k = 1 - Math.exp(-10 * dt);
        for (const m of this.list) { const px = m.x, pz = m.z; m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k; m.z += (m.tz - m.z) * k; m.yaw += angDiff(m.yaw, m.tyaw) * k; m.flash = Math.max(0, m.flash - dt * 4); const mv = Math.hypot(m.x - px, m.z - pz) / Math.max(dt, 1e-3); m.moving = Math.min(1, mv / 5); m.phase += dt * (4 + mv * 1.6); }
      }
      // drop the dead (swap-pop: combat may hold the array during the same frame, so only here)
      for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].dead) { const m = this.list[i]; if (!m.silent) this.byId.delete(m.id); this.list[i] = this.list[this.list.length - 1]; this.list.pop(); }
    }
    this.render.update(this.list, this.ctx.camera.position, !!this.ctx.gr.post);
    this._hudTick(dt);
  }

  // ---- network ---------------------------------------------------------------------------------------------------
  _send(force) {
    const net = this.ctx.net; this.sendT = this.running ? 0.1 : 1.5;
    if (!net || !net.broadcast || net.role === 'guest' || (!net.players.size && !force)) return;
    const r = (v) => Math.round(v * 10) / 10, m = [];
    for (const o of this.list) if (!o.dead && m.length < 64) m.push([o.id, o.t, r(o.x), r(o.y), r(o.z), r(o.yaw), Math.ceil(o.hp), o.flash > 0.5 ? 1 : 0]);
    net.broadcast('hd:s', { r: this.running ? 1 : 0, w: this.wave, k: this.kills, s: this.state, b: Math.round(this.breakT), q: this.queue.length, d: this.diff, z: this.waveSize || 1, m }, { reliable: false });
  }

  onState(d) {
    if (this.authority || !d) return;
    const was = this.running; this.running = !!d.r; this.wave = num(d.w, 0, 0, 999); this.kills = num(d.k, 0, 0, 1e6); this.state = num(d.s, 0, 0, 2); this.breakT = num(d.b, 0, 0, 99); this.snapQ = num(d.q, 0, 0, 999); this.waveSize = num(d.z, 1, 1, 999); this.diff = num(d.d, 1, 0, 2);
    if (this.running && !was) this.banner('Horda iniciada — ONDA ' + this.wave, 3000);
    if (!this.running) { if (was) { this.banner('Horda encerrada · ' + this.kills + ' abates', 3500); } this.clear(); return; }
    const seen = new Set();
    if (Array.isArray(d.m)) for (const e of d.m.slice(0, 64)) {
      if (!Array.isArray(e)) continue; const id = num(e[0], 0, 1, 1e9), t = num(e[1], 0, 0, 3) | 0; if (!id || !TYPES[t]) continue; seen.add(id);
      let m = this.byId.get(id);
      if (!m) { const T = TYPES[t]; m = { id, t, x: num(e[2]), y: num(e[3], 80, -64, 600), z: num(e[4]), vx: 0, vy: 0, vz: 0, kx: 0, kz: 0, yaw: num(e[5], 0, -10, 10), hp: num(e[6], 1), max: num(e[6], 1), r: T.r * T.scale, h: T.h, phase: Math.random() * 6, moving: 0, flash: 0, dead: false, tx: 0, ty: 0, tz: 0, tyaw: 0 }; this.list.push(m); this.byId.set(id, m); }
      m.tx = num(e[2]); m.ty = num(e[3], 80, -64, 600); m.tz = num(e[4]); m.tyaw = num(e[5], 0, -10, 10); m.hp = num(e[6], 1); if (e[7] && m.flash < 0.5) m.flash = 1;
      if (Math.hypot(m.x - m.tx, m.z - m.tz) > 30) { m.x = m.tx; m.y = m.ty; m.z = m.tz; }
    }
    for (const m of this.list) if (!seen.has(m.id)) { if (!m.dead && Math.hypot(m.x - this.ctx.player.x, m.z - this.ctx.player.z) < 80) { this.ctx.interaction.particles.burst(m.x, m.y + m.h * 0.5, m.z, [0.45, 0.95, 0.3], 10, 1.4); } m.dead = true; }
  }

  onHit(d, from) {
    if (!this.authority || !this.running || !d) return;
    const m = this.byId.get(num(d.id, 0)); if (!m || m.dead) return;
    this._apply(m, num(d.d, 0, 0, 80), num(d.kx, 0, -30, 30), num(d.kz, 0, -30, 30), 3, from);
  }

  onDmg(d) {
    const ctx = this.ctx, net = ctx.net, ir = ctx.itemsRuntime; if (!d || !net || d.to !== net.localId || !ir || !ir.health.alive) return;
    ir.health.damage(num(d.d, 0, 0, 40), { kind: 'monster', by: String(d.w || 'Monstro').slice(0, 20), weapon: 'garras' });
    if (!ir.health.invulnerable) ctx.player.impulse(num(d.kx, 0, -20, 20) * 0.5, 3, num(d.kz, 0, -20, 20) * 0.5);
  }

  dispose() { this.hud.remove(); this.render.dispose(); }
}

export default defineFeature({
  id: 'horde', order: 30,

  init(ctx) {
    H = new Horde(ctx);
    ctx.horde = { get list() { return H.list; }, get authority() { return H.authority; }, get running() { return H.running; }, get wave() { return H.wave; }, get kills() { return H.kills; }, damage: (...a) => H.damage(...a), start: (d) => H.start(d), stop: () => H.stop(), spawn: (t) => H._spawn(t) };
    const open = () => {
      const el = document.createElement('div'); el.className = 'hd-panel';
      const auth = H.authority;
      el.innerHTML = `<p>Ondas de monstros alienígenas surgem ao redor de vocês. Lute a pé ou <b>pegue a nave (B)</b>: um pilota, o outro entra como <b>artilheiro</b> (B perto da nave) e metralha tudo. Use <b>V</b> dash, <b>C</b> no ar para ground-pound, e as armas da tecla <b>E</b>.</p>
        <label>Dificuldade <select id="hd-diff"><option value="0">Fácil</option><option value="1" selected>Normal</option><option value="2">Difícil</option></select></label>
        <div class="hd-btns"><button class="btn primary" id="hd-go"></button><button class="btn" id="hd-stop">Encerrar</button></div>
        <p class="hd-st"></p>`;
      const st = el.querySelector('.hd-st'), go = el.querySelector('#hd-go'), stop = el.querySelector('#hd-stop'), df = el.querySelector('#hd-diff');
      const sync = () => { go.textContent = H.running ? 'Reiniciar' : 'Iniciar horda'; stop.style.display = H.running ? '' : 'none'; go.disabled = df.disabled = !auth; st.textContent = auth ? (H.running ? `Onda ${H.wave} · ${H.kills} abates` : '') : 'Só o anfitrião do planeta inicia a horda (você vê os monstros e ajuda a matar).'; };
      go.onclick = () => { H.start(+df.value); ctx.ui.closePanels(); }; stop.onclick = () => { H.stop(); ctx.ui.closePanels(); }; sync();
      ctx.ui.panel({ id: 'horde', title: 'Horda de monstros', subtitle: 'cooperativo', content: el, width: 520 });
    };
    ctx.ui.addToolbarButton({ id: 'horde', icon: '👾', title: 'Horda de monstros', key: 'H', onClick: open });
    ctx.addHotkey('KeyH', open);
    ctx.events.on('player:respawn', () => { /* monsters keep going: respawn is part of the loop */ });
    ctx.events.on('net:role', () => { if (H && H.authority === false) { H.running = false; H.clear(); } });
  },

  ready(ctx) {
    if (!H) return;
    const net = ctx.net; if (!net || !net.on) return;
    net.on('hd:s', (d) => H.onState(d)); net.on('hd:hit', (d, from) => H.onHit(d, from)); net.on('hd:dmg', (d) => H.onDmg(d));
    net.on('hd:heal', (d) => { const ir = ctx.itemsRuntime; if (ir && ir.health.alive) ir.health.heal(num(d && d.n, 0, 0, 20)); });
    ctx.events.on('net:peerJoin', () => { if (H.running) H._send(true); });
  },

  update(dt) { if (H) H.update(dt); },
  dispose() { if (H) { H.dispose(); H = null; } },
});
