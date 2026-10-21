// RemotePlayer: a remote avatar's replicated state + snapshot interpolation (render ~110 ms in the past, short extrapolation when starved).
import { Vector3 } from 'three';

export const FLAG = { CROUCH: 1, SWIM: 2, FLY: 4, SPRINT: 8, GROUND: 16 };
const N = 8, STRIDE = 7, DELAY = 110, MAX_EXTRAP = 260, TAU = Math.PI * 2;
const angLerp = (a, b, k) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return a + d * k; };

export class RemotePlayer {
  constructor(id, name, color) {
    this.id = id; this.name = name; this.color = color;
    this.pos = new Vector3(); this.vel = new Vector3(); this.yaw = 0; this.pitch = 0;
    this.hp = 20; this.team = null; this.item = null; this.alive = true; this.ping = 0; this.extra = {};
    this.flags = 0; this.hasPos = false;
    // animation state driven by the renderer
    this.crouch = 0; this.swim = 0; this.fly = 0; this.phase = 0; this.walk = 0; this.fade = 1; this.deadT = 0;
    this._t = new Float64Array(N); this._v = new Float64Array(N * STRIDE); this._n = 0; this._h = 0;
    this._lx = 0; this._ly = 0; this._lz = 0; this._tag = -1;
  }

  /** Store a received sample (receive time in ms, position, look, flags). */
  push(t, x, y, z, yaw, pitch, flags) {
    const i = this._h; this._h = (i + 1) % N; if (this._n < N) this._n++;
    this._t[i] = t; const o = i * STRIDE, v = this._v;
    v[o] = x; v[o + 1] = y; v[o + 2] = z; v[o + 3] = yaw; v[o + 4] = pitch; v[o + 5] = flags;
    this.flags = flags;
    if (!this.hasPos) { this.hasPos = true; this.pos.set(x, y, z); this.yaw = yaw; this.pitch = pitch; this._lx = x; this._ly = y; this._lz = z; }
  }
  _idx(k) { return (this._h - 1 - k + N * 2) % N; }   // k = 0 newest

  /** Advance the smoothed state to `now`. No allocations. */
  update(now, dt) {
    if (!this.hasPos) return;
    const rt = now - DELAY, n = this._n, v = this._v;
    let x, y, z, yaw, pitch;
    const i0 = this._idx(0), t0 = this._t[i0];
    if (rt >= t0) {                           // starved: extrapolate along the last velocity, briefly
      const o = i0 * STRIDE; x = v[o]; y = v[o + 1]; z = v[o + 2]; yaw = v[o + 3]; pitch = v[o + 4];
      if (n > 1) {
        const i1 = this._idx(1), o1 = i1 * STRIDE, dtt = Math.max(1, t0 - this._t[i1]), e = Math.min(rt - t0, MAX_EXTRAP) / dtt;
        const ex = (x - v[o1]) * e, ey = (y - v[o1 + 1]) * e, ez = (z - v[o1 + 2]) * e;
        if (Math.abs(ex) + Math.abs(ez) < 6) { x += ex; z += ez; if (!(this.flags & FLAG.GROUND)) y += ey; }
      }
    } else {
      let k = 1; while (k < n && this._t[this._idx(k)] > rt) k++;
      if (k >= n) { const o = this._idx(n - 1) * STRIDE; x = v[o]; y = v[o + 1]; z = v[o + 2]; yaw = v[o + 3]; pitch = v[o + 4]; }
      else {
        const ia = this._idx(k), ib = this._idx(k - 1), oa = ia * STRIDE, ob = ib * STRIDE, ta = this._t[ia], f = Math.min(1, Math.max(0, (rt - ta) / Math.max(1, this._t[ib] - ta)));
        x = v[oa] + (v[ob] - v[oa]) * f; y = v[oa + 1] + (v[ob + 1] - v[oa + 1]) * f; z = v[oa + 2] + (v[ob + 2] - v[oa + 2]) * f;
        yaw = angLerp(v[oa + 3], v[ob + 3], f); pitch = v[oa + 4] + (v[ob + 4] - v[oa + 4]) * f;
      }
    }
    const jump = Math.abs(x - this.pos.x) + Math.abs(z - this.pos.z) > 24;      // teleport / respawn: snap instead of gliding across the map
    const k = jump ? 1 : Math.min(1, dt * 30);
    const px = this.pos.x, py = this.pos.y, pz = this.pos.z;
    this.pos.x += (x - px) * k; this.pos.y += (y - py) * k; this.pos.z += (z - pz) * k;
    this.yaw = angLerp(this.yaw, yaw, Math.min(1, dt * 24)); this.pitch += (pitch - this.pitch) * Math.min(1, dt * 24);
    if (dt > 0) { const s = Math.min(1, dt * 12); this.vel.x += ((this.pos.x - px) / dt - this.vel.x) * s; this.vel.y += ((this.pos.y - py) / dt - this.vel.y) * s; this.vel.z += ((this.pos.z - pz) / dt - this.vel.z) * s; }
    if (jump) this.vel.set(0, 0, 0);
    // pose blends + walk cycle
    const f = this.flags, a = Math.min(1, dt * 10);
    this.crouch += (((f & FLAG.CROUCH) ? 1 : 0) - this.crouch) * a;
    this.swim += (((f & FLAG.SWIM) && !(f & FLAG.FLY) ? 1 : 0) - this.swim) * a;
    this.fly += (((f & FLAG.FLY) ? 1 : 0) - this.fly) * a;
    const sp = Math.hypot(this.vel.x, this.vel.z), target = (f & FLAG.GROUND) || this.swim > 0.5 ? Math.min(1.4, sp / 5) : 0;
    this.walk += (target - this.walk) * Math.min(1, dt * 8);
    this.phase += dt * (3 + sp * 1.7) * (this.walk > 0.03 ? 1 : 0);
    if (!this.alive) this.deadT = Math.min(1, this.deadT + dt * 3); else this.deadT = Math.max(0, this.deadT - dt * 4);
  }
}
