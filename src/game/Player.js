// Player: AABB (0.6 x 1.8) voxel physics against world.getBlock, walking / sprinting / crouching / swimming / flying,
// plus camera placement (eye height, head-bob, FOV kick). No per-frame allocations.
import { B, SOLID, LIQUID, isWatery } from '../shared/blocks.js';
import { WORLD_HEIGHT, WATER_TOP } from '../shared/constants.js';

const HW = 0.3, HEIGHT = 1.8, EPS = 1e-4;
const EYE = 1.62, EYE_CROUCH = 1.32;
const GRAVITY = 28, JUMP_V = 8.9, TERMINAL = 70;
const SPEED_WALK = 5.0, SPEED_SPRINT = 8.2, SPEED_CROUCH = 1.9, SWIM_K = 0.55;
const MAX_SUBSTEP = 0.4;          // max displacement per collision sub-step (blocks) -> no tunnelling

export class Player {
  /**
   * @param {object} world  anything implementing getBlock(x,y,z)
   * @param {THREE.PerspectiveCamera} camera
   */
  constructor(world, camera) {
    this.world = world;
    this.camera = camera;
    camera.rotation.order = 'YXZ';
    this.x = 0; this.y = 100; this.z = 0;           // feet position (block units, doubles)
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;                   // radians; yaw 0 faces -Z, positive = turn left
    this.flying = false; this.onGround = false; this.inWater = false; this.headUnderwater = false;
    this.sprinting = false; this.crouching = false; this.frozen = false;
    this.flySpeed = 14;
    this.fovBase = 75; this.fovCur = 75;
    this.autoWalk = false; this.autoStep = false;
    /** Filled by Controls every frame. */
    this.input = { fwd: 0, strafe: 0, jump: false, sprint: false, crouch: false };
    /** Event callbacks (set by main): onStep(blockUnderFeet, sprinting), onLand(speed), onSplash(speed). */
    this.onStep = null; this.onLand = null; this.onSplash = null;
    this._bob = 0; this._bobAmt = 0; this._eye = EYE; this._camOff = 0; this._stepDist = 0; this._wasWater = false;
    this._hHit = false;
  }

  /** Teleport feet to (x,y,z) and clear velocity. */
  teleport(x, y, z) { this.x = x; this.y = y; this.z = z; this.vx = this.vy = this.vz = 0; this._camOff = 0; }

  setLook(yawRad, pitchRad) { this.yaw = yawRad; this.pitch = Math.max(-1.553, Math.min(1.553, pitchRad)); }

  /** Mouse look in radians (already scaled by sensitivity). */
  look(dYaw, dPitch) { this.yaw += dYaw; this.setLook(this.yaw, this.pitch + dPitch); }

  /** Unit view direction written into `out` (THREE.Vector3). */
  getLookDir(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  /** True if the AABB of the player overlaps the unit block at integer (bx,by,bz). */
  intersectsBlock(bx, by, bz) {
    return this.x - HW < bx + 1 && this.x + HW > bx && this.y < by + 1 && this.y + HEIGHT > by && this.z - HW < bz + 1 && this.z + HW > bz;
  }

  /** Push the player upwards until not embedded in solid blocks (call once the surrounding terrain is loaded). */
  unstick() {
    let n = 0;
    while (this._collides() && n++ < WORLD_HEIGHT) this.y += 1;
  }

  /** Advance physics by dt seconds and place the camera. */
  update(dt) {
    dt = Math.min(dt, 0.1);
    const w = this.world;
    const by = Math.max(0, Math.min(WORLD_HEIGHT - 1, Math.floor(this.y)));
    // freeze while the column under us isn't loaded (never fall through unloaded terrain)
    this.frozen = w.getBlock(Math.floor(this.x), by, Math.floor(this.z)) === B.UNLOADED;
    if (!this.frozen && dt > 0) {
      const n = Math.min(8, Math.ceil(dt * 90));
      const h = dt / n;
      for (let i = 0; i < n; i++) this._step(h);
    }
    this.updateCamera(dt);
  }

  _step(h) {
    const inp = this.input, w = this.world;
    const sinY = Math.sin(this.yaw), cosY = Math.cos(this.yaw);
    let f = this.autoWalk ? 1 : inp.fwd, s = inp.strafe;
    const len = Math.hypot(f, s);
    if (len > 1) { f /= len; s /= len; }
    const wishX = -sinY * f + cosY * s, wishZ = -cosY * f - sinY * s;
    const moving = len > 0.05;

    // fluid state
    const fx = Math.floor(this.x), fz = Math.floor(this.z);
    this.inWater = isWatery(w.getBlock(fx, Math.floor(this.y + 0.4), fz));
    const eyeY = this.y + this._eye;
    const eyeB = Math.floor(eyeY);
    this.headUnderwater = isWatery(w.getBlock(fx, eyeB, fz)) && (eyeY - eyeB) < WATER_TOP;
    if (this.inWater && !this._wasWater && this.vy < -3 && this.onSplash) this.onSplash(-this.vy);
    this._wasWater = this.inWater;

    this.crouching = inp.crouch && !this.flying;
    this.sprinting = inp.sprint && f > 0.1 && !this.crouching;

    if (this.flying) {
      const sp = this.flySpeed * (inp.sprint ? 2.6 : 1);
      const vy = (inp.jump ? 1 : 0) - (inp.crouch ? 1 : 0);
      const k = 1 - Math.exp(-9 * h);
      this.vx += (wishX * sp - this.vx) * k;
      this.vz += (wishZ * sp - this.vz) * k;
      this.vy += (vy * sp * 0.7 - this.vy) * k;
    } else {
      let speed = this.crouching ? SPEED_CROUCH : this.sprinting ? SPEED_SPRINT : SPEED_WALK;
      let k;
      if (this.inWater) { speed *= SWIM_K; k = 1 - Math.exp(-5 * h); } else k = this.onGround ? 1 - Math.exp(-14 * h) : 1 - Math.exp(-3.2 * h);
      this.vx += (wishX * speed - this.vx) * k;
      this.vz += (wishZ * speed - this.vz) * k;
      if (this.inWater) {
        this.vy -= 7 * h;
        this.vy *= Math.exp(-2.2 * h);
        if (inp.jump) this.vy = Math.min(4.2, this.vy + 24 * h);
        else if (inp.crouch) this.vy = Math.max(-4, this.vy - 18 * h);
        if (inp.jump && this._hHit) this.vy = Math.max(this.vy, 6.5); // hop out of the water
      } else {
        this.vy = Math.max(-TERMINAL, this.vy - GRAVITY * h);
        if (inp.jump && this.onGround) { this.vy = JUMP_V; this.onGround = false; }
      }
    }

    // integrate with axis-separated, sub-stepped collision
    const wasGround = this.onGround, px = this.x, pz = this.z;
    this._hHit = false;
    const preVy = this.vy;
    this._moveAxis(0, this.vx * h);
    this._moveAxis(2, this.vz * h);
    this.onGround = false;
    this._moveAxis(1, this.vy * h);
    // crouching on the ground: don't walk off ledges
    if (this.crouching && wasGround && (this.x !== px || this.z !== pz) && !this._supported()) { this.x = px; this.z = pz; this.vx = this.vz = 0; this.onGround = true; }

    if (this.onGround && !wasGround && preVy < -9 && this.onLand) this.onLand(-preVy);

    // footsteps
    if (this.onGround && !this.flying && moving) {
      this._stepDist += Math.hypot(this.vx, this.vz) * h;
      const stride = this.sprinting ? 2.4 : this.crouching ? 1.2 : 1.8;
      if (this._stepDist > stride) {
        this._stepDist = 0;
        if (this.onStep) this.onStep(w.getBlock(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z)), this.sprinting);
      }
    }
    // head bob
    const hs = Math.hypot(this.vx, this.vz);
    const bobTarget = (this.onGround && !this.flying && hs > 0.6) ? 1 : 0;
    this._bobAmt += (bobTarget - this._bobAmt) * (1 - Math.exp(-10 * h));
    if (bobTarget) this._bob += hs * h * 1.55;
  }

  /** True if there is solid ground within 0.35 below the feet. */
  _supported() {
    const y0 = this.y; this.y -= 0.35;
    const c = this._collides();
    this.y = y0;
    return c;
  }

  _collides() {
    const w = this.world;
    const x0 = Math.floor(this.x - HW + EPS), x1 = Math.floor(this.x + HW - EPS);
    const z0 = Math.floor(this.z - HW + EPS), z1 = Math.floor(this.z + HW - EPS);
    const y0 = Math.floor(this.y + EPS), y1 = Math.floor(this.y + HEIGHT - EPS);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (SOLID[w.getBlock(x, y, z)] === 1) return true;
    return false;
  }

  /** Move along one axis (0=x,1=y,2=z) in sub-steps <= MAX_SUBSTEP; snaps to the block face on contact. */
  _moveAxis(axis, d) {
    if (d === 0) return;
    const n = Math.ceil(Math.abs(d) / MAX_SUBSTEP), sd = d / n;
    for (let i = 0; i < n; i++) {
      if (axis === 0) this.x += sd; else if (axis === 1) this.y += sd; else this.z += sd;
      if (!this._collides()) continue;
      if (axis !== 1 && this.onGround && !this.flying && this.vy <= 0.5 && (this.sprinting || this.autoStep) && this._tryStepUp()) continue;
      if (axis === 0) { this.x = sd > 0 ? Math.floor(this.x + HW - EPS) - HW : Math.floor(this.x - HW + EPS) + 1 + HW; this.vx = 0; this._hHit = true; }
      else if (axis === 2) { this.z = sd > 0 ? Math.floor(this.z + HW - EPS) - HW : Math.floor(this.z - HW + EPS) + 1 + HW; this.vz = 0; this._hHit = true; }
      else if (sd > 0) { this.y = Math.floor(this.y + HEIGHT - EPS) - HEIGHT; this.vy = 0; }
      else { this.y = Math.floor(this.y + EPS) + 1; this.vy = 0; this.onGround = true; }
      return;
    }
  }

  /** Auto step-up of exactly one block (sprinting / touch). Returns true if the step was taken. */
  _tryStepUp() {
    const y0 = this.y;
    this.y = Math.floor(y0 + EPS) + 1;
    if (this._collides()) { this.y = y0; return false; }
    this._camOff -= this.y - y0;
    return true;
  }

  /** Place the camera at the eye (bob, step smoothing, FOV kick). Called by update(); main also calls it alone while physics is frozen. */
  updateCamera(dt) {
    const cam = this.camera;
    const eyeT = this.crouching ? EYE_CROUCH : EYE;
    this._eye += (eyeT - this._eye) * (1 - Math.exp(-14 * dt));
    this._camOff *= Math.exp(-12 * dt);
    const bobY = Math.sin(this._bob * 2) * 0.045 * this._bobAmt;
    const bobX = Math.cos(this._bob) * 0.03 * this._bobAmt;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    cam.position.set(this.x + cy * bobX, this.y + this._eye + bobY + this._camOff, this.z - sy * bobX);
    cam.rotation.set(this.pitch, this.yaw, Math.cos(this._bob) * 0.003 * this._bobAmt, 'YXZ');
    // FOV kick
    const hs = Math.hypot(this.vx, this.vz);
    const kick = this.sprinting && hs > 5 ? 7 : this.flying && hs > 20 ? 6 : 0;
    const target = this.fovBase + kick;
    this.fovCur += (target - this.fovCur) * (1 - Math.exp(-8 * dt));
    if (Math.abs(cam.fov - this.fovCur) > 0.02) { cam.fov = this.fovCur; cam.updateProjectionMatrix(); }
  }
}

