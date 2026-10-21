// Avatars: every remote player is one instance of a blocky humanoid. ONE InstancedMesh for all bodies (limbs, head pitch, crouch/swim/fly/dead poses
// are animated in the vertex shader around per-vertex pivots) + ONE instanced billboard mesh for the name tags (a shared canvas atlas) = 2 draw calls.
// Shading, fog and tone mapping reuse the engine's GLSL chunks exactly like render/Mobs.js does.
import * as THREE from 'three';
import { UNIFORMS, NOISE, SKY_FN, FOG_FN, LIGHT_FN, TONEMAP_FN, OUTPUT } from '../../render/shaders/common.js';
import { blockColor } from '../../game/blockColors.js';

const MAX = 16, SCALE = 1.8 / 32, SLOT_W = 256, SLOT_H = 40, FAR0 = 120, FAR1 = 165;
const FACE = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const CORNERS = [[[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]];

// box: [x0,y0,z0,x1,y1,z1, material, part]   material: 0 skin 1 shirt(player colour) 2 trousers 3 hair 4 dark 5 held item
//                                             part: 0 body 1 head 2 right arm 3 left arm 4 right leg 5 left leg 6 held item (follows the right arm)
const BOXES = [
  [-4, 12, -2, 4, 24, 2, 1, 0], [-4, 12, -2.05, 4, 13.6, 2.05, 4, 0],
  [-4, 24, -4, 4, 32, 4, 0, 1], [-4.25, 29.4, -4.25, 4.25, 32.25, 4.25, 3, 1], [-4.25, 24.5, 2.6, 4.25, 32.25, 4.25, 3, 1], [-4.25, 27.5, -4.25, -3.4, 32.25, 0, 3, 1], [3.4, 27.5, -4.25, 4.25, 32.25, 0, 3, 1],
  [-3, 26.6, -4.1, -1, 28.2, -3.9, 4, 1], [1, 26.6, -4.1, 3, 28.2, -3.9, 4, 1],
  [4, 12, -2, 8, 24, 2, 1, 2], [4, 12, -2, 8, 15.5, 2, 0, 2],
  [-8, 12, -2, -4, 24, 2, 1, 3], [-8, 12, -2, -4, 15.5, 2, 0, 3],
  [0, 0, -2, 4, 12, 2, 2, 4], [0, 0, -2.1, 4, 2.6, 2.1, 4, 4],
  [-4, 0, -2, 0, 12, 2, 2, 5], [-4, 0, -2.1, 0, 2.6, 2.1, 4, 5],
  [4.6, 6, -9, 8.4, 10, -5, 5, 6],
];
const PIVOT = [[0, 0, 0], [0, 24, 0], [6, 22, 0], [-6, 22, 0], [2, 12, 0], [-2, 12, 0], [6, 22, 0]];

function buildModel() {
  const pos = [], nrm = [], mat = [], piv = [], idx = [];
  for (const [x0, y0, z0, x1, y1, z1, k, part] of BOXES) {
    for (let f = 0; f < 6; f++) {
      const base = pos.length / 3;
      for (const q of CORNERS[f]) { pos.push(q[0] ? x1 : x0, q[1] ? y1 : y0, q[2] ? z1 : z0); nrm.push(...FACE[f]); mat.push(k); piv.push(...PIVOT[part], part); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { pos, nrm, mat, piv, idx };
}

const BODY_VS = /* glsl */`
${UNIFORMS}
attribute vec3 aN; attribute float aK; attribute vec4 aPiv;
attribute vec4 iA;   // xyz = feet position relative to the camera, w = yaw
attribute vec4 iB;   // x walk phase, y walk amount 0..1.4, z head pitch, w dead 0..1
attribute vec4 iC;   // rgb = player colour, a = fade 0..1
attribute vec4 iD;   // rgb = held item colour (black = nothing)
attribute vec4 iE;   // x crouch, y swim, z fly, w fly speed 0..1
varying vec3 vCol; varying vec3 vN; varying vec3 vRel; varying vec3 vLocal; varying float vFade; varying float vEmit;
vec3 rotX(vec3 p, vec3 c, float a){ float cs = cos(a), sn = sin(a); vec3 d = p - c; return c + vec3(d.x, d.y * cs - d.z * sn, d.y * sn + d.z * cs); }
vec3 rotZ(vec3 p, vec3 c, float a){ float cs = cos(a), sn = sin(a); vec3 d = p - c; return c + vec3(d.x * cs - d.y * sn, d.x * sn + d.y * cs, d.z); }
vec3 rotNX(vec3 n, float a){ float cs = cos(a), sn = sin(a); return vec3(n.x, n.y * cs - n.z * sn, n.y * sn + n.z * cs); }
void main(){
  vec3 p = position, n = aN;
  float part = aPiv.w, ph = iB.x, walk = min(iB.y, 1.0);
  float swim = iE.y, fly = iE.z, crouch = iE.x;
  float sw = sin(ph) * (0.85 + 0.55 * swim) * walk;
  float a = 0.0, has = step(0.001, dot(iD.rgb, vec3(1.0)));
  if (part > 5.5 && has < 0.5) p = vec3(0.0);
  if (part > 1.5) {                       // limbs: arm R / item / leg L swing together, opposite to arm L / leg R
    float side = (part < 2.5 || part > 4.5) ? 1.0 : -1.0;
    bool arm = part < 3.5 || part > 5.5;
    a = sw * side;
    if (arm) a += 0.3 * crouch - 0.5 * fly + ((part < 2.5 || part > 5.5) ? 0.4 * has : 0.0);
    else { a = a * (1.0 - 0.6 * fly) + 0.15 * fly; a += sin(ph * 1.7 + part) * 0.4 * swim; }
    p = rotX(p, aPiv.xyz, a); n = rotNX(n, a);
  } else if (part > 0.5) {                // head follows the look pitch
    float hp = clamp(iB.z, -1.2, 1.2) * (1.0 - 0.6 * swim);
    p = rotX(p, aPiv.xyz, hp); n = rotNX(n, hp);
  }
  if (crouch > 0.001 && (part < 3.5 || part > 5.5)) { float c = -0.5 * crouch; p = rotX(p, vec3(0.0, 12.0, 0.0), c); n = rotNX(n, c); }
  float lean = swim * -1.4 + fly * -(0.22 + 0.85 * iE.w);
  if (abs(lean) > 0.001) { p = rotX(p, vec3(0.0, 14.0, 0.0), lean); n = rotNX(n, lean); }
  if (iB.w > 0.001) { float r = 1.55 * iB.w; p = rotZ(p, vec3(0.0, 0.0, 0.0), r); p.y += 4.0 * iB.w; float cs = cos(r), sn = sin(r); n = vec3(n.x * cs - n.y * sn, n.x * sn + n.y * cs, n.z); }
  p *= ${SCALE.toFixed(6)};
  float s = sin(iA.w), c = cos(iA.w);
  vec3 w = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  vec3 nw = vec3(n.x * c + n.z * s, n.y, -n.x * s + n.z * c);
  vec3 rel = iA.xyz + w;
  vec3 col;
  if (aK < 0.5) col = vec3(0.93, 0.74, 0.58);
  else if (aK < 1.5) col = iC.rgb;
  else if (aK < 2.5) col = iC.rgb * 0.42 + vec3(0.05, 0.07, 0.17);
  else if (aK < 3.5) col = iC.rgb * 0.3 + vec3(0.03, 0.02, 0.02);
  else if (aK < 4.5) col = vec3(0.07, 0.07, 0.1);
  else col = iD.rgb;
  vCol = col; vEmit = aK > 4.5 ? 1.0 : 0.0; vFade = iC.a;
  vRel = rel; vN = nw; vLocal = position;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}`;

const BODY_FS = /* glsl */`
${UNIFORMS}
${NOISE}
${SKY_FN}
${FOG_FN}
${LIGHT_FN}
${TONEMAP_FN}
varying vec3 vCol; varying vec3 vN; varying vec3 vRel; varying vec3 vLocal; varying float vFade; varying float vEmit;
void main(){
  if (vFade < 0.999 && bayer4(gl_FragCoord.xy) > vFade) discard;
  vec3 grain = floor(vLocal * 2.0 + 0.5);
  vec3 alb = srgb2lin(vCol * (0.94 + 0.12 * hash13(grain)));
  float ao = mix(0.72, 1.0, smoothstep(0.0, 14.0, vLocal.y));
  float ndl = max(dot(vN, uKeyDir), 0.0);
  vec3 col = alb * lightTerm(vN.y, 0.9, ndl, 1.0, 0.0, ao, 1.0);
  if (uHeld.a > 0.0) col += alb * heldLight(vRel, vN, 1.0, ao);
  col += alb * vEmit * 1.6;
  col = applyFog(col, vRel);
  float outAlpha = 1.0;
  ${OUTPUT}
}`;

const TAG_VS = /* glsl */`
${UNIFORMS}
attribute vec4 iA;   // xyz = anchor relative to the camera, w = atlas slot
attribute vec2 iB;   // x fade, y width scale
varying vec2 vUv; varying float vFade;
const float SLOTS = ${MAX}.0;
void main(){
  vec3 v = mat3(viewMatrix) * iA.xyz;
  float dist = length(iA.xyz);
  float s = max(0.25, dist * 0.055); // constant on-screen size; shrinks when close so a nearby player's tag does not cover the view
  v.xy += position.xy * vec2(4.0 * iB.y, 0.625) * s;
  vUv = vec2(position.x + 0.5, 1.0 - (iA.w + 1.0 - (position.y + 0.5)) / SLOTS);
  vFade = iB.x;
  gl_Position = projectionMatrix * vec4(v, 1.0);
}`;

const TAG_FS = /* glsl */`
${UNIFORMS}
${NOISE}
${SKY_FN}
${FOG_FN}
${LIGHT_FN}
${TONEMAP_FN}
uniform sampler2D tNames;
varying vec2 vUv; varying float vFade;
void main(){
  vec4 t = texture2D(tNames, vUv);
  if (t.a < 0.02) discard;
  vec3 col = srgb2lin(t.rgb) * 1.9;
  float outAlpha = t.a * vFade;
  ${OUTPUT}
}`;

const hashColor = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } const hue = ((h >>> 0) % 360) / 360, k = (n) => Math.max(0, Math.min(1, Math.abs(((hue * 6 + n) % 6) - 3) - 1)); return [0.35 + 0.65 * k(0), 0.35 + 0.65 * k(4), 0.35 + 0.65 * k(2)]; };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Avatars {
  /** @param {object} gr GameRenderer */
  constructor(gr) {
    this.gr = gr; this.group = new THREE.Group(); this.group.name = 'net-avatars';
    const m = buildModel(), g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3)); g.setAttribute('aN', new THREE.Float32BufferAttribute(m.nrm, 3));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(m.mat, 1)); g.setAttribute('aPiv', new THREE.Float32BufferAttribute(m.piv, 4)); g.setIndex(m.idx);
    this.d = {}; for (const k of ['iA', 'iB', 'iC', 'iD', 'iE']) { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); this.d[k] = a; }
    g.instanceCount = 0; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.bodyMat = new THREE.ShaderMaterial({ uniforms: Object.assign({}, gr.shared), vertexShader: BODY_VS, fragmentShader: BODY_FS, side: THREE.FrontSide });
    this.body = new THREE.Mesh(g, this.bodyMat); this.body.frustumCulled = false; this.body.matrixAutoUpdate = false;

    // name tags
    this.cv = document.createElement('canvas'); this.cv.width = SLOT_W; this.cv.height = SLOT_H * MAX; this.cx = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv); this.tex.colorSpace = THREE.NoColorSpace; this.tex.minFilter = THREE.LinearFilter; this.tex.generateMipmaps = false;
    const tg = new THREE.InstancedBufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3)); tg.setIndex([0, 1, 2, 0, 2, 3]);
    this.t = {}; this.t.iA = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); this.t.iB = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 2), 2);
    this.t.iA.setUsage(THREE.DynamicDrawUsage); this.t.iB.setUsage(THREE.DynamicDrawUsage);
    tg.setAttribute('iA', this.t.iA); tg.setAttribute('iB', this.t.iB); tg.instanceCount = 0; tg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.tagMat = new THREE.ShaderMaterial({ uniforms: Object.assign({ tNames: { value: this.tex } }, gr.shared), vertexShader: TAG_VS, fragmentShader: TAG_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.tags = new THREE.Mesh(tg, this.tagMat); this.tags.frustumCulled = false; this.tags.matrixAutoUpdate = false; this.tags.renderOrder = 5;
    this.group.add(this.body, this.tags);
    this.slots = new Map(); this.free = Array.from({ length: MAX }, (_, i) => MAX - 1 - i); this.np = null; this.count = 0;
    gr.scene.add(this.group); this._syncPost();
  }

  _syncPost() {
    const np = !this.gr.post; if (np === this.np) return; this.np = np;
    for (const mt of [this.bodyMat, this.tagMat]) { mt.defines = np ? { NO_POST: 1 } : {}; mt.needsUpdate = true; }
  }

  _slot(rp) {
    let s = this.slots.get(rp.id);
    if (!s) { if (!this.free.length) return null; s = { i: this.free.pop(), key: '' }; this.slots.set(rp.id, s); }
    const key = rp.name + '|' + rp.color;
    if (s.key !== key) { s.key = key; this._drawTag(s.i, rp); }
    return s;
  }

  _drawTag(i, rp) {
    const c = this.cx, y = i * SLOT_H;
    c.clearRect(0, y, SLOT_W, SLOT_H);
    c.font = '600 21px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const w = Math.min(SLOT_W - 12, Math.ceil(c.measureText(rp.name).width) + 38), x0 = (SLOT_W - w) / 2;
    c.fillStyle = 'rgba(8,12,28,0.62)'; c.beginPath(); c.roundRect(x0, y + 4, w, SLOT_H - 8, 12); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.28)'; c.lineWidth = 1.5; c.stroke();
    c.fillStyle = rp.color; c.beginPath(); c.arc(x0 + 15, y + SLOT_H / 2, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffffff'; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText(rp.name, x0 + 28, y + SLOT_H / 2 + 1, w - 36);
    this.tex.needsUpdate = true;
  }

  /** @param {number} dt @param {{x:number,y:number,z:number}} cam @param {Map} players */
  update(dt, cam, players) {
    this._syncPost();
    const A = this.d.iA.array, B = this.d.iB.array, C = this.d.iC.array, D = this.d.iD.array, E = this.d.iE.array, TA = this.t.iA.array, TB = this.t.iB.array;
    let n = 0;
    for (const rp of players.values()) {
      if (!rp.hasPos || n >= MAX) continue;
      const rx = rp.pos.x - cam.x, ry = rp.pos.y - cam.y, rz = rp.pos.z - cam.z, dist = Math.hypot(rx, ry, rz);
      if (dist > FAR1) continue;
      const sl = this._slot(rp); if (!sl) continue;
      const fade = 1 - smooth(FAR0, FAR1, dist), o = n * 4;
      A[o] = rx; A[o + 1] = ry; A[o + 2] = rz; A[o + 3] = rp.yaw;
      B[o] = rp.phase; B[o + 1] = rp.walk; B[o + 2] = rp.pitch; B[o + 3] = rp.deadT;
      if (rp._col !== rp.color) { rp._col = rp.color; const h = parseInt(rp.color.slice(1), 16); rp._rgb = [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; }
      C[o] = rp._rgb[0]; C[o + 1] = rp._rgb[1]; C[o + 2] = rp._rgb[2]; C[o + 3] = fade;
      if (rp._item !== rp.item) { rp._item = rp.item; rp._ic = typeof rp.item === 'number' ? (rp.item > 0 ? blockColor(rp.item) : null) : typeof rp.item === 'string' && rp.item ? hashColor(rp.item) : null; }
      const ic = rp._ic;
      D[o] = ic ? ic[0] : 0; D[o + 1] = ic ? ic[1] : 0; D[o + 2] = ic ? ic[2] : 0; D[o + 3] = 0;
      E[o] = rp.crouch; E[o + 1] = rp.swim; E[o + 2] = rp.fly; E[o + 3] = Math.min(1, Math.hypot(rp.vel.x, rp.vel.z) / 22);
      TA[o] = rx; TA[o + 1] = ry + 2.12 - 0.3 * rp.crouch - 1.45 * rp.deadT - 0.9 * rp.swim; TA[o + 2] = rz; TA[o + 3] = sl.i;
      TB[n * 2] = fade * (rp.deadT > 0.5 ? 0.6 : 1); TB[n * 2 + 1] = 1;
      n++;
    }
    for (const [id, s] of this.slots) if (!players.has(id)) { this.slots.delete(id); this.free.push(s.i); }
    this.count = n;
    this.body.geometry.instanceCount = n; this.tags.geometry.instanceCount = n;
    this.group.visible = n > 0;
    if (n) { for (const k in this.d) this.d[k].needsUpdate = true; this.t.iA.needsUpdate = true; this.t.iB.needsUpdate = true; }
  }

  dispose() {
    this.gr.scene.remove(this.group);
    this.body.geometry.dispose(); this.tags.geometry.dispose(); this.bodyMat.dispose(); this.tagMat.dispose(); this.tex.dispose();
  }
}
