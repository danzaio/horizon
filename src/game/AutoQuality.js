// AutoQuality: adaptive resolution / preset controller. Pure logic (time is passed in) so it can be unit-tested with node.
//   State = (tier, scaleIdx). Down: scaleIdx 0..4 (renderScale x1, .85, .7, .55, .4), then one tier lower at x0.85.  Up: the reverse
//   (scaleIdx back to 0, then one tier higher at x0.85).
//   Down: p95 frame time > 1.25 x target for 2 consecutive 2 s windows.  Up: p95 < 0.7 x target for 10 s.  >= 8 s between changes.
import { PRESETS, QUALITY_ORDER } from '../shared/quality.js';

export const SCALE_FACTORS = [1, 0.85, 0.7, 0.55, 0.4];
export const AUTO_MAX_TIER = 3; // 'high' — ultra is manual only

/** Initial tier guess (0 potato .. 3 high) from coarse hardware hints. */
export function guessInitialTier({ cores = 4, memory = 0, mobile = false, glRenderer = '' } = {}) {
  const gl = String(glRenderer);
  if (/swiftshader|llvmpipe|software|softpipe|basic render|microsoft basic|lavapipe/i.test(gl)) return 0;
  let tier = mobile ? 1 : 2;
  if (cores && cores <= 2) tier -= 1;   // many cores say nothing about the GPU: only a known strong GPU starts above 'medium'
  if (memory && memory <= 2) tier -= 1;
  if (/intel/i.test(gl) && /hd graphics|gma|uhd graphics (4|5|6)\d\d/i.test(gl) && !/iris/i.test(gl)) tier = Math.min(tier, 1);
  if (/mali-[t]?[3-7]\d\d|adreno[^0-9]*[2-5]\d\d\b|powervr|videocore|vivante/i.test(gl)) tier = Math.min(tier, 1);
  if (!mobile && /(rtx|gtx 1[06]|radeon rx|geforce|apple m\d|arc a)/i.test(gl)) tier = Math.max(tier, 2);
  if (!mobile && /(rtx [234]0[6-9]0|rtx [34]0[5-9]0|rx [67]\d00|apple m[1-9] (pro|max|ultra)|rtx a\d{4})/i.test(gl)) tier = 3;
  return Math.max(0, Math.min(AUTO_MAX_TIER, tier));
}

export class AutoQuality {
  /**
   * @param {object} o
   * @param {(s:{tierName:string, tier:number, preset:object, renderScale:number, tierChanged:boolean})=>void} o.apply
   * @param {number} [o.initialTier=2] @param {number} [o.targetMs=16.667]
   */
  constructor({ apply, initialTier = 2, targetMs = 1000 / 60, windowMs = 2000, warmupMs = 4000, minGapMs = 8000, upAfterMs = 10000, maxTier = AUTO_MAX_TIER } = {}) {
    this.applyFn = apply; this.target = targetMs; this.windowMs = windowMs; this.warmupMs = warmupMs; this.minGap = minGapMs; this.upAfter = upAfterMs;
    this.maxTier = maxTier; this.autoTier = Math.max(0, Math.min(initialTier, maxTier)); this.scaleIdx = 0;
    this.mode = 'auto'; this.fixedTier = 2;
    this.buf = new Float32Array(1024); this.n = 0;
    this.ema = this.target; this.p95 = 0;
    this.paused = true; this.warmUntil = 0; this.winStart = 0;
    this.badRun = 0; this.goodMs = 0; this.lastChange = -Infinity; this.lastDir = 0; this.upBackoff = 0; this.changes = 0;
    /** Reused object for the debug overlay. */
    this.current = { mode: 'auto', tierName: '', tier: 0, scaleFactor: 1, renderScale: 1, ema: 0, p95: 0, changes: 0, paused: true };
    this._sync();
  }

  get tier() { return this.mode === 'auto' ? this.autoTier : this.fixedTier; }
  get scaleFactor() { return this.mode === 'auto' ? SCALE_FACTORS[this.scaleIdx] : 1; }
  /** Monotonic quality rank (higher = better); handy for tests / debugging. */
  get rank() { return this.autoTier * SCALE_FACTORS.length - this.scaleIdx; }
  get renderScale() { return Math.max(0.3, Math.min(1, PRESETS[QUALITY_ORDER[this.tier]].renderScale * this.scaleFactor)); }

  _sync() {
    const c = this.current;
    c.mode = this.mode; c.tier = this.tier; c.tierName = QUALITY_ORDER[this.tier]; c.scaleFactor = this.scaleFactor; c.renderScale = this.renderScale;
    c.ema = this.ema; c.p95 = this.p95; c.changes = this.changes; c.paused = this.paused;
  }

  _apply(tierChanged) {
    this._sync();
    if (this.applyFn) this.applyFn({ tierName: this.current.tierName, tier: this.tier, preset: PRESETS[this.current.tierName], renderScale: this.renderScale, tierChanged });
  }

  /** 'auto' or a preset name ('potato'..'ultra') => fixed. Applies immediately. */
  setMode(mode) {
    if (mode === 'auto') {
      if (this.mode === 'fixed') { this.autoTier = Math.min(this.fixedTier, this.maxTier); this.scaleIdx = 0; }
      this.mode = 'auto';
    } else {
      const t = QUALITY_ORDER.indexOf(mode);
      if (t < 0) return;
      this.mode = 'fixed'; this.fixedTier = t;
    }
    this._resetWindow(this.lastNow || 0, true);
    this._apply(true);
  }

  /** Stop measuring (loading screen, hidden tab, menus). */
  pause() { this.paused = true; this.n = 0; this._sync(); }
  /** Resume measuring; the first `warmupMs` are ignored. */
  resume(now) { this.paused = false; this._resetWindow(now, true); this._sync(); }

  _resetWindow(now, warm) {
    this.n = 0; this.winStart = now; this.badRun = 0; this.goodMs = 0;
    if (warm) this.warmUntil = now + this.warmupMs;
  }

  /** Feed one frame (ms between frames) at time `now` (ms, monotonic). */
  feed(frameMs, now) {
    this.lastNow = now;
    if (this.paused) return;
    if (now < this.warmUntil) { this.winStart = now; return; }
    if (frameMs > 250 || frameMs <= 0) return; // hitch / tab switch: not representative
    this.ema += (frameMs - this.ema) * 0.05;
    if (this.n < this.buf.length) this.buf[this.n++] = frameMs;
    const el = now - this.winStart;
    if (el >= this.windowMs && (this.n >= 8 || el >= this.windowMs * 3)) this._evaluate(now); // very slow devices: wait for a few samples
  }

  _evaluate(now) {
    const span = now - this.winStart;
    if (this.n >= 3) {
      const s = this.buf.subarray(0, this.n); s.sort();
      this.p95 = s[Math.min(this.n - 1, Math.floor(this.n * 0.95))];
      const bad = this.p95 > this.target * 1.25, good = this.p95 < this.target * 0.7;
      this.badRun = bad ? this.badRun + 1 : 0;
      this.goodMs = good ? this.goodMs + span : 0;
      if (this.mode === 'auto') {
        const gap = now - this.lastChange;
        if (this.badRun >= 2 && gap >= this.minGap && this._canStep(1)) this._step(1, now);
        else if (this.goodMs >= this.upAfter && gap >= Math.max(this.minGap, this.upBackoff) && this._canStep(-1)) this._step(-1, now);
      }
    }
    this.n = 0; this.winStart = now;
    this._sync();
  }

  _canStep(dir) { return dir > 0 ? (this.scaleIdx < SCALE_FACTORS.length - 1 || this.autoTier > 0) : (this.scaleIdx > 0 || this.autoTier < this.maxTier); }

  _step(dir, now) {
    const prevTier = this.autoTier;
    // went up recently and had to come back down => be more conservative about trying again
    if (dir > 0 && this.lastDir < 0 && now - this.lastChange < 30000) this.upBackoff = Math.min(120000, Math.max(20000, this.upBackoff * 2));
    if (dir > 0) { if (this.scaleIdx < SCALE_FACTORS.length - 1) this.scaleIdx++; else { this.autoTier--; this.scaleIdx = 1; } }
    else if (this.scaleIdx > 0) this.scaleIdx--; else { this.autoTier++; this.scaleIdx = 1; }
    this.lastDir = dir; this.lastChange = now; this.changes++;
    this._resetWindow(now, false);
    this.warmUntil = now + 2500; // let the new target / shaders settle
    this._apply(this.autoTier !== prevTier);
  }
}
