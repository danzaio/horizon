// Cars: the BYD Dolphin Mini. R calls your car / gets in / gets out. Arcade driving on voxel terrain (climbs 1-block steps, jumps off ramps,
// drifts with the handbrake), 3rd person chase camera or driver's seat (Z), run over monsters and animals, horn (X). Others can ride along (R near a driven car).
import './cars.css';
import * as THREE from 'three';
import { defineFeature } from '../registry.js';
import { SOLID, LIQUID } from '../../shared/blocks.js';
import { makeShipMaterial } from '../ships/model.js';
import { buildCarGeometry, CAR_COLORS } from './model.js';

const TAU = Math.PI * 2;
const MAX_FWD = 26, MAX_SPORT = 36, MAX_REV = 8, WB = 1.2, HW = 0.78;      // m/s, wheel base half length, half track
const num = (v, d = 0, lo = -1e7, hi = 1e7) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const hashColor = (id) => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return CAR_COLORS[h % CAR_COLORS.length]; };
let C = null;

class Cars {
  constructor(ctx) {
    this.ctx = ctx; this.world = ctx.world; this.player = ctx.player; this.camera = ctx.camera; this.gr = ctx.gr;
    this.geo = buildCarGeometry(); this.color = hashColor(ctx.identity.id); this.mat = makeShipMaterial(ctx.gr.shared, this.color);
    this.mesh = new THREE.Mesh(this.geo, this.mat); this.mesh.frustumCulled = false; this.mesh.visible = false; ctx.gr.scene.add(this.mesh);
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0; this.h = 0; this.sp = 0; this.steer = 0; this.pitch = 0; this.roll = 0;
    this.alive = false; this.driving = false; this.ride = null; this.mode = '3p'; this.camDist = 6.5; this.offs = 0; this.lastYaw = 0; this.camInit = false; this.cam = new THREE.Vector3();
    this.q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._v = new THREE.Vector3(); this._o = new THREE.Vector3(); this._d = new THREE.Vector3();
    this.hudT = 0; this.sendT = 0; this.callCd = 0; this.hitCd = 0; this.remote = new Map(); this._post = null; this.air = false;
    const r = this.hud = document.createElement('div'); r.id = 'hz-car-hud'; r.className = 'hidden';
    r.innerHTML = '<div class="car-frame"><i class="a"></i><i class="b"></i><i class="c"></i></div><div class="car-dash"><div class="car-wheel"></div><div class="car-spd"><b>0</b><small>km/h</small></div><div class="car-mode"></div></div><div class="car-hints"><kbd>W S</kbd> acelerar/ré · <kbd>A D</kbd> virar · <kbd>Espaço</kbd> freio de mão (drift) · <kbd>Shift</kbd> sport · <kbd>X</kbd> buzina · <kbd>Z</kbd> câmera · <kbd>R</kbd> sair</div>';
    document.body.appendChild(r); this.el = { spd: r.querySelector('.car-spd b'), wheel: r.querySelector('.car-wheel'), mode: r.querySelector('.car-mode'), frame: r.querySelector('.car-frame') };
  }

  // ---- terrain ----------------------------------------------------------------------------------------------------
  _ground(x, z, y0) { // y of the top of the first solid block below y0+1.6 (null = column not loaded)
    const w = this.world, bx = Math.floor(x), bz = Math.floor(z);
    for (let yy = Math.floor(y0 + 1.6), n = 0; n < 12; n++, yy--) { const b = w.getBlock(bx, yy, bz); if (b === 255) return null; if (SOLID[b] === 1) return yy + 1; }
    return y0 - 12;
  }
  _solid(x, y, z) { const b = this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); return b !== 255 && SOLID[b] === 1; }
  _corners(x, z, h, y0, out) { // 4 wheel contact heights: [FL, FR, RL, RR]
    const fx = -Math.sin(h), fz = -Math.cos(h), rx = Math.cos(h), rz = -Math.sin(h); let ok = true, i = 0;
    for (const [a, b] of [[WB, -HW], [WB, HW], [-WB, -HW], [-WB, HW]]) { const g = this._ground(x + fx * a + rx * b, z + fz * a + rz * b, y0); if (g === null) ok = false; out[i++] = g === null ? y0 : g; }
    return ok;
  }

  // ---- lifecycle --------------------------------------------------------------------------------------------------
  call() {
    if (this.callCd > 0) return; this.callCd = 1; const p = this.player, ctx = this.ctx;
    let found = false;
    for (const r of [5, 7, 4, 9]) for (const da of [0, 0.7, -0.7, 1.4, -1.4]) {
      if (found) break; const a = p.yaw + da, cx = p.x - Math.sin(a) * r, cz = p.z - Math.cos(a) * r, gy = this._ground(cx, cz, p.y);
      if (gy === null || Math.abs(gy - p.y) >= 3) continue;
      let clear = true; for (let d = -2; d <= 5 && clear; d++) for (const dh of [0.6, 1.4]) if (this._solid(cx - Math.sin(p.yaw) * d, gy + dh, cz - Math.cos(p.yaw) * d)) { clear = false; break; }   // room to drive off (no tree in front)
      if (clear) { this.x = cx; this.z = cz; this.y = gy; found = true; }
    }
    if (!found) { this.x = p.x - Math.sin(p.yaw) * 5; this.z = p.z - Math.cos(p.yaw) * 5; this.y = Math.max(p.y, this._ground(this.x, this.z, p.y) || p.y); }
    this.h = p.yaw + Math.PI / 2 * 0; this.sp = 0; this.vx = this.vz = this.vy = 0; this.pitch = this.roll = 0; this.alive = true; this.mesh.visible = true;
    ctx.audio.teleport(); for (let i = 0; i < 2; i++) ctx.interaction.particles.burst(this.x, this.y + 0.6, this.z, [0.7, 0.9, 1], 12, 2);
    ctx.ui.toast('🚗 Dolphin Mini chamado — aperte R perto dele para entrar'); this._send(true);
  }

  enter() {
    const ctx = this.ctx, p = this.player, ir = ctx.itemsRuntime; if (ir && !ir.health.alive) return;
    this.driving = true; p.vx = p.vy = p.vz = 0; p.flying = false; ctx.controls.noDoubleTapFly = true; ctx.interaction.enabled = false;
    if (ir) ir.suspend(); if (this.gr.hand) this.gr.hand.root.visible = false;
    this.offs = 0; this.lastYaw = p.yaw = this.h; p.pitch = 0.18; this.camInit = false; this.hud.classList.remove('hidden');
    ctx.audio.equip(); ctx.events.emit('car:enter', {});
  }

  leave(force) {
    if (!this.driving && !this.ride) return; const ctx = this.ctx, p = this.player, ir = ctx.itemsRuntime;
    const pose = this.ride ? this.remote.get(this.ride) : this; if (!pose) return;
    const hd = pose.h, rx = Math.cos(hd), rz = -Math.sin(hd); let spot = null;
    for (const [ox, oz] of [[-1, 0], [1, 0], [0, 1], [0, -1]]) { const sx = pose.x + rx * 1.8 * (ox || 0) + (-Math.sin(hd)) * 1.8 * (oz || 0), sz = pose.z + rz * 1.8 * (ox || 0) + (-Math.cos(hd)) * 1.8 * (oz || 0), g = this._ground(sx, sz, pose.y); if (g !== null && Math.abs(g - pose.y) < 2.5 && !this._solid(sx, g + 0.5, sz) && !this._solid(sx, g + 1.5, sz)) { spot = { x: sx, y: g + 0.02, z: sz }; break; } }
    if (!spot && !force) { ctx.ui.toast('Sem espaço para sair — manobre o carro'); return; }
    if (!spot) spot = { x: pose.x, y: pose.y + 1, z: pose.z };
    if (this.ride) { const id = this.ride; this.ride = null; const n = ctx.net; if (n && n.broadcast) n.broadcast('car:g', { to: id, on: 0 }); }
    this.driving = false; p.teleport(spot.x, spot.y, spot.z); p.pitch = 0; p.fovCur = p.fovBase; this.camera.fov = p.fovBase; this.camera.updateProjectionMatrix();
    ctx.controls.noDoubleTapFly = false; ctx.interaction.enabled = true; ctx.audio.jet(0); if (this.gr.hand) this.gr.hand.root.visible = true;
    if (ir) { ir.health.noFall = 1; ir.health._peak = p.y; }
    this.hud.classList.add('hidden'); this.mesh.visible = this.alive; ctx.events.emit('car:exit', {}); this._send(true);
  }

  onR() {
    const ctx = this.ctx, p = this.player; if (ctx.state !== 'playing' || (ctx.ship && ctx.ship.piloting)) return;
    if (this.driving || this.ride) { this.leave(); return; }
    if (this.alive && Math.hypot(this.x - p.x, this.z - p.z) < 6 && Math.abs(this.y - p.y) < 5) { this.enter(); return; }
    for (const [id, r] of this.remote) if (r.k === 1 && Math.hypot(r.x - p.x, r.z - p.z) < 8 && Math.abs(r.y - p.y) < 5) { this.boardRide(id); return; }
    this.call();
  }

  boardRide(id) {
    const ctx = this.ctx, p = this.player; this.ride = id; p.vx = p.vy = p.vz = 0; p.flying = false; ctx.controls.noDoubleTapFly = true; ctx.interaction.enabled = false;
    if (ctx.itemsRuntime) ctx.itemsRuntime.suspend(); if (this.gr.hand) this.gr.hand.root.visible = false; this.hud.classList.remove('hidden'); this.hud.classList.add('ride');
    const n = ctx.net; if (n && n.broadcast) n.broadcast('car:g', { to: id, on: 1 }); ctx.ui.toast('Você é o passageiro. R sai.');
  }

  toggleCamera() { this.mode = this.mode === '3p' ? '1p' : '3p'; this.camInit = false; this.ctx.ui.toast(this.mode === '3p' ? 'Câmera: externa' : 'Câmera: motorista'); }

  // ---- driving ---------------------------------------------------------------------------------------------------
  drive(dt) {
    const ctx = this.ctx, p = this.player, inp = p.input, ir = ctx.itemsRuntime, w = this.world;
    dt = Math.min(dt, 0.08); if (this.hitCd > 0) this.hitCd -= dt;
    ctx.controls.mouse.placePressed = false; ctx.controls.mouse.pickPressed = false;
    if (ir && !ir.health.alive) { this.leave(true); return; }
    if (w.getBlock(Math.floor(this.x), Math.floor(this.y + 1), Math.floor(this.z)) === 255) { this._cameraAndSync(dt); return; }   // column not loaded: hold still
    const f = inp.fwd, s = inp.strafe, brake = inp.jump, sport = inp.sprint, top = sport ? MAX_SPORT : MAX_FWD;
    // engine
    if (f > 0) this.sp += (this.sp < 0 ? 38 : (sport ? 17 : 11) * (1 - Math.max(0, this.sp) / top * 0.55)) * dt * f;
    else if (f < 0) this.sp += (this.sp > 0.5 ? -30 : -9) * dt * -f;
    else this.sp *= Math.exp(-0.45 * dt);
    if (brake) this.sp *= Math.exp(-1.1 * dt);
    this.sp = Math.max(-MAX_REV, Math.min(top, this.sp));
    if (this._wet) this.sp *= Math.exp(-1.6 * dt);
    // steering (right turn = heading decreases)
    const ar = Math.abs(this.sp), turn = 1.9 * Math.min(1, ar / 5) * (1 - 0.42 * Math.min(1, ar / 32)) * (this.sp >= 0 ? 1 : -1) * (brake ? 1.55 : 1);
    this.steer += (s - this.steer) * Math.min(1, dt * 9); this.h -= this.steer * turn * dt;
    // velocity follows the heading (grip), the handbrake lets the tail slide
    const fx = -Math.sin(this.h), fz = -Math.cos(this.h), grip = 1 - Math.exp(-(brake ? 2.2 : 9) * dt);
    this.vx += (fx * this.sp - this.vx) * grip; this.vz += (fz * this.sp - this.vz) * grip;
    // move with collision
    const subs = Math.max(1, Math.ceil(Math.hypot(this.vx, this.vz) * dt / 0.5)), hh = dt / subs, cn = this._cn || (this._cn = [0, 0, 0, 0]); let hitSpeed = 0;
    for (let i = 0; i < subs; i++) {
      const nx = this.x + this.vx * hh, nz = this.z + this.vz * hh, ok = this._corners(nx, nz, this.h, this.y, cn), hmax = Math.max(cn[0], cn[1], cn[2], cn[3]);
      const dx = this.vx, dz = this.vz, dl = Math.hypot(dx, dz) || 1, fy = Math.max(cn[0], cn[1], this.y), nose = this._solid(nx + dx / dl * 1.8, fy + 0.4, nz + dz / dl * 1.8) || this._solid(nx + dx / dl * 1.8, fy + 1.0, nz + dz / dl * 1.8);   // anything taller than the front wheels' ground
      if (!ok || nose || hmax - this.y > 1.15) { this._why = [ok, nose, +(hmax - this.y).toFixed(2), +nx.toFixed(1), +nz.toFixed(1)]; hitSpeed = Math.max(hitSpeed, Math.hypot(this.vx, this.vz)); this.vx *= -0.2; this.vz *= -0.2; this.sp *= -0.2; break; }
      this.x = nx; this.z = nz;
    }
    if (hitSpeed > 14 && this.hitCd <= 0) { this.hitCd = 0.6; if (ir) { ir.health.damage(Math.min(8, Math.round((hitSpeed - 14) * 0.35)), 'generic'); ir.hud.shake(0.05); } ctx.audio.hurt(); ctx.interaction.particles.burst(this.x, this.y + 0.8, this.z, [0.9, 0.9, 0.9], 8, 1.4); }
    // suspension / gravity / tilt from the four wheel contacts
    this._corners(this.x, this.z, this.h, this.y, cn);
    const hF = (cn[0] + cn[1]) / 2, hR = (cn[2] + cn[3]) / 2, hL = (cn[0] + cn[2]) / 2, hRt = (cn[1] + cn[3]) / 2, target = (hF + hR) / 2;
    if (this.y > target + 0.08 || this.vy > 0.5) { this.air = true; this.vy -= 26 * dt; this.y += this.vy * dt; if (this.y <= target) { if (this.vy < -9 && ir) ir.hud.shake(0.03); this.y = target; this.vy = 0; this.air = false; } }
    else { this.air = false; this.y += (target - this.y) * Math.min(1, dt * 16); this.vy = 0; }
    const pT = this.air ? this.pitch * 0.98 : Math.max(-0.55, Math.min(0.55, Math.atan2(hF - hR, WB * 2))), rT = this.air ? this.roll * 0.98 : Math.max(-0.45, Math.min(0.45, Math.atan2(hRt - hL, HW * 2)));
    this.pitch += (pT - this.pitch) * Math.min(1, dt * 10); this.roll += (rT - this.roll) * Math.min(1, dt * 10);
    this._wet = LIQUID[w.getBlock(Math.floor(this.x), Math.floor(this.y + 0.3), Math.floor(this.z))] === 1;
    // run things over
    if (Math.abs(this.sp) > 6) this._ram(dt);
    // sound / effects
    ctx.audio.jet(Math.min(0.5, 0.06 + ar / 70)); if (brake && ar > 8 && Math.random() < 0.7) ctx.interaction.particles.burst(this.x - fx * 1.2, this.y + 0.15, this.z - fz * 1.2, [0.85, 0.85, 0.85], 1, 0.7);
    this._cameraAndSync(dt);
  }

  _ram(dt) {
    const ctx = this.ctx, ir = ctx.itemsRuntime, fx = -Math.sin(this.h), fz = -Math.cos(this.h), px = this.x + fx * 1.2, pz = this.z + fz * 1.2, dmg = 3 + Math.abs(this.sp) * 0.75, now = performance.now();
    const hd = ctx.horde; if (hd && hd.list) for (const m of hd.list) { if (m.dead || now - (m._car || 0) < 450) continue; const dx = m.x - px, dz = m.z - pz; if (dx * dx + dz * dz < (m.r + 1.1) ** 2 && Math.abs(m.y - this.y) < 2.4) { m._car = now; hd.damage(m, dmg, fx * 14, fz * 14, 'me', 5); ctx.interaction.particles.burst(m.x, m.y + 0.5, m.z, [0.5, 1, 0.3], 8, 1.4); } }
    const L = ctx.mobs && ctx.mobs.list; if (L && ir) for (const m of [...L]) { if (now - (m._car || 0) < 450) continue; const dx = m.x - px, dz = m.z - pz; if (dx * dx + dz * dz < 1.8 && Math.abs(m.y - this.y) < 2) { m._car = now; ir.combat.damageMob(m, dmg, fx * 12, fz * 12, 'me'); } }
  }

  _cameraAndSync(dt) {
    const p = this.player, cam = this.camera, ctx = this.ctx;
    // mouse look: orbit offset around the heading that eases back while driving
    const dy = p.yaw - this.lastYaw; this.offs += dy; if (Math.abs(this.sp) > 3 && Math.abs(dy) < 1e-4) this.offs *= Math.exp(-1.2 * dt);
    this.offs = Math.max(-3.1, Math.min(3.1, this.offs)); p.yaw = this.h + this.offs; this.lastYaw = p.yaw; p.pitch = Math.max(-0.2, Math.min(0.9, p.pitch));
    p.x = this.x; p.y = this.y; p.z = this.z; p.vx = p.vy = p.vz = 0; p.onGround = true; p.flying = false;
    const ir = ctx.itemsRuntime; if (ir) { ir.health._peak = p.y; ir.health.noFall = Math.max(ir.health.noFall, 0.3); }
    this._placeCamera(cam, this, dt, true);
    const spd = Math.abs(this.sp), target = p.fovBase + Math.min(14, spd * 0.4) + (this.sp > MAX_FWD + 1 ? 6 : 0); p.fovCur += (target - p.fovCur) * (1 - Math.exp(-5 * dt));
    if (Math.abs(cam.fov - p.fovCur) > 0.02) { cam.fov = p.fovCur; cam.updateProjectionMatrix(); }
    this._hudTick(dt); this.sendT -= dt; if (this.sendT <= 0) this._send();
  }

  _placeCamera(cam, pose, dt, own) {
    const p = this.player, yaw = p.yaw, pitch = p.pitch;
    if (this.mode === '1p') {
      this.q.setFromEuler(this._e.set(pose.pitch || 0, pose.h, pose.roll || 0)); const c = this._v.set(own ? -0.38 : 0.38, 1.28, -0.1).applyQuaternion(this.q);
      cam.position.set(pose.x + c.x, pose.y + c.y, pose.z + c.z); cam.rotation.set(p.pitch * 0.6 - 0.05, yaw, (pose.roll || 0) * 0.5, 'YXZ'); this.mesh.visible = false; return;
    }
    const cp = Math.cos(pitch), d = this.camDist, tx = pose.x + Math.sin(yaw) * cp * d, ty = pose.y + 1.5 + Math.sin(pitch) * d, tz = pose.z + Math.cos(yaw) * cp * d;
    if (!this.camInit) { this.cam.set(tx, ty, tz); this.camInit = true; } const k = 1 - Math.exp(-13 * dt); this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k; this.cam.z += (tz - this.cam.z) * k;
    const o = this._o.set(pose.x, pose.y + 1.3, pose.z), dv = this._d.set(this.cam.x - o.x, this.cam.y - o.y, this.cam.z - o.z), len = dv.length() || 1; dv.multiplyScalar(1 / len);
    const hit = this.world.raycast(o, dv, len + 0.4), L = hit ? Math.max(1.4, hit.dist - 0.5) : len;
    cam.position.set(o.x + dv.x * L, o.y + dv.y * L, o.z + dv.z * L); cam.rotation.set(-Math.atan2(cam.position.y - (pose.y + 1.2), Math.hypot(cam.position.x - pose.x, cam.position.z - pose.z)) , yaw, 0, 'YXZ'); this.mesh.visible = true;
  }

  _hudTick(dt) {
    this.hudT -= dt; if (this.hudT > 0) return; this.hudT = 0.1;
    this.el.spd.textContent = String(Math.round(Math.abs(this.sp) * 3.6)); this.el.wheel.style.transform = 'rotate(' + Math.round(-this.steer * 120) + 'deg)';
    this.el.mode.textContent = this.sp < -0.5 ? 'R' : Math.abs(this.sp) < 0.5 ? 'P' : this.ctx.player.input.sprint ? 'SPORT' : 'D'; this.el.frame.style.display = this.mode === '1p' ? '' : 'none';
  }

  // ---- passenger ---------------------------------------------------------------------------------------------------
  rideStep(dt) {
    const ctx = this.ctx, p = this.player, r = this.remote.get(this.ride), ir = ctx.itemsRuntime; dt = Math.min(dt, 0.1);
    if (!r || r.k === 0 || performance.now() - r.seen > 3000) { this.leave(true); return; }
    if (ir && !ir.health.alive) { this.leave(true); return; }
    p.x = r.x; p.y = r.y; p.z = r.z; p.vx = p.vy = p.vz = 0; p.onGround = true; if (ir) { ir.health._peak = p.y; ir.health.noFall = Math.max(ir.health.noFall, 0.3); }
    this.mode = '1p'; this._placeCamera(this.camera, r, dt, false); this.mesh.visible = this.alive && !this.driving;
  }

  // ---- render + network --------------------------------------------------------------------------------------------
  update(dt) {
    if (this.callCd > 0) this.callCd -= dt;
    const post = !!this.gr.post;
    if (post !== this._post) { this._post = post; const d = post ? {} : { NO_POST: 1 }; for (const m of [this.mat, ...[...this.remote.values()].map((r) => r.mat)]) { m.defines = Object.assign({}, d); m.needsUpdate = true; } }
    if (this.alive) {
      if (!this.driving) { // parked: roll to a stop and settle on the ground
        if (this.sp) { this.sp *= Math.exp(-2 * dt); if (Math.abs(this.sp) < 0.05) this.sp = 0; }
        const g = this._ground(this.x, this.z, this.y); if (g !== null && Math.abs(g - this.y) > 0.02) this.y += (g - this.y) * Math.min(1, dt * 10);
        this.sendT -= dt; if (this.sendT <= 0) this._send();
      }
      const c = this.camera.position; this.q.setFromEuler(this._e.set(this.pitch, this.h, this.roll)); this.mesh.position.set(this.x - c.x, this.y - c.y, this.z - c.z); this.mesh.quaternion.copy(this.q);
      if (this.driving && this.mode === '1p') this.mesh.visible = false; else if (!this.driving) this.mesh.visible = true;
    }
    if (this.remote.size) this._remotes(dt);
  }

  _send() {
    const net = this.ctx.net; this.sendT = this.driving ? 0.1 : 1.5; if (!net || !net.broadcast || !this.alive || net.role === 'solo' && !net.players.size) return;
    net.broadcast('car:s', { p: [this.x, this.y, this.z], h: this.h, pi: this.pitch, ro: this.roll, c: this.color, k: this.driving ? 1 : 0 }, { reliable: false });
  }
  _remotes(dt) {
    const now = performance.now(), c = this.camera.position;
    for (const [id, r] of this.remote) {
      if (now - r.seen > 8000) { this.gr.scene.remove(r.mesh); r.mat.dispose(); this.remote.delete(id); if (this.ride === id) this.leave(true); continue; }
      const k = 1 - Math.exp(-12 * dt); r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k; r.h += Math.atan2(Math.sin(r.th - r.h), Math.cos(r.th - r.h)) * k; r.pitch += (r.tp - r.pitch) * k; r.roll += (r.tr - r.roll) * k;
      r.q.setFromEuler(this._e.set(r.pitch, r.h, r.roll)); r.mesh.position.set(r.x - c.x, r.y - c.y, r.z - c.z); r.mesh.quaternion.copy(r.q); r.mesh.visible = !(this.ride === id && this.mode === '1p');
    }
  }
  onRemote(d, from) {
    if (!d || !Array.isArray(d.p) || !from) return; const id = String(from).slice(0, 40); let r = this.remote.get(id);
    const tx = num(d.p[0]), ty = num(d.p[1], 80, -64, 600), tz = num(d.p[2]);
    if (!r) { const col = typeof d.c === 'string' && /^#[0-9a-f]{6}$/i.test(d.c) ? d.c : '#f4b6c2', mat = makeShipMaterial(this.gr.shared, col), mesh = new THREE.Mesh(this.geo, mat); mesh.frustumCulled = false; this.gr.scene.add(mesh); if (this._post === false) mat.defines = { NO_POST: 1 };
      r = { mesh, mat, x: tx, y: ty, z: tz, tx, ty, tz, h: num(d.h), th: num(d.h), pitch: 0, tp: 0, roll: 0, tr: 0, q: new THREE.Quaternion(), seen: 0, k: 0 }; this.remote.set(id, r); }
    r.tx = tx; r.ty = ty; r.tz = tz; r.th = num(d.h, 0, -50, 50); r.tp = num(d.pi, 0, -1, 1); r.tr = num(d.ro, 0, -1, 1); r.k = d.k ? 1 : 0; r.seen = performance.now();
    if (Math.hypot(r.x - tx, r.z - tz) > 60) { r.x = tx; r.y = ty; r.z = tz; r.h = r.th; }
  }
  dispose() { this.hud.remove(); this.gr.scene.remove(this.mesh); this.geo.dispose(); this.mat.dispose(); for (const r of this.remote.values()) { this.gr.scene.remove(r.mesh); r.mat.dispose(); } if (this.driving || this.ride) { this.ctx.interaction.enabled = true; this.ctx.controls.noDoubleTapFly = false; } }
}

export default defineFeature({
  id: 'cars', order: 22,
  init(ctx) {
    C = new Cars(ctx);
    const orig = ctx.player.update.bind(ctx.player);
    ctx.player.update = (dt) => { if (C && C.driving) C.drive(dt); else if (C && C.ride) C.rideStep(dt); else orig(dt); };
    ctx.addHotkey('KeyR', () => C.onR());
    ctx.addHotkey('KeyZ', () => { if (C.driving || C.ride) C.toggleCamera(); });
    ctx.addHotkey('KeyX', () => { if (C.driving) ctx.audio._tone && ctx.audio._tone({ type: 'square', f0: 392, f1: 392, dur: 0.4, gain: 0.1, lp: 1800 }); });
    ctx.ui.addToolbarButton({ id: 'car', icon: '🚗', title: 'Carro BYD Dolphin Mini (chamar / entrar / sair)', key: 'R', onClick: () => C.onR() });
    const wheel = ctx.controls.actions.hotbarDelta;
    ctx.controls.actions.hotbarDelta = (d) => { if (C && (C.driving || C.ride)) { C.camDist = Math.max(3.5, Math.min(14, C.camDist + d * 0.8)); return; } if (wheel) wheel(d); };
    ctx.car = { call: () => C.call(), enter: () => C.enter(), exit: () => C.leave(true), get active() { return !!(C && (C.driving || C.ride)); }, get state() { return { x: C.x, y: C.y, z: C.z, alive: C.alive, speed: C.sp }; }, get _c() { return C; } };
    ctx.events.on('player:die', () => { if (C && (C.driving || C.ride)) C.leave(true); });
  },
  ready(ctx) {
    if (!C) return; const net = ctx.net;
    if (net && net.on) { net.on('car:s', (d, from) => C.onRemote(d, from)); net.on('car:g', (d, from) => { if (d && d.to === net.localId && C.driving) { const pl = net.players && net.players.get(from); ctx.ui.toast(d.on ? '🧑‍🤝‍🧑 ' + (pl ? pl.name : 'Um amigo') + ' entrou no carro' : 'O passageiro saiu'); } }); ctx.events.on('net:peerJoin', () => C._send(true)); }
    try { if (!localStorage.getItem('horizon.cars.hint')) { localStorage.setItem('horizon.cars.hint', '1'); setTimeout(() => ctx.ui.toast('Dica: R chama o seu BYD Dolphin Mini 🚗'), 7000); } } catch { /* ignore */ }
  },
  update(dt) { if (C) C.update(dt); },
  dispose() { if (C) { C.dispose(); C = null; } },
});
