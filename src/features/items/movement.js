// Movement tech for PvP: dash (V / ⚡), wall-slide + wall-jump, ground-pound (crouch in mid-air). Works with any hotbar item; costs nothing when idle
// (a few comparisons per frame). Uses only Player's public hooks (input, impulse, vx/vz/vy) and Health.noFall.
import { SOLID } from '../../shared/blocks.js';

const MAX_DASH = 2, RECHARGE = 1.7, DASH_SPEED = 19;

export class Movement {
  /** @param {object} S items runtime */
  constructor(S) {
    this.S = S; this.charges = MAX_DASH; this.rech = 0; this.cd = 0; this.wallCd = 0; this.pound = 0; this.poundCd = 0;
    this._jumpPrev = false; this._crouchPrev = false; this.slideT = 0;
  }

  _ok() { const S = this.S; return S.health.alive && S.ctx.state === 'playing' && !S.player.frozen; }

  dash() {
    const S = this.S, p = S.player;
    if (!this._ok() || this.charges < 1 || this.cd > 0) return false;
    const inp = p.input, sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    let f = inp.fwd, s = inp.strafe; const len = Math.hypot(f, s);
    let dx, dz;
    if (len > 0.05) { f /= len; s /= len; dx = -sy * f + cy * s; dz = -cy * f - sy * s; } else { dx = -sy; dz = -cy; }
    p.vx = dx * DASH_SPEED; p.vz = dz * DASH_SPEED;
    if (p.onGround) p.vy = Math.max(p.vy, 2.4); else p.vy = Math.max(p.vy * 0.25, 1.4);
    p.impulse(0, 0, 0); p.flying = false;
    this.charges--; this.cd = 0.22; if (this.rech <= 0) this.rech = RECHARGE;
    p.fovExtra = 12; S.audio.dash(); S.health.noFall = Math.max(S.health.noFall, 0.2);
    const pc = S.particles(); for (let i = 0; i < 4; i++) pc.burst(p.x - dx * i * 0.5, p.y + 0.9, p.z - dz * i * 0.5, [0.75, 0.9, 1], 3, 0.5);
    S.events.emit('player:dash', { dx, dz });
    this._pips(); return true;
  }

  _wall(p) { // returns [nx, nz] pointing away from an adjacent wall, or null
    const w = this.S.world, y = Math.floor(p.y + 0.9), y2 = Math.floor(p.y + 1.5), x = p.x, z = p.z, r = 0.42;
    const sx = (xx, zz) => SOLID[w.getBlock(Math.floor(xx), y, Math.floor(zz))] === 1 || SOLID[w.getBlock(Math.floor(xx), y2, Math.floor(zz))] === 1;
    let nx = 0, nz = 0;
    if (sx(x + r, z)) nx -= 1; if (sx(x - r, z)) nx += 1; if (sx(x, z + r)) nz -= 1; if (sx(x, z - r)) nz += 1;
    return nx || nz ? [nx, nz] : null;
  }

  _pips() { this.S.hud.setDash(this.charges, MAX_DASH, this.rech > 0 ? 1 - this.rech / RECHARGE : 1); }

  update(dt) {
    const S = this.S, p = S.player, inp = p.input;
    if (this.cd > 0) this.cd -= dt;
    if (this.wallCd > 0) this.wallCd -= dt;
    if (this.poundCd > 0) this.poundCd -= dt;
    if (this.charges < MAX_DASH) { this.rech -= dt; if (this.rech <= 0) { this.charges++; this.rech = this.charges < MAX_DASH ? RECHARGE : 0; } this._pips(); }
    else if (S.hud._dash !== MAX_DASH * 10 + 9) this._pips();
    const jumpEdge = inp.jump && !this._jumpPrev, crouchEdge = inp.crouch && !this._crouchPrev;
    this._jumpPrev = inp.jump; this._crouchPrev = inp.crouch;
    if (!this._ok()) { this.pound = 0; return; }
    const air = !p.onGround && !p.flying && !p.inWater;

    // ---- ground pound
    if (this.pound) {
      if (p.onGround) { this.pound = 0; this._slam(); }
      else if (p.inWater || p.flying) this.pound = 0;
      else { p.vy = Math.min(p.vy, -36); p.vx *= 0.92; p.vz *= 0.92; S.health._peak = p.y; if (Math.random() < 0.6) S.particles().burst(p.x, p.y + 1.6, p.z, [0.9, 0.9, 1], 1, 0.4); }
    } else if (air && crouchEdge && this.poundCd <= 0 && this._height(p) > 2.2) {
      this.pound = 1; p.vy = -20; p.vx *= 0.3; p.vz *= 0.3; S.audio.dash(); p.fovExtra = 8;
    }

    // ---- wall slide / wall jump
    if (air && !this.pound) {
      const wl = this._wall(p);
      if (wl) {
        if (p.vy < -2.2 && (inp.fwd || inp.strafe)) { p.vy = -2.2; S.health._peak = p.y; if (Math.random() < 0.3) S.particles().burst(p.x - wl[0] * 0.3, p.y + 0.6, p.z - wl[1] * 0.3, [0.8, 0.8, 0.8], 1, 0.3); }
        if (jumpEdge && this.wallCd <= 0 && !(p.extraJumps > 0 && p._jumpsLeft > 0)) {
          const l = Math.hypot(wl[0], wl[1]) || 1, nx = wl[0] / l, nz = wl[1] / l, sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
          p.vx = nx * 7.2 - sy * 3; p.vz = nz * 7.2 - cy * 3; p.vy = 9.2; p.impulse(0, 0, 0);
          this.wallCd = 0.3; S.health.noFall = Math.max(S.health.noFall, 0.3); S.health._peak = p.y; S.audio.wallJump();
          if (p.extraJumps > 0) p._jumpsLeft = p.extraJumps;
          this.charges = Math.min(MAX_DASH, this.charges + 1); this._pips();                 // wall-jumps refund a dash: chain them for speed tech
          S.particles().burst(p.x - nx * 0.3, p.y + 0.9, p.z - nz * 0.3, [0.85, 0.85, 0.85], 6, 0.9);
        }
      }
    }
  }

  _height(p) { const w = this.S.world, x = Math.floor(p.x), z = Math.floor(p.z); for (let d = 1; d <= 4; d++) if (SOLID[w.getBlock(x, Math.floor(p.y) - d, z)] === 1) return d - 1 + (p.y - Math.floor(p.y)); return 9; }

  _slam() {
    const S = this.S, p = S.player;
    this.poundCd = 0.8; S.health.noFall = Math.max(S.health.noFall, 0.4); S.health._peak = p.y; p.vy = 5.5;
    S.audio.slam(); S.hud.shake(0.05);
    S.combat.explode(p.x, p.y + 0.3, p.z, 2.4, { by: S.localId, noSelf: true });
    S.ents.blast(p.x, p.y + 0.2, p.z, 6, 0.4, 0);
    const pc = S.particles(); for (let i = 0; i < 3; i++) pc.burst(p.x, p.y + 0.2, p.z, [0.7, 0.66, 0.6], 12, 2.4);
    S.events.emit('player:slam', { x: p.x, y: p.y, z: p.z });
  }
}
