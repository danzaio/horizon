// Health (ctx.health): 20 hp, fall damage, drowning, lava, void, damage flash, death screen + respawn, post-respawn invulnerability.
// Events: player:damage {amount, src, hp} · player:die {src} · player:respawn {}.
import { B } from '../../shared/blocks.js';

const CAUSE = { fall: 'Você caiu de muito alto', drown: 'Você se afogou', lava: 'Você virou churrasco na lava', void: 'Você caiu no vazio', explosion: 'Você foi pelos ares', player: 'Você foi derrotado', generic: 'Você morreu' };

export class Health {
  /** @param {object} S items runtime */
  constructor(S) {
    this.S = S; this.hp = 20; this.max = 20; this.alive = true; this.invulnerable = false; this.spawnPoint = null; this.home = null; this.guard = false;
    this._inv = 0; this._since = 99; this._air = 10; this._drown = 0; this._lava = 0; this._falling = false; this._peak = 0; this._tick = 0; this._regen = 0; this._void = 0;
    this.noFall = 0;                     // seconds of fall-damage immunity (slow fall feather, respawn)
    this.S.hud.setHearts(this.hp, this.max);
  }

  _src(src) { return typeof src === 'string' ? { kind: src } : src && typeof src === 'object' ? src : { kind: 'generic' }; }

  /** Apply damage (hp). Ignored while dead or invulnerable. @returns {boolean} whether it hurt */
  damage(n, src) {
    const S = this.S;
    n = Number(n); if (!this.alive || this.invulnerable || !(n > 0)) return false;
    src = this._src(src);
    if (this.guard && src.kind !== 'fall' && src.kind !== 'void' && src.kind !== 'drown') { n *= 0.2; this.S.audio.hit(false); if (n < 0.5) return false; }   // shield up
    this.hp = Math.max(0, this.hp - n); this._since = 0;
    S.ctx.localState.hp = this.hp;
    S.hud.setHearts(this.hp, this.max); S.hud.flash(Math.min(0.9, 0.3 + n * 0.06)); S.hud.shake(Math.min(0.06, 0.012 + n * 0.004));
    S.audio.hurt();
    S.events.emit('player:damage', { amount: n, src, hp: this.hp });
    if (this.hp <= 0) this._die(src);
    return true;
  }

  heal(n) {
    n = Number(n); if (!this.alive || !(n > 0)) return;
    this.hp = Math.min(this.max, this.hp + n); this.S.ctx.localState.hp = this.hp; this.S.hud.setHearts(this.hp, this.max);
  }

  kill(src = 'generic') { if (this.alive) { this.hp = 0; this.S.ctx.localState.hp = 0; this.S.hud.setHearts(0, this.max); this._die(this._src(src)); } }

  _die(src) {
    const S = this.S; this.alive = false; this.hp = 0;
    S.ctx.localState.hp = 0; S.ctx.localState.extra.alive = false;
    S.audio.death(); S.hud.flash(0.95);
    const by = src.by && src.by !== 'Você' ? ` por ${src.by}` : '';
    S.hud.killFeed(src.kind === 'player' ? `${src.by || '?'} derrotou você` : (CAUSE[src.kind] || CAUSE.generic));
    S.events.emit('player:die', { src });
    S.player.input.fwd = S.player.input.strafe = 0; S.player.input.jump = false;
    S.hud.showDeath((CAUSE[src.kind] || CAUSE.generic) + by, () => this.respawn());
    if (S.ctx.state === 'playing') S.ui.beginModal();
    this._modal = true;
  }

  /** Back to life at spawnPoint (or the planet spawn), with a short invulnerability window. */
  respawn() {
    const S = this.S, p = S.player;
    if (this.alive) return;
    this.alive = true; this.hp = this.max; this._air = 10; this._since = 99; this._falling = false; this.noFall = 1.5;
    const sp = this.spawnPoint || this.home;
    if (sp) { p.teleport(sp.x, sp.y, sp.z); p.unstick(); }
    p.flying = false; p.vx = p.vy = p.vz = 0;
    this.invulnerable = true; this._inv = 3;
    S.ctx.localState.hp = this.hp; S.ctx.localState.extra.alive = true;
    S.hud.hideDeath(); S.hud.setHearts(this.hp, this.max); S.hud.setAir(null);
    if (this._modal) { this._modal = false; S.ui.endModal(); }
    S.audio.respawn();
    S.events.emit('player:respawn', {});
  }

  _isLava(x, y, z) { return this.S.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) === B.LAVA; }

  /** per frame (cheap) */
  update(dt) {
    const S = this.S, p = S.player;
    if (!this.alive) return;
    this._since += dt;
    if (this.invulnerable) { this._inv -= dt; if (this._inv <= 0) this.invulnerable = false; S.hud.hearts.classList.toggle('inv', this.invulnerable); }
    if (this.noFall > 0) this.noFall -= dt;
    if (S.ctx.state !== 'playing') return;
    // fall damage: distance fallen since the last time we stood on something / swam / flew
    if (p.onGround || p.inWater || p.flying || p.frozen) {
      if (this._falling && p.onGround && !p.inWater && !p.flying && this.noFall <= 0 && p.fallCap <= 0) {
        const d = (this._peak - p.y) * Math.max(0.4, p.gravityScale);
        if (d > 3.6) this.damage(Math.floor(d - 3.5), 'fall');
      }
      this._peak = p.y; this._falling = false;
    } else if (!this._falling) { this._falling = true; this._peak = p.y; } else if (p.y > this._peak) this._peak = p.y;
    // drowning
    if (p.headUnderwater) {
      this._air -= dt; S.hud.setAir(Math.max(0, this._air / 10));
      if (this._air <= 0) { this._drown -= dt; if (this._drown <= 0) { this._drown = 1; this.damage(2, 'drown'); } }
    } else if (this._air < 10) { this._air = Math.min(10, this._air + dt * 5); S.hud.setAir(this._air >= 10 ? null : this._air / 10); }
    // lava + void, 5x per second
    this._tick -= dt;
    if (this._tick <= 0) {
      this._tick = 0.2;
      const x = p.x, z = p.z, y = p.y;
      if (this._isLava(x, y - 0.1, z) || this._isLava(x, y + 0.5, z) || this._isLava(x + 0.35, y + 0.3, z) || this._isLava(x - 0.35, y + 0.3, z) || this._isLava(x, y + 0.3, z + 0.35) || this._isLava(x, y + 0.3, z - 0.35)) {
        this._lava -= 0.2; if (this._lava <= 0) { this._lava = 0.5; this.damage(2, 'lava'); }
      } else this._lava = 0;
      if (y < -12) { this._void -= 0.2; if (this._void <= 0) { this._void = 0.4; this.damage(4, 'void'); } }
    }
    // slow regeneration after a calm spell
    if (this.hp < this.max && this._since > 8) { this._regen -= dt; if (this._regen <= 0) { this._regen = 2.5; this.heal(1); } }
  }
}
