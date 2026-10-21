import * as THREE from 'three';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const TILT = 0.38;
const _m4 = new THREE.Matrix4(), _axis = new THREE.Vector3(0, -Math.sin(TILT), Math.cos(TILT));
// Sky palette. DEFAULT_LOOK is the stock sky; planets replace it through TimeOfDay.setLook (see GameRenderer.setPlanetLook).
const DEFAULT_LOOK = {
  zenN: [0.004, 0.008, 0.026], zenD: [0.07, 0.24, 0.62], zenTw: [0.10 * 0.7, 0.08 * 0.4, 0.16 * 0.5], horN: [0.012, 0.022, 0.05], horD: [0.50, 0.68, 0.92], dusk: [1.0, 0.46, 0.24],
  glowLow: [1.0, 0.42, 0.14], glowDay: [1.0, 0.86, 0.62], keyLow: [1.0, 0.5, 0.2], keyDay: [1.0, 0.94, 0.84],
  ambSky: [1, 1, 1], ambGround: [1, 1, 1], water: [1, 1, 1], moons: null, sun2: 0,
};
const cl = (x, a, b) => (x < a ? a : x > b ? b : x);
/** Derive a full sky palette from a profile's sky block (display-linear colours). */
export function lookFromSky(sky, waterRGB) {
  const D = DEFAULT_LOOK, z = sky.zenith, h = sky.horizon, du = sky.dusk, su = sky.sun;
  const ratio = (c, d) => { const mc = Math.max(...c), md = Math.max(...d); return c.map((v, i) => cl((v / mc) / (d[i] / md), 0.3, 2.2)); };
  const zr = ratio(z, D.zenD), hr = ratio(h, D.horD);
  const mixv = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  return {
    zenD: z, zenN: z.map((v, i) => v * [0.057, 0.034, 0.042][i] + 0.002), zenTw: du.map((v, i) => v * [0.07, 0.03, 0.04][i]),
    horD: h, horN: h.map((v, i) => v * [0.024, 0.032, 0.054][i] + 0.003), dusk: du,
    glowDay: su, glowLow: [du[0], du[1] * 0.9, du[2] * 0.6], keyDay: mixv(su, [1, 1, 1], 0.5), keyLow: [du[0], du[1] * 1.05, du[2] * 0.8],
    ambSky: mixv([1, 1, 1], zr, 0.6), ambGround: mixv([1, 1, 1], hr, 0.5),
    water: waterRGB ? waterRGB.map((v, i) => cl(v / [60, 120, 215][i], 0.25, 2.5)) : [1, 1, 1],
  };
}

/** Day/night cycle. All derived colours are plain Vector3 objects referenced directly by the shared shader uniforms. */
export class TimeOfDay {
  constructor() {
    this.hours = 9; this.speed = 0.02; this.paused = false; this.day = 0;
    this.sunDir = new THREE.Vector3(); this.moonDir = new THREE.Vector3(); this.keyDir = new THREE.Vector3(0, 1, 0);
    this.keyColor = new THREE.Vector3(); this.ambSky = new THREE.Vector3(); this.ambGround = new THREE.Vector3();
    this.zenith = new THREE.Vector3(); this.horizon = new THREE.Vector3(); this.sunGlow = new THREE.Vector3();
    this.waterFog = new THREE.Vector3(); this.starRot = new THREE.Matrix3();
    this.skyP = new THREE.Vector4(0, 1, 1, 1); // night, skyGain, exposure, sunUp
    this.look = DEFAULT_LOOK; this.sun2Dir = new THREE.Vector4(0, 1, 0, 0); this.moonA = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()]; this.moonSpec = [];
    this._h = -1; this.isNight = false; this.sunUp = 1; this.dayAmt = 1; this.shadowStrength = 1; this.cloudLit = 1;
    this.compute();
  }
  /**
   * Planet sky: palette + moons + second sun. `null` restores the stock sky.
   * @param {object|null} look result of lookFromSky() extended with `moons:[{size}]` and `sun2:number` (disc scale, 0 = none)
   */
  setLook(look) { this.look = look ? Object.assign({}, DEFAULT_LOOK, look) : DEFAULT_LOOK; this.moonSpec = (this.look.moons || []).slice(0, 3); this._h = -1; this.compute(); }
  /** @param {number} h hours 0..24 */
  set(h) { this.hours = ((h % 24) + 24) % 24; this.compute(); }
  /** @param {number} dt seconds */
  update(dt) {
    if (!this.paused) {
      this.hours += dt * this.speed;
      if (this.hours >= 24) { this.hours -= 24; this.day++; }
    }
    if (this.hours < 0 || this.hours >= 24) this.hours = ((this.hours % 24) + 24) % 24; // external writes (GAME sets .hours directly)
    if (this.hours !== this._h) { this._h = this.hours; this.compute(); }
  }
  compute() {
    const ang = ((this.hours - 6) / 24) * Math.PI * 2, c = Math.cos(TILT), s = Math.sin(TILT);
    this.sunDir.set(Math.cos(ang), Math.sin(ang) * c, Math.sin(ang) * s).normalize();
    const mang = ang + Math.PI + Math.sin(this.day * 0.9 + this.hours * 0.01) * 0.5;
    this.moonDir.set(Math.cos(mang), Math.sin(mang) * c, Math.sin(mang) * s).normalize();
    const e = this.sunDir.y;
    const dayA = smooth(-0.1, 0.24, e), tw = Math.exp(-Math.pow(e / 0.17, 2)), night = 1 - smooth(-0.22, 0.04, e);
    const sunUp = smooth(-0.07, 0.05, e), low = 1 - smooth(0.0, 0.5, e);
    this.dayAmt = dayA; this.sunUp = sunUp; this.isNight = e < -0.08;
    const L = (o, a, b, t) => o.set(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
    // sky gradient (display-linear)
    const K = this.look;
    L(this.zenith, K.zenN, K.zenD, dayA);
    this.zenith.x += K.zenTw[0] * tw; this.zenith.y += K.zenTw[1] * tw; this.zenith.z += K.zenTw[2] * tw;
    L(this.horizon, K.horN, K.horD, dayA);
    const hh = this.horizon, k = tw * 0.9;
    hh.set(lerp(hh.x, K.dusk[0], k), lerp(hh.y, K.dusk[1], k), lerp(hh.z, K.dusk[2], k));
    L(this.sunGlow, K.glowLow, K.glowDay, smooth(0.0, 0.45, e));
    // key light: sun by day, moon by night
    const sunKey = [lerp(K.keyLow[0], K.keyDay[0], 1 - low), lerp(K.keyLow[1], K.keyDay[1], 1 - low), lerp(K.keyLow[2], K.keyDay[2], 1 - low)], sunI = lerp(1.5, 2.3, 1 - low);
    const w = smooth(-0.08, 0.07, e);
    this.keyColor.set(lerp(0.3 * 0.34, sunKey[0] * sunI, w), lerp(0.42 * 0.34, sunKey[1] * sunI, w), lerp(0.85 * 0.34, sunKey[2] * sunI, w));
    this.keyDir.copy(this.moonDir).lerp(this.sunDir, w).normalize();
    this.shadowStrength = w;
    L(this.ambSky, [0.07, 0.105, 0.21], [0.62, 0.78, 1.06], dayA);
    this.ambSky.x += 0.10 * tw; this.ambSky.y += 0.02 * tw;
    this.ambSky.x *= K.ambSky[0]; this.ambSky.y *= K.ambSky[1]; this.ambSky.z *= K.ambSky[2];
    L(this.ambGround, [0.02, 0.024, 0.04], [0.44, 0.40, 0.33], dayA);
    this.ambGround.x *= K.ambGround[0]; this.ambGround.y *= K.ambGround[1]; this.ambGround.z *= K.ambGround[2];
    // second sun + planet moons (each moon drifts at its own pace along a tilted orbit)
    if (K.sun2) {
      const a2 = ang + 0.5, x2 = Math.cos(a2), y2 = Math.sin(a2) * c, z2 = Math.sin(a2) * s, n2 = Math.hypot(x2, y2, z2);
      this.sun2Dir.set(x2 / n2, y2 / n2, z2 / n2, K.sun2);
    } else this.sun2Dir.w = 0;
    for (let i = 0; i < 3; i++) {
      const sp = this.moonSpec[i], mv = this.moonA[i];
      if (!sp) { mv.set(0, 1, 0, 0); continue; }
      const ma = ang * (0.62 + 0.41 * i) + 1.9 * i + this.day * 0.7, tl = 0.25 + 0.5 * i, cc = Math.cos(tl), ss = Math.sin(tl);
      mv.set(Math.cos(ma), Math.sin(ma) * cc, Math.sin(ma) * ss, sp.size); const n = Math.hypot(mv.x, mv.y, mv.z); mv.x /= n; mv.y /= n; mv.z /= n;
    }
    const exposure = lerp(1.25, 0.33, dayA);
    this.skyP.set(night, 0.9 / exposure, exposure, sunUp);
    const wf = 0.2 + 0.8 * dayA;
    this.waterFog.set(0.03 * wf / exposure * this.look.water[0], 0.22 * wf / exposure * this.look.water[1], 0.30 * wf / exposure * this.look.water[2]);
    _m4.makeRotationAxis(_axis, -ang); this.starRot.setFromMatrix4(_m4);
  }
}
