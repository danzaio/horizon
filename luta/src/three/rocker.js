// 3D caricature rocker built from primitives, driven by the same 2D pose angles as the game logic
// (0 = limb pointing down, + = rotating toward the facing direction). Arms switch to 3D IK while shredding.
import * as THREE from 'three';
import { toon, part, canvasTex } from './toon.js';
import { GY, D, TAU, clamp, lerp, canvas, FONT } from '../shared.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const cap = (r, len) => new THREE.CapsuleGeometry(r, Math.max(0.1, len), 6, 16);
const sph = (r, ...a) => new THREE.SphereGeometry(r, 28, 18, ...a);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

// ---------- painted textures (equirect / lathe UVs: u = 0.5 is the front, u = 0 / 1 the back)
function tex(w, h, paint) { const c = canvas(w, h); paint(c.getContext('2d'), w, h); return canvasTex(c); }
function strokes(g, n, w, h, cols, len, lw, seed = 1) {
  let s = seed; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = R() * h, l = len * (0.6 + R() * 0.8);
    g.strokeStyle = cols[i % cols.length]; g.lineWidth = lw;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + (R() - 0.5) * 8, y + l / 2, x + (R() - 0.5) * 6, y + l); g.stroke();
  }
}
function faceTexture(id) {
  return tex(512, 256, (g, w, h) => {
    g.fillStyle = id === 'lula' ? '#d99d73' : '#f0c39b'; g.fillRect(0, 0, w, h);
    const blush = g.createRadialGradient(0, 0, 2, 0, 0, 40); blush.addColorStop(0, 'rgba(220,90,80,.35)'); blush.addColorStop(1, 'rgba(220,90,80,0)');
    for (const x of [205, 307]) { g.save(); g.translate(x, 138); g.fillStyle = blush; g.fillRect(-40, -40, 80, 80); g.restore(); }
    if (id === 'lula') {
      g.strokeStyle = 'rgba(110,52,34,.75)'; g.lineWidth = 3; g.lineCap = 'round';
      for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(222, 72 + i * 8); g.quadraticCurveTo(256, 64 + i * 8, 290, 72 + i * 8); g.stroke(); }
      for (const s of [-1, 1]) { // crow's feet + bags
        const x = 256 + s * 44;
        for (const dy of [-6, 0, 6]) { g.beginPath(); g.moveTo(x, 112 + dy * 0.4); g.lineTo(x + s * 14, 112 + dy * 1.4); g.stroke(); }
        g.beginPath(); g.moveTo(256 + s * 16, 124); g.quadraticCurveTo(256 + s * 28, 130, 256 + s * 38, 123); g.stroke();
      }
    }
  });
}
function stubbleTexture() {
  return tex(512, 256, (g, w, h) => {
    g.fillStyle = '#f0c39b'; g.fillRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 40, 0, 200); gr.addColorStop(0, 'rgba(70,80,110,0)'); gr.addColorStop(1, 'rgba(70,80,110,.42)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(50,55,80,.12)'; for (let i = 0; i < 1600; i++) { const y = 80 + Math.random() * 170; g.fillRect(Math.random() * w, y, 1.2, 1.2); }
    g.strokeStyle = 'rgba(150,80,60,.8)'; g.lineWidth = 3; g.lineCap = 'round'; // smirk crease
    g.beginPath(); g.moveTo(226, 92); g.quadraticCurveTo(222, 108, 230, 118); g.stroke();
  });
}
function hairTexture(base, dark, light, seed) {
  return tex(256, 256, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); g.globalAlpha = 0.45; strokes(g, 110, w, h, [dark, light, dark], 60, 1.6, seed); });
}
function beardTexture() {
  return tex(256, 256, (g, w, h) => {
    g.fillStyle = '#ece9e3'; g.fillRect(0, 0, w, h);
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(160,155,150,0)'); gr.addColorStop(1, 'rgba(150,145,140,.55)'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    strokes(g, 260, w, h, ['#a9a49d', '#ffffff', '#8f8a84'], 22, 2, 7);
  });
}
function jerseyTexture() {
  return tex(1024, 512, (g, w, h) => {
    g.fillStyle = '#ffd21a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#0e9a48'; for (const x of [256, 768]) g.fillRect(x - 22, 0, 44, h);
    g.fillStyle = '#ffd21a'; for (const x of [256, 768]) g.fillRect(x - 6, 0, 12, h);
    // V collar (front) + generic crest
    g.fillStyle = '#0e9a48'; g.beginPath(); g.moveTo(452, 0); g.lineTo(512, 92); g.lineTo(572, 0); g.closePath(); g.fill();
    g.fillStyle = '#ffd21a'; g.beginPath(); g.moveTo(476, 0); g.lineTo(512, 58); g.lineTo(548, 0); g.closePath(); g.fill();
    g.fillStyle = '#1f3fbf'; g.beginPath(); g.moveTo(580, 120); g.lineTo(612, 120); g.lineTo(612, 146); g.lineTo(596, 160); g.lineTo(580, 146); g.closePath(); g.fill();
    const num = (x, y, size, text) => {
      g.font = `${size}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = size * 0.22; g.strokeStyle = '#ffffff'; g.strokeText(text, x, y);
      g.lineWidth = size * 0.08; g.strokeStyle = '#130a16'; g.strokeText(text, x, y);
      g.fillStyle = '#0e9a48'; g.fillText(text, x, y);
    };
    num(470, 200, 92, '01');
    for (const x of [0, w]) { num(x, 250, 190, '01'); num(x, 120, 64, 'FLÁVIO'); }
  });
}
function jacketTexture() {
  return tex(1024, 512, (g, w, h) => {
    g.fillStyle = '#c8122c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#7a0a1c'; g.lineWidth = 6;
    for (const x of [452, 572]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    g.strokeStyle = '#ff5a6e'; g.lineWidth = 3; for (const x of [444, 580]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
    // back print: flames + "O BARBA"
    for (const x0 of [0, w]) {
      for (let i = -6; i <= 6; i++) {
        const x = x0 + i * 26, hh = 70 + (6 - Math.abs(i)) * 14;
        g.fillStyle = i % 2 ? '#ffb21a' : '#ff6a12';
        g.beginPath(); g.moveTo(x - 22, 420); g.quadraticCurveTo(x - 10, 420 - hh * 0.6, x + 4, 420 - hh); g.quadraticCurveTo(x + 6, 420 - hh * 0.4, x + 22, 420); g.closePath(); g.fill();
      }
      g.font = `86px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      g.lineWidth = 14; g.strokeStyle = '#130a16'; g.strokeText('O BARBA', x0, 300);
      g.fillStyle = '#ffd400'; g.fillText('O BARBA', x0, 300);
    }
  });
}
function fretTexture() {
  return tex(512, 32, (g, w, h) => {
    g.fillStyle = '#3a2010'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e7d9ae'; for (let x = 18; x < w; x += 40) g.fillRect(x, 0, 4, h);
    g.fillStyle = '#f2ead6'; for (const x of [78, 158, 238, 358]) { g.beginPath(); g.arc(x, h / 2, 5, 0, TAU); g.fill(); }
  });
}

// ---------- guitars (body at origin, neck along +x, headstock tip near x = 176, strings face +z)
function shape(pts) { const s = new THREE.Shape(); s.moveTo(pts[0], -pts[1]); for (let i = 2; i < pts.length; i += 2) s.lineTo(pts[i], -pts[i + 1]); s.closePath(); return s; }
function ext(sh, depth, bev) {
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  return g;
}
function star(ro, ri) { const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? ri : ro, a = i / 10 * TAU + Math.PI / 2; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); } s.closePath(); return s; }
export function buildGuitar(def) {
  const G = new THREE.Group(), ink = toon('#1b1b1f'), metal = toon('#cfd0d8');
  let body;
  if (def.guitar === 'v') {
    body = new THREE.Shape(); body.moveTo(34, 11); body.lineTo(-58, 54); body.quadraticCurveTo(-78, 60, -76, 40); body.lineTo(-30, 0);
    body.lineTo(-76, -40); body.quadraticCurveTo(-78, -60, -58, -54); body.lineTo(34, -11); body.closePath();
  } else body = shape([34, -12, -6, -30, -40, -62, -56, -50, -70, -6, -62, 26, -30, 44, 10, 24, 34, 12]);
  part(ext(body, 9, 2.5), toon(def.gtrCol), G, 0, 0, 0, 0.8);
  if (def.guitar === 'v') part(new THREE.ShapeGeometry(shape([26, -9, -20, -30, -32, -16, -12, 0, -32, 16, -20, 30, 26, 9])), toon(def.gtrGuard), G, 0, 0, 7.3, 0);
  else {
    part(new THREE.ShapeGeometry(shape([30, -14, -6, -31, -38, -59, -45, -55, -10, -25, 28, -7])), toon(def.gtrGuard), G, 0, 0, 7.3, 0);
    part(new THREE.ShapeGeometry(star(13, 5.5)), toon('#1f3fbf'), G, -34, -8, 7.4, 0);
  }
  for (const x of [-2, 16]) part(new THREE.BoxGeometry(10, 20, 3), ink, G, x, 0, 8, 0.5);
  part(new THREE.BoxGeometry(6, 16, 2), metal, G, -16, 0, 7.6, 0);
  for (const [x, y] of [[-40, -18], [-50, -24], [-44, -30]]) { const k = part(new THREE.CylinderGeometry(3.5, 3.5, 3, 12), metal, G, x, y, 8.4, 0.5); k.rotation.x = Math.PI / 2; }
  part(new THREE.BoxGeometry(122, 12, 6), toon('#5b3417'), G, 72, 0, 5, 0.8);
  part(new THREE.PlaneGeometry(118, 11), toon('#ffffff', { map: fretTexture() }), G, 73, 0, 8.1, 0);
  const head = def.guitar === 'v' ? [128, -8, 168, -17, 176, -6, 172, 8, 128, 8] : [128, -8, 160, -22, 174, -16, 162, 8, 128, 8];
  part(ext(shape(head), 4, 1.2), toon(def.gtrCol), G, 0, 0, 4, 0.8);
  for (let i = 0; i < 3; i++) part(new THREE.SphereGeometry(2.6, 8, 6), metal, G, 140 + i * 10, 10 + i * 2.5, 7.5, 0);
  for (const y of [-3, -1, 1, 3]) part(new THREE.BoxGeometry(148, 0.7, 0.7), toon('#ededf2'), G, 57, y * 0.9, 9, 0);
  return G;
}

// ---------- the rocker
export class Rocker {
  constructor(def) {
    this.def = def;
    const L = def.len, Wd = def.limb;
    const M = this.M = {
      skin: toon(def.skin), pants: toon(def.pants), sleeve: toon(def.sleeve), fore: toon(def.fore), boot: toon(def.boot),
      sole: toon(def.id === 'flavio' ? '#c9ccd2' : '#2a1e22'), ink: toon('#1c1a21'), white: toon('#fbf6ea'), iris: toon('#24160e'),
      gold: toon('#e8c64a'), metal: toon('#c9c9d2'), belt: toon('#1a1210'), mouth: toon('#4a1414'),
    };
    this.root = new THREE.Group();
    this.hip = new THREE.Group(); this.root.add(this.hip);
    this.rotG = new THREE.Group(); this.hip.add(this.rotG);
    part(sph(26), M.pants, this.rotG, 0, 2, 0).scale.set(1.05, 0.72, 0.95);
    this.legB = this.chain(this.rotG, V(2, 0, -13), L.thigh, Wd.thigh / 2, M.pants, L.shin, Wd.shin / 2, M.pants);
    this.legF = this.chain(this.rotG, V(2, 0, 13), L.thigh, Wd.thigh / 2, M.pants, L.shin, Wd.shin / 2, M.pants);
    this.boot(this.legB.end); this.boot(this.legF.end);
    this.torso = new THREE.Group(); this.rotG.add(this.torso);
    def.id === 'lula' ? this.torsoLula() : this.torsoFlavio();
    const shY = L.torso * 0.86, shZ = 31;
    this.armB = this.chain(this.torso, V(0, shY, -shZ), L.upper, Wd.upper / 2, M.sleeve, L.fore, Wd.fore / 2, M.fore);
    this.armF = this.chain(this.torso, V(0, shY, shZ), L.upper, Wd.upper / 2, M.sleeve, L.fore, Wd.fore / 2, M.fore);
    part(sph(13), M.skin, this.armB.end);
    part(sph(14.5), M.skin, this.armF.end);
    this.horns = new THREE.Group(); this.armF.end.add(this.horns);
    for (const [x, r] of [[-5, 0.2], [6, -0.2]]) { const f = part(cap(3.6, 12), M.skin, this.horns, x, 18, 0, 0.7); f.rotation.z = r; }
    part(new THREE.CylinderGeometry(12.5, 13.5, 24, 16), M.skin, this.torso, 2, L.torso + 4, 0);
    this.head = new THREE.Group(); this.head.position.set(2, L.torso + 10, 0); this.torso.add(this.head);
    def.id === 'lula' ? this.headLula() : this.headFlavio();
    // guitar: holder (placement per mode) → inner (offset) → model
    this.holder = new THREE.Group(); this.gInner = new THREE.Group(); this.holder.add(this.gInner);
    this.guitar = buildGuitar(def); this.gInner.add(this.guitar);
    this.tip = new THREE.Object3D(); this.tip.position.set(172, 0, 0); this.guitar.add(this.tip);
    this.gMode = null; this.setGuitarMode('back');
    if (def.heavy === 'hammer') { // Lula's sledgehammer ("MARTELADA"), held in the front hand
      this.hammer = new THREE.Group(); this.hammer.position.y = -L.fore; this.armF.b.add(this.hammer);
      part(new THREE.CylinderGeometry(4.5, 5, 118, 10), toon('#7a4a24'), this.hammer, 0, -44, 0, 0.8);
      part(new THREE.CylinderGeometry(6, 6, 24, 10), toon('#c8122c'), this.hammer, 0, -6, 0, 0.6);
      part(new THREE.BoxGeometry(64, 30, 30), toon('#9aa0ad'), this.hammer, 6, -104, 0, 1);
      part(new THREE.BoxGeometry(8, 32, 32), toon('#c8122c'), this.hammer, 6, -104, 0, 0.6);
      this.hammer.visible = false;
    }
  }
  chain(parent, pos, lenA, rA, matA, lenB, rB, matB) {
    const a = new THREE.Group(); a.position.copy(pos); parent.add(a);
    part(cap(rA, lenA), matA, a, 0, -lenA / 2, 0);
    const b = new THREE.Group(); b.position.y = -lenA; a.add(b);
    part(cap(rB, lenB), matB, b, 0, -lenB / 2, 0);
    const end = new THREE.Group(); end.position.y = -lenB; b.add(end);
    return { a, b, end, lenA, lenB };
  }
  boot(end) {
    const M = this.M;
    part(cap(11, 20), M.boot, end, 9, -4, 0).rotation.z = Math.PI / 2;
    part(new THREE.BoxGeometry(46, 6, 23), M.sole, end, 9, -13, 0);
    if (this.def.id === 'flavio') for (const z of [-11.5, 11.5]) { const s = part(new THREE.BoxGeometry(20, 3.5, 1), toon('#0e9a48'), end, 8, -4, z, 0); s.rotation.z = 0.45; }
    else part(new THREE.SphereGeometry(3, 8, 6), M.metal, end, -2, -2, 11, 0);
  }
  torsoLula() {
    const T = this.torso, L = this.def.len.torso, M = this.M, tee = M.ink;
    part(cap(29, L - 54), toon('#ffffff', { map: jacketTexture() }), T, 0, L * 0.5, 0).scale.set(1.12, 1, 0.92);
    part(sph(30), tee, T, 12, L * 0.44, 0).scale.set(0.78, 1.45, 0.74);
    part(sph(27), tee, T, 17, L * 0.27, 0).scale.set(1, 0.92, 0.95);
    const st = part(new THREE.ExtrudeGeometry(star(10, 4.2), { depth: 2, bevelEnabled: false }), toon('#e3121c'), T, 35.5, L * 0.55, 0, 0.6);
    st.rotation.y = Math.PI / 2;
    for (const z of [-27, -19, 19, 27]) part(new THREE.SphereGeometry(2.8, 8, 6), M.metal, T, -2, L * 0.92 - Math.abs(z) * 0.18, z, 0);
    this.belt(T);
  }
  torsoFlavio() {
    const T = this.torso, L = this.def.len.torso;
    part(cap(28, L - 52), toon('#ffffff', { map: jerseyTexture() }), T, 0, L * 0.5, 0).scale.set(1.1, 1, 0.92);
    part(sph(25), toon('#ffd21a'), T, 11, L * 0.3, 0).scale.set(1, 0.9, 0.9);
    part(new THREE.TorusGeometry(13.5, 3.4, 8, 24), toon('#0e9a48'), T, 3, L + 1, 0, 0.6).rotation.x = Math.PI / 2;
    this.belt(T);
  }
  belt(T) {
    const b = part(new THREE.CylinderGeometry(28.5, 28.5, 9, 24), this.M.belt, T, 0, 4, 0, 0.6); b.scale.set(1.12, 1, 0.94);
    part(new THREE.BoxGeometry(5, 12, 15), this.M.gold, T, 32.5, 4, 0, 0.6);
  }
  ears(H, x, y, z) { for (const s of [-1, 1]) part(sph(9), this.M.skin, H, x, y, s * z).scale.set(0.55, 1.25, 0.6); }
  eyesBrows(H, ex, ey, ez, r, browY, browCol, base) {
    this.eyes = []; this.brows = []; this.eyeBase = base;
    for (const s of [-1, 1]) {
      const g = new THREE.Group(); g.position.set(ex, ey, s * ez); H.add(g);
      part(sph(r), this.M.white, g, 0, 0, 0, 0.7).scale.set(0.5, 0.62, 1);
      part(sph(r * 0.45), this.M.iris, g, r * 0.42, 0, 0, 0);
      this.eyes.push(g);
      const b = new THREE.Group(); b.position.set(ex + 1, browY, s * (ez + 1)); b.userData.s = s; H.add(b);
      part(cap(3.7, 14), toon(browCol), b, 0, 0, 0, 0.8).rotation.x = Math.PI / 2;
      this.brows.push(b);
    }
  }
  headLula() {
    const H = this.head, M = this.M;
    part(sph(40), toon('#ffffff', { map: faceTexture('lula') }), H, 6, 48, 0).scale.set(1, 1.15, 0.95);
    part(new THREE.SphereGeometry(42, 28, 14, -0.63 * Math.PI, 1.26 * Math.PI, 0, 0.56 * Math.PI), toon('#ffffff', { map: hairTexture('#c8c4bf', '#8a8580', '#eeeae4', 3) }), H, 5, 48, 0).scale.set(1, 1.15, 0.95);
    part(new THREE.SphereGeometry(42.2, 28, 8, 0, TAU, 0, 0.2 * Math.PI), toon('#b9b5b0'), H, 5, 48, 0, 0.8).scale.set(1, 1.15, 0.95);
    this.ears(H, -4, 46, 37);
    const beardM = toon('#ffffff', { map: beardTexture() });
    part(new THREE.SphereGeometry(43, 28, 14, 0.4 * Math.PI, 1.2 * Math.PI, 0.53 * Math.PI, 0.45 * Math.PI), beardM, H, 6, 48, 0).scale.set(1.05, 1.13, 1);
    part(sph(22), beardM, H, 22, 12, 0).scale.set(1, 0.8, 1.15);
    this.mouth = part(sph(9), M.mouth, H, 43, 18, 0, 0.6);
    this.teeth = part(new THREE.BoxGeometry(3, 3.5, 13), M.white, H, 45.5, 22, 0, 0);
    part(new THREE.TorusGeometry(13, 5.5, 8, 18, Math.PI), toon('#cfcac3'), H, 45, 19, 0).rotation.y = Math.PI / 2;
    part(sph(11.5), M.skin, H, 49, 39, 0).scale.set(1.05, 0.95, 1.1);
    part(cap(6, 14), M.skin, H, 44, 51, 0).rotation.z = 0.42;
    this.eyesBrows(H, 41, 57, 14, 6.5, 67, '#4b4744', 0.55);
  }
  headFlavio() {
    const H = this.head, M = this.M;
    part(sph(42), toon('#ffffff', { map: faceTexture('flavio') }), H, 6, 50, 0).scale.set(1, 1.1, 0.98);
    part(sph(36), toon('#ffffff', { map: stubbleTexture() }), H, 12, 27, 0).scale.set(1.02, 0.74, 1.08);
    const hairM = toon('#ffffff', { map: hairTexture('#2b1d14', '#120b07', '#5a4232', 5) });
    part(new THREE.SphereGeometry(43.6, 28, 14, -0.58 * Math.PI, 1.16 * Math.PI, 0, 0.47 * Math.PI), hairM, H, 5, 50, 0).scale.set(1, 1.1, 0.98);
    part(new THREE.SphereGeometry(43.9, 28, 8, 0, TAU, 0, 0.24 * Math.PI), hairM, H, 6, 50, 0, 0.8).scale.set(1, 1.1, 0.98);
    this.ears(H, -4, 48, 40);
    part(sph(9.5), M.skin, H, 50, 42, 0).scale.set(1, 0.95, 1.05);
    part(cap(5, 14), M.skin, H, 46, 53, 0).rotation.z = 0.36;
    this.smirk = part(cap(2.3, 13), M.mouth, H, 48.6, 23, 1, 0); this.smirk.rotation.set(Math.PI / 2, 0.15, 0);
    this.mouth = part(sph(8.5), M.mouth, H, 46.5, 24, 0, 0.6);
    this.teeth = part(new THREE.BoxGeometry(3, 3, 12), M.white, H, 49, 27, 0, 0);
    this.eyesBrows(H, 43, 59, 14, 5.6, 69, '#24170f', 0.62);
    for (const s of [-1, 1]) part(cap(1.6, 10), M.ink, H, 44.8, 62.4, s * 14, 0).rotation.x = Math.PI / 2;
  }
  setGuitarMode(m) {
    if (m === this.gMode) return;
    this.gMode = m;
    const H = this.holder, I = this.gInner, L = this.def.len;
    this.guitar.scale.setScalar(m === 'back' ? 0.78 : 1);
    if (m === 'back') { this.torso.add(H); H.position.set(-40, L.torso * 0.42, 0); H.rotation.set(0, -Math.PI / 2, 0); I.rotation.set(0, 0, 1.3); I.position.set(0, 0, 0); }
    else if (m === 'hands') { this.torso.add(H); H.position.set(this.def.id === 'lula' ? 52 : 44, L.torso * 0.34, 4); H.rotation.set(0, Math.PI / 2, 0); I.rotation.set(0, 0, 0.45); I.position.set(0, 0, 0); }
    else { this.armF.b.add(H); H.position.set(0, -L.fore, 10); H.rotation.set(0, 0, Math.PI / 2); I.rotation.set(0, 0, 0); I.position.set(-138, 0, 0); }
  }
  // o: { x, y, facing, yaw, gtr, ex, t, horns, scale }
  setPose(p, o) {
    const L = this.def.len;
    this.root.position.set(o.x - 640, GY - o.y, o.z || 0);
    this.root.rotation.y = o.facing > 0 ? -o.yaw : Math.PI + o.yaw;
    this.root.scale.setScalar(o.scale || 1);
    const fy = (h, k) => Math.cos(h) * L.thigh + Math.cos(h + k) * L.shin;
    const lying = clamp(-p.rot / (84 * D), 0, 1);
    this.hip.position.y = lying > 0.02 ? lerp(L.thigh + L.shin - 6, 26, lying) : Math.max(fy(p.hb, p.kb), fy(p.hf, p.kf)) + 16;
    this.rotG.rotation.z = -p.rot;
    this.legB.a.rotation.set(0, 0, p.hb); this.legB.b.rotation.set(0, 0, p.kb); this.legB.end.rotation.z = -(p.hb + p.kb) * 0.9;
    this.legF.a.rotation.set(0, 0, p.hf); this.legF.b.rotation.set(0, 0, p.kf); this.legF.end.rotation.z = -(p.hf + p.kf) * 0.9;
    this.torso.rotation.z = -p.lean;
    this.head.rotation.z = 0.6 * p.lean - p.head;
    this.setGuitarMode(o.gtr || 'back');
    if (this.gMode === 'hands') {
      const t = o.t || 0;
      this.holder.updateMatrix(); this.gInner.updateMatrix();
      _m.multiplyMatrices(this.holder.matrix, this.gInner.matrix);
      const fret = _v1.set(78 + Math.sin(t * 0.21) * 14, 0, 9).applyMatrix4(_m);
      this.ik(this.armB, fret.clone(), V(-0.2, -1, -1));
      const strum = _v1.set(0, -4 + Math.sin(t * 0.9) * 10, 12).applyMatrix4(_m);
      this.ik(this.armF, strum.clone(), V(-1, -0.5, 0.7));
    } else {
      this.armB.a.rotation.set(0, 0, p.sb + p.lean); this.armB.b.rotation.set(0, 0, p.eb);
      this.armF.a.rotation.set(0, 0, p.sf + p.lean); this.armF.b.rotation.set(0, 0, p.ef);
    }
    this.horns.visible = !!o.horns;
    if (this.hammer) this.hammer.visible = o.weapon === 'hammer';
    // face
    const ex = o.ex || {}, open = clamp(ex.mouth || 0, 0, 1);
    if (this.smirk) { const shout = open > 0.15; this.smirk.visible = !shout; this.mouth.visible = shout; }
    const my = 0.22 + open * 0.85;
    this.mouth.scale.set(0.42, my, 1.15);
    this.teeth.visible = open > 0.2; this.teeth.position.y = this.mouth.position.y + my * 6;
    const eyeY = ex.ko || ex.hurt || ex.blink ? 0.12 : this.eyeBase;
    for (const e of this.eyes) e.scale.y = eyeY;
    for (const b of this.brows) { const s = b.userData.s; b.rotation.x = ex.angry ? -s * 0.38 : ex.hurt ? s * 0.32 : s * 0.1; }
    this.root.updateMatrixWorld(true);
  }
  guitarTip(out) { return this.tip.getWorldPosition(out); }
  ik(chain, T, pole) {
    const S = chain.a.position, a = chain.lenA, b = chain.lenB;
    const dir = _v2.subVectors(T, S); const dist = clamp(dir.length(), 1, a + b - 0.5); dir.normalize();
    const A = Math.acos(clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1));
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const E = _v3.copy(S).addScaledVector(dir, Math.cos(A) * a).addScaledVector(pole, Math.sin(A) * a);
    const Hn = T.copy(S).addScaledVector(dir, dist);
    chain.a.quaternion.setFromUnitVectors(DOWN, _v1.subVectors(E, S).normalize());
    _v1.subVectors(Hn, E).normalize().applyQuaternion(_q.copy(chain.a.quaternion).invert());
    chain.b.quaternion.setFromUnitVectors(DOWN, _v1);
  }
}
