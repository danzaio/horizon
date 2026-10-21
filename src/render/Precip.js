import * as THREE from 'three';
import { UNIFORMS, NOISE, TONEMAP_FN, OUTPUT } from './shaders/common.js';

// Rain streaks (LineSegments) and snow flakes (Points), fully animated in the vertex shader: zero per-frame CPU work except 2 uniforms.
// Particles live in a wrapped box around the camera (world-fixed field, camera-relative wrap), so they never "follow" the player.

const BOX = 52;

const COMMON = /* glsl */`
uniform vec3 uCamMod;   // camera position mod BOX
uniform vec4 uPrecip;   // x intensity 0..1, y time, z fall speed, w wind
uniform float uBox;
attribute vec4 aSeed;
varying float vA;
vec3 wrapRel(vec3 p){ return mod(p - uCamMod + uBox * 0.5, uBox) - uBox * 0.5; }
`;

const RAIN_VS = /* glsl */`
${COMMON}
attribute float aEnd;
void main(){
  float sv = fract(aSeed.x * 17.31 + aSeed.z * 5.17);
  float speed = uPrecip.z * (0.85 + 0.3 * sv);
  vec3 p = aSeed.xyz * uBox;
  p.y -= uPrecip.y * speed;
  p.x += uPrecip.y * uPrecip.w;
  vec3 rel = wrapRel(p);
  vec3 dir = normalize(vec3(uPrecip.w, speed, 0.0));
  float dist = length(rel);
  rel += dir * aEnd * (0.95 + 0.9 * sv);
  float keep = step(aSeed.w, uPrecip.x);
  vA = keep * (1.0 - smoothstep(0.62, 1.0, dist / (uBox * 0.5))) * smoothstep(0.8, 3.0, dist) * (1.0 - 0.7 * aEnd);
  vec4 mv = vec4(mat3(viewMatrix) * rel, 1.0);
  gl_Position = projectionMatrix * mv;
  if (keep < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const SNOW_VS = /* glsl */`
${COMMON}
void main(){
  float sv = fract(aSeed.x * 17.31 + aSeed.z * 5.17);
  float speed = uPrecip.z * (0.7 + 0.6 * sv);
  vec3 p = aSeed.xyz * uBox;
  p.y -= uPrecip.y * speed;
  float ph = uPrecip.y * (0.5 + sv * 0.7) + aSeed.w * 40.0;
  p.x += uPrecip.y * uPrecip.w + sin(ph) * 0.9;
  p.z += cos(ph * 0.83) * 0.9;
  vec3 rel = wrapRel(p);
  float dist = length(rel);
  float keep = step(aSeed.w, uPrecip.x);
  vA = keep * (1.0 - smoothstep(0.55, 1.0, dist / (uBox * 0.5))) * smoothstep(0.6, 2.5, dist);
  vec4 mv = vec4(mat3(viewMatrix) * rel, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((0.09 + 0.07 * sv) * 900.0 / max(-mv.z, 0.5), 1.5, 9.0);
  if (keep < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;

const RAIN_FS = /* glsl */`
${UNIFORMS}
${NOISE}
${TONEMAP_FN}
varying float vA;
void main(){
  vec3 col = (uAmbSky * 1.1 + uKeyColor * 0.08 + vec3(0.06)) * vec3(0.86, 0.93, 1.0) + vec3(0.6, 0.65, 0.95) * uWeather.y;
  float outAlpha = vA * 0.62;
  ${OUTPUT}
}`;

const SNOW_FS = /* glsl */`
${UNIFORMS}
${NOISE}
${TONEMAP_FN}
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.18, d);
  vec3 col = (uAmbSky * 1.25 + uKeyColor * 0.12 + vec3(0.05)) * vec3(0.95, 0.98, 1.0);
  float outAlpha = vA * a * 0.9;
  ${OUTPUT}
}`;

const PETAL_VS = /* glsl */`
uniform vec3 uCamMod; uniform float uBox; uniform vec4 uAmb; // x time, y petals, z fireflies
attribute vec4 aSeed;
varying float vA; varying float vSv;
vec3 wrapRel(vec3 p){ return mod(p - uCamMod + uBox * 0.5, uBox) - uBox * 0.5; }
void main(){
  float sv = fract(aSeed.x * 17.31 + aSeed.z * 5.17); vSv = sv;
  float t = uAmb.x;
  vec3 p = aSeed.xyz * uBox;
  p.y -= t * (0.7 + 0.5 * sv);
  p.x += t * 0.6 + sin(t * (0.8 + sv) + aSeed.w * 30.0) * 1.4;
  p.z += cos(t * (0.7 + sv * 0.6) + aSeed.w * 20.0) * 1.4;
  vec3 rel = wrapRel(p);
  float dist = length(rel);
  float keep = step(aSeed.w, uAmb.y);
  vA = keep * (1.0 - smoothstep(0.5, 1.0, dist / (uBox * 0.5))) * smoothstep(0.8, 2.5, dist);
  vec4 mv = vec4(mat3(viewMatrix) * rel, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp((0.11 + 0.06 * sv) * 900.0 / max(-mv.z, 0.5), 2.5, 12.0);
  if (keep < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const PETAL_FS = /* glsl */`
${UNIFORMS}
${NOISE}
${TONEMAP_FN}
varying float vA; varying float vSv;
void main(){
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.16, length(q * vec2(1.0, 1.35)));
  vec3 col = mix(vec3(1.0, 0.52, 0.72), vec3(1.0, 0.8, 0.88), vSv) * (uAmbSky * 1.5 + uKeyColor * 0.5 + vec3(0.1));
  float outAlpha = vA * a;
  ${OUTPUT}
}`;
const FLY_VS = /* glsl */`
uniform vec3 uCamMod; uniform float uBox; uniform vec4 uAmb;
attribute vec4 aSeed;
varying float vA;
vec3 wrapRel(vec3 p){ return mod(p - uCamMod + uBox * 0.5, uBox) - uBox * 0.5; }
void main(){
  float t = uAmb.x, ph = aSeed.w * 40.0;
  vec3 p = aSeed.xyz * uBox;
  p.x += sin(t * 0.35 + ph) * 2.5 + sin(t * 0.9 + ph * 1.7) * 0.8;
  p.y += sin(t * 0.5 + ph * 1.3) * 1.6;
  p.z += cos(t * 0.4 + ph * 0.7) * 2.5;
  vec3 rel = wrapRel(p);
  rel.y = rel.y * 0.16 - 0.5;                       // squashed into a slab around eye height: fireflies hover near the player
  float dist = length(rel);
  float keep = step(aSeed.w, uAmb.z);
  float pulse = 0.3 + 0.7 * pow(max(0.0, sin(t * (1.3 + aSeed.x * 1.5) + ph)), 3.0);
  vA = keep * pulse * (1.0 - smoothstep(0.35, 0.8, dist / (uBox * 0.5))) * smoothstep(1.0, 3.0, dist);
  vec4 mv = vec4(mat3(viewMatrix) * rel, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.1 * 900.0 / max(-mv.z, 0.5), 2.5, 11.0);
  if (keep < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const FLY_FS = /* glsl */`
${UNIFORMS}
${NOISE}
${TONEMAP_FN}
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = pow(smoothstep(0.5, 0.0, d), 1.6);
  vec3 col = vec3(0.72, 1.0, 0.34) * 2.6;
  float outAlpha = vA * a;
  ${OUTPUT}
}`;

function seeds(n, perVertex) {
  const a = new Float32Array(n * perVertex * 4), pos = new Float32Array(n * perVertex * 3), e = new Float32Array(n * perVertex);
  let s = 12345;
  const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n; i++) {
    const x = r(), y = r(), z = r(), w = r();
    for (let k = 0; k < perVertex; k++) { const o = i * perVertex + k; a.set([x, y, z, w], o * 4); e[o] = k; }
  }
  return { a, pos, e };
}

export class Precip {
  /** @param {object} shared global uniforms (GameRenderer.shared) */
  constructor(shared) {
    this.uCamMod = { value: new THREE.Vector3() }; this.uPrecip = { value: new THREE.Vector4(0, 0, 14, 2) }; this.uBox = { value: BOX };
    this.shared = shared; this.count = 0; this.type = 'rain'; this.t = 0;
    const base = { transparent: true, depthWrite: false, depthTest: true };
    const uni = () => Object.assign({ uCamMod: this.uCamMod, uPrecip: this.uPrecip, uBox: this.uBox }, shared);
    this.rainMat = new THREE.ShaderMaterial(Object.assign({ uniforms: uni(), vertexShader: RAIN_VS, fragmentShader: RAIN_FS }, base));
    this.snowMat = new THREE.ShaderMaterial(Object.assign({ uniforms: uni(), vertexShader: SNOW_VS, fragmentShader: SNOW_FS }, base));
    this.rain = new THREE.LineSegments(new THREE.BufferGeometry(), this.rainMat);
    this.snow = new THREE.Points(new THREE.BufferGeometry(), this.snowMat);
    for (const m of [this.rain, this.snow]) { m.frustumCulled = false; m.renderOrder = 5; m.visible = false; m.matrixAutoUpdate = false; }
    // ambient life: petals (cherry grove, day) and fireflies (night, grassy biomes)
    this.uAmb = { value: new THREE.Vector4(0, 0, 0, 0) }; this.ambT = 0; this.ambTarget = [0, 0]; this.ambCur = [0, 0];
    const au = () => Object.assign({ uCamMod: this.uCamMod, uBox: this.uBox, uAmb: this.uAmb }, shared);
    this.petalMat = new THREE.ShaderMaterial(Object.assign({ uniforms: au(), vertexShader: PETAL_VS, fragmentShader: PETAL_FS }, base));
    this.flyMat = new THREE.ShaderMaterial({ uniforms: au(), vertexShader: FLY_VS, fragmentShader: FLY_FS, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending });
    this.petals = new THREE.Points(new THREE.BufferGeometry(), this.petalMat);
    this.flies = new THREE.Points(new THREE.BufferGeometry(), this.flyMat);
    for (const m of [this.petals, this.flies]) { m.frustumCulled = false; m.renderOrder = 6; m.visible = false; m.matrixAutoUpdate = false; }
    this.group = new THREE.Group(); this.group.add(this.rain, this.snow, this.petals, this.flies);
  }

  setPost(post) {
    for (const m of [this.rainMat, this.snowMat, this.petalMat, this.flyMat]) {
      const d = post ? {} : { NO_POST: 1 };
      if (Object.keys(m.defines || {}).length !== Object.keys(d).length) { m.defines = d; m.needsUpdate = true; }
    }
  }

  /** Number of particles (0 disables). Rebuilds the static geometry only when it changes. */
  setCount(n) {
    n = n | 0; if (n === this.count) return; this.count = n;
    for (const [mesh, per] of [[this.rain, 2], [this.snow, 1]]) {
      mesh.geometry.dispose();
      const g = new THREE.BufferGeometry(); if (n > 0) {
        const s = seeds(n, per);
        g.setAttribute('position', new THREE.BufferAttribute(s.pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(s.a, 4)); g.setAttribute('aEnd', new THREE.BufferAttribute(s.e, 1));
      }
      mesh.geometry = g;
    }
    for (const [mesh, k, cap] of [[this.petals, 0.3, 900], [this.flies, 0.1, 420]]) {
      mesh.geometry.dispose();
      const g = new THREE.BufferGeometry(), c = Math.min(cap, Math.round(n * k));
      if (c > 0) { const sd = seeds(c, 1); g.setAttribute('position', new THREE.BufferAttribute(sd.pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd.a, 4)); }
      mesh.geometry = g; mesh.userData.count = c;
    }
  }

  /** Ambient particle strengths 0..1 (petals, fireflies); eased here. */
  setAmbient(petals, flies) { this.ambTarget[0] = petals; this.ambTarget[1] = flies; }
  updateAmbient(dt, cam) {
    const c = this.ambCur, t = this.ambTarget, k = Math.min(1, dt * 0.8);
    c[0] += (t[0] - c[0]) * k; c[1] += (t[1] - c[1]) * k;
    this.petals.visible = c[0] > 0.01 && this.petals.userData.count > 0; this.flies.visible = c[1] > 0.01 && this.flies.userData.count > 0;
    if (!this.petals.visible && !this.flies.visible) return;
    this.ambT += dt; const u = this.uAmb.value; u.set(this.ambT, c[0], c[1], 0);
    this.uCamMod.value.set(((cam.x % BOX) + BOX) % BOX, ((cam.y % BOX) + BOX) % BOX, ((cam.z % BOX) + BOX) % BOX);
  }

  /** @param {number} dt @param {THREE.Vector3} cam @param {'rain'|'snow'} type @param {number} intensity 0..1 (already roof-attenuated) */
  update(dt, cam, type, intensity) {
    const on = this.count > 0 && intensity > 0.01;
    this.rain.visible = on && type === 'rain'; this.snow.visible = on && type === 'snow';
    if (!on) return;
    this.t += dt;
    const u = this.uPrecip.value;
    u.x = intensity; u.y = this.t;
    if (type === 'rain') { u.z = 15; u.w = 2.2; } else { u.z = 1.9; u.w = 0.7; }
    this.uCamMod.value.set(((cam.x % BOX) + BOX) % BOX, ((cam.y % BOX) + BOX) % BOX, ((cam.z % BOX) + BOX) % BOX);
  }

  dispose() { for (const m of [this.rain, this.snow, this.petals, this.flies]) m.geometry.dispose(); for (const m of [this.rainMat, this.snowMat, this.petalMat, this.flyMat]) m.dispose(); }
}
