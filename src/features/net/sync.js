// Sync: glue between Net (messages) and the game (world edits, permissions, time, weather, local pose).
import { B } from '../../shared/blocks.js';
import { clampNum, r2, r3, BLOCK_ID_MAX, WORLD_H } from './protocol.js';

const REACH_SQ = 30 * 30, MAX_PER_MSG = 40, WX_KINDS = ['clear', 'rain', 'storm', 'snow'];
const wrap24 = (d) => ((d + 36) % 24) - 12;

export class Sync {
  constructor(net, ctx) {
    this.net = net; this.ctx = ctx; this.world = ctx.world; this.q = []; this.corr = 0; this.lastWx = 'clear'; this.flyWarn = 0; this.offs = [];
    this.offs.push(ctx.events.on('world:blockSet', (e) => this.onBlockSet(e)));
    const P = net.dome.perms, role = () => net.role;
    // dome permissions: guests obey them locally; the host enforces them on guest-originated actions (by !== host); pvp binds everybody inside a dome
    const guestRule = (key) => (info) => {
      const r = role(); if (r === 'solo') return undefined;
      if (r === 'guest') return P[key] ? undefined : false;
      const by = info && info.by; return by && by !== net.localId && by !== ctx.identity.id && !P[key] ? false : undefined;
    };
    this.offs.push(ctx.permissions.add('place', guestRule('build')), ctx.permissions.add('break', guestRule('break')), ctx.permissions.add('fly', (i) => (role() === 'guest' && !P.fly ? false : (void i, undefined))),
      ctx.permissions.add('pvp', () => (role() !== 'solo' && !P.pvp ? false : undefined)));
    if (net.welcome) { this.setHours(net.welcome.time); ctx.gr.time.speed = net.welcome.speed; this.applyWeather(net.welcome.weather, true); }
  }

  // ---------------------------------------------------------------- edits
  onBlockSet(e) {
    const net = this.net, src = e.source;
    if (net.role === 'host') { if (src === 'local' || src === 'game') this.q.push(e.x, e.y, e.z, e.id, 0); }
    else if (net.role === 'guest' && src === 'local') {
      const key = e.id === B.AIR ? 'break' : 'place', perm = key === 'place' ? 'build' : 'break';
      if (!net.dome.perms[perm]) { if (e.prev >= 0) this.world.applyEdit(e.x, e.y, e.z, e.prev, 'remote'); this.ctx.ui.toast(key === 'place' ? 'Construir está desativado neste domo' : 'Quebrar blocos está desativado neste domo'); return; }
      if (this.q.length < 20000) this.q.push(e.x, e.y, e.z, e.id, e.prev);
    }
  }
  flushEdits() {
    const q = this.q; if (!q.length) return;
    const n = MAX_PER_MSG * 5;
    for (let i = 0; i < q.length; i += n) {
      const m = { t: 'eb', e: q.slice(i, i + n) };
      if (this.net.role === 'host') this.net._toAll(m); else this.net._gSend(m);
    }
    q.length = 0;
  }
  /** Host: validate + apply + relay a guest's edit batch. */
  hostEdits(peer, list) {
    if (!Array.isArray(list) || list.length > MAX_PER_MSG * 5) return;
    const net = this.net, ctx = this.ctx, w = this.world, ok = [], fix = [], r = peer.raw, known = peer.rp.hasPos;
    for (let i = 0; i + 4 < list.length; i += 5) {
      const x = list[i], y = list[i + 1], z = list[i + 2], id = list[i + 3], prev = list[i + 4];
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) || !Number.isInteger(id) || Math.abs(x) > 3e7 || Math.abs(z) > 3e7 || y < 0 || y >= WORLD_H || id < 0 || id > BLOCK_ID_MAX) continue;
      const dx = x + 0.5 - r[0], dy = y + 0.5 - r[1], dz = z + 0.5 - r[2];
      const allowed = (!known || dx * dx + dy * dy + dz * dz < REACH_SQ) && ctx.permissions.can(id === B.AIR ? 'break' : 'place', { x, y, z, id, by: peer.id });
      if (allowed) { w.applyEdit(x, y, z, id, 'remote'); ok.push(x, y, z, id, 0); }
      else { const cur = w.getBlock(x, y, z); fix.push(x, y, z, cur === B.UNLOADED ? (Number.isInteger(prev) && prev >= 0 && prev <= BLOCK_ID_MAX ? prev : 0) : cur, 0); }
    }
    if (ok.length) net._toAll({ t: 'eb', e: ok }, true, peer.id);
    if (fix.length) net._pSend(peer, { t: 'efix', e: fix });
  }
  /** Guest: apply edits the host sent (also corrections of rejected edits). */
  guestEdits(list) {
    if (!Array.isArray(list) || list.length > 60000) return;
    for (let i = 0; i + 3 < list.length; i += 5) {
      const x = list[i], y = list[i + 1], z = list[i + 2], id = list[i + 3];
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z) || !Number.isInteger(id) || Math.abs(x) > 3e7 || Math.abs(z) > 3e7 || y < 0 || y >= WORLD_H || id < 0 || id > BLOCK_ID_MAX) continue;
      this.world.applyEdit(x, y, z, id, 'remote');
    }
  }

  /** After a reconnect: the host sent a fresh welcome; bring the world, clock and weather back in line. */
  resume(w) {
    const world = this.world;
    for (let i = 0; i + 3 < w.edits.length; i += 4) world.applyEdit(w.edits[i] * 32 + (w.edits[i + 2] & 31), w.edits[i + 2] >> 10, w.edits[i + 1] * 32 + ((w.edits[i + 2] >> 5) & 31), w.edits[i + 3], 'remote');
    this.setHours(w.time); this.ctx.gr.time.speed = w.speed; this.applyWeather(w.weather, false);
    for (const [k, h] of this.net._snaps) if (k in w.snapshots) { try { h.set(w.snapshots[k]); } catch (e) { console.error('[HZ] snapshot set failed:', k, e); } }
  }

  // ---------------------------------------------------------------- pose
  pose() {
    const p = this.ctx.player, l = this.ctx.localState, h = this.ctx.hotbar;
    const fl = (p.crouching ? 1 : 0) | (p.inWater ? 2 : 0) | (p.flying ? 4 : 0) | (p.sprinting ? 8 : 0) | (p.onGround ? 16 : 0);
    const item = l.item !== null && l.item !== undefined ? l.item : (h && h.slots ? h.slots[h.sel] : null);
    return [r2(p.x), r2(p.y), r2(p.z), r3(p.yaw), r3(p.pitch), fl, l.hp === undefined ? 20 : l.hp, l.team === undefined ? null : l.team, item === undefined ? null : item];
  }
  hostPos() { const p = this.ctx.player; return [r2(p.x), r2(p.y), r2(p.z)]; }

  // ---------------------------------------------------------------- time / weather
  hours() { return this.ctx.gr.time.hours; }
  timeSpeed() { return this.ctx.gr.time.speed; }
  setHours(h) { this.ctx.gr.time.hours = ((h % 24) + 24) % 24; }
  onTime(m) {
    if (typeof m.h !== 'number') return;
    this.corr = wrap24(clampNum(m.h, 0, 24, 9) - this.ctx.gr.time.hours);
    if (Math.abs(this.corr) > 2) { this.setHours(m.h); this.corr = 0; }
    this.ctx.gr.time.speed = clampNum(m.s, 0, 5, 0.02);
  }
  weatherKind() {
    const w = this.ctx.gr._wx; if (!w) return 'clear';
    return w.target <= 0 ? 'clear' : w.type === 'snow' ? 'snow' : w.storm ? 'storm' : 'rain';
  }
  pollWeather() { const k = this.weatherKind(); if (k !== this.lastWx) { this.lastWx = k; this.net._toAll({ t: 'weather', kind: k }); } }
  onWeather(kind) { this.applyWeather(kind, false); }
  applyWeather(kind, instant) {
    if (!WX_KINDS.includes(kind)) return;
    this.lastWx = kind; const hz = window.__hz;
    if (hz && hz.setWeather) hz.setWeather(kind, instant);
  }

  /** per frame while connected: follow the host's clock gently; guests cannot fly where the dome forbids it */
  frame(dt) {
    const net = this.net, ctx = this.ctx;
    if (net.role !== 'guest') return;
    if (this.corr) { const s = this.corr * Math.min(1, dt * 1.5); this.setHours(ctx.gr.time.hours + s); this.corr -= s; if (Math.abs(this.corr) < 0.001) this.corr = 0; }
    if (!net.dome.perms.fly && ctx.player.flying) {
      ctx.player.flying = false; ctx.player.vy = 0; if (ctx.ui.setFly) ctx.ui.setFly(false);
      const now = performance.now(); if (now - this.flyWarn > 4000) { this.flyWarn = now; ctx.ui.toast('Voar está desativado neste domo'); }
    }
  }

  dispose() { for (const o of this.offs) o(); this.offs.length = 0; }
}
