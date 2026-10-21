import * as THREE from 'three';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const TILT = 0.38;
const _m4 = new THREE.Matrix4(), _axis = new THREE.Vector3(0, -Math.sin(TILT), Math.cos(TILT));

/** Day/night cycle. All derived colours are plain Vector3 objects referenced directly by the shared shader uniforms. */
export class TimeOfDay {
  constructor() {
    this.hours = 9; this.speed = 0.02; this.paused = false; this.day = 0;
    this.sunDir = new THREE.Vector3(); this.moonDir = new THREE.Vector3(); this.keyDir = new THREE.Vector3(0, 1, 0);
    this.keyColor = new THREE.Vector3(); this.ambSky = new THREE.Vector3(); this.ambGround = new THREE.Vector3();
    this.zenith = new THREE.Vector3(); this.horizon = new THREE.Vector3(); this.sunGlow = new THREE.Vector3();
    this.waterFog = new THREE.Vector3(); this.starRot = new THREE.Matrix3();
    this.skyP = new THREE.Vector4(0, 1, 1, 1); // night, skyGain, exposure, sunUp
    this._h = -1; this.isNight = false; this.sunUp = 1; this.dayAmt = 1; this.shadowStrength = 1; this.cloudLit = 1;
    this.compute();
  }
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
    L(this.zenith, [0.004, 0.008, 0.026], [0.07, 0.24, 0.62], dayA);
    this.zenith.x += 0.10 * tw * 0.7; this.zenith.y += 0.08 * tw * 0.4; this.zenith.z += 0.16 * tw * 0.5;
    L(this.horizon, [0.012, 0.022, 0.05], [0.50, 0.68, 0.92], dayA);
    const hh = this.horizon, k = tw * 0.9;
    hh.set(lerp(hh.x, 1.0, k), lerp(hh.y, 0.46, k), lerp(hh.z, 0.24, k));
    L(this.sunGlow, [1.0, 0.42, 0.14], [1.0, 0.86, 0.62], smooth(0.0, 0.45, e));
    // key light: sun by day, moon by night
    const sunKey = [lerp(1.0, 1.0, 1 - low), lerp(0.5, 0.94, 1 - low), lerp(0.2, 0.84, 1 - low)], sunI = lerp(1.5, 2.3, 1 - low);
    const w = smooth(-0.08, 0.07, e);
    this.keyColor.set(lerp(0.3 * 0.34, sunKey[0] * sunI, w), lerp(0.42 * 0.34, sunKey[1] * sunI, w), lerp(0.85 * 0.34, sunKey[2] * sunI, w));
    this.keyDir.copy(this.moonDir).lerp(this.sunDir, w).normalize();
    this.shadowStrength = w;
    L(this.ambSky, [0.07, 0.105, 0.21], [0.62, 0.78, 1.06], dayA);
    this.ambSky.x += 0.10 * tw; this.ambSky.y += 0.02 * tw;
    L(this.ambGround, [0.02, 0.024, 0.04], [0.44, 0.40, 0.33], dayA);
    const exposure = lerp(1.25, 0.33, dayA);
    this.skyP.set(night, 0.9 / exposure, exposure, sunUp);
    const wf = 0.2 + 0.8 * dayA;
    this.waterFog.set(0.03 * wf / exposure, 0.22 * wf / exposure, 0.30 * wf / exposure);
    _m4.makeRotationAxis(_axis, -ang); this.starRot.setFromMatrix4(_m4);
  }
}
