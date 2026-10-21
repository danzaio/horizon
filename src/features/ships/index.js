// Spaceships: call your ship (B), board it, fly in 1st (cockpit) or 3rd person (Z), boost, lasers + missiles, dock anywhere,
// and jump to other planets from orbit (J = galaxy map). Other players' ships are replicated over ctx.net (`ship:s`).
// Cost when you are not flying: one early return per frame (+ the parked mesh, 1 draw call).
import './ships.css';
import * as THREE from 'three';
import { defineFeature } from '../registry.js';
import { SOLID } from '../../shared/blocks.js';
import { buildShipGeometry, makeShipMaterial } from './model.js';

const MAX_SPEED = 44, BOOST = 2.4, HALF = [1.2, 0.5, 1.3], ORBIT_Y = 200, CAP_Y = 420;
const TAU = Math.PI * 2;
const num = (v, d = 0, lo = -1e7, hi = 1e7) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };

let S = null;

class ShipFeature {
  constructor(ctx) {
    this.ctx = ctx; this.player = ctx.player; this.camera = ctx.camera; this.world = ctx.world; this.gr = ctx.gr;
    this.geo = buildShipGeometry();
    this.mat = makeShipMaterial(ctx.gr.shared, ctx.identity.color);
    this.mesh = new THREE.Mesh(this.geo, this.mat); this.mesh.frustumCulled = false; this.mesh.visible = false;
    ctx.gr.scene.add(this.mesh);
    // our ship (doubles; the mesh is positioned relative to the camera so it stays precise far from the origin)
    this.x = 0; this.y = 0; this.z = 0; this.vx = 0; this.vy = 0; this.vz = 0;
    this.q = new THREE.Quaternion(); this.qa = new THREE.Quaternion(); this.qr = new THREE.Quaternion();
    this.alive = false; this.piloting = false; this.gun = null; this.thr = 0; this.bank = 0; this.boost = 0;
    this.mode = '3p'; this.camDist = 9; this.cam = new THREE.Vector3(); this.camInit = false;
    this.cd = 0; this.mcd = 0; this.hitCd = 0; this.sendT = 0; this.hudT = 0; this.callCd = 0; this.wing = 0;
    this._e = new THREE.Euler(0, 0, 0, 'YXZ'); this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._o = new THREE.Vector3(); this._d = new THREE.Vector3();
    this._post = null; this.remote = new Map();
    this._buildHud();
  }

  // ---- HUD ---------------------------------------------------------------------------------------------------------
  _buildHud() {
    const r = this.hud = document.createElement('div'); r.id = 'hz-ship-hud'; r.className = 'hidden';
    r.innerHTML = '<div class="hz-canopy"><i class="a"></i><i class="b"></i><i class="c"></i><i class="d"></i></div>' +
      '<div class="hz-cross"></div><div class="hz-readout"><div class="spd"><b>0</b><small>blocos/s</small></div><div class="alt">ALT <b>0</b></div><div class="bar"><i></i></div><div class="orbit hidden">ÓRBITA · <kbd>J</kbd> mapa galáctico · salto de dobra</div></div>' +
      '<div class="hz-hints"><kbd>W A S D</kbd> mover · <kbd>Espaço</kbd>/<kbd>C</kbd> subir/descer · <kbd>Shift</kbd> turbo · <kbd>Clique</kbd> laser · <kbd>Botão dir.</kbd> míssil · <kbd>Z</kbd> câmera · <kbd>B</kbd> sair</div>';
    document.body.appendChild(r);
    this.el = { spd: r.querySelector('.spd b'), alt: r.querySelector('.alt b'), bar: r.querySelector('.bar i'), orbit: r.querySelector('.orbit'), canopy: r.querySelector('.hz-canopy') };
  }

  _hudTick(dt) {
    this.hudT -= dt; if (this.hudT > 0) return; this.hudT = 0.1;
    const sp = Math.hypot(this.vx, this.vy, this.vz);
    this.el.spd.textContent = String(Math.round(sp)); this.el.alt.textContent = String(Math.round(this.y));
    this.el.bar.style.width = Math.round(Math.min(1, sp / (MAX_SPEED * BOOST)) * 100) + '%'; this.el.bar.classList.toggle('boost', this.boost > 0.5);
    this.el.orbit.classList.toggle('hidden', this.y < ORBIT_Y);
    this.el.canopy.style.display = this.mode === '1p' ? '' : 'none';
  }

  // ---- ship lifecycle ----------------------------------------------------------------------------------------------
  /** put the ship on the ground in front of the player */
  call() {
    const p = this.player, ctx = this.ctx;
    if (this.callCd > 0) return; this.callCd = 1;
    let x = p.x, z = p.z, y = p.y + 0.3, found = false;
    for (const r of [7, 9, 5, 11, 13]) for (const da of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6]) {
      if (found) break;
      const ang = p.yaw + da, cx = p.x - Math.sin(ang) * r, cz = p.z - Math.cos(ang) * r, gy = this.world.getSurfaceY(Math.floor(cx), Math.floor(cz)) + 1.6;
      if (Math.abs(gy - p.y) < 6 && !this._hits(cx, gy, cz)) { x = cx; z = cz; y = gy; found = true; }
    }
    this.x = x; this.z = z; this.y = y; this.vx = this.vy = this.vz = 0;
    for (let i = 0; i < 40 && this._hits(this.x, this.y, this.z); i++) this.y += 0.5;           // never spawn inside terrain
    this.qa.setFromEuler(this._e.set(0, p.yaw + Math.PI, 0)); this.q.copy(this.qa);                 // nose toward the player (they walk up to it)
    this.q.setFromEuler(this._e.set(0, p.yaw, 0)); this.alive = true; this.mesh.visible = true; this.thr = 0; this.bank = 0;
    ctx.audio.teleport(); const pc = ctx.interaction.particles; for (let i = 0; i < 3; i++) pc.burst(x, this.y, z, [0.5, 0.85, 1], 14, 2.2);
    ctx.ui.toast('Nave chamada — aperte B perto dela para embarcar');
    this._send(true);
  }

  board() {
    const ctx = this.ctx, p = this.player;
    if (!ctx.itemsRuntime || ctx.itemsRuntime.health.alive) { /* ok */ } else return;
    this.piloting = true; this.mode = this.mode || '3p';
    const f = this._fwd(this._v);
    p.yaw = Math.atan2(-f.x, -f.z); p.pitch = Math.asin(Math.max(-1, Math.min(1, f.y))) * 0.6;
    p.vx = p.vy = p.vz = 0; p.flying = true; ctx.controls.noDoubleTapFly = true; ctx.interaction.enabled = false;
    if (ctx.itemsRuntime) ctx.itemsRuntime.suspend();
    if (this.gr.hand) this.gr.hand.root.visible = false;
    this.hud.classList.remove('hidden'); this.camInit = false; this.cd = this.mcd = 0.3;
    ctx.audio.equip(); ctx.events.emit('ship:board', {});
  }

  exit(force = false) {
    const ctx = this.ctx, p = this.player, w = this.world;
    if (!this.piloting) return;
    // find a standing spot next to the ship
    let spot = null;
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    for (const [ox, oz] of [[cy, -sy], [-cy, sy], [sy, cy], [-sy, -cy]]) {
      const x = this.x + ox * 2.6, z = this.z + oz * 2.6, gy = w.getSurfaceY(Math.floor(x), Math.floor(z)) + 1.01;
      if (Math.abs(gy - this.y) < 6) { spot = { x, y: gy, z }; break; }
    }
    if (!spot && !force) { ctx.ui.toast('Pouse a nave perto do chão para sair'); return; }
    if (!spot) spot = { x: this.x, y: this.y, z: this.z };
    this.piloting = false; p.teleport(spot.x, spot.y, spot.z); p.flying = false; p.pitch = 0;
    ctx.controls.noDoubleTapFly = false; ctx.interaction.enabled = true; ctx.audio.jet(0);
    if (this.gr.hand) this.gr.hand.root.visible = true;
    this.hud.classList.add('hidden'); this.mesh.visible = true; this.thr = 0; this.boost = 0; p.fovMul = 1;
    if (ctx.itemsRuntime) { ctx.itemsRuntime.health.noFall = 1; ctx.itemsRuntime.health._peak = p.y; }
    ctx.events.emit('ship:exit', {}); this._send(true);
  }

  toggleCamera() { this.mode = this.mode === '3p' ? '1p' : '3p'; this.camInit = false; if (this.piloting) this.mesh.visible = this.mode === '3p'; this.ctx.ui.toast(this.mode === '3p' ? 'Câmera: terceira pessoa' : 'Câmera: cabine'); }

  onB() {
    if (this.ctx.state !== 'playing') return;
    if (this.piloting) { this.exit(); return; }
    if (this.gun) { this.exitGunner(); return; }
    if (this.alive && Math.hypot(this.x - this.player.x, this.z - this.player.z) < 8 && Math.abs(this.y - this.player.y) < 8) { this.board(); return; }
    for (const [id, r] of this.remote) if (r.k === 1 && Math.hypot(r.x - this.player.x, r.z - this.player.z) < 14 && Math.abs(r.y - this.player.y) < 12) { this.boardGunner(id); return; }
    this.call();
  }

  _fwd(out) { return out.set(0, 0, -1).applyQuaternion(this.q); }

  // ---- collision ---------------------------------------------------------------------------------------------------
  _hits(x, y, z) {
    const w = this.world, x0 = Math.floor(x - HALF[0]), x1 = Math.floor(x + HALF[0]), y0 = Math.floor(y - HALF[1]), y1 = Math.floor(y + HALF[1]), z0 = Math.floor(z - HALF[2]), z1 = Math.floor(z + HALF[2]);
    for (let yy = y0; yy <= y1; yy++) for (let zz = z0; zz <= z1; zz++) for (let xx = x0; xx <= x1; xx++) if (SOLID[w.getBlock(xx, yy, zz)] === 1) return true;
    return false;
  }

  _move(dt) {
    const sp = Math.hypot(this.vx, this.vy, this.vz), n = Math.max(1, Math.min(30, Math.ceil(sp * dt / 0.4))), h = dt / n;
    let impact = 0;
    if (this._hits(this.x, this.y, this.z)) { this.y += 6 * dt; this.vy = Math.max(this.vy, 0); return 0; }   // embedded (terrain edited under us): float up
    for (let i = 0; i < n; i++) {
      let nx = this.x + this.vx * h; if (this._hits(nx, this.y, this.z)) { impact = Math.max(impact, Math.abs(this.vx)); this.vx *= -0.25; nx = this.x; } this.x = nx;
      let nz = this.z + this.vz * h; if (this._hits(this.x, this.y, nz)) { impact = Math.max(impact, Math.abs(this.vz)); this.vz *= -0.25; nz = this.z; } this.z = nz;
      let ny = this.y + this.vy * h; if (this._hits(this.x, ny, this.z)) { impact = Math.max(impact, Math.abs(this.vy)); this.vy *= -0.2; ny = this.y; } this.y = ny;
    }
    if (this.y > CAP_Y) { this.y = CAP_Y; this.vy = Math.min(0, this.vy); }
    return impact;
  }

  // ---- per-frame flight --------------------------------------------------------------------------------------------
  pilot(dt) {
    const ctx = this.ctx, p = this.player, inp = p.input, ir = ctx.itemsRuntime, m = ctx.controls.mouse;
    dt = Math.min(dt, 0.1);
    if (this.cd > 0) this.cd -= dt; if (this.mcd > 0) this.mcd -= dt; if (this.hitCd > 0) this.hitCd -= dt;
    m.placePressed = false; m.pickPressed = false;
    if (ir && !ir.health.alive) { this.exit(true); return; }
    // --- velocity
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw), cp = Math.cos(p.pitch), spt = Math.sin(p.pitch);
    const fx = -sy * cp, fy = spt, fz = -cy * cp, rx = cy, rz = -sy;
    const boosting = inp.sprint && inp.fwd > 0; this.boost += ((boosting ? 1 : 0) - this.boost) * Math.min(1, dt * 4);
    const top = MAX_SPEED * (1 + (BOOST - 1) * this.boost), f = inp.fwd, s = inp.strafe, u = (inp.jump ? 1 : 0) - (inp.crouch ? 1 : 0);
    let wx = fx * f * top + rx * s * top * 0.55, wy = fy * f * top + u * top * 0.5, wz = fz * f * top + rz * s * top * 0.55;
    const idle = f === 0 && s === 0 && u === 0;
    const k = 1 - Math.exp(-(idle ? 0.9 : boosting ? 2.6 : 1.7) * dt);
    this.vx += (wx - this.vx) * k; this.vy += (wy - this.vy) * k; this.vz += (wz - this.vz) * k;
    // --- orientation: the hull chases the mouse aim and banks into turns
    const shipYaw = Math.atan2(-(-0 + this._fwd(this._v).x), -this._v.z), yawErr = angDiff(shipYaw, p.yaw);
    const bankT = Math.max(-0.75, Math.min(0.75, yawErr * 1.4 - s * 0.32));
    this.bank += (bankT - this.bank) * Math.min(1, dt * 6);
    this.qa.setFromEuler(this._e.set(p.pitch, p.yaw, 0));
    this.q.slerp(this.qa, Math.min(1, dt * 9));
    // --- collision / impact
    const hit = this._move(dt);
    if (hit > 22 && this.hitCd <= 0) {
      this.hitCd = 0.6;
      if (ir) ir.health.damage(Math.min(8, Math.round((hit - 22) * 0.25)), 'generic');
      ctx.audio.hurt(); if (ir) ir.hud.shake(0.06);
      ctx.interaction.particles.burst(this.x, this.y, this.z, [1, 0.7, 0.3], 14, 2.4);
    }
    // --- sync the player body (world streaming, avatar for other players, fall damage off)
    p.x = this.x; p.y = this.y - 0.9; p.z = this.z; p.vx = p.vy = p.vz = 0; p.onGround = false; p.flying = true;
    if (ir) { ir.health._peak = p.y; ir.health.noFall = Math.max(ir.health.noFall, 0.3); }
    // --- throttle visuals + engine sound + exhaust
    const sp = Math.hypot(this.vx, this.vy, this.vz);
    this.thr += ((Math.min(1, sp / (MAX_SPEED * BOOST) + (f > 0 ? 0.25 : 0)) ) - this.thr) * Math.min(1, dt * 5);
    ctx.audio.jet(0.25 + this.thr * 0.7);
    if (Math.random() < 0.5 + this.thr) { const b = this._v.set(0, 0, 2.9).applyQuaternion(this.q); ctx.interaction.particles.burst(this.x + b.x, this.y + b.y, this.z + b.z, boosting ? [0.5, 0.8, 1] : [1, 0.65, 0.3], 1, 0.5 + this.thr); }
    // --- weapons
    this._guns(dt, m, this);
    // --- camera
    this._camera(dt);
    this._hudTick(dt);
    this._netTick(dt);
  }

  _guns(dt, m, src) {
    const ctx = this.ctx, ir = ctx.itemsRuntime, p = this.player; if (!ir) return;
    const cp = Math.cos(p.pitch), look = this._d.set(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
    // aim point: where the crosshair ray ends (terrain) or 140 blocks out
    const cam = this.camera.position, o = this._o.set(cam.x, cam.y, cam.z);
    const ah = this.world.raycast(o, look, 200), reach = ah ? ah.dist : 140;
    const px = cam.x + look.x * reach, py = cam.y + look.y * reach, pz = cam.z + look.z * reach;
    if (m.breakHeld && this.cd <= 0) {
      this.cd = 0.13; this.wing = 1 - this.wing;
      const w = this._v.set(this.wing ? 1.75 : -1.75, src === this ? -0.02 : 0.7, -0.7).applyQuaternion(src.q), ox = src.x + w.x, oy = src.y + w.y, oz = src.z + w.z;
      const dx = px - ox, dy = py - oy, dz = pz - oz, l = Math.hypot(dx, dy, dz) || 1;
      ir.eye.set(ox, oy, oz); ir.dir.set(dx / l, dy / l, dz / l);
      ir.combat.hitscan({ range: 200, dmg: 4.5, head: 1, kb: 2, color: [1, 0.25, 0.4], thick: 0.08, weapon: 'laser da nave', from: { x: ox, y: oy, z: oz } });
      ctx.audio.gun('rifle');
    }
    if (m.placeHeld && this.mcd <= 0) {
      this.mcd = 1.0;
      const n = this._v.set(0, src === this ? -0.15 : 0.6, -3.2).applyQuaternion(src.q), ox = src.x + n.x, oy = src.y + n.y, oz = src.z + n.z;
      const dx = px - ox, dy = py - oy, dz = pz - oz, l = Math.hypot(dx, dy, dz) || 1;
      if (ctx.permissions.can('explode', { by: ctx.identity.id })) { ir.combat.projectile({ kind: 'missile', x: ox, y: oy, z: oz, dx: dx / l, dy: dy / l, dz: dz / l, speed: 70, damage: 0 }); ctx.audio.gun('rocket'); ir.hud.shake(0.01); }
    }
  }

  _camera(dt) {
    const p = this.player, cam = this.camera, e = this._e.set(p.pitch, p.yaw, this.bank * 0.5);
    cam.rotation.copy(e);
    if (this.mode === '1p') {
      const c = this._v.set(0, 0.62, -1.0).applyQuaternion(this.q);
      cam.position.set(this.x + c.x, this.y + c.y, this.z + c.z); this.mesh.visible = false; this.camInit = false;
    } else {
      const cp = Math.cos(p.pitch), d = this.camDist + this.boost * 2.5;
      const tx = this.x + Math.sin(p.yaw) * cp * d, ty = this.y - Math.sin(p.pitch) * d + 1.7, tz = this.z + Math.cos(p.yaw) * cp * d;
      if (!this.camInit) { this.cam.set(tx, ty, tz); this.camInit = true; }
      const k = 1 - Math.exp(-14 * dt); this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k; this.cam.z += (tz - this.cam.z) * k;
      // keep the camera out of terrain: shorten the boom when something is in the way
      const o = this._o.set(this.x, this.y + 0.6, this.z), dv = this._v2.set(this.cam.x - o.x, this.cam.y - o.y, this.cam.z - o.z), len = dv.length() || 1; dv.multiplyScalar(1 / len);
      const hit = this.world.raycast(o, dv, len + 0.4);
      const L = hit ? Math.max(1.2, hit.dist - 0.5) : len;
      cam.position.set(o.x + dv.x * L, o.y + dv.y * L, o.z + dv.z * L); this.mesh.visible = true;
    }
    // FOV: wide when boosting
    const target = p.fovBase + this.boost * 16; p.fovCur += (target - p.fovCur) * (1 - Math.exp(-6 * dt));
    if (Math.abs(cam.fov - p.fovCur) > 0.02) { cam.fov = p.fovCur; cam.updateProjectionMatrix(); }
  }

  // ---- gunner seat on somebody else's ship ---------------------------------------------------------------------------
  boardGunner(id) {
    const ctx = this.ctx, p = this.player, r = this.remote.get(id); if (!r) return;
    this.gun = id; p.vx = p.vy = p.vz = 0; p.flying = true; ctx.controls.noDoubleTapFly = true; ctx.interaction.enabled = false;
    if (ctx.itemsRuntime) ctx.itemsRuntime.suspend();
    if (this.gr.hand) this.gr.hand.root.visible = false;
    this.hud.classList.remove('hidden'); this.hud.classList.add('gun'); this.cd = this.mcd = 0.3;
    const net = ctx.net; if (net && net.broadcast) net.broadcast('ship:g', { to: id, on: 1 });
    ctx.ui.toast('Você é o artilheiro: mire e atire (clique = laser, botão direito = míssil). B sai.'); ctx.audio.equip();
  }

  exitGunner(why) {
    const ctx = this.ctx, p = this.player, r = this.remote.get(this.gun), id = this.gun; if (!id) return;
    this.gun = null; ctx.controls.noDoubleTapFly = false; ctx.interaction.enabled = true;
    if (this.gr.hand) this.gr.hand.root.visible = true;
    this.hud.classList.add('hidden'); this.hud.classList.remove('gun');
    let gy = r ? this.world.getSurfaceY(Math.floor(r.x), Math.floor(r.z)) + 1.01 : p.y; const near = r && Math.abs(gy - r.y) < 6;
    if (r) p.teleport(r.x + 2.4, near ? gy : r.y, r.z); p.flying = false; p.pitch = 0;
    const ir = ctx.itemsRuntime; if (ir) { ir.health.noFall = near ? 1 : 6; ir.health._peak = p.y; }
    if (!near) p.fallCap = 7, setTimeout(() => { p.fallCap = 0; }, 9000);                          // emergency chute if you jump out in mid-air
    const net = ctx.net; if (net && net.broadcast) net.broadcast('ship:g', { to: id, on: 0 });
    if (why) ctx.ui.toast(why);
  }

  gunnerStep(dt) {
    const ctx = this.ctx, p = this.player, r = this.remote.get(this.gun), ir = ctx.itemsRuntime, m = ctx.controls.mouse;
    dt = Math.min(dt, 0.1);
    if (!r || r.k === 0 || performance.now() - r.seen > 3000) { this.exitGunner('A nave pousou — você desembarcou'); return; }
    if (ir && !ir.health.alive) { this.exitGunner(); return; }
    if (this.cd > 0) this.cd -= dt; if (this.mcd > 0) this.mcd -= dt;
    m.placePressed = false; m.pickPressed = false;
    p.x = r.x; p.y = r.y - 0.9; p.z = r.z; p.vx = p.vy = p.vz = 0; p.onGround = false; p.flying = true;
    if (ir) { ir.health._peak = p.y; ir.health.noFall = Math.max(ir.health.noFall, 0.3); }
    const c = this._v.set(0, 1.5, 0.5).applyQuaternion(r.q), cam = this.camera;
    cam.position.set(r.x + c.x, r.y + c.y, r.z + c.z); cam.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
    if (Math.abs(cam.fov - p.fovBase) > 0.02) { p.fovCur += (p.fovBase - p.fovCur) * (1 - Math.exp(-6 * dt)); cam.fov = p.fovCur; cam.updateProjectionMatrix(); }
    this._guns(dt, m, r);
  }

  // ---- rendering helpers -------------------------------------------------------------------------------------------
  _place(mesh, x, y, z, q) { const c = this.camera.position; mesh.position.set(x - c.x, y - c.y, z - c.z); mesh.quaternion.copy(q); }

  update(dt) {
    if (this.callCd > 0) this.callCd -= dt;
    const post = !!this.gr.post;
    if (post !== this._post) { this._post = post; const d = post ? {} : { NO_POST: 1 }; for (const mt of [this.mat, ...[...this.remote.values()].map((r) => r.mat)]) { mt.defines = Object.assign({}, d); mt.needsUpdate = true; } }
    if (this.piloting) {
      this.qr.setFromAxisAngle(this._v.set(0, 0, 1), this.bank);
      // pilot() runs from the player.update wrapper (before the camera is final); only the mesh is placed here, after the camera moved
      this.mat.uniforms.uThr.value = this.thr;
      const qf = this._qf || (this._qf = new THREE.Quaternion()); qf.copy(this.q).multiply(this.qr); this._place(this.mesh, this.x, this.y, this.z, qf);
    } else if (this.alive) {
      // parked: drift to a stop, hover
      if (this.vx || this.vy || this.vz) { const k = Math.exp(-2.2 * dt); this.vx *= k; this.vy *= k; this.vz *= k; this._move(dt); if (Math.abs(this.vx) + Math.abs(this.vy) + Math.abs(this.vz) < 0.05) this.vx = this.vy = this.vz = 0; }
      this.mat.uniforms.uThr.value = 0.05; this.mesh.visible = true; this._place(this.mesh, this.x, this.y + Math.sin(performance.now() / 700) * 0.04, this.z, this.q);
      this._netTick(dt);
    }
    if (this.remote.size) this._remotes(dt);
  }

  // ---- network ---------------------------------------------------------------------------------------------------
  _send(force) {
    const net = this.ctx.net; if (!net || !net.broadcast || !this.alive || (net.role === 'solo' && !net.players.size)) return;
    const q = this.q; net.broadcast('ship:s', { p: [this.x, this.y, this.z], q: [q.x, q.y, q.z, q.w], t: this.thr, c: this.ctx.identity.color, k: this.piloting ? 1 : 0 }, { reliable: false });
    this.sendT = this.piloting ? 0.1 : 1.5; void force;
  }
  _netTick(dt) { this.sendT -= dt; if (this.sendT <= 0) this._send(); }

  _remotes(dt) {
    const now = performance.now();
    for (const [id, r] of this.remote) {
      if (now - r.seen > 8000) { this.gr.scene.remove(r.mesh); r.mat.dispose(); this.remote.delete(id); continue; }
      const k = 1 - Math.exp(-12 * dt);
      r.x += (r.tx - r.x) * k; r.y += (r.ty - r.y) * k; r.z += (r.tz - r.z) * k; r.q.slerp(r.tq, k);
      r.mat.uniforms.uThr.value += (r.thr - r.mat.uniforms.uThr.value) * k;
      this._place(r.mesh, r.x, r.y, r.z, r.q);
    }
  }

  onRemote(d, from) {
    if (!d || !Array.isArray(d.p) || !Array.isArray(d.q) || !from) return;
    const id = String(from).slice(0, 40); let r = this.remote.get(id);
    const tx = num(d.p[0]), ty = num(d.p[1], 80, -64, 600), tz = num(d.p[2]);
    if (!r) {
      const col = typeof d.c === 'string' && /^#[0-9a-f]{6}$/i.test(d.c) ? d.c : '#ff8fd0', mat = makeShipMaterial(this.gr.shared, col), mesh = new THREE.Mesh(this.geo, mat);
      mesh.frustumCulled = false; this.gr.scene.add(mesh); if (this._post === false) { mat.defines = { NO_POST: 1 }; }
      r = { mesh, mat, x: tx, y: ty, z: tz, tx, ty, tz, q: new THREE.Quaternion(), tq: new THREE.Quaternion(), thr: 0, seen: 0, k: 0 }; this.remote.set(id, r);
    }
    r.tx = tx; r.ty = ty; r.tz = tz; r.tq.set(num(d.q[0], 0, -1, 1), num(d.q[1], 0, -1, 1), num(d.q[2], 0, -1, 1), num(d.q[3], 1, -1, 1)).normalize();
    r.thr = num(d.t, 0, 0, 1); r.k = d.k ? 1 : 0; r.seen = performance.now();
    if (Math.hypot(r.x - tx, r.z - tz) > 80) { r.x = tx; r.y = ty; r.z = tz; r.q.copy(r.tq); }
  }

  dispose() {
    this.hud.remove(); this.gr.scene.remove(this.mesh); this.geo.dispose(); this.mat.dispose();
    for (const r of this.remote.values()) { this.gr.scene.remove(r.mesh); r.mat.dispose(); }
    if (this.piloting || this.gun) { this.ctx.interaction.enabled = true; this.ctx.controls.noDoubleTapFly = false; }
  }
}

export default defineFeature({
  id: 'ships', order: 20,

  init(ctx) {
    S = new ShipFeature(ctx);
    // the pilot drives the camera inside player.update so the world streams around the final camera position
    const orig = ctx.player.update.bind(ctx.player);
    ctx.player.update = (dt) => { if (S && S.piloting) S.pilot(dt); else if (S && S.gun) S.gunnerStep(dt); else orig(dt); };
    ctx.addHotkey('KeyB', () => S.onB());
    ctx.addHotkey('KeyZ', () => { if (S.piloting) S.toggleCamera(); });
    ctx.ui.addToolbarButton({ id: 'ship', icon: '🚀', title: 'Nave (chamar / embarcar / sair)', key: 'B', onClick: () => S.onB() });
    const wheel = ctx.controls.actions.hotbarDelta;
    ctx.controls.actions.hotbarDelta = (d) => { if (S && S.piloting) { S.camDist = Math.max(4, Math.min(22, S.camDist + d * 1.2)); return; } if (wheel) wheel(d); };
    ctx.ship = { call: () => S.call(), board: () => S.board(), exit: () => S.exit(true), get piloting() { return S.piloting; }, get state() { return { x: S.x, y: S.y, z: S.z, alive: S.alive }; } };
    ctx.events.on('player:die', () => { if (S && S.piloting) S.exit(true); });
    // arrival after a hyperspace jump: you come out of warp already at the controls
    ctx.events.on('universe:travel', () => { try { sessionStorage.setItem('horizon.ship.arrive', '1'); } catch { /* ignore */ } });
  },

  ready(ctx) {
    if (!S) return;
    const net = ctx.net; if (net && net.on) { net.on('ship:s', (d, from) => S.onRemote(d, from)); net.on('ship:g', (d, from) => { if (d && d.to === net.localId && S.piloting) { const pl = net.players && net.players.get(from); ctx.ui.toast(d.on ? '🔫 ' + (pl ? pl.name : 'Um amigo') + ' embarcou como artilheiro' : 'O artilheiro saiu da nave'); } }); ctx.events.on('net:peerJoin', () => S._send(true)); }
    let arrive = false; try { arrive = sessionStorage.getItem('horizon.ship.arrive') === '1'; sessionStorage.removeItem('horizon.ship.arrive'); } catch { /* ignore */ }
    if (arrive && ctx.role === 'solo') {
      const p = ctx.player; S.x = p.x; S.z = p.z; S.y = Math.min(p.y + 40, 150); S.q.setFromEuler(new THREE.Euler(0, p.yaw, 0, 'YXZ')); S.alive = true; S.mesh.visible = true;
      S.board(); ctx.ui.toast('Saída do salto de dobra — você está nos controles da nave');
    } else if (!localStorage.getItem('horizon.ships.hint')) { try { localStorage.setItem('horizon.ships.hint', '1'); } catch { /* ignore */ } setTimeout(() => ctx.ui.toast('Dica: B chama a sua nave espacial 🚀'), 4000); }
  },

  update(dt) { if (S) S.update(dt); },
  dispose() { if (S) { S.dispose(); S = null; } },
});
