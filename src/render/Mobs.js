import * as THREE from 'three';
import { UNIFORMS, NOISE, SKY_FN, FOG_FN, LIGHT_FN, TONEMAP_FN, OUTPUT } from './shaders/common.js';

// Animals: one InstancedMesh per species (= 4 draw calls however many animals). Bodies are boxy models built from coloured cuboids;
// legs / head are animated in the vertex shader around per-vertex pivots, so the CPU only writes 8 floats per animal per frame.
// Model space: 1 unit = 1 pixel (1/16 block), feet at y=0, centred on x/z, forward = -Z.

export const SPECIES = { PIG: 0, COW: 1, SHEEP: 2, CHICKEN: 3 };
const W = [236, 236, 230], K = [38, 34, 34];

// box: [x0,y0,z0, x1,y1,z1, [r,g,b], part]   part: 0 body, 1..4 legs (diagonal pairs swing together), 5 head (pitches at the neck pivot)
const MODELS = {
  [SPECIES.PIG]: { scale: 1 / 16, pivotHead: [0, 12, -7], boxes: [
    [-5, 6, -7, 5, 15, 9, [238, 152, 162], 0],
    [-4, 8, -15, 4, 16, -7, [240, 160, 170], 5], [-2, 8, -16, 2, 11.5, -15, [252, 182, 190], 5], [-4, 16, -12, -2, 18, -10, [226, 134, 146], 5], [2, 16, -12, 4, 18, -10, [226, 134, 146], 5],
    [-5, 0, -6, -1, 6, -2, [228, 140, 152], 1], [1, 0, -6, 5, 6, -2, [228, 140, 152], 2], [-5, 0, 3, -1, 6, 7, [228, 140, 152], 3], [1, 0, 3, 5, 6, 7, [228, 140, 152], 4],
  ] },
  [SPECIES.COW]: { scale: 1 / 16, pivotHead: [0, 19, -9], boxes: [
    [-6, 10, -9, 6, 22, -2, W, 0], [-6, 10, -2, 6, 22, 5, K, 0], [-6, 10, 5, 6, 22, 11, W, 0], [-4, 21.9, -6, 3, 22.1, 2, K, 0],
    [-4, 16, -16, 4, 25, -9, W, 5], [-4, 16, -16, 4, 20.5, -15.5, [236, 188, 188], 5], [-5, 24, -13, -4, 27, -12, [220, 210, 190], 5], [4, 24, -13, 5, 27, -12, [220, 210, 190], 5],
    [-6, 0, -8, -2, 10, -4, [70, 60, 56], 1], [2, 0, -8, 6, 10, -4, [70, 60, 56], 2], [-6, 0, 6, -2, 10, 10, [70, 60, 56], 3], [2, 0, 6, 6, 10, 10, [70, 60, 56], 4],
  ] },
  [SPECIES.SHEEP]: { scale: 1 / 16, pivotHead: [0, 18, -8], boxes: [
    [-6, 9, -8, 6, 21, 10, [238, 236, 228], 0], [-6.6, 9.6, -7, 6.6, 20.4, 9, [244, 242, 236], 0],
    [-3, 14, -14, 3, 22, -8, [72, 64, 60], 5], [-4, 19, -11, 4, 24, -7, [244, 242, 236], 5],
    [-5, 0, -7, -2, 9, -4, [184, 172, 150], 1], [2, 0, -7, 5, 9, -4, [184, 172, 150], 2], [-5, 0, 5, -2, 9, 8, [184, 172, 150], 3], [2, 0, 5, 5, 9, 8, [184, 172, 150], 4],
  ] },
  [SPECIES.CHICKEN]: { scale: 1 / 16, pivotHead: [0, 11, -3], boxes: [
    [-3, 5, -4, 3, 12, 4, [244, 244, 238], 0], [-4, 6, -3, -3, 11, 3, [226, 226, 220], 0], [3, 6, -3, 4, 11, 3, [226, 226, 220], 0],
    [-2, 11, -7, 2, 17, -3, [246, 246, 240], 5], [-1, 13, -9, 1, 15, -7, [240, 188, 48], 5], [-1, 17, -6, 1, 19, -4, [214, 42, 40], 5], [-1, 10.5, -7.2, 1, 12.5, -7, [214, 42, 40], 5],
    [-2.5, 0, -1, -1.5, 5, 0, [236, 184, 52], 1], [1.5, 0, -1, 2.5, 5, 0, [236, 184, 52], 2],
  ] },
};

const FACE = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const CORNERS = [ // per face: 4 corners as (x?,y?,z?) selectors (0=min,1=max), CCW from outside
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];

function buildModel(def) {
  const pos = [], nrm = [], col = [], piv = [], idx = [];
  for (const [x0, y0, z0, x1, y1, z1, c, part] of def.boxes) {
    // legs rotate about their top centre; the head about the neck pivot
    const pv = part >= 1 && part <= 4 ? [(x0 + x1) / 2, y1, (z0 + z1) / 2] : part === 5 ? def.pivotHead : [0, 0, 0];
    for (let f = 0; f < 6; f++) {
      const base = pos.length / 3, shade = f === 2 ? 1.0 : f === 3 ? 0.62 : f < 2 ? 0.84 : 0.92;
      for (const q of CORNERS[f]) {
        pos.push((q[0] ? x1 : x0) / 16, (q[1] ? y1 : y0) / 16, (q[2] ? z1 : z0) / 16);
        nrm.push(...FACE[f]); col.push(c[0] * shade / 255, c[1] * shade / 255, c[2] * shade / 255);
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
attribute vec4 iB;   // x walk phase, y walk speed 0..1, z graze 0..1, w per-animal random
varying vec3 vCol; varying vec3 vN; varying vec3 vRel; varying vec3 vLocal;
void main(){
  vec3 p = position;
  float part = aPiv.w;
  if (part > 0.5) {
    float a;
    if (part < 4.5) a = sin(iB.x) * 0.8 * iB.y * ((part < 1.5 || part > 3.5) ? 1.0 : -1.0);
    else a = -iB.z * 0.85 + sin(uTime * 1.3 + iB.w * 40.0) * 0.035 + sin(iB.x * 2.0) * 0.05 * iB.y;
    float cs = cos(a), sn = sin(a);
    vec3 d = p - aPiv.xyz;
    p = aPiv.xyz + vec3(d.x, d.y * cs - d.z * sn, d.y * sn + d.z * cs);
  }
  float s = sin(iA.w), c = cos(iA.w);
  vec3 w = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
  vec3 n = vec3(aN.x * c + aN.z * s, aN.y, -aN.x * s + aN.z * c);
  vec3 rel = iA.xyz + w;
  vRel = rel; vN = n; vLocal = position; vCol = aC;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * rel, 1.0);
}`;

const FS = /* glsl */`
${UNIFORMS}
${NOISE}
${SKY_FN}
${FOG_FN}
${LIGHT_FN}
${TONEMAP_FN}
varying vec3 vCol; varying vec3 vN; varying vec3 vRel; varying vec3 vLocal;
void main(){
  FADE_TEST
  vec3 grain = floor(vLocal * 16.0 + 0.5);
  vec3 alb = srgb2lin(vCol * (0.93 + 0.14 * hash13(grain)));
  float ao = mix(0.7, 1.0, smoothstep(0.0, 0.5, vLocal.y));
  float ndl = max(dot(vN, uKeyDir), 0.0);
  vec3 col = alb * lightTerm(vN.y, 0.9, ndl, 1.0, 0.0, ao, 1.0);
  if (uHeld.a > 0.0) col += alb * heldLight(vRel, vN, 1.0, ao);
  col = applyFog(col, vRel);
  float outAlpha = 1.0;
  ${OUTPUT}
}`;

export class Mobs {
  /** @param {object} shared global uniforms @param {number} maxPerSpecies */
  constructor(shared, maxPerSpecies = 64) {
    this.max = maxPerSpecies;
    this.material = new THREE.ShaderMaterial({ uniforms: Object.assign({}, shared), vertexShader: VS, fragmentShader: FS, side: THREE.FrontSide });
    this.group = new THREE.Group();
    this.meshes = []; this.data = [];
    for (let sp = 0; sp < 4; sp++) {
      const m = buildModel(MODELS[sp]), g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
      g.setAttribute('aN', new THREE.Float32BufferAttribute(m.nrm, 3));
      g.setAttribute('aC', new THREE.Float32BufferAttribute(m.col, 3));
      g.setAttribute('aPiv', new THREE.Float32BufferAttribute(m.piv, 4));
      g.setIndex(m.idx);
      const a = new Float32Array(maxPerSpecies * 4), b = new Float32Array(maxPerSpecies * 4);
      const ia = new THREE.InstancedBufferAttribute(a, 4), ib = new THREE.InstancedBufferAttribute(b, 4);
      ia.setUsage(THREE.DynamicDrawUsage); ib.setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('iA', ia); g.setAttribute('iB', ib); g.instanceCount = 0;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
      const mesh = new THREE.Mesh(g, this.material);
      mesh.frustumCulled = false; mesh.visible = false; mesh.matrixAutoUpdate = false;
      this.group.add(mesh); this.meshes.push(mesh); this.data.push({ a, b, ia, ib });
    }
  }

  setPost(post) {
    const d = post ? {} : { NO_POST: 1 };
    if (Object.keys(this.material.defines || {}).length !== Object.keys(d).length) { this.material.defines = d; this.material.needsUpdate = true; }
  }

  /**
   * @param {number} sp species @param {number} i instance index (< count)
   * rx,ry,rz: position relative to the camera (float64 subtracted on the CPU => precise at any world coordinate)
   */
  put(sp, i, rx, ry, rz, yaw, phase, speed, graze, rnd) {
    const d = this.data[sp], o = i * 4;
    d.a[o] = rx; d.a[o + 1] = ry; d.a[o + 2] = rz; d.a[o + 3] = yaw;
    d.b[o] = phase; d.b[o + 1] = speed; d.b[o + 2] = graze; d.b[o + 3] = rnd;
  }
  /** call once per species per frame after the put()s */
  commit(sp, count) {
    const d = this.data[sp], g = this.meshes[sp].geometry;
    g.instanceCount = count; this.meshes[sp].visible = count > 0;
    if (count) { d.ia.needsUpdate = true; d.ib.needsUpdate = true; }
  }
  dispose() { for (const m of this.meshes) m.geometry.dispose(); this.material.dispose(); }
}
