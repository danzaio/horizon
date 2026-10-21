// Horde monsters: three instanced models (crawler, brute, wasp). Like Mobs.js: boxy cuboid bodies, legs / wings animated in the vertex shader around
// per-vertex pivots, so the CPU writes 8 floats per monster per frame. 3 draw calls however many monsters there are. The titan reuses the brute at 1.9x.
import * as THREE from 'three';
import { UNIFORMS, NOISE, SKY_FN, FOG_FN, LIGHT_FN, TONEMAP_FN, OUTPUT } from '../../render/shaders/common.js';

export const TYPES = [
  { id: 'crawler', name: 'Rastejante', model: 0, r: 0.45, h: 0.8, hp: 8, speed: 5.4, dmg: 3, reach: 1.55, kb: 5, scale: 1, fly: false },
  { id: 'brute', name: 'Bruto', model: 1, r: 0.85, h: 2.0, hp: 46, speed: 3.3, dmg: 8, reach: 2.3, kb: 12, scale: 1, fly: false },
  { id: 'wasp', name: 'Vespa', model: 2, r: 0.4, h: 0.7, hp: 6, speed: 8.5, dmg: 2.5, reach: 2.4, kb: 3, scale: 1, fly: true },
  { id: 'titan', name: 'Titã', model: 1, r: 1.6, h: 3.7, hp: 230, speed: 2.5, dmg: 14, reach: 3.6, kb: 20, scale: 1.9, fly: false },
];

const CH = [58, 28, 72], CH2 = [96, 46, 110], EYE = [255, 70, 60], BELLY = [150, 70, 80], BR = [96, 52, 40], BR2 = [138, 84, 58], WS = [214, 170, 40], WS2 = [40, 34, 30], WING = [190, 220, 255];
// box: [x0,y0,z0,x1,y1,z1,[r,g,b],part]  part: 0 body · 1..4 legs (swing) · 5/6 wings (flap) · 7 emissive (eyes)
const MODELS = [
  { pivots: {}, boxes: [ // crawler: low many-legged bug, 1 unit = 1/16 block
    [-5, 4, -7, 5, 10, 8, CH, 0], [-3.5, 5, -12, 3.5, 10, -7, CH2, 0], [-2.5, 8.5, -11.5, -1, 9.8, -10.5, EYE, 7], [1, 8.5, -11.5, 2.5, 9.8, -10.5, EYE, 7], [-4, 10, -4, 4, 12, 6, CH2, 0], [-3, 3, -5, 3, 4, 6, BELLY, 0],
    [-8, 0, -6, -5, 6, -4, CH2, 1], [5, 0, -6, 8, 6, -4, CH2, 2], [-8, 0, -1, -5, 6, 1, CH2, 3], [5, 0, -1, 8, 6, 1, CH2, 4], [-8, 0, 4, -5, 6, 6, CH2, 2], [5, 0, 4, 8, 6, 6, CH2, 1]] },
  { pivots: {}, boxes: [ // brute: hunched armoured beast
    [-9, 12, -8, 9, 28, 10, BR, 0], [-7, 26, -10, 7, 34, 6, BR2, 0], [-6, 20, -17, 6, 32, -8, BR2, 0], [-4, 29, -17.5, -2, 31, -16.5, EYE, 7], [2, 29, -17.5, 4, 31, -16.5, EYE, 7],
    [-10, 22, -4, -9, 34, 4, CH, 0], [9, 22, -4, 10, 34, 4, CH, 0], [-3, 28, 8, 3, 36, 12, CH2, 0],
    [-9, 0, -7, -4, 12, -2, BR2, 1], [4, 0, -7, 9, 12, -2, BR2, 2], [-9, 0, 3, -4, 12, 8, BR2, 3], [4, 0, 3, 9, 12, 8, BR2, 4]] },
  { pivots: {}, boxes: [ // wasp: flier with a stinger
    [-3, 6, -5, 3, 11, 3, WS, 0], [-2.5, 6.5, 3, 2.5, 10.5, 9, WS2, 0], [-1.5, 6, 9, 1.5, 9, 13, WS, 0], [-2.5, 7, -8, 2.5, 11, -5, WS2, 0], [-2, 9, -8.2, -0.7, 10.2, -7.6, EYE, 7], [0.7, 9, -8.2, 2, 10.2, -7.6, EYE, 7],
    [-12, 11.5, -3, -3, 12.3, 2, WING, 5], [3, 11.5, -3, 12, 12.3, 2, WING, 6], [-1, 3, -3, 1, 6, -1, WS2, 0], [-1, 3, 1, 1, 6, 3, WS2, 0]] },
];
const FACE = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const CORNERS = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];

function build(def) {
  const pos = [], nrm = [], col = [], piv = [], idx = [];
  for (const [x0, y0, z0, x1, y1, z1, c, part] of def.boxes) {
    const pv = part >= 1 && part <= 4 ? [(x0 + x1) / 2, y1, (z0 + z1) / 2] : part === 5 ? [-3, 11.9, -0.5] : part === 6 ? [3, 11.9, -0.5] : [0, 0, 0];
    for (let f = 0; f < 6; f++) {
      const base = pos.length / 3, shade = f === 2 ? 1.0 : f === 3 ? 0.6 : f < 2 ? 0.84 : 0.92;
      for (const q of CORNERS[f]) {
        pos.push((q[0] ? x1 : x0) / 16, (q[1] ? y1 : y0) / 16, (q[2] ? z1 : z0) / 16); nrm.push(...FACE[f]); col.push(c[0] * shade / 255, c[1] * shade / 255, c[2] * shade / 255);
        piv.push(pv[0] / 16, pv[1] / 16, pv[2] / 16, part);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  return { pos, nrm, col, piv, idx };
}

const VS = /* glsl */`
${UNIFORMS}
attribute vec3 aN; attribute vec3 aC; attribute vec4 aPiv;
attribute vec4 iA;   // xyz = position relative to the camera, w = yaw
attribute vec4 iB;   // x walk phase, y move speed 0..1, z scale, w hit flash 0..1
varying vec3 vCol; varying vec3 vN; varying vec3 vRel; varying float vEm; varying float vFlash;
void main(){
  vec3 p = position;
  float part = aPiv.w;
  if (part > 0.5 && part < 4.5) {
    float a = sin(iB.x) * 0.9 * iB.y * ((part < 1.5 || part > 3.5) ? 1.0 : -1.0);
    float cs = cos(a), sn = sin(a); vec3 d = p - aPiv.xyz;
    p = aPiv.xyz + vec3(d.x, d.y * cs - d.z * sn, d.y * sn + d.z * cs);
  } else if (part > 4.5 && part < 6.5) {
    float a = sin(uTime * 42.0 + iB.x * 3.0) * 0.8 * (part < 5.5 ? 1.0 : -1.0);
    float cs = cos(a), sn = sin(a); vec3 d = p - aPiv.xyz;
    p = aPiv.xyz + vec3(d.x * cs - d.y * sn, d.x * sn + d.y * cs, d.z);
  }
  p *= iB.z;
  float s = sin(iA.w), c = cos(iA.w);
  vec3 w = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  vec3 n = vec3(aN.x * c + aN.z * s, aN.y, -aN.x * s + aN.z * c);
  vec3 rel = iA.xyz + w;
  vRel = rel; vN = n; vCol = aC; vEm = part > 6.5 ? 1.0 : 0.0; vFlash = iB.w;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}`;

const FS = /* glsl */`
${UNIFORMS}
${NOISE}
${SKY_FN}
${FOG_FN}
${LIGHT_FN}
${TONEMAP_FN}
varying vec3 vCol; varying vec3 vN; varying vec3 vRel; varying float vEm; varying float vFlash;
void main(){
  FADE_TEST
  vec3 alb = srgb2lin(vCol);
  float ndl = max(dot(vN, uKeyDir), 0.0);
  vec3 col = alb * lightTerm(vN.y, 0.9, ndl, 1.0, 0.0, 1.0, 1.0);
  if (uHeld.a > 0.0) col += alb * heldLight(vRel, vN, 1.0, 1.0);
  col = mix(col, alb * 3.2, vEm);
  col = mix(col, vec3(2.4, 0.9, 0.7), vFlash * 0.75);
  col = applyFog(col, vRel);
  float outAlpha = 1.0;
  ${OUTPUT}
}`;

const MAX = 80;

export class HordeRender {
  /** @param {object} shared GameRenderer.shared uniforms */
  constructor(shared, scene) {
    this.scene = scene;
    this.material = new THREE.ShaderMaterial({ uniforms: Object.assign({}, shared), vertexShader: VS, fragmentShader: FS, side: THREE.FrontSide });
    this.group = new THREE.Group(); this.meshes = []; this.data = []; this.counts = [0, 0, 0]; this._post = null;
    for (let i = 0; i < MODELS.length; i++) {
      const m = build(MODELS[i]), g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3)); g.setAttribute('aN', new THREE.Float32BufferAttribute(m.nrm, 3));
      g.setAttribute('aC', new THREE.Float32BufferAttribute(m.col, 3)); g.setAttribute('aPiv', new THREE.Float32BufferAttribute(m.piv, 4)); g.setIndex(m.idx);
      const a = new Float32Array(MAX * 4), b = new Float32Array(MAX * 4), ia = new THREE.InstancedBufferAttribute(a, 4), ib = new THREE.InstancedBufferAttribute(b, 4);
      ia.setUsage(THREE.DynamicDrawUsage); ib.setUsage(THREE.DynamicDrawUsage); g.setAttribute('iA', ia); g.setAttribute('iB', ib); g.instanceCount = 0;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mesh = new THREE.Mesh(g, this.material); mesh.frustumCulled = false; mesh.visible = false; mesh.matrixAutoUpdate = false;
      this.group.add(mesh); this.meshes.push(mesh); this.data.push({ a, b, ia, ib });
    }
    scene.add(this.group);
  }

  /** @param {Array} list monsters  @param {{x:number,y:number,z:number}} cam */
  update(list, cam, post) {
    if (post !== this._post) { this._post = post; this.material.defines = post ? {} : { NO_POST: 1 }; this.material.needsUpdate = true; }
    const c = this.counts; c[0] = c[1] = c[2] = 0;
    for (let i = 0; i < list.length; i++) {
      const m = list[i], T = TYPES[m.t], mi = T.model, k = c[mi]; if (k >= MAX || m.dead) continue; c[mi]++;
      const d = this.data[mi], o = k * 4;
      d.a[o] = m.x - cam.x; d.a[o + 1] = m.y - cam.y; d.a[o + 2] = m.z - cam.z; d.a[o + 3] = m.yaw;
      d.b[o] = m.phase; d.b[o + 1] = m.moving; d.b[o + 2] = T.scale; d.b[o + 3] = m.flash;
    }
    for (let i = 0; i < 3; i++) { const g = this.meshes[i].geometry; g.instanceCount = c[i]; this.meshes[i].visible = c[i] > 0; if (c[i]) { this.data[i].ia.needsUpdate = true; this.data[i].ib.needsUpdate = true; } }
  }

  dispose() { this.group.removeFromParent(); for (const m of this.meshes) m.geometry.dispose(); this.material.dispose(); }
}
