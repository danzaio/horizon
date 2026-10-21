// Procedural WebAudio: footsteps, break/place thuds, splash, wind (follows altitude), night pad + crickets-lite. No assets.
// The AudioContext is created lazily after the first user gesture; everything is a handful of nodes => negligible CPU.
import { BLOCKS } from '../shared/blocks.js';

// surface classes: 0 soft (grass/dirt/leaves), 1 hard (stone), 2 wood, 3 loose (sand/gravel/snow), 4 glass
const SURF = {};
for (const [names, c] of [[['grass', 'dirt', 'oak_leaves', 'birch_leaves', 'spruce_leaves', 'tall_grass', 'red_flower', 'yellow_flower', 'dead_bush', 'cactus'], 0],
  [['stone', 'cobblestone', 'bricks', 'sandstone', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'bedrock', 'glowstone', 'ice'], 1],
  [['planks', 'oak_log', 'birch_log', 'spruce_log'], 2], [['sand', 'gravel', 'snow', 'snowy_grass'], 3], [['glass'], 4]])
  for (const n of names) for (const d of BLOCKS) if (d && d.name === n) SURF[d.id] = c;
const surf = (id) => SURF[id] ?? 1;

export class GameAudio {
  constructor() { this.ctx = null; this.volume = 0.7; this.muted = false; this._wind = null; this._night = null; this._t = 0; this.master = null; }

  /** Call from a user gesture (click / key). Safe to call repeatedly. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try {
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.connect(ctx.destination); this._applyVolume();
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      let b0 = 0; for (let i = 0; i < len; i++) { b0 = b0 * 0.97 + (Math.random() * 2 - 1) * 0.3; d[i] = b0 + (Math.random() * 2 - 1) * 0.35; }
      this.noise = buf;
      this._startAmbient();
    } catch { this.ctx = null; }
  }

  setVolume(v) { this.volume = v; this._applyVolume(); }
  setMuted(m) { this.muted = m; this._applyVolume(); }
  _applyVolume() { if (this.master) this.master.gain.value = this.muted ? 0 : this.volume * this.volume * 0.9; }

  _burst({ freq = 800, q = 1, type = 'lowpass', dur = 0.08, gain = 0.4, tone = 0, attack = 0.004, detune = 0 }) {
    const c = this.ctx; if (!c || this.muted || this.volume <= 0) return;
    const t = c.currentTime, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise; src.playbackRate.value = 0.85 + Math.random() * 0.3; f.type = type; f.frequency.value = freq * (1 + detune * (Math.random() - 0.5)); f.Q.value = q;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random() * 1.5, dur + 0.05);
    if (tone) { // short pitched thump
      const o = c.createOscillator(), og = c.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(tone, t); o.frequency.exponentialRampToValueAtTime(tone * 0.5, t + dur);
      og.gain.setValueAtTime(gain * 0.9, t); og.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(og); og.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
    }
  }

  _surfaceBurst(id, strength, dur) {
    switch (surf(id)) {
      case 0: this._burst({ freq: 520, dur: dur * 1.1, gain: 0.32 * strength, detune: 0.3 }); break;
      case 1: this._burst({ freq: 1500, q: 2, type: 'bandpass', dur: dur * 0.8, gain: 0.34 * strength, tone: 150, detune: 0.3 }); break;
      case 2: this._burst({ freq: 700, q: 3, type: 'bandpass', dur: dur * 0.9, gain: 0.34 * strength, tone: 210, detune: 0.2 }); break;
      case 3: this._burst({ freq: 3200, type: 'highpass', dur: dur * 1.4, gain: 0.2 * strength, detune: 0.4 }); break;
      default: this._burst({ freq: 4500, q: 6, type: 'bandpass', dur: dur * 0.7, gain: 0.3 * strength, tone: 1400 });
    }
  }

  footstep(blockId, sprint) { this._surfaceBurst(blockId, sprint ? 1 : 0.75, 0.09); }
  land(speed) { this._burst({ freq: 380, dur: 0.16, gain: Math.min(0.7, speed / 25), tone: 90 }); }
  blockBreak(id) { this._surfaceBurst(id, 1.5, 0.18); }
  blockPlace(id) { this._surfaceBurst(id, 1.1, 0.1); }
  splash(speed) { this._burst({ freq: 1800, q: 0.7, type: 'bandpass', dur: 0.4, gain: Math.min(0.6, 0.15 + speed / 25), attack: 0.02, detune: 0.3 }); }

  // --- items / combat (G): everything is synthesized from noise bursts and short oscillator sweeps ---
  /** Pitched sweep: oscillator f0 -> f1 over `dur`, optional lowpass; `delay` seconds from now. */
  _tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.15, gain = 0.2, delay = 0, lp = 0, attack = 0.005 }) {
    const c = this.ctx; if (!c || this.muted || this.volume <= 0) return;
    const t = c.currentTime + delay, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let out = o;
    if (lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); out = f; }
    out.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.03);
  }
  swing(heavy = false) { this._burst({ freq: heavy ? 900 : 1500, q: 1.1, type: 'bandpass', dur: heavy ? 0.22 : 0.15, gain: 0.26, attack: 0.04, detune: 0.3 }); }
  hit(heavy = false) { this._burst({ freq: 700, q: 1.5, type: 'bandpass', dur: 0.1, gain: heavy ? 0.5 : 0.36, tone: heavy ? 110 : 160 }); }
  hurt() { this._tone({ type: 'sawtooth', f0: 230, f1: 110, dur: 0.2, gain: 0.2, lp: 900 }); this._burst({ freq: 500, dur: 0.1, gain: 0.25 }); }
  death() { this._tone({ type: 'sawtooth', f0: 320, f1: 50, dur: 0.9, gain: 0.22, lp: 700 }); }
  respawn() { this._tone({ f0: 330, f1: 660, dur: 0.25, gain: 0.14 }); this._tone({ f0: 495, f1: 990, dur: 0.3, gain: 0.12, delay: 0.1 }); }
  bowShoot(power = 1) { this._tone({ type: 'triangle', f0: 190 + 90 * power, f1: 70, dur: 0.16, gain: 0.3 }); this._burst({ freq: 2600, q: 0.8, type: 'bandpass', dur: 0.09, gain: 0.2 * power }); }
  bowDraw() { this._burst({ freq: 420, q: 4, type: 'bandpass', dur: 0.12, gain: 0.08, attack: 0.03 }); }
  arrowHit(id) { this._surfaceBurst(id || 1, 1.1, 0.07); this._tone({ f0: 320, f1: 160, dur: 0.07, gain: 0.12 }); }
  fuse() { this._burst({ freq: 3800, q: 0.5, type: 'highpass', dur: 1.1, gain: 0.14, attack: 0.05 }); }
  explosion(power = 4, dist = 0) {
    const v = Math.max(0, 1 - dist / (40 + power * 6)); if (v < 0.03) return;
    this._burst({ freq: 1200, q: 0.6, type: 'bandpass', dur: 0.3, gain: 0.55 * v, attack: 0.002 });
    this._burst({ freq: 260, q: 0.7, type: 'lowpass', dur: 1.1 + power * 0.12, gain: 0.95 * v, attack: 0.01 });
    this._burst({ freq: 110, q: 0.7, type: 'lowpass', dur: 1.8 + power * 0.15, gain: 0.8 * v, attack: 0.04 });
    this._tone({ f0: 90, f1: 28, dur: 0.9, gain: 0.5 * v });
  }
  // PvP weapons / movement (synthesised, no assets)
  gun(kind = 'rifle') {
    if (kind === 'shotgun') { this._burst({ freq: 700, q: 0.7, type: 'lowpass', dur: 0.28, gain: 0.5 }); this._tone({ type: 'triangle', f0: 150, f1: 45, dur: 0.22, gain: 0.35 }); }
    else if (kind === 'rail') { this._tone({ type: 'sawtooth', f0: 2400, f1: 90, dur: 0.45, gain: 0.22, lp: 5000 }); this._burst({ freq: 4200, q: 1.5, type: 'bandpass', dur: 0.25, gain: 0.3 }); }
    else if (kind === 'rocket') { this._burst({ freq: 380, q: 0.8, type: 'lowpass', dur: 0.4, gain: 0.45 }); this._tone({ type: 'sawtooth', f0: 220, f1: 60, dur: 0.35, gain: 0.25, lp: 1200 }); }
    else { this._burst({ freq: 3200, q: 0.9, type: 'bandpass', dur: 0.07, gain: 0.34 }); this._tone({ type: 'square', f0: 260, f1: 90, dur: 0.06, gain: 0.14, lp: 2000 }); }
  }
  dash() { this._burst({ freq: 1100, q: 0.9, type: 'bandpass', dur: 0.24, gain: 0.34, attack: 0.02 }); this._tone({ type: 'sine', f0: 300, f1: 760, dur: 0.14, gain: 0.1 }); }
  wallJump() { this._burst({ freq: 800, q: 1.2, type: 'bandpass', dur: 0.12, gain: 0.26 }); this._tone({ f0: 420, f1: 640, dur: 0.1, gain: 0.1 }); }
  slam() { this._tone({ type: 'sine', f0: 120, f1: 30, dur: 0.5, gain: 0.5 }); this._burst({ freq: 260, q: 0.7, type: 'lowpass', dur: 0.4, gain: 0.5 }); }
  beep(hi = false) { this._tone({ type: 'square', f0: hi ? 1500 : 900, f1: hi ? 1500 : 900, dur: 0.06, gain: 0.1, lp: 3000 }); }
  hitmark(kill = false) { this._tone({ f0: kill ? 1200 : 1800, f1: kill ? 700 : 1500, dur: 0.07, gain: 0.12 }); }

  gravPick() { this._tone({ type: 'sawtooth', f0: 220, f1: 520, dur: 0.22, gain: 0.14, lp: 1400 }); }
  gravDrop() { this._tone({ type: 'sawtooth', f0: 420, f1: 150, dur: 0.2, gain: 0.12, lp: 1200 }); }
  gravThrow() { this._tone({ type: 'sawtooth', f0: 520, f1: 90, dur: 0.28, gain: 0.2, lp: 1600 }); this._burst({ freq: 500, dur: 0.2, gain: 0.3 }); }
  grappleShoot() { this._tone({ type: 'square', f0: 1400, f1: 300, dur: 0.12, gain: 0.1, lp: 3000 }); this._burst({ freq: 3000, q: 1, type: 'bandpass', dur: 0.08, gain: 0.2 }); }
  grappleHit() { this._tone({ type: 'square', f0: 900, f1: 600, dur: 0.06, gain: 0.12, lp: 2400 }); }
  snowThrow() { this._burst({ freq: 900, q: 0.7, type: 'bandpass', dur: 0.1, gain: 0.2, attack: 0.02 }); }
  snowHit() { this._burst({ freq: 3000, type: 'highpass', dur: 0.09, gain: 0.25 }); this._tone({ f0: 200, f1: 120, dur: 0.06, gain: 0.08 }); }
  wand() { [880, 1320, 1760, 2200].forEach((f, i) => this._tone({ f0: f, f1: f * 1.02, dur: 0.22, gain: 0.08, delay: i * 0.06 })); }
  pickup() { this._tone({ f0: 620, f1: 980, dur: 0.1, gain: 0.12 }); }
  equip() { this._burst({ freq: 2200, q: 2, type: 'bandpass', dur: 0.04, gain: 0.1 }); }
  rocket() { this._burst({ freq: 3000, q: 0.5, type: 'highpass', dur: 0.9, gain: 0.18, attack: 0.04 }); }
  teleport() { this._tone({ f0: 1200, f1: 200, dur: 0.3, gain: 0.14 }); this._tone({ f0: 200, f1: 900, dur: 0.25, gain: 0.1, delay: 0.1 }); }
  /** Continuous jetpack roar, level 0..1 (0 = off). Created on first use. */
  jet(level) {
    const c = this.ctx; if (!c) return;
    if (!this._jet) {
      if (level <= 0) return;
      const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = this.noise; s.loop = true; f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.7; g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.master); s.start();
      this._jet = { f, g };
    }
    const now = c.currentTime;
    this._jet.g.gain.setTargetAtTime(this.muted ? 0 : 0.2 * level, now, 0.06);
    this._jet.f.frequency.setTargetAtTime(500 + 500 * level, now, 0.1);
  }

  _startAmbient() {
    const c = this.ctx;
    const mk = (type, freq, q) => { const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(); s.buffer = this.noise; s.loop = true; f.type = type; f.frequency.value = freq; f.Q.value = q; g.gain.value = 0; s.connect(f); f.connect(g); g.connect(this.master); s.start(); return { f, g }; };
    this._wind = mk('bandpass', 420, 0.6);
    this._rain = mk('bandpass', 2400, 0.28); this._rainLo = mk('lowpass', 700, 0.5); // rain: hiss + low body
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.11; lg.gain.value = 160; lfo.connect(lg); lg.connect(this._wind.f.frequency); lfo.start();
    // night: low pad (2 detuned sines) + crickets (4.4 kHz sine gated by a ~22 Hz square LFO, itself slowly gated)
    const pad = c.createGain(); pad.gain.value = 0; pad.connect(this.master);
    for (const fr of [110, 164.8]) { const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = fr; o.detune.value = (Math.random() - 0.5) * 12; o.connect(pad); o.start(); }
    const cr = c.createOscillator(), crg = c.createGain(), gate = c.createOscillator(), gg = c.createGain(), slow = c.createOscillator(), sg = c.createGain();
    cr.frequency.value = 4400; gate.type = 'square'; gate.frequency.value = 21; gg.gain.value = 0.5; slow.frequency.value = 0.6; sg.gain.value = 0.5;
    crg.gain.value = 0; const mod = c.createGain(); mod.gain.value = 0.5; gate.connect(gg); gg.connect(mod.gain); slow.connect(sg); sg.connect(mod.gain);
    cr.connect(mod); mod.connect(crg); crg.connect(this.master); cr.start(); gate.start(); slow.start();
    this._night = { pad, crg };
  }

  /** Animal voice (species: 0 pig, 1 cow, 2 sheep, 3 chicken), quieter with distance. */
  mob(sp, dist) {
    if (!this.ctx || this.muted) return;
    const v = Math.max(0, 1 - dist / 30); if (v < 0.04) return;
    const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
    const P = [[170, 105, 0.26, 'sawtooth', 700], [118, 78, 0.9, 'sawtooth', 380], [330, 270, 0.55, 'sawtooth', 1100], [900, 1500, 0.1, 'square', 2400]][sp];
    o.type = P[3]; o.frequency.setValueAtTime(P[0], t); o.frequency.exponentialRampToValueAtTime(P[1], t + P[2]);
    if (sp === 2) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 32; lg.gain.value = 24; l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + P[2]); }
    f.type = 'lowpass'; f.frequency.value = P[4]; f.Q.value = 0.8;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * v, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + P[2] + 0.1);
    o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + P[2] + 0.15);
  }
  /** Rain loudness 0..1 (already attenuated for roofs). */
  setRain(a) { this._rainT = a; }
  /** Thunder rumble: crack + long low roll, after `delay` seconds (distance). */
  thunder(delay, strength = 1) {
    if (!this.ctx) return;
    setTimeout(() => {
      this._burst({ freq: 1100, q: 0.6, type: 'bandpass', dur: 0.35, gain: 0.5 * strength, attack: 0.003 });
      this._burst({ freq: 170, q: 0.7, type: 'lowpass', dur: 3.2, gain: 0.95 * strength, attack: 0.12 });
      this._burst({ freq: 90, q: 0.7, type: 'lowpass', dur: 4.2, gain: 0.8 * strength, attack: 0.3 });
    }, delay * 1000);
  }

  /** Per-frame (cheap, throttled internally): ambient levels from altitude / time of day / state. */
  update(dt, altitude, night, underwater) {
    if (!this.ctx || !this._wind) return;
    this._t += dt; if (this._t < 0.25) return; this._t = 0;
    const now = this.ctx.currentTime, alt = Math.max(0, Math.min(1, (altitude - 60) / 140));
    this._wind.g.gain.setTargetAtTime(underwater ? 0 : 0.018 + 0.1 * alt, now, 0.5);
    this._wind.f.Q.setTargetAtTime(0.6 + alt, now, 0.5);
    const ra = underwater ? 0 : (this._rainT || 0);
    this._rain.g.gain.setTargetAtTime(0.07 * ra, now, 0.6); this._rainLo.g.gain.setTargetAtTime(0.05 * ra, now, 0.6);
    this._night.pad.gain.setTargetAtTime(night && !underwater ? 0.012 : 0, now, 1.5);
    this._night.crg.gain.setTargetAtTime(night && !underwater && altitude < 110 ? 0.006 : 0, now, 1.5);
  }
}
