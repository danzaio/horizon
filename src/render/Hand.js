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
    this.geoms = new Map();
    this.id = 0; this.pending = 0; this.dip = 0; this.swingT = 1; this.breaking = false; this.phase = 0; this.t = 0; this.speed = 0; this.light = 1; this.lightTarget = 1; this.sun = 1;
  }

  /** Material compile flags follow the renderer (NO_POST when materials tonemap themselves). */
  setPost(post) {
    const d = post ? {} : { NO_POST: 1 };
    if (Object.keys(this.material.defines || {}).length !== Object.keys(d).length) { this.material.defines = d; this.material.needsUpdate = true; }
  }

  /** Select the displayed block (0 = nothing). Plays a lower/raise animation when it changes. */
  setBlock(id) { if (id !== this.pending) { this.pending = id; this.dip = Math.max(this.dip, 0.001); } }
  /** One punch (place / break). */
  swing() { if (this.swingT >= 0.6) this.swingT = 0; }
  /** Continuous mining swing while the break button is held on a target. */
  setBreaking(on) { this.breaking = on; }
  /** Local light 0..1 (sky exposure at the player) and sun visibility. */
  setLight(light, sun = 1) { this.lightTarget = light; this.sun = sun; }

  _apply(id) {
    this.id = id;
    if (!id || RENDER[id] === 0) { this.mesh.visible = false; return; }
    let g = this.geoms.get(id);
    if (!g) { g = RENDER[id] === RENDER_CROSS ? buildSprite(id) : buildCube(id); this.geoms.set(id, g); }
    this.mesh.geometry = g; this.mesh.visible = true;
    const tint = TINT[id];
    this.uTint.value.set(...(tint === TINT_GRASS ? [0.5, 0.74, 0.31] : tint === TINT_FOLIAGE ? [0.36, 0.61, 0.2] : [1, 1, 1]));
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
    const s = this.sprite ? 0.22 : 0.15;
    r.position.set(0.215 + bx - sw * 0.07, -0.19 + by + idle - dip * 0.34 + sw * 0.03, -0.5 - sw * 0.09);
    r.rotation.set(0.42 - sw * 0.9 + (m.sprint ? 0.12 : 0), -0.7 + sw * 0.25, 0.02 + bx * 2);
    r.scale.setScalar(s);
    if (this.sprite) { r.rotation.y = -0.35; r.rotation.x = 0.15 - sw * 0.7; }
  }
}
