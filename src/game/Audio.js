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
