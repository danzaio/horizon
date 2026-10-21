import * as THREE from 'three';
import { TILE_FACE, RENDER, RENDER_CROSS, TINT, TINT_GRASS, TINT_FOLIAGE, EMIT, CUTOUT } from '../shared/blocks.js';
import { UNIFORMS, NOISE, TONEMAP_FN, OUTPUT } from './shaders/common.js';

// First-person held block: a small convex cube (or flat sprite for plants) parented to the camera. Convex => no depth test needed,
// so it never clips into terrain. Uses the world's texture array + lighting uniforms so it matches the scene in every quality tier.

// face corners (u0v0, u1v0, u1v1, u0v1), CCW seen from outside; face order matches blocks.js (+X -X +Y -Y +Z -Z)
const FACES = [
  [[.5, -.5, .5], [.5, -.5, -.5], [.5, .5, -.5], [.5, .5, .5], [1, 0, 0]],
  [[-.5, -.5, -.5], [-.5, -.5, .5], [-.5, .5, .5], [-.5, .5, -.5], [-1, 0, 0]],
  [[-.5, .5, .5], [.5, .5, .5], [.5, .5, -.5], [-.5, .5, -.5], [0, 1, 0]],
  [[-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5], [0, -1, 0]],
  [[-.5, -.5, .5], [.5, -.5, .5], [.5, .5, .5], [-.5, .5, .5], [0, 0, 1]],
  [[.5, -.5, -.5], [-.5, -.5, -.5], [-.5, .5, -.5], [.5, .5, -.5], [0, 0, -1]],
];
const UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
const FACE_SHADE = [0.82, 0.82, 1.0, 0.52, 0.9, 0.9];

const VS = /* glsl */`
attribute vec3 aN;
attribute vec2 aUv;
attribute float aLayer;
varying vec2 vUv;
flat varying float vLayer;
varying vec3 vNW;
void main(){
  vUv = aUv; vLayer = aLayer;
  vec3 nv = normalize(normalMatrix * aN);
  vNW = nv * mat3(viewMatrix); // view -> world (rotation only)
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FS = /* glsl */`
${UNIFORMS}
${NOISE}
${TONEMAP_FN}
uniform sampler2DArray uTiles;
uniform vec3 uHandTint;
uniform vec4 uHandP; // x local ambient light 0..1, y cutout, z emissive, w sun visibility 0..1
varying vec2 vUv;
flat varying float vLayer;
varying vec3 vNW;
void main(){
  vec4 t = texture(uTiles, vec3(vUv, vLayer));
  if (uHandP.y > 0.5 && t.a < 0.45) discard;
  vec3 albedo = srgb2lin(t.rgb * mix(vec3(1.0), uHandTint, mix(t.a, 1.0, uHandP.y)));
  vec3 n = normalize(vNW);
  float ndl = max(dot(n, uKeyDir), 0.0);
  float sh = 0.55 + 0.45 * (n.y * 0.5 + 0.5);
  float wet = 1.0 - 0.24 * uWeather.x;
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5) * (uHandP.x * uHandP.x * (1.6 - 0.6 * uHandP.x)) * sh;
  vec3 sun = uKeyColor * ndl * uHandP.w * smoothstep(0.4, 0.9, uHandP.x) * (1.0 - 0.86 * uWeather.x);
  vec3 held = uHeld.rgb * 0.55 * (1.0 - 0.85 * uHandP.x * (1.0 - uSkyP.x));
  vec3 col = albedo * wet * (amb + sun + held + vec3(0.02, 0.022, 0.03)) + albedo * vec3(0.7, 0.78, 1.0) * uWeather.y * 0.5;
  col = mix(col, albedo * 2.0, uHandP.z);
  float outAlpha = 1.0;
  ${OUTPUT}
}`;

function buildCube(id) {
  const pos = [], nrm = [], uv = [], lay = [], idx = [];
  for (let f = 0; f < 6; f++) {
    const F = FACES[f], base = pos.length / 3;
    for (let c = 0; c < 4; c++) { pos.push(...F[c]); nrm.push(...F[4]); uv.push(...UV[c]); lay.push(TILE_FACE[id * 6 + f]); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return mk(pos, nrm, uv, lay, idx);
}
function buildSprite(id) {
  const L = TILE_FACE[id * 6];
  return mk([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 0, 1, 0, 1, 1, 0, 1], [L, L, L, L], [0, 1, 2, 0, 2, 3]);
}
function mk(pos, nrm, uv, lay, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aN', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aUv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(lay, 1));
  g.setIndex(idx);
  return g;
}

// ---- items (G): held models built from coloured cuboids (pixel units, grip at the origin, forward = -Z, up = +Y) ----
// box: [x0,y0,z0,x1,y1,z1,[r,g,b],part]  part: 0 static, 1 pulled back by uAnim.x (bow string), 2 emissive, 3 pulsing emissive, 4 flame (scaled by uAnim.z)
const IVS = /* glsl */`
attribute vec3 aN; attribute vec3 aC; attribute float aPart;
uniform vec4 uAnim;   // x charge 0..1, y time, z flame 0..1
varying vec3 vC; varying vec3 vNW; varying float vE;
void main(){
  vec3 p = position; vE = 0.0;
  if (aPart > 0.5) {
    if (aPart < 1.5) p.z += uAnim.x * 7.0;
    else if (aPart < 2.5) vE = 1.0;
    else if (aPart < 3.5) vE = 0.55 + 0.45 * sin(uAnim.y * 7.0);
    else { p.y *= uAnim.z * (0.85 + 0.15 * sin(uAnim.y * 40.0)); vE = 1.0; }
  }
  vC = aC;
  vNW = normalize(normalMatrix * aN) * mat3(viewMatrix);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const IFS = /* glsl */`
${UNIFORMS}
${NOISE}
${TONEMAP_FN}
uniform vec4 uHandP;
varying vec3 vC; varying vec3 vNW; varying float vE;
void main(){
  vec3 albedo = srgb2lin(vC);
  vec3 n = normalize(vNW);
  float ndl = max(dot(n, uKeyDir), 0.0);
  float sh = 0.55 + 0.45 * (n.y * 0.5 + 0.5);
  float wet = 1.0 - 0.24 * uWeather.x;
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5) * (uHandP.x * uHandP.x * (1.6 - 0.6 * uHandP.x)) * sh;
  vec3 sun = uKeyColor * ndl * uHandP.w * smoothstep(0.4, 0.9, uHandP.x) * (1.0 - 0.86 * uWeather.x);
  vec3 held = uHeld.rgb * 0.55 * (1.0 - 0.85 * uHandP.x * (1.0 - uSkyP.x));
  vec3 col = albedo * wet * (amb + sun + held + vec3(0.03, 0.033, 0.045));
  col = mix(col, albedo * 2.4, vE);
  float outAlpha = 1.0;
  ${OUTPUT}
}`;
const ICORN = [[[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]];
const IFACE = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]], ISHADE = [0.84, 0.84, 1.0, 0.6, 0.92, 0.92];
function buildBoxModel(boxes) {
  const pos = [], nrm = [], col = [], part = [], idx = [];
  for (const [x0, y0, z0, x1, y1, z1, c, pt = 0] of boxes) {
    for (let f = 0; f < 6; f++) {
      const base = pos.length / 3, sh = pt >= 2 ? 1 : ISHADE[f];
      for (const q of ICORN[f]) { pos.push(q[0] ? x1 : x0, q[1] ? y1 : y0, q[2] ? z1 : z0); nrm.push(...IFACE[f]); col.push(c[0] * sh / 255, c[1] * sh / 255, c[2] * sh / 255); part.push(pt); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aN', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aC', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1)); g.setIndex(idx);
  return g;
}

export class Hand {
  /** @param {object} shared global uniforms (GameRenderer.shared) @param {THREE.DataArrayTexture} tiles */
  constructor(shared, tiles) {
    this.uTint = { value: new THREE.Vector3(1, 1, 1) };
    this.uP = { value: new THREE.Vector4(1, 0, 0, 1) };
    this.material = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uTiles: { value: tiles }, uHandTint: this.uTint, uHandP: this.uP }, shared),
      vertexShader: VS, fragmentShader: FS, side: THREE.FrontSide, depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true, transparent: true, blending: THREE.NoBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 100; this.mesh.visible = false;
    this.root = new THREE.Group(); this.root.add(this.mesh);
    // held items (coloured cuboid models, registered by the items feature)
    this.uAnim = { value: new THREE.Vector4(0, 0, 0, 0) };
    this.itemMaterial = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uHandP: this.uP, uAnim: this.uAnim }, shared),
      vertexShader: IVS, fragmentShader: IFS, side: THREE.FrontSide, depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true, transparent: true, blending: THREE.NoBlending,
    });
    this.itemMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.itemMaterial);
    this.itemMesh.frustumCulled = false; this.itemMesh.renderOrder = 100; this.itemMesh.visible = false;
    this.root.add(this.itemMesh);
    this.items = new Map(); this.itemSpec = null; this._postDefs = {};
    this.geoms = new Map(); this.grassTint = [0.5, 0.74, 0.31]; this.foliageTint = [0.36, 0.61, 0.2];
    this.id = 0; this.pending = 0; this.dip = 0; this.swingT = 1; this.breaking = false; this.phase = 0; this.t = 0; this.speed = 0; this.light = 1; this.lightTarget = 1; this.sun = 1;
  }

  /** Material compile flags follow the renderer (NO_POST when materials tonemap themselves). */
  setPost(post) {
    const d = post ? {} : { NO_POST: 1 };
    if (Object.keys(this.material.defines || {}).length !== Object.keys(d).length) { this.material.defines = d; this.material.needsUpdate = true; }
    if (Object.keys(this.itemMaterial.defines || {}).length !== Object.keys(d).length) { this.itemMaterial.defines = Object.assign({}, d); this.itemMaterial.needsUpdate = true; }
  }

  /**
   * Register a held item model (items feature). spec: { boxes, scale (camera units per pixel), pos:[x,y,z], rot:[x,y,z], swing:'slash'|'thrust'|'throw'|'none' }.
   * Geometry is built on first use.
   */
  registerItem(id, spec) { this.items.set(id, { spec, geo: null }); }
  /** Animation inputs for the item in hand: charge 0..1 (bow draw), flame 0..1 (jetpack). */
  setItemAnim(charge, flame) { this.uAnim.value.x = charge; this.uAnim.value.z = flame; }

  /** Planet palette (sRGB bytes) for tinted blocks; null = stock world. Re-applies to the block currently in hand. */
  setPlanetTint(pal) {
    this.grassTint = pal && pal.grass ? pal.grass.map((v) => v / 255) : [0.5, 0.74, 0.31];
    this.foliageTint = pal && pal.foliage ? pal.foliage.map((v) => v / 255) : [0.36, 0.61, 0.2];
    if (typeof this.id === 'number' && this.id) this._apply(this.id);
  }

  /** Select the displayed block (number) or item (string id); 0 / null = nothing. Plays a lower/raise animation when it changes. */
  setBlock(id) { if (id == null) id = 0; if (id !== this.pending) { this.pending = id; this.dip = Math.max(this.dip, 0.001); } }
  /** One punch (place / break). */
  swing() { if (this.swingT >= 0.6) this.swingT = 0; }
  /** Continuous mining swing while the break button is held on a target. */
  setBreaking(on) { this.breaking = on; }
  /** Local light 0..1 (sky exposure at the player) and sun visibility. */
  setLight(light, sun = 1) { this.lightTarget = light; this.sun = sun; }

  _apply(id) {
    this.id = id; this.itemSpec = null; this.itemMesh.visible = false;
    if (typeof id === 'string') {
      const it = this.items.get(id); this.mesh.visible = false;
      if (!it) return;
      if (!it.geo) { try { it.geo = buildBoxModel(it.spec.boxes); } catch (e) { console.warn('[HZ] item model failed:', id, e); it.geo = new THREE.BufferGeometry(); } }
      this.itemMesh.geometry = it.geo; this.itemMesh.visible = true; this.itemSpec = it.spec; this.sprite = false;
      return;
    }
    if (!id || RENDER[id] === 0) { this.mesh.visible = false; return; }
    let g = this.geoms.get(id);
    if (!g) { g = RENDER[id] === RENDER_CROSS ? buildSprite(id) : buildCube(id); this.geoms.set(id, g); }
    this.mesh.geometry = g; this.mesh.visible = true;
    const tint = TINT[id];
    this.uTint.value.set(...(tint === TINT_GRASS ? this.grassTint : tint === TINT_FOLIAGE ? this.foliageTint : [1, 1, 1]));
    this.uP.value.y = CUTOUT[id] ? 1 : 0; this.uP.value.z = EMIT[id] > 0 ? 1 : 0;
    this.sprite = RENDER[id] === RENDER_CROSS;
    this.material.side = this.sprite ? THREE.DoubleSide : THREE.FrontSide;
  }

  /** @param {number} dt @param {{speed?:number, sprint?:boolean, air?:boolean, swimming?:boolean}} m  speed 0..1 of max walking speed */
  update(dt, m = {}) {
    this.t += dt;
    // switching animation: dip down, swap, come back up
    if (this.pending !== this.id || this.dip > 0) {
      if (this.pending !== this.id) { this.dip += dt * 7; if (this.dip >= 1) { this._apply(this.pending); this.dip = 1; this._rising = true; } }
      else { this.dip -= dt * 6; if (this.dip <= 0) { this.dip = 0; this._rising = false; } }
    }
    const sp = Math.min(1, m.speed || 0);
    this.speed += (sp - this.speed) * Math.min(1, dt * 8);
    this.phase += dt * (6 + 4 * (m.sprint ? 1 : 0)) * this.speed;
    this.light += (this.lightTarget - this.light) * Math.min(1, dt * 4);
    this.uP.value.x = this.light; this.uP.value.w = this.sun;
    // swing curve
    let sw = 0;
    if (this.swingT < 1) { this.swingT = Math.min(1, this.swingT + dt / 0.28); sw = Math.sin(this.swingT * Math.PI); }
    else if (this.breaking) { sw = 0.5 + 0.5 * Math.sin(this.t * 13); }
    const bob = this.speed * (m.air ? 0 : 1);
    const r = this.root, dip = this.dip * this.dip * (3 - 2 * this.dip);
    const bx = Math.cos(this.phase) * 0.012 * bob, by = Math.abs(Math.sin(this.phase)) * 0.018 * bob;
    const idle = Math.sin(this.t * 1.7) * 0.0035;
    this.uAnim.value.y = this.t;
    const isp = this.itemSpec;
    if (isp) { // held item: pose from the spec + a swing style
      const ps = isp.pos || [0.28, -0.24, -0.5], pr = isp.rot || [0.2, -0.5, 0];
      let px = ps[0] + bx, py = ps[1] + by + idle - dip * 0.4, pz = ps[2], rx = pr[0] + (m.sprint ? 0.1 : 0), ry = pr[1], rz = pr[2] + bx * 2;
      switch (isp.swing) {
        case 'slash': rx -= sw * 1.5; rz += sw * 0.7; px -= sw * 0.14; pz -= sw * 0.1; py += sw * 0.04; break;
        case 'thrust': pz -= sw * 0.16; rx -= sw * 0.18; break;
        case 'throw': rx -= sw * 1.0; py += sw * 0.07; pz -= sw * 0.12; break;
        default: pz -= sw * 0.05;
      }
      r.position.set(px, py, pz); r.rotation.set(rx, ry, rz); r.scale.setScalar(isp.scale || 0.022);
      return;
    }
    const s = this.sprite ? 0.22 : 0.15;
    r.position.set(0.215 + bx - sw * 0.07, -0.19 + by + idle - dip * 0.34 + sw * 0.03, -0.5 - sw * 0.09);
    r.rotation.set(0.42 - sw * 0.9 + (m.sprint ? 0.12 : 0), -0.7 + sw * 0.25, 0.02 + bx * 2);
    r.scale.setScalar(s);
    if (this.sprite) { r.rotation.y = -0.35; r.rotation.x = 0.15 - sw * 0.7; }
  }
}
