// Football (soccer): a floating stadium is built above you, teams are picked, a physics ball is simulated by the authority (solo / host) and shown to everybody.
// Run into the ball to dribble, U = kick (toward where you look, lofted), score in the other goal. 5 minutes, then everyone goes back where they were.
// Network: `sc:s` (state + ball, 12 Hz), `sc:kick` (guest -> host), `sc:team` (guest -> host). Pitch blocks travel as ordinary world edits.
import './soccer.css';
import * as THREE from 'three';
import { defineFeature } from '../registry.js';
import { BLOCKS } from '../../shared/blocks.js';
import { UNIFORMS, NOISE, SKY_FN, FOG_FN, LIGHT_FN, TONEMAP_FN, OUTPUT } from '../../render/shaders/common.js';

const L = 44, W = 26, GW = 4.0, R = 0.4, LIFT = 14, MATCH = 300, TEAM = [{ n: 'Vermelho', c: '#ef4444', i: '🔴' }, { n: 'Azul', c: '#3b82f6', i: '🔵' }];
const ID = new Map(BLOCKS.filter(Boolean).map((b) => [b.name, b.id])), bid = (n) => ID.get(n) ?? 1;
const num = (v, d = 0, lo = -1e7, hi = 1e7) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
let K = null;

const VS = /* glsl */`
${UNIFORMS}
varying vec3 vN; varying vec3 vRel; varying vec3 vP;
void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vRel = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vP = normalize(position); gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * w.xyz, 1.0); }`;
const FS = /* glsl */`
${UNIFORMS}
${NOISE}
${SKY_FN}
${FOG_FN}
${LIGHT_FN}
${TONEMAP_FN}
varying vec3 vN; varying vec3 vRel; varying vec3 vP;
void main(){
  FADE_TEST
  float pat = step(0.0, sin(vP.x * 5.0 + 0.7) * sin(vP.y * 5.0 + 1.3) * sin(vP.z * 5.0 + 2.1));
  vec3 alb = srgb2lin(mix(vec3(0.96), vec3(0.08), pat));
  float ndl = max(dot(normalize(vN), uKeyDir), 0.0);
  vec3 col = alb * lightTerm(vN.y, 0.9, ndl, 1.0, 0.0, 1.0, 1.0);
  col = applyFog(col, vRel);
  float outAlpha = 1.0;
  ${OUTPUT}
}`;

class Soccer {
  constructor(ctx) {
    this.ctx = ctx; this.world = ctx.world; this.st = 0; this.t = MATCH; this.score = [0, 0]; this.O = null; this.team = new Map(); this.myTeam = 0; this.ret = null;
    this.b = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }; this.tgt = { x: 0, y: 0, z: 0 }; this.stT = 0; this.sendT = 0; this.touch = new Map(); this.prevPos = new Map(); this.q = []; this.qi = 0;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 20, 14), new THREE.ShaderMaterial({ uniforms: Object.assign({}, ctx.gr.shared), vertexShader: VS, fragmentShader: FS })); this.mesh.frustumCulled = false; this.mesh.visible = false; ctx.gr.scene.add(this.mesh);
    this._post = null; this.kickCd = 0; this.handled = -1;
    const r = this.hud = document.createElement('div'); r.id = 'hz-soccer-hud'; r.className = 'hidden';
    r.innerHTML = '<div class="sc-top"><span class="sc-r"></span><b class="sc-s"></b><span class="sc-b"></span><em class="sc-t"></em></div><div class="sc-banner"></div><div class="sc-hint"><kbd>U</kbd> chutar · corra na bola para driblar</div>';
    document.body.appendChild(r); this.el = { r: r.querySelector('.sc-r'), b: r.querySelector('.sc-b'), s: r.querySelector('.sc-s'), t: r.querySelector('.sc-t'), ban: r.querySelector('.sc-banner') };
  }
  get authority() { const n = this.ctx.net; return !n || n.role !== 'guest'; }
  banner(t, ms = 2200) { this.el.ban.textContent = t; this.el.ban.classList.add('on'); clearTimeout(this._bt); this._bt = setTimeout(() => this.el.ban.classList.remove('on'), ms); }

  // ---- pitch ---------------------------------------------------------------------------------------------------------
  _build(ox, oy, oz) {
    const q = this.q; q.length = 0; this.qi = 0; const put = (x, y, z, id) => q.push(ox + x, oy + y, oz + z, id);
    const grass = bid('grass'), line = bid('white_terracotta'), glass = bid('glass'), post = bid('cobblestone'), air = 0, hw = W / 2;
    for (let u = -3; u <= L + 3; u++) for (let v = -1; v <= W; v++) put(u, -1, v, grass);
    // clear a little head-room (previous stadiums) and lines
    const onLine = (u, v) => u === 0 || u === L || v === 0 || v === W - 1 || u === Math.floor(L / 2) || (Math.hypot(u - L / 2, v - hw + 0.5) > 3.6 && Math.hypot(u - L / 2, v - hw + 0.5) < 4.6) || ((u === 8 || u === L - 8) && Math.abs(v - hw + 0.5) < 7) || ((u <= 8 || u >= L - 8) && (v === Math.floor(hw - 7) || v === Math.floor(hw + 6)));
    for (let u = 0; u <= L; u++) for (let v = 0; v < W; v++) if (onLine(u, v)) put(u, -1, v, line);
    for (let y = 0; y < 6; y++) { for (let u = -3; u <= L + 3; u++) { put(u, y, -1, glass); put(u, y, W, glass); } for (let v = 0; v < W; v++) { put(-4, y, v, glass); put(L + 4, y, v, glass); if (Math.abs(v - hw + 0.5) > GW + 0.5) { put(0, y, v, glass); put(L, y, v, glass); } } }
    for (const gx of [0, L]) { for (let y = 0; y < 3; y++) { put(gx, y, Math.floor(hw - GW - 0.5), post); put(gx, y, Math.floor(hw + GW + 0.5), post); } for (let v = Math.floor(hw - GW - 0.5); v <= Math.floor(hw + GW + 0.5); v++) put(gx, 3, v, post);
      const s = gx === 0 ? -1 : 1; for (let d = 1; d <= 3; d++) for (let y = 0; y < 4; y++) { put(gx + s * d, y, Math.floor(hw - GW - 0.5), glass); put(gx + s * d, y, Math.floor(hw + GW + 0.5), glass); } }
    void air; return q.length / 4;
  }
  _pump() {
    const q = this.q, w = this.world; let n = 700;
    while (this.qi < q.length && n-- > 0) { const x = q[this.qi], y = q[this.qi + 1], z = q[this.qi + 2], id = q[this.qi + 3]; this.qi += 4; w.applyEdit(x, y, z, id, 'game'); }
    if (this.qi >= q.length && q.length) { q.length = 0; this.qi = 0; }
  }

  // ---- match control (authority) --------------------------------------------------------------------------------------
  start() {
    if (!this.authority) { this.ctx.ui.toast('Só o anfitrião inicia a partida'); return; }
    const p = this.ctx.player; this.O = { x: Math.floor(p.x) - 22, y: Math.floor(p.y) + LIFT, z: Math.floor(p.z) - 13 };
    this._build(this.O.x, this.O.y, this.O.z); this.team.clear();
    const ids = ['me', ...(this.ctx.net ? [...this.ctx.net.players.keys()] : [])]; ids.forEach((id, i) => this.team.set(id, i % 2));
    this.score = [0, 0]; this.t = MATCH; this.st = 5; this.stT = 4.5; this._resetBall(); this.handled = -1; this._send(true);
  }
  stop() { if (!this.authority) return; this.st = 0; this._send(true); this._onState(0); }
  _resetBall() { const O = this.O; Object.assign(this.b, { x: O.x + L / 2, y: O.y + R + 0.05, z: O.z + W / 2 - 0.5, vx: 0, vy: 0, vz: 0 }); this.tgt.x = this.b.x; this.tgt.y = this.b.y; this.tgt.z = this.b.z; }

  _spawnFor(team, idx) { const O = this.O, side = team === 0 ? 7 : L - 7; return { x: O.x + side + (idx % 3 - 1) * 1.2, y: O.y + 0.02, z: O.z + 5 + (idx % 5) * 4 }; }
  _teleportMe() {
    const p = this.ctx.player, ids = [...this.team.keys()], mine = this.myId(), idx = Math.max(0, ids.filter((i) => this.team.get(i) === this.myTeam).indexOf(mine)), s = this._spawnFor(this.myTeam, idx);
    p.teleport(s.x, s.y, s.z); p.yaw = this.myTeam === 0 ? -Math.PI / 2 : Math.PI / 2; p.pitch = 0;
  }
  myId() { const n = this.ctx.net; return this.authority ? 'me' : (n && n.localId) || 'me'; }

  _onState(st) { // every client: reaction to a state transition
    const ctx = this.ctx, p = ctx.player, ir = ctx.itemsRuntime;
    if (st === 5 && !this.ret) { this.ret = { x: p.x, y: p.y, z: p.z }; this.hud.classList.remove('hidden'); this.mesh.visible = true; this.banner('⚽ ESTÁDIO NO CÉU — preparando…', 3500); }
    if (st === 3) { this._teleportMe(); if (ir) { ir.health.noFall = 4; ir.health._peak = ctx.player.y; } this.banner('3… 2… 1…', 3000); }
    if (st === 1) this.banner('BOLA ROLANDO!', 1400);
    if (st === 4) this.banner(this.score[0] === this.score[1] ? 'EMPATE ' + this.score[0] + ' × ' + this.score[1] : (this.score[0] > this.score[1] ? '🔴 Vermelho' : '🔵 Azul') + ' venceu ' + Math.max(...this.score) + ' × ' + Math.min(...this.score), 6000);
    if (st === 0 && this.ret) { p.teleport(this.ret.x, this.ret.y + 0.5, this.ret.z); if (ir) { ir.health.noFall = 4; ir.health._peak = p.y; } this.ret = null; this.hud.classList.add('hidden'); this.mesh.visible = false; }
  }

  // ---- physics (authority) -----------------------------------------------------------------------------------------
  _ball(dt) {
    const b = this.b, O = this.O; let u = b.x - O.x, v = b.z - O.z, y = b.y - O.y;
    b.vy -= 22 * dt; u += b.vx * dt; v += b.vz * dt; y += b.vy * dt;
    const hw = W / 2 - 0.5, inGoal = (vv) => Math.abs(vv - hw) < GW - R * 0.3;
    if (y < R) { y = R; if (b.vy < -1.2) b.vy *= -0.62; else b.vy = 0; const f = Math.exp(-0.75 * dt); b.vx *= f; b.vz *= f; }
    if (y > 6 - R) { y = 6 - R; b.vy = -Math.abs(b.vy) * 0.5; }
    // side lines
    const vmin = R, vmax = W - 1 - R + 0.5; if (v < vmin) { v = vmin; b.vz = Math.abs(b.vz) * 0.7; } if (v > vmax) { v = vmax; b.vz = -Math.abs(b.vz) * 0.7; }
    // end lines (solid except in the goal mouths); balls inside a goal stay between the posts
    const inMouth = inGoal(v) && y < 3 - R * 0.6;
    if (u < R && !inMouth && u > -0.01 + 0.0) { /* before the line, nothing */ }
    if (!inMouth) { if (u < R && b.vx < 0 && u > -1) { u = R; b.vx = Math.abs(b.vx) * 0.7; } if (u > L - R && b.vx > 0 && u < L + 1) { u = L - R; b.vx = -Math.abs(b.vx) * 0.7; } }
    if (u < 0 || u > L) { // inside a goal box: walls
      if (u < -3 + R) { u = -3 + R; b.vx = Math.abs(b.vx) * 0.3; } if (u > L + 3 - R) { u = L + 3 - R; b.vx = -Math.abs(b.vx) * 0.3; }
      if (v < hw - GW + R) { v = hw - GW + R; b.vz = Math.abs(b.vz) * 0.4; } if (v > hw + GW - R) { v = hw + GW - R; b.vz = -Math.abs(b.vz) * 0.4; }
      if (y > 3 - R) { y = 3 - R; b.vy = -Math.abs(b.vy) * 0.4; }
    }
    b.x = O.x + u; b.y = O.y + y; b.z = O.z + v; return u;
  }
  _contacts(dt) {
    const ctx = this.ctx, b = this.b, now = performance.now(), pl = []; const p = ctx.player;
    pl.push({ id: 'me', x: p.x, y: p.y, z: p.z, vx: p.vx, vz: p.vz });
    const n = ctx.net; if (n && n.players) for (const q of n.players.values()) if (q.pos) { const pv = this.prevPos.get(q.id); const vx = pv ? (q.pos.x - pv.x) / Math.max(dt, 1e-3) : 0, vz = pv ? (q.pos.z - pv.z) / Math.max(dt, 1e-3) : 0; this.prevPos.set(q.id, { x: q.pos.x, z: q.pos.z }); pl.push({ id: q.id, x: q.pos.x, y: q.pos.y, z: q.pos.z, vx: Math.max(-12, Math.min(12, vx)), vz: Math.max(-12, Math.min(12, vz)) }); }
    for (const q of pl) {
      const dx = b.x - q.x, dz = b.z - q.z, d = Math.hypot(dx, dz); if (d > 0.9 || b.y > q.y + 1.9 || b.y < q.y - 0.5) continue;
      if (now - (this.touch.get(q.id) || 0) < 160) continue; this.touch.set(q.id, now);
      const nx = d > 1e-3 ? dx / d : 1, nz = d > 1e-3 ? dz / d : 0, sp = Math.hypot(q.vx, q.vz), push = 3.2 + sp * 1.25;
      b.vx = nx * push + q.vx * 0.5; b.vz = nz * push + q.vz * 0.5; if (b.y < q.y + 0.6 && sp > 5) b.vy = Math.max(b.vy, 1.2);
    }
  }
  kick(id, dx, dy, dz) { // authority: kick if the player is close enough
    const b = this.b, n = this.ctx.net, pos = id === 'me' ? this.ctx.player : (n && n.players.get(id) && n.players.get(id).pos); if (!pos) return;
    if (Math.hypot(b.x - pos.x, b.z - pos.z) > 3.2 || Math.abs(b.y - pos.y) > 2.6) return;
    const l = Math.hypot(dx, dy, dz) || 1; b.vx = dx / l * 15; b.vz = dz / l * 15; b.vy = 4.2 + Math.max(0, dy / l) * 7; this.ctx.audio.gun && this.ctx.audio.beep(true);
  }
  myKick() {
    if (this.st !== 1 || this.kickCd > 0) return; this.kickCd = 0.35; const p = this.ctx.player, cp = Math.cos(p.pitch), dx = -Math.sin(p.yaw) * cp, dy = Math.sin(p.pitch), dz = -Math.cos(p.yaw) * cp;
    this.ctx.audio.swing(); if (this.authority) this.kick('me', dx, dy, dz); else if (this.ctx.net) this.ctx.net.send('sc:kick', { dx, dy, dz });
  }

  update(dt) {
    dt = Math.min(dt, 0.1); const ctx = this.ctx; if (this.kickCd > 0) this.kickCd -= dt;
    const post = !!ctx.gr.post; if (post !== this._post) { this._post = post; this.mesh.material.defines = post ? {} : { NO_POST: 1 }; this.mesh.material.needsUpdate = true; }
    if (this.authority && this.q.length) this._pump();
    if (this.authority && this.st !== 0) {
      this.stT -= dt;
      if (this.st === 5 && this.stT <= 0 && this.qi === 0 && !this.q.length) { this.st = 3; this.stT = 3.2; this._resetBall(); this._send(true); }
      else if (this.st === 3 && this.stT <= 0) { this.st = 1; this._send(true); }
      else if (this.st === 2 && this.stT <= 0) { this.st = 3; this.stT = 3; this._resetBall(); this._send(true); }
      else if (this.st === 4 && this.stT <= 0) { this.st = 0; this._send(true); }
      if (this.st === 1) {
        this.t -= dt; this._contacts(dt); const u = this._ball(dt);
        const y = this.b.y - this.O.y; if (u < -0.3 && y < 3) this._goal(1); else if (u > L + 0.3 && y < 3) this._goal(0);
        if (this.t <= 0) { this.st = 4; this.stT = 7; this._send(true); }
      } else if (this.st === 2 || this.st === 3 || this.st === 5) { /* ball rests */ }
      this.sendT -= dt; if (this.sendT <= 0) this._send();
    } else if (!this.authority && this.st !== 0) { // guests: extrapolate, ease toward the snapshot
      const b = this.b; if (this.st === 1) { b.vy -= 22 * dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt; if (this.O && b.y < this.O.y + R) { b.y = this.O.y + R; b.vy = Math.max(0, -b.vy * 0.5); } }
      const k = 1 - Math.exp(-14 * dt); b.x += (this.tgt.x - b.x) * k; b.y += (this.tgt.y - b.y) * k; b.z += (this.tgt.z - b.z) * k;
    }
    if (this.st !== this.handled) { this._onState(this.st); this.handled = this.st; }
    if (this.st !== 0) {
      const c = ctx.camera.position; this.mesh.position.set(this.b.x - c.x, this.b.y - c.y, this.b.z - c.z);
      const sp = Math.hypot(this.b.vx, this.b.vz); if (sp > 0.05) { this.mesh.rotation.z -= this.b.vx * dt / R * 0.7; this.mesh.rotation.x += this.b.vz * dt / R * 0.7; }
      this._hudTick();
      // out of bounds (fell off the stadium): put the player back on the pitch
      const p = ctx.player; if (this.O && p.y < this.O.y - 12) this._teleportMe();
    }
  }

  _goal(team) { // `team` scored
    this.score[team]++; this.st = 2; this.stT = 3.5; this.ctx.events.emit('soccer:goal', { team, score: this.score.slice() }); this._send(true);
    this.banner('GOOOL! ' + TEAM[team].i + ' ' + this.score[0] + ' × ' + this.score[1], 3000); this.ctx.audio.respawn(); this.ctx.interaction.particles.burst(this.b.x, this.b.y + 1, this.b.z, [1, 0.9, 0.4], 30, 3);
  }
  _hudTick() {
    const mm = Math.max(0, Math.floor(this.t / 60)), ss = Math.max(0, Math.floor(this.t % 60));
    this.el.r.textContent = TEAM[0].i + ' Vermelho'; this.el.b.textContent = 'Azul ' + TEAM[1].i; this.el.s.textContent = this.score[0] + ' : ' + this.score[1]; this.el.t.textContent = String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  }

  // ---- network ---------------------------------------------------------------------------------------------------
  _send(force) {
    this.sendT = 0.085; const n = this.ctx.net; if (!n || !n.broadcast || n.role === 'guest') return; void force;
    const r = (v) => Math.round(v * 100) / 100, b = this.b, tm = {}; for (const [id, t] of this.team) tm[id === 'me' ? n.localId : id] = t;
    n.broadcast('sc:s', { st: this.st, t: Math.round(this.t * 10) / 10, s: this.score, O: this.O && [this.O.x, this.O.y, this.O.z], b: [r(b.x), r(b.y), r(b.z), r(b.vx), r(b.vy), r(b.vz)], tm }, { reliable: this.st !== 1 });
  }
  onState(d) {
    if (this.authority || !d) return; const st = num(d.st, 0, 0, 5);
    this.t = num(d.t, 0, 0, 3600); this.score = Array.isArray(d.s) ? [num(d.s[0], 0, 0, 99), num(d.s[1], 0, 0, 99)] : [0, 0];
    if (Array.isArray(d.O)) this.O = { x: num(d.O[0]), y: num(d.O[1], 80, -64, 600), z: num(d.O[2]) };
    if (Array.isArray(d.b)) { const b = this.b; b.vx = num(d.b[3], 0, -60, 60); b.vy = num(d.b[4], 0, -60, 60); b.vz = num(d.b[5], 0, -60, 60); this.tgt.x = num(d.b[0]); this.tgt.y = num(d.b[1], 80, -64, 600); this.tgt.z = num(d.b[2]); if (Math.hypot(b.x - this.tgt.x, b.z - this.tgt.z) > 8 || this.st === 0) { b.x = this.tgt.x; b.y = this.tgt.y; b.z = this.tgt.z; } }
    const my = this.ctx.net && d.tm && d.tm[this.ctx.net.localId]; this.myTeam = my === 1 ? 1 : 0; this.team.clear(); if (d.tm) for (const k of Object.keys(d.tm).slice(0, 32)) this.team.set(k, d.tm[k] === 1 ? 1 : 0);
    if (st === 0 && this.st === 0) return; this.st = st;
  }
  onKick(d, from) { if (!this.authority || this.st !== 1 || !d || !from) return; this.kick(from, num(d.dx, 0, -1, 1), num(d.dy, 0, -1, 1), num(d.dz, 0, -1, 1)); }
  onTeam(d, from) { if (!this.authority || !d || !from) return; this.team.set(from, d.t === 1 ? 1 : 0); this._send(true); }
  setMyTeam(t) { this.myTeam = t; if (this.authority) { this.team.set('me', t); this._send(true); } else if (this.ctx.net) this.ctx.net.send('sc:team', { t }); }
  dispose() { this.hud.remove(); this.ctx.gr.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}

export default defineFeature({
  id: 'soccer', order: 35,
  init(ctx) {
    K = new Soccer(ctx);
    const open = () => {
      const el = document.createElement('div'), auth = K.authority; el.className = 'sc-panel';
      el.innerHTML = '<p>Constrói um <b>estádio no céu</b> acima de você e leva todo mundo para lá. Corra na bola para driblar e aperte <b>U</b> para chutar. 5 minutos de jogo; no fim vocês voltam para onde estavam.</p><div class="sc-btns"></div><p class="sc-st dim"></p>';
      const btns = el.querySelector('.sc-btns'), st = el.querySelector('.sc-st');
      const mk = (label, fn, cls = 'btn') => { const b = document.createElement('button'); b.className = cls; b.type = 'button'; b.textContent = label; b.onclick = fn; btns.append(b); return b; };
      if (auth) { mk(K.st ? 'Reiniciar partida' : '⚽ Iniciar partida', () => { K.start(); ctx.ui.closePanels(); }, 'btn primary'); if (K.st) mk('Encerrar', () => { K.stop(); ctx.ui.closePanels(); }); } else st.textContent = 'Só o anfitrião inicia a partida.';
      if (K.st) { mk('🔴 Time Vermelho', () => { K.setMyTeam(0); ctx.ui.toast('Você está no Vermelho'); }); mk('🔵 Time Azul', () => { K.setMyTeam(1); ctx.ui.toast('Você está no Azul'); }); st.textContent = 'Partida em andamento: ' + K.score[0] + ' × ' + K.score[1]; }
      ctx.ui.panel({ id: 'soccer', title: 'Futebol', subtitle: 'cooperativo e competitivo', content: el, width: 480 });
    };
    ctx.ui.addToolbarButton({ id: 'soccer', icon: '⚽', title: 'Futebol', key: 'I', onClick: open });
    ctx.addHotkey('KeyI', open);
    ctx.addHotkey('KeyU', () => K.myKick());
    ctx.soccer = { start: () => K.start(), stop: () => K.stop(), get active() { return K.st !== 0; }, get score() { return K.score.slice(); }, open, get _k() { return K; } };
  },
  ready(ctx) { const n = ctx.net; if (!K || !n || !n.on) return; n.on('sc:s', (d) => K.onState(d)); n.on('sc:kick', (d, f) => K.onKick(d, f)); n.on('sc:team', (d, f) => K.onTeam(d, f)); },
  update(dt) { if (K) K.update(dt); },
  dispose() { if (K) { K.dispose(); K = null; } },
});
