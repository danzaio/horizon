// =====================================================================================
//  GUITAR BRIGA III — LENDAS DO PLANALTO
//  Paródia de jogo de luta no estilo de "Guitar Hero III: Legends of Rock".
//  A luta é 3D (Three.js, toon shading + nanquim); título e VS usam ilustração 2D, como as telas de loading do GH3.
//  Tudo procedural: geometria, texturas pintadas em canvas, música e efeitos em WebAudio. Nenhum asset externo.
// =====================================================================================
import { TAU, D, W, H, GY, rnd, irnd, clamp, lerp, ease, FONT } from './shared.js';
import { Stage3D } from './three/stage.js';
const OUT = '#130a16';
const URLP = new URLSearchParams(location.search);

// three stacked layers: 2D backdrop (select screen panels) · WebGL (3D) · 2D front (HUD, text, FX, 2D scenes)
const stackEl = document.getElementById('stack');
const bgCv = document.getElementById('bg'), glCv = document.getElementById('gl'), cv = document.getElementById('fg');
const ctx = cv.getContext('2d'), bgx = bgCv.getContext('2d');
const grainEl = document.getElementById('grain');
let scale = 1, cssScale = 1, r3 = null;
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cssScale = Math.min(innerWidth / W, innerHeight / H);
  const cw = Math.round(W * cssScale), ch = Math.round(H * cssScale);
  stackEl.style.width = cw + 'px'; stackEl.style.height = ch + 'px';
  for (const c of [cv, bgCv]) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); }
  scale = cssScale * dpr;
  if (r3) r3.resize(cw, ch, Math.min(dpr, 1.75));
  buildBG(); buildPost();
}

// ---------- color helpers
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function mix(a, b, t) { const A = hex2rgb(a), B = hex2rgb(b); return 'rgb(' + A.map((v, i) => Math.round(lerp(v, B[i], t))).join(',') + ')'; }
const dimCache = new Map();
function dim(c) { if (!c.startsWith('#')) return c; let v = dimCache.get(c); if (!v) { v = mix(c, '#1a0822', 0.32); dimCache.set(c, v); } return v; }

// =====================================================================================
//  INPUT
// =====================================================================================
const keys = new Set(), edge = new Set();
const PREVENT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);
addEventListener('keydown', e => {
  if (!keys.has(e.code)) edge.add(e.code);
  keys.add(e.code);
  if (PREVENT.has(e.code)) e.preventDefault();
  audio.unlock();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
const BIND = {
  p1: { l: ['KeyA'], r: ['KeyD'], u: ['KeyW'], d: ['KeyS'], p: ['KeyF'], k: ['KeyG'], h: ['KeyH'], pr: ['KeyR'], sp: ['KeyT'] },
  p2: { l: ['ArrowLeft'], r: ['ArrowRight'], u: ['ArrowUp'], d: ['ArrowDown'], p: ['Numpad1', 'KeyJ'], k: ['Numpad2', 'KeyK'], h: ['Numpad3', 'KeyL'], pr: ['Numpad4', 'KeyU'], sp: ['Numpad5', 'KeyI'] },
};
function readBind(b) {
  const held = n => b[n].some(c => keys.has(c)), ed = n => b[n].some(c => edge.has(c));
  return { l: held('l'), r: held('r'), u: held('u'), d: held('d'), U: ed('u'), P: ed('p'), K: ed('k'), H: ed('h'), PR: ed('pr'), SP: ed('sp') };
}
function orPad(a, b) { const o = {}; for (const k in a) o[k] = a[k] || b[k]; return o; }
const emptyPad = () => ({ l: false, r: false, u: false, d: false, U: false, P: false, K: false, H: false, PR: false, SP: false });
const anyEdge = (...codes) => codes.some(c => edge.has(c));
const confirmEdge = () => anyEdge('Enter', 'NumpadEnter', 'Space', 'KeyF', 'KeyJ', 'Numpad1');

// pointer / touch
let tap = null, isTouch = matchMedia('(pointer: coarse)').matches;
cv.addEventListener('pointerdown', e => {
  audio.unlock();
  const r = cv.getBoundingClientRect();
  tap = { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  if (e.pointerType === 'touch') isTouch = true;
});
const touchEl = document.getElementById('touch');
for (const b of touchEl.querySelectorAll('.tb')) {
  const k = b.dataset.k;
  const down = e => { e.preventDefault(); audio.unlock(); if (!keys.has(k)) edge.add(k); keys.add(k); b.classList.add('dn'); try { b.setPointerCapture(e.pointerId); } catch (_) {} };
  const up = e => { e.preventDefault(); keys.delete(k); b.classList.remove('dn'); };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
}

// =====================================================================================
//  AUDIO (procedural rock)
// =====================================================================================
const audio = {
  ctx: null, muted: URLP.get('mute') === '1', master: null, sfxGain: null, musGain: null, curve: null, noise: null,
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfxGain = c.createGain(); this.sfxGain.gain.value = 0.9; this.sfxGain.connect(this.master);
    this.musGain = c.createGain(); this.musGain.gain.value = 0.42; this.musGain.connect(this.master);
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; curve[i] = Math.tanh(x * 9) * 0.8; }
    this.curve = curve;
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    music.start();
  },
  // the leader's voice, via the browser's speech synthesis (silently skipped where unavailable)
  say(text, pitch = 1.2) {
    if (this.muted || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = 'pt-BR'; u.rate = 1.1; u.pitch = pitch; u.volume = 1;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (_) { /* no speech available */ }
  },
  toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.55; },
  get t() { return this.ctx ? this.ctx.currentTime : 0; },
  env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); },
  noiseHit(t, dur, freq, q, peak, type = 'bandpass', dest) {
    const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = rnd(0.8, 1.2);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); this.env(g, t, 0.003, peak, dur);
    s.connect(f); f.connect(g); g.connect(dest || this.sfxGain); s.start(t, rnd(0, 1.5)); s.stop(t + dur + 0.05);
    return f;
  },
  tone(t, type, f0, f1, dur, peak, dest) {
    const c = this.ctx, o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); this.env(g, t, 0.004, peak, dur);
    o.connect(g); g.connect(dest || this.sfxGain); o.start(t); o.stop(t + dur + 0.05);
  },
  chord(t, root, dur, peak, cutoff, dest) { // distorted power chord
    const c = this.ctx, sh = c.createWaveShaper(); sh.curve = this.curve;
    const pre = c.createGain(); pre.gain.value = 0.9;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 1.2;
    const g = c.createGain(); this.env(g, t, 0.005, peak, dur);
    for (const m of [1, 1.4983, 2]) for (const det of [-6, 6]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = root * m; o.detune.value = det;
      const og = c.createGain(); og.gain.value = 0.18; o.connect(og); og.connect(pre); o.start(t); o.stop(t + dur + 0.05);
    }
    pre.connect(sh); sh.connect(f); f.connect(g); g.connect(dest || this.sfxGain);
  },
  sfx(name, v = 1) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'punch': this.noiseHit(t, 0.09, 1400, 1.2, 0.7 * v); this.tone(t, 'sine', 190, 55, 0.12, 0.8 * v); break;
      case 'kick': this.noiseHit(t, 0.12, 900, 1, 0.8 * v); this.tone(t, 'sine', 140, 40, 0.16, 0.9 * v); break;
      case 'smash': this.noiseHit(t, 0.35, 2200, 0.6, 0.9 * v); this.tone(t, 'sine', 120, 35, 0.3, 1 * v); this.chord(t, 82.4 * 2, 0.7, 0.55 * v, 4200); this.chord(t, 87.3 * 2, 0.5, 0.35 * v, 3000); break;
      case 'block': this.noiseHit(t, 0.06, 3500, 2, 0.5 * v); this.tone(t, 'square', 950, 700, 0.07, 0.15 * v); break;
      case 'whoosh': { const f = this.noiseHit(t, 0.18, 500, 1.5, 0.25 * v); f.frequency.exponentialRampToValueAtTime(2600, t + 0.16); break; }
      case 'jump': { const f = this.noiseHit(t, 0.12, 400, 1.2, 0.15 * v); f.frequency.exponentialRampToValueAtTime(1500, t + 0.1); break; }
      case 'fire': this.noiseHit(t, 0.45, 700, 0.6, 0.35 * v, 'lowpass'); this.noiseHit(t, 0.3, 3000, 1, 0.12 * v); break;
      case 'boom': this.noiseHit(t, 0.6, 400, 0.5, 0.9 * v, 'lowpass'); this.tone(t, 'sine', 90, 30, 0.5, 0.9 * v); break;
      case 'miss': this.tone(t, 'square', 110, 92, 0.18, 0.18 * v); this.tone(t, 'square', 117, 98, 0.18, 0.18 * v); break;
      case 'select': this.tone(t, 'square', 660, 990, 0.08, 0.15 * v); break;
      case 'confirm': this.chord(t, 164.8, 0.5, 0.4 * v, 3500); break;
      case 'ko': this.chord(t, 82.4, 1.6, 0.6 * v, 3000); this.chord(t + 0.02, 82.4 * 2, 1.4, 0.4 * v, 5000); this.tone(t, 'sine', 70, 28, 0.8, 1 * v); this.sfx('cheer', 1.4); break;
      case 'cheer': {
        const c = this.ctx, s = c.createBufferSource(); s.buffer = this.noise; s.loop = true;
        const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1300; f.Q.value = 0.5;
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 * v, t + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
        s.connect(f); f.connect(g); g.connect(this.sfxGain); s.start(t); s.stop(t + 2.3);
        for (let i = 0; i < 4; i++) { const w = t + rnd(0.1, 1.2); this.tone(w, 'sine', rnd(1800, 2600), rnd(2600, 3400), rnd(0.15, 0.35), 0.05 * v); }
        break;
      }
      case 'roar': this.sfx('cheer', 1.6); this.noiseHit(t, 0.6, 600, 0.6, 0.5 * v, 'lowpass'); this.tone(t, 'sawtooth', 190, 85, 0.5, 0.22 * v); this.tone(t, 'square', 95, 60, 0.45, 0.2 * v); break;
      case 'coin': this.tone(t, 'square', 988, 988, 0.06, 0.12 * v); this.tone(t + 0.06, 'square', 1319, 1319, 0.12, 0.12 * v); break;
      case 'kaching': this.noiseHit(t, 0.08, 5000, 2, 0.4 * v); this.tone(t + 0.05, 'triangle', 1568, 1568, 0.5, 0.25 * v); this.tone(t + 0.05, 'triangle', 2093, 2093, 0.5, 0.18 * v); break;
      case 'heal': [523, 659, 784, 1047].forEach((f, i) => this.tone(t + i * 0.07, 'sine', f, f, 0.25, 0.22 * v)); break;
      case 'jingle': [784, 659, 784, 988, 880, 988, 1175].forEach((f, i) => this.tone(t + i * 0.11, 'triangle', f, f, 0.18, 0.2 * v)); break;
      case 'boo': {
        const f = this.noiseHit(t, 0.9, 300, 0.8, 0.18 * v, 'lowpass');
        this.tone(t, 'sawtooth', 140, 110, 0.8, 0.05 * v); break;
      }
    }
  },
  lead(lane, perfect) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime, c = this.ctx;
    const scale = [329.6, 392, 440, 493.9, 587.3, 659.3, 784, 880];
    const f0 = scale[clamp(lane * 2 + irnd(3), 0, 7)] * (perfect ? 2 : 1);
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 0.94, t); o.frequency.exponentialRampToValueAtTime(f0, t + 0.04);
    const lfo = c.createOscillator(); lfo.frequency.value = 6.5; const lg = c.createGain(); lg.gain.value = f0 * 0.012; lfo.connect(lg); lg.connect(o.frequency);
    const sh = c.createWaveShaper(); sh.curve = this.curve;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 4500;
    const g = c.createGain(); this.env(g, t, 0.005, 0.35, 0.38);
    o.connect(sh); sh.connect(f); f.connect(g); g.connect(this.sfxGain);
    o.start(t); lfo.start(t); o.stop(t + 0.42); lfo.stop(t + 0.42);
  },
};

const music = {
  bpm: 144, step: 0, next: 0, timer: 0, intensity: 1,
  start() {
    if (this.timer) return;
    this.next = audio.t + 0.08; this.step = 0;
    this.timer = setInterval(() => this.tick(), 25);
  },
  tick() {
    const c = audio.ctx; if (!c || audio.muted) { if (c) this.next = c.currentTime + 0.05; return; }
    const sp = 60 / this.bpm / 4;
    while (this.next < c.currentTime + 0.12) { this.play(this.step, this.next); this.next += sp; this.step++; }
  },
  // E minor riff: bars of power chords + palm-muted chugs
  play(s, t) {
    const G = audio.musGain, st = s % 16, bar = (s >> 4) % 8;
    const prog = [0, 0, 3, 5, 0, 0, 7, 5];
    const root = 82.41 * Math.pow(2, prog[bar] / 12);
    const scene = game.scene, calm = scene === 'title' || scene === 'mode' || scene === 'select';
    // drums
    if (st === 0 || st === 7 || st === 10 || (!calm && st === 14)) { audio.tone(t, 'sine', 150, 42, 0.18, 0.9, G); audio.noiseHit(t, 0.02, 3000, 1, 0.2, 'bandpass', G); }
    if (st === 4 || st === 12) { audio.noiseHit(t, 0.16, 1800, 0.7, 0.55, 'bandpass', G); audio.tone(t, 'triangle', 220, 160, 0.08, 0.3, G); }
    if (st % 2 === 0) audio.noiseHit(t, st % 4 === 2 ? 0.05 : 0.025, 8000, 1, 0.14, 'highpass', G);
    if (bar === 7 && st >= 12) audio.noiseHit(t, 0.1, 1500 + st * 120, 0.8, 0.35, 'bandpass', G);
    if (bar === 0 && st === 0) audio.noiseHit(t, 0.9, 6000, 0.4, 0.22, 'highpass', G); // crash
    // bass
    if (st % 2 === 0) audio.tone(t, 'sawtooth', root / 2, root / 2, 0.11, 0.22, G);
    // guitar
    const open = st === 0 || st === 3 || st === 6 || st === 8 || (bar % 2 === 1 && st === 11);
    if (open) audio.chord(t, root, calm ? 0.5 : 0.36, 0.3, 3200, G);
    else if (st % 2 === 0) audio.chord(t, root, 0.09, 0.2, 750, G);
  },
  get beat() { // continuous beat phase (beats)
    if (audio.ctx && this.timer && !audio.muted) return (audio.t - (this.next - this.step * 60 / this.bpm / 4)) * this.bpm / 60;
    return game.t / 60 * this.bpm / 60;
  },
};

// =====================================================================================
//  CHARACTERS
// =====================================================================================
const CHARS = {
  lula: {
    id: 'lula', name: 'LULA', nick: '"O BARBA"', full: 'LULA "O BARBA"',
    len: { torso: 92, thigh: 58, shin: 58, upper: 52, fore: 50 },
    limb: { thigh: 32, shin: 27, upper: 25, fore: 22 },
    walk: 3.7, jump: -18.5, power: 1.08,
    skin: '#d99d73', skinS: '#a5664a',
    pants: '#262a40', pantsS: '#161829',
    sleeve: '#c8122c', sleeveS: '#7a0a1c',
    fore: '#c8122c', foreS: '#7a0a1c',
    boot: '#1b1418', bootS: '#0a0709',
    guitar: 'v', gtrCol: '#e3121c', gtrColS: '#8d0a12', gtrGuard: '#f6f0e4',
    accent: '#ff2a2a', accent2: '#ffd400', bg: ['#5a0010', '#c8102e'],
    proj: 'foice', projName: 'FOICE E MARTELO', proj2: 'sigilo', proj2Name: 'LIBERA O SIGILO!', heavy: 'hammer', superName: 'SOLO DO COMPANHEIRO',
    moves: ['R: FOICE E MARTELO', '↓+R: LIBERA O SIGILO!', 'H: MARTELADA'],
    torcida: { name: 'EXÉRCITO DO LULA', leader: 'JANONES', leaderId: 'janones', shout: 'EXPLODE!!!', say: 'Explode!', pitch: 1.35,
      col: '#c8122c', cloth: '#c8122c', emblem: 'star', emblemCol: '#ffd400', tint: '#ff4a5a', signs: ['COMPANHEIRO', 'O BARBA', 'PICANHA'] },
    stats: [['FORÇA', 5], ['VELOCIDADE', 3], ['CARISMA', 5]],
    quotes: ['Nunca antes na história deste país se viu um solo desses, companheiro!', 'Picanha e rock\'n\'roll pra todo mundo!', 'Companheiro, eu toco guitarra desde o tempo da fábrica!'],
    taunts: ['COMPANHEIRO!', 'É O BARBA!', 'PICANHA!'],
  },
  flavio: {
    id: 'flavio', name: 'FLÁVIO', nick: '"ZERO UM"', full: 'FLÁVIO "ZERO UM"',
    len: { torso: 98, thigh: 64, shin: 62, upper: 55, fore: 52 },
    limb: { thigh: 30, shin: 25, upper: 23, fore: 20 },
    walk: 4.5, jump: -19.5, power: 0.96,
    skin: '#f0c39b', skinS: '#c58b66',
    pants: '#2c4f8a', pantsS: '#1a3160',
    sleeve: '#ffd21a', sleeveS: '#c99200',
    fore: '#f0c39b', foreS: '#c58b66',
    boot: '#f4f4f0', bootS: '#b9bcc4',
    guitar: 'x', gtrCol: '#0e9a48', gtrColS: '#05592a', gtrGuard: '#ffd21a',
    accent: '#ffd21a', accent2: '#0e9a48', bg: ['#063d1f', '#0e9a48'],
    proj: 'bola', projName: 'BOLA ZERO UM', proj2: 'lulinha', proj2Name: 'E O LULINHA?', heavy: 'guitar', superName: 'SOLO ZERO UM',
    moves: ['R: BOLA ZERO UM', '↓+R: E O LULINHA?', 'H: GUITARRADA'],
    torcida: { name: 'TROPA DO FLÁVIO', leader: 'NIKOLAS "CHUPETINHA"', leaderId: 'nikolas', shout: 'AVANTE, TROPA!!!', say: 'Avante, tropa!', pitch: 1.1,
      col: '#0e9a48', cloth: '#0e9a48', emblem: '01', emblemCol: '#ffd21a', tint: '#c8ff3a', signs: ['ZERO UM', 'MERMÃO', 'TROPA'] },
    stats: [['FORÇA', 4], ['VELOCIDADE', 5], ['CARISMA', 3]],
    quotes: ['Zero Um no placar, zero chance pra você!', 'Isso aqui é rock carioca, mermão!', 'Pode pedir música que hoje o show é meu!'],
    taunts: ['ZERO UM!', 'MERMÃO!', 'GOOOL!'],
  },
};

// =====================================================================================
//  POSES (angles: 0 = pointing down, + = rotates toward facing/forward)
// =====================================================================================
const PK = ['lean', 'head', 'sb', 'eb', 'sf', 'ef', 'hb', 'kb', 'hf', 'kf', 'rot'];
function P(o) { const p = {}; for (const k of PK) p[k] = (o[k] || 0) * D; return p; }
const POSES = {
  idle: P({ lean: 8, head: -4, sb: 30, eb: 105, sf: 45, ef: 100, hb: -20, kb: -8, hf: 22, kf: -28 }),
  crouch: P({ lean: 24, head: -14, sb: 40, eb: 115, sf: 55, ef: 110, hb: 30, kb: -118, hf: 78, kf: -112 }),
  jump: P({ lean: 6, head: -6, sb: -30, eb: 60, sf: 30, ef: 110, hb: 18, kb: -95, hf: 62, kf: -100 }),
  punchW: P({ lean: 4, head: -4, sb: 35, eb: 110, sf: 28, ef: 128, hb: -22, kb: -8, hf: 24, kf: -30 }),
  punchS: P({ lean: 20, head: 2, sb: 22, eb: 110, sf: 90, ef: 4, hb: -30, kb: -4, hf: 30, kf: -20 }),
  cpunchS: P({ lean: 30, head: -6, sb: 30, eb: 110, sf: 82, ef: 4, hb: 30, kb: -118, hf: 78, kf: -112 }),
  kickW: P({ lean: -6, head: -6, sb: 40, eb: 100, sf: 30, ef: 100, hb: -8, kb: -4, hf: 72, kf: -122 }),
  kickS: P({ lean: -22, head: -10, sb: 60, eb: 60, sf: 12, ef: 90, hb: -10, kb: 0, hf: 100, kf: -4 }),
  heavyW: P({ lean: -14, head: -12, sb: 30, eb: 90, sf: -165, ef: -15, hb: -26, kb: -6, hf: 20, kf: -24 }),
  heavyS: P({ lean: 30, head: 4, sb: 10, eb: 60, sf: 98, ef: 4, hb: -34, kb: -4, hf: 42, kf: -50 }),
  sweepW: P({ lean: 28, head: -10, sb: 40, eb: 110, sf: 60, ef: 100, hb: 28, kb: -118, hf: 70, kf: -110 }),
  sweepS: P({ lean: 34, head: -8, sb: 10, eb: 60, sf: 80, ef: 30, hb: 30, kb: -115, hf: 88, kf: -4 }),
  airkS: P({ lean: -12, head: -6, sb: -20, eb: 70, sf: 20, ef: 100, hb: 12, kb: -100, hf: 78, kf: -8 }),
  airpS: P({ lean: 26, sb: -10, eb: 80, sf: 70, ef: 4, hb: 12, kb: -90, hf: 52, kf: -100 }),
  projW: P({ lean: -10, head: -6, sb: 40, eb: 80, sf: -130, ef: 50, hb: -24, kb: -6, hf: 22, kf: -28 }),
  projS: P({ lean: 24, sb: 10, eb: 60, sf: 86, ef: 4, hb: -30, kb: -4, hf: 32, kf: -24 }),
  block: P({ lean: -6, head: -16, sb: 55, eb: 135, sf: 66, ef: 135, hb: -20, kb: -10, hf: 18, kf: -32 }),
  cblock: P({ lean: 10, head: -20, sb: 55, eb: 135, sf: 66, ef: 135, hb: 30, kb: -118, hf: 78, kf: -112 }),
  hit: P({ lean: -26, head: -24, sb: -40, eb: 40, sf: -20, ef: 50, hb: -14, kb: -8, hf: 30, kf: -20 }),
  down: P({ lean: 0, head: -10, sb: -150, eb: 10, sf: -120, ef: 20, hb: 10, kb: -10, hf: 34, kf: -34, rot: -84 }),
  chant: P({ lean: -6, head: -10, sb: 30, eb: 100, sf: 150, ef: 30, hb: -14, kb: -6, hf: 16, kf: -14 }),
  cheer: P({ lean: -16, head: -18, sb: -165, eb: 10, sf: 165, ef: 8, hb: -20, kb: -8, hf: 22, kf: -16 }),
  shock: P({ lean: -14, head: -25, sb: -130, eb: 30, sf: -110, ef: -30, hb: -25, kb: 0, hf: 30, kf: 0 }),
  shred: P({ lean: -10, head: 12, hb: -30, kb: -10, hf: 34, kf: -22 }),
  win: P({ lean: -6, head: -14, sb: 30, eb: 100, sf: 168, ef: 8, hb: -22, kb: -6, hf: 22, kf: -12 }),
};
function copyPose(p) { const o = {}; for (const k of PK) o[k] = p[k]; return o; }
function lerpPose(cur, tgt, t) { for (const k of PK) cur[k] += (tgt[k] - cur[k]) * t; }

// =====================================================================================
//  DRAWING PRIMITIVES
// =====================================================================================
function pathPts(c, pts, close = true) { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); if (close) c.closePath(); }
function inked(c, fill, lw = 4.5) { c.fillStyle = fill; c.fill(); c.lineWidth = lw; c.strokeStyle = OUT; c.lineJoin = 'round'; c.stroke(); }
function ell(c, x, y, rx, ry, r = 0) { c.beginPath(); c.ellipse(x, y, Math.abs(rx), Math.abs(ry), r, 0, TAU); }
function line(c, x1, y1, x2, y2) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
const dirv = a => [Math.sin(a), Math.cos(a)];

// limb: chain of points drawn as cel-shaded tubes with a single ink outline
function limb(c, pts, widths, cols, shades, rim) {
  c.lineCap = 'round'; c.lineJoin = 'round';
  c.strokeStyle = OUT;
  for (let i = 0; i < pts.length - 1; i++) { c.lineWidth = widths[i] + 9; line(c, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]); }
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1], w = widths[i];
    c.strokeStyle = shades[i]; c.lineWidth = w; line(c, x1, y1, x2, y2);
    // lit band, nudged toward the key light (up / forward)
    const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, nx = dy / L, ny = -dx / L;
    const s = (ny < 0 ? 1 : -1) * w * 0.17;
    c.strokeStyle = cols[i]; c.lineWidth = w * 0.52; line(c, x1 + nx * s, y1 + ny * s, x2 + nx * s, y2 + ny * s);
    // nanquim: short hatch strokes along the shadow edge (GH3 comic-ink look)
    c.strokeStyle = 'rgba(19,10,22,.55)'; c.lineWidth = 1.3; c.lineCap = 'butt';
    const hx = -nx * Math.sign(s) * w * 0.36, hy = -ny * Math.sign(s) * w * 0.36, n = Math.floor(L / 6);
    c.beginPath();
    for (let k = 1; k < n; k++) { const u = k / n, px = x1 + dx * u + hx, py = y1 + dy * u + hy; c.moveTo(px - nx * Math.sign(s) * 3 - dx / L * 3, py - ny * Math.sign(s) * 3 - dy / L * 3); c.lineTo(px + nx * Math.sign(s) * 3 + dx / L * 3, py + ny * Math.sign(s) * 3 + dy / L * 3); }
    c.stroke(); c.lineCap = 'round';
    if (rim) { c.strokeStyle = rim; c.lineWidth = 2.2; c.globalAlpha = 0.55; line(c, x1 - nx * w * 0.42, y1 - ny * w * 0.42, x2 - nx * w * 0.42, y2 - ny * w * 0.42); c.globalAlpha = 1; }
  }
}

// diagonal ink hatching inside the current clip/region
function hatch(c, x0, y0, x1, y1, gap = 5, col = 'rgba(19,10,22,.4)', lw = 1.3) {
  c.strokeStyle = col; c.lineWidth = lw; c.beginPath();
  for (let x = x0 - (y1 - y0); x < x1; x += gap) { c.moveTo(x, y1); c.lineTo(x + (y1 - y0), y0); }
  c.stroke();
}
function ik2(sx, sy, tx, ty, a, b, bend) {
  const dx = tx - sx, dy = ty - sy;
  const d = clamp(Math.hypot(dx, dy), 1, a + b - 0.5);
  const ang = Math.atan2(dy, dx);
  const A = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  const e = ang + bend * A;
  return { el: [sx + Math.cos(e) * a, sy + Math.sin(e) * a], hand: [sx + Math.cos(ang) * d, sy + Math.sin(ang) * d] };
}

// ---------- GUITARS (body at origin, neck toward +x, headstock ends at ~x=170)
function drawGuitar(c, d) {
  c.lineJoin = 'round';
  // neck
  c.beginPath(); c.rect(12, -6, 120, 12); inked(c, '#5b3417', 3.5);
  c.strokeStyle = '#e7d9ae'; c.lineWidth = 1.6;
  for (let x = 30; x < 130; x += 9.5) line(c, x, -5, x, 5);
  c.fillStyle = '#f2ead6'; for (const x of [44, 63, 82, 110]) { ell(c, x, 0, 1.8, 1.8); c.fill(); }
  // headstock
  if (d.guitar === 'v') pathPts(c, [128, -8, 168, -17, 176, -6, 172, 8, 128, 8]);
  else pathPts(c, [128, -8, 160, -22, 174, -16, 162, 8, 128, 8]);
  inked(c, d.gtrCol, 3.5);
  c.fillStyle = '#d8d8d8'; for (let i = 0; i < 3; i++) { ell(c, 140 + i * 10, -10 - i * 2.5, 2.5, 2.5); c.fill(); }
  // body
  if (d.guitar === 'v') {
    c.beginPath(); c.moveTo(34, -11); c.lineTo(-58, -54); c.quadraticCurveTo(-78, -60, -76, -40); c.lineTo(-30, 0); c.lineTo(-76, 40);
    c.quadraticCurveTo(-78, 60, -58, 54); c.lineTo(34, 11); c.closePath(); inked(c, d.gtrCol);
    c.save(); c.clip(); c.fillStyle = d.gtrColS; c.beginPath(); c.moveTo(34, 4); c.lineTo(-80, 30); c.lineTo(-80, 70); c.lineTo(40, 70); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.lineWidth = 3; line(c, 24, -12, -56, -48); c.restore();
    pathPts(c, [26, -9, -20, -30, -32, -16, -12, 0, -32, 16, -20, 30, 26, 9]); inked(c, d.gtrGuard, 2.5);
  } else {
    c.beginPath(); c.moveTo(34, -12); c.lineTo(-6, -30); c.lineTo(-40, -62); c.lineTo(-56, -50); c.lineTo(-70, -6); c.lineTo(-62, 26);
    c.lineTo(-30, 44); c.lineTo(10, 24); c.lineTo(34, 12); c.closePath(); inked(c, d.gtrCol);
    c.save(); c.clip(); c.fillStyle = d.gtrColS; c.beginPath(); c.moveTo(40, 6); c.lineTo(-80, 16); c.lineTo(-80, 60); c.lineTo(40, 60); c.fill(); c.restore();
    // yellow bevel stripe + blue star (flag colors)
    c.strokeStyle = d.gtrGuard; c.lineWidth = 5; c.beginPath(); c.moveTo(28, -10); c.lineTo(-8, -26); c.lineTo(-40, -55); c.stroke();
    c.save(); c.translate(-34, 8); c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 6 : 14, a = i / 10 * TAU - Math.PI / 2; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); inked(c, '#1f3fbf', 2.5); c.restore();
  }
  // pickups, bridge, knobs
  for (const x of [-2, 16]) { c.beginPath(); c.rect(x - 5, -10, 10, 20); inked(c, '#1b1b1f', 2.5); }
  c.beginPath(); c.rect(-18, -8, 6, 16); inked(c, '#c9c9c9', 2);
  c.fillStyle = '#ddd'; for (const [x, y] of [[-40, 18], [-50, 24], [-44, 30]]) { ell(c, x, y, 3.5, 3.5); c.fill(); c.lineWidth = 1.5; c.strokeStyle = OUT; c.stroke(); }
  // strings
  c.strokeStyle = 'rgba(240,240,240,.8)'; c.lineWidth = 0.9;
  for (let i = -3; i <= 3; i += 2) line(c, -16, i * 1.1, 130, i * 0.9);
}

// ---------- HEADS (origin = top of neck, +x = face direction)
function brows(c, x1, y1, x2, y2, w, col) { c.strokeStyle = OUT; c.lineCap = 'round'; c.lineWidth = w + 4; line(c, x1, y1, x2, y2); c.strokeStyle = col; c.lineWidth = w; line(c, x1, y1, x2, y2); }
function eye(c, x, y, rx, ry, ex, irisCol = '#2a1a10') {
  if (ex.ko) { c.strokeStyle = OUT; c.lineWidth = 3; line(c, x - rx, y - ry, x + rx, y + ry); line(c, x - rx, y + ry, x + rx, y - ry); return; }
  if (ex.hurt || ex.blink) { c.strokeStyle = OUT; c.lineWidth = 3; c.beginPath(); c.moveTo(x - rx, y - (ex.hurt ? 2 : 0)); c.lineTo(x + rx * 0.2, y + 2); c.lineTo(x + rx, y - (ex.hurt ? 3 : 0)); c.stroke(); return; }
  ell(c, x, y, rx, ry); c.fillStyle = '#fbf6ea'; c.fill(); c.lineWidth = 2.5; c.strokeStyle = OUT; c.stroke();
  ell(c, x + rx * 0.3, y + 0.5, ry * 0.85, ry * 0.85); c.fillStyle = irisCol; c.fill();
  c.fillStyle = '#fff'; ell(c, x + rx * 0.45, y - ry * 0.3, 1.2, 1.2); c.fill();
}

function headLula(c, ex) {
  const SK = '#d99d73', SKS = '#a5664a', HR = '#c8c4bf', HRS = '#8a8580', BD = '#ece9e3', BDS = '#aaa49d';
  // skull + face
  c.beginPath(); c.moveTo(-24, -22); c.bezierCurveTo(-40, -56, -30, -98, 14, -98); c.bezierCurveTo(40, -96, 50, -76, 48, -56);
  c.bezierCurveTo(48, -40, 46, -24, 40, -14); c.bezierCurveTo(30, 2, 0, 6, -14, -4); c.closePath();
  inked(c, SK);
  c.save(); c.clip();
  c.fillStyle = SKS; c.beginPath(); c.moveTo(-40, -110); c.bezierCurveTo(-6, -90, -10, -50, 4, 10); c.lineTo(-60, 10); c.fill();
  c.save(); c.beginPath(); c.moveTo(-40, -110); c.bezierCurveTo(-6, -90, -10, -50, 4, 10); c.lineTo(-60, 10); c.clip(); hatch(c, -40, -110, 10, 10, 4.5); c.restore();
  c.strokeStyle = 'rgba(120,60,40,.6)'; c.lineWidth = 2; // forehead wrinkles
  for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(14, -84 + i * 6); c.quadraticCurveTo(30, -88 + i * 6, 44, -82 + i * 6); c.stroke(); }
  c.restore();
  // hair: receding, combed back, grey
  c.beginPath(); c.moveTo(-27, -36); c.bezierCurveTo(-38, -60, -30, -96, 4, -100); c.bezierCurveTo(16, -101, 24, -99, 28, -96);
  c.bezierCurveTo(16, -93, 6, -88, 0, -78); c.bezierCurveTo(-6, -66, -9, -52, -12, -38); c.closePath(); inked(c, HR, 4);
  c.save(); c.clip(); c.fillStyle = HRS; c.beginPath(); c.moveTo(-50, -60); c.bezierCurveTo(-24, -60, -16, -40, -14, -10); c.lineTo(-50, -10); c.fill(); c.restore();
  c.strokeStyle = HRS; c.lineWidth = 1.8;
  for (let i = 0; i < 4; i++) { c.beginPath(); c.moveTo(22 - i * 7, -97 + i * 2); c.quadraticCurveTo(-16 - i * 3, -90 + i * 5, -27 + i * 2, -50 + i * 4); c.stroke(); }
  // ear
  ell(c, -12, -46, 9, 13, -0.2); inked(c, SK, 3.5);
  c.strokeStyle = SKS; c.lineWidth = 2.5; c.beginPath(); c.arc(-11, -46, 5, -1.2, 1.6); c.stroke();
  // beard (full, white-grey, trimmed)
  c.beginPath(); c.moveTo(-12, -56); c.bezierCurveTo(-20, -32, -16, -8, 2, 2); c.bezierCurveTo(14, 10, 32, 8, 42, -4);
  c.bezierCurveTo(48, -12, 50, -22, 48, -30); c.bezierCurveTo(42, -36, 32, -38, 24, -34); c.bezierCurveTo(16, -32, 10, -38, 8, -44);
  c.bezierCurveTo(4, -50, -2, -54, -6, -58); c.closePath(); inked(c, BD, 4);
  c.save(); c.clip();
  c.fillStyle = BDS; c.beginPath(); c.moveTo(-30, -40); c.bezierCurveTo(-4, -30, 10, -6, 50, -10); c.lineTo(50, 20); c.lineTo(-30, 20); c.fill();
  c.strokeStyle = 'rgba(110,105,100,.55)'; c.lineWidth = 1.6;
  for (let i = 0; i < 14; i++) { const x = -10 + (i * 37 % 52), y = -40 + (i * 23 % 40); c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 2, y + 4, x + 1, y + 7); c.stroke(); }
  c.restore();
  // mouth
  const mo = ex.mouth || 0;
  ell(c, 34, -18, 10, 3 + mo * 7); c.fillStyle = '#4a1414'; c.fill(); c.lineWidth = 2.5; c.strokeStyle = OUT; c.stroke();
  c.save(); ell(c, 34, -18, 10, 3 + mo * 7); c.clip(); c.fillStyle = '#fff6e6'; c.fillRect(22, -22 - mo * 7, 24, 4 + mo * 2); c.restore();
  // moustache
  c.beginPath(); c.moveTo(20, -30); c.bezierCurveTo(28, -36, 44, -36, 52, -28); c.bezierCurveTo(50, -22, 44, -22, 38, -25);
  c.bezierCurveTo(32, -22, 24, -22, 20, -30); c.closePath(); inked(c, BD, 3.5);
  c.strokeStyle = BDS; c.lineWidth = 1.5; line(c, 30, -31, 32, -26); line(c, 40, -31, 42, -26);
  // nose: big, round
  c.beginPath(); c.moveTo(36, -66); c.bezierCurveTo(40, -56, 44, -50, 50, -46); c.bezierCurveTo(60, -42, 58, -32, 50, -32);
  c.bezierCurveTo(46, -30, 42, -32, 38, -35); c.bezierCurveTo(34, -34, 30, -38, 34, -42); inked(c, SK, 3.5);
  c.fillStyle = SKS; ell(c, 44, -36, 4, 2.5); c.fill();
  c.fillStyle = 'rgba(255,220,190,.7)'; ell(c, 51, -42, 3, 2); c.fill();
  // eyes (squinty, smiling)
  eye(c, 23, -58, 6, 3.6, ex); eye(c, 45, -59, 3.5, 3.2, ex);
  if (!ex.ko) { c.strokeStyle = 'rgba(110,50,30,.7)'; c.lineWidth = 1.6; line(c, 13, -56, 9, -52); line(c, 13, -60, 8, -61); line(c, 22, -52, 28, -51); }
  // brows: thick dark grey
  if (ex.angry) { brows(c, 14, -70, 32, -63, 5.5, '#4b4744'); brows(c, 40, -64, 50, -69, 4.5, '#4b4744'); }
  else { brows(c, 14, -67, 32, -70, 5.5, '#4b4744'); brows(c, 40, -70, 50, -68, 4.5, '#4b4744'); }
}

function headFlavio(c, ex) {
  const SK = '#f0c39b', SKS = '#c58b66', HR = '#2b1d14', HRL = '#5a4232';
  // face: round, full cheeks, soft double chin
  c.beginPath(); c.moveTo(-28, -30); c.bezierCurveTo(-40, -72, -18, -102, 14, -100); c.bezierCurveTo(42, -98, 52, -78, 50, -58);
  c.bezierCurveTo(52, -44, 52, -28, 46, -16); c.bezierCurveTo(38, 2, 20, 8, 4, 6); c.bezierCurveTo(-12, 4, -24, -10, -28, -30); c.closePath();
  inked(c, SK);
  c.save(); c.clip();
  c.fillStyle = SKS; c.beginPath(); c.moveTo(-40, -110); c.bezierCurveTo(-4, -86, -6, -40, 12, 12); c.lineTo(-60, 12); c.fill();
  c.save(); c.beginPath(); c.moveTo(-40, -110); c.bezierCurveTo(-4, -86, -6, -40, 12, 12); c.lineTo(-60, 12); c.clip(); hatch(c, -40, -110, 14, 12, 4.5); c.restore();
  // stubble shadow
  c.fillStyle = 'rgba(70,80,105,.22)'; c.beginPath(); c.moveTo(-20, -46); c.bezierCurveTo(0, -36, 14, -40, 30, -30); c.bezierCurveTo(44, -32, 52, -26, 56, -24); c.lineTo(56, 14); c.lineTo(-30, 14); c.fill();
  c.restore();
  // double chin line + jaw
  c.strokeStyle = OUT; c.lineWidth = 2.5; c.beginPath(); c.moveTo(8, 0); c.quadraticCurveTo(26, 0, 36, -10); c.stroke();
  c.strokeStyle = SKS; c.lineWidth = 2; c.beginPath(); c.moveTo(30, -36); c.quadraticCurveTo(38, -26, 46, -26); c.stroke();
  // ear
  ell(c, -10, -48, 9, 13, -0.2); inked(c, SK, 3.5);
  c.strokeStyle = SKS; c.lineWidth = 2.5; c.beginPath(); c.arc(-9, -48, 5, -1.2, 1.6); c.stroke();
  // hair: short, dark, side part, receding temples
  c.beginPath(); c.moveTo(-26, -40); c.bezierCurveTo(-40, -70, -26, -106, 10, -106); c.bezierCurveTo(34, -106, 50, -96, 48, -80);
  c.bezierCurveTo(44, -84, 38, -86, 32, -84); c.bezierCurveTo(26, -86, 22, -84, 18, -80); c.bezierCurveTo(10, -80, 4, -76, 0, -70);
  c.bezierCurveTo(-6, -64, -10, -54, -14, -44); c.closePath(); inked(c, HR, 4);
  c.strokeStyle = HRL; c.lineWidth = 2.2;
  c.beginPath(); c.moveTo(-10, -96); c.quadraticCurveTo(14, -104, 40, -94); c.stroke();
  c.beginPath(); c.moveTo(-18, -86); c.quadraticCurveTo(4, -96, 26, -92); c.stroke();
  c.strokeStyle = OUT; c.lineWidth = 2; c.beginPath(); c.moveTo(4, -104); c.quadraticCurveTo(-8, -92, -16, -76); c.stroke(); // side part
  // eyes: small, dark
  eye(c, 24, -60, 5.2, 3.6, ex); eye(c, 44, -61, 3.4, 3.2, ex);
  if (!ex.ko && !ex.hurt) { c.strokeStyle = OUT; c.lineWidth = 2.2; line(c, 18, -64, 30, -64); line(c, 41, -64, 47, -64); }
  // brows: dark, straight, heavy
  if (ex.angry) { brows(c, 14, -72, 32, -66, 5, '#24170f'); brows(c, 39, -67, 50, -72, 4.5, '#24170f'); }
  else { brows(c, 14, -70, 32, -71, 5, '#24170f'); brows(c, 39, -71, 50, -70, 4.5, '#24170f'); }
  // nose: straight, medium
  c.beginPath(); c.moveTo(38, -64); c.bezierCurveTo(42, -54, 50, -48, 54, -42); c.bezierCurveTo(56, -36, 50, -34, 46, -36);
  c.bezierCurveTo(42, -34, 38, -36, 38, -40); inked(c, SK, 3.5);
  c.fillStyle = SKS; ell(c, 46, -38, 3, 2); c.fill();
  // mouth: smirk / shout
  const mo = ex.mouth || 0;
  if (mo > 0.15) {
    ell(c, 38, -22, 9, 2 + mo * 8); c.fillStyle = '#4a1414'; c.fill(); c.lineWidth = 2.5; c.strokeStyle = OUT; c.stroke();
    c.save(); ell(c, 38, -22, 9, 2 + mo * 8); c.clip(); c.fillStyle = '#fff6e6'; c.fillRect(28, -26 - mo * 8, 20, 4 + mo * 2); c.restore();
  } else {
    c.strokeStyle = OUT; c.lineWidth = 3; c.lineCap = 'round'; c.beginPath(); c.moveTo(28, -22); c.quadraticCurveTo(38, -20, 48, -26); c.stroke();
    c.strokeStyle = '#b86b5a'; c.lineWidth = 2; c.beginPath(); c.moveTo(32, -18); c.quadraticCurveTo(38, -16, 44, -19); c.stroke();
  }
}
const HEADS = { lula: headLula, flavio: headFlavio };

// ---------- TORSO (local frame: hip at 0,0, torso extends to y = -L)
function drawTorso(c, d, L, t) {
  const s = L / 98;
  c.save(); c.scale(1, s);
  // pelvis / pants top
  c.beginPath(); c.moveTo(-28, -6); c.lineTo(26, -6); c.lineTo(28, 14); c.lineTo(-28, 14); c.closePath(); inked(c, d.pants);
  let body;
  if (d.id === 'lula') {
    body = () => { c.beginPath(); c.moveTo(-28, 4); c.bezierCurveTo(-36, -30, -38, -60, -34, -82); c.quadraticCurveTo(-30, -98, -10, -100);
      c.lineTo(18, -100); c.quadraticCurveTo(36, -96, 36, -80); c.bezierCurveTo(38, -62, 54, -42, 46, -14); c.bezierCurveTo(42, 2, 30, 8, 22, 8); c.closePath(); };
  } else {
    body = () => { c.beginPath(); c.moveTo(-26, 4); c.bezierCurveTo(-32, -30, -36, -64, -34, -84); c.quadraticCurveTo(-30, -100, -10, -102);
      c.lineTo(18, -102); c.quadraticCurveTo(38, -98, 38, -82); c.bezierCurveTo(40, -62, 44, -36, 38, -12); c.bezierCurveTo(36, 2, 28, 8, 20, 8); c.closePath(); };
  }
  body(); inked(c, d.id === 'lula' ? '#c8122c' : '#ffd21a', 5);
  c.save(); body(); c.clip();
  if (d.id === 'lula') {
    // jacket shading
    c.fillStyle = '#7a0a1c'; c.beginPath(); c.moveTo(-40, -110); c.bezierCurveTo(-14, -70, -18, -30, -10, 10); c.lineTo(-50, 10); c.fill();
    c.save(); c.clip(); hatch(c, -50, -110, -8, 10, 5); c.restore();
    c.save(); body(); c.clip();
    // black tee under open jacket, with red star
    c.beginPath(); c.moveTo(10, -102); c.lineTo(30, -102); c.bezierCurveTo(44, -70, 58, -40, 50, -10); c.lineTo(46, 10); c.lineTo(16, 10); c.bezierCurveTo(22, -30, 18, -70, 10, -102); c.closePath();
    inked(c, '#1c1a21', 3.5);
    c.save(); c.translate(36, -56); c.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 5 : 11, a = i / 10 * TAU - Math.PI / 2; c.lineTo(Math.cos(a) * r * 0.75, Math.sin(a) * r); } c.closePath(); inked(c, '#e3121c', 2); c.restore();
    // lapel + studs
    c.strokeStyle = '#ff5a6e'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(8, -98); c.bezierCurveTo(16, -70, 20, -30, 14, 8); c.stroke();
    c.fillStyle = '#e6e6ee'; for (let i = 0; i < 5; i++) { ell(c, -20 + i * 8, -92 + Math.abs(i - 2) * 1.5, 2.4, 2.4); c.fill(); }
    // rim light
    c.strokeStyle = 'rgba(255,90,200,.55)'; c.lineWidth = 3; c.beginPath(); c.moveTo(-33, -6); c.bezierCurveTo(-38, -40, -38, -66, -32, -86); c.stroke();
  } else {
    // jersey shading
    c.fillStyle = '#c99200'; c.beginPath(); c.moveTo(-40, -110); c.bezierCurveTo(-14, -70, -18, -30, -10, 10); c.lineTo(-50, 10); c.fill();
    c.save(); c.clip(); hatch(c, -50, -110, -8, 10, 5); c.restore();
    c.save(); body(); c.clip();
    // green side trim
    c.strokeStyle = '#0e9a48'; c.lineWidth = 7; c.beginPath(); c.moveTo(-31, 4); c.bezierCurveTo(-35, -30, -37, -62, -33, -84); c.stroke();
    // V collar
    c.beginPath(); c.moveTo(2, -104); c.lineTo(16, -80); c.lineTo(30, -104); c.closePath(); inked(c, '#0e9a48', 3);
    c.beginPath(); c.moveTo(8, -104); c.lineTo(16, -90); c.lineTo(24, -104); c.closePath(); c.fillStyle = d.skin; c.fill();
    // number 01
    c.save(); c.translate(24, -52); c.rotate(0.04); if (drawFacing < 0) c.scale(-1, 1); c.font = 'bold 30px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = 6; c.strokeStyle = '#ffffff'; c.strokeText('01', 0, 0); c.lineWidth = 3; c.strokeStyle = OUT; c.strokeText('01', 0, 0); c.fillStyle = '#0e9a48'; c.fillText('01', 0, 0); c.restore();
    // generic crest
    c.beginPath(); c.moveTo(-6, -82); c.lineTo(4, -82); c.lineTo(4, -74); c.lineTo(-1, -70); c.lineTo(-6, -74); c.closePath(); inked(c, '#1f3fbf', 1.6);
    c.strokeStyle = 'rgba(255,90,200,.5)'; c.lineWidth = 3; c.beginPath(); c.moveTo(-31, -6); c.bezierCurveTo(-36, -40, -38, -66, -32, -88); c.stroke();
  }
  c.restore(); c.restore();
  // belt
  c.beginPath(); c.rect(-28, -6, 56, 10); inked(c, '#1a1210', 3);
  c.fillStyle = '#cfd0d8'; for (let x = -22; x < 24; x += 9) { ell(c, x, -1, 1.8, 1.8); c.fill(); }
  c.beginPath(); c.rect(14, -8, 14, 14); inked(c, '#e8c64a', 2.5);
  c.restore();
}

// ---------- BOOT
function drawBoot(c, d, x, y, ang, dimmed) {
  c.save(); c.translate(x, y); c.rotate(clamp(ang, -0.9, 0.9)); c.scale(1.18, 1.18);
  c.beginPath(); c.moveTo(-14, -16); c.lineTo(10, -16); c.quadraticCurveTo(34, -12, 36, 2); c.lineTo(36, 8); c.lineTo(-16, 8); c.closePath();
  inked(c, dimmed ? dim(d.boot) : d.boot, 4);
  if (d.id === 'flavio') { c.strokeStyle = '#0e9a48'; c.lineWidth = 3; line(c, -4, -10, 18, -2); c.fillStyle = '#c9ccd2'; c.fillRect(-15, 3, 50, 4); }
  else { c.fillStyle = '#3a2c30'; c.fillRect(-15, 2, 50, 5); c.fillStyle = '#c9c9c9'; ell(c, -6, -6, 3, 3); c.fill(); }
  c.restore();
}

function drawHand(c, d, x, y, r, horns, dimmed) {
  ell(c, x, y, r, r * 0.92); inked(c, dimmed ? dim(d.skin) : d.skin, 3.5);
  c.strokeStyle = d.skinS; c.lineWidth = 1.5; c.beginPath(); c.arc(x + 2, y, r * 0.55, -1.2, 1.2); c.stroke();
  if (horns) { c.strokeStyle = OUT; c.lineCap = 'round'; c.lineWidth = 9; line(c, x - 4, y - 6, x - 6, y - 24); line(c, x + 5, y - 6, x + 8, y - 22);
    c.strokeStyle = d.skin; c.lineWidth = 5; line(c, x - 4, y - 6, x - 6, y - 24); line(c, x + 5, y - 6, x + 8, y - 22); }
}

// ---------- FULL FIGURE
// pose: angles; o = { gtr: 'back'|'hands'|'swing', ex, t, horns, footY }
let drawFacing = 1;
function drawFigure(c, d, p, x, footY, facing, sc, o = {}) {
  drawFacing = facing;
  const L = d.len, Wd = d.limb;
  const neck = [Math.sin(p.lean) * L.torso, -Math.cos(p.lean) * L.torso];
  const perp = [Math.cos(p.lean), Math.sin(p.lean)];
  const shoulder = off => [neck[0] * 0.88 + perp[0] * off, neck[1] * 0.88 + perp[1] * off];
  const shB = shoulder(-15), shF = shoulder(9);
  const arm = (sh, s, e) => { const a = dirv(s), b = dirv(s + e); const el = [sh[0] + a[0] * L.upper, sh[1] + a[1] * L.upper]; return [sh, el, [el[0] + b[0] * L.fore, el[1] + b[1] * L.fore]]; };
  const leg = (hx, h, k) => { const a = dirv(h), b = dirv(h + k); const hp = [hx, 0], kn = [hx + a[0] * L.thigh, a[1] * L.thigh]; return [hp, kn, [kn[0] + b[0] * L.shin, kn[1] + b[1] * L.shin]]; };
  const legB = leg(-9, p.hb, p.kb), legF = leg(9, p.hf, p.kf);
  let armB = arm(shB, p.sb, p.eb), armF = arm(shF, p.sf, p.ef);

  // guitar in hands: arms via IK onto the instrument
  const gtrMode = o.gtr || 'back';
  const gA = -0.42, gC = [16, -44];
  const gPt = (gx, gy) => [gC[0] + Math.cos(gA) * gx - Math.sin(gA) * gy, gC[1] + Math.sin(gA) * gx + Math.cos(gA) * gy];
  if (gtrMode === 'hands') {
    const t = o.t || 0;
    const fret = gPt(78 + Math.sin(t * 0.21) * 14, 0), strum = gPt(-2, -6 + Math.sin(t * 0.9) * 9);
    const a = ik2(shF[0], shF[1], fret[0], fret[1], L.upper, L.fore, -1);
    const b = ik2(shB[0], shB[1], strum[0], strum[1], L.upper, L.fore, 1);
    armF = [shF, a.el, a.hand]; armB = [shB, b.el, b.hand];
  }

  let hipY;
  const lying = clamp(-p.rot / (84 * D), 0, 1);
  if (lying > 0.02) hipY = -lerp(L.thigh + L.shin - 6, 26, lying);
  else hipY = -(Math.max(legB[2][1], legF[2][1]) + 10);

  c.save(); c.translate(x, footY); c.scale(facing * sc, sc); c.translate(0, hipY); c.rotate(p.rot);
  const rim = o.rim || 'rgba(255,80,210,1)';
  const pc = [d.pants, d.pants], ps = [d.pantsS, d.pantsS];
  const torsoFrame = fn => { c.save(); c.rotate(p.lean); fn(); c.restore(); };

  if (gtrMode === 'back') torsoFrame(() => { c.save(); c.translate(-8, -40 * L.torso / 98); c.rotate(-2.1); c.scale(0.85, 0.85); drawGuitar(c, d); c.restore(); });
  // back leg + back arm (dimmed)
  limb(c, legB, [Wd.thigh, Wd.shin], pc.map(dim), ps.map(dim));
  drawBoot(c, d, legB[2][0], legB[2][1], -(p.hb + p.kb) * 0.4 + 0.1, true);
  const drawArmB = () => { limb(c, armB, [Wd.upper, Wd.fore], [dim(d.sleeve), dim(d.fore)], [dim(d.sleeveS), dim(d.foreS)]); drawHand(c, d, armB[2][0], armB[2][1], 13.5, false, gtrMode !== 'hands'); };
  if (gtrMode !== 'hands') drawArmB();
  // front leg
  limb(c, legF, [Wd.thigh, Wd.shin], pc, ps, rim);
  drawBoot(c, d, legF[2][0], legF[2][1], -(p.hf + p.kf) * 0.4 + 0.1, false);
  // torso
  torsoFrame(() => drawTorso(c, d, L.torso, o.t || 0));
  // neck + head
  c.save(); c.translate(neck[0], neck[1]); c.rotate(p.lean * 0.4 + p.head);
  c.beginPath(); c.rect(-11, -14, 24, 22); inked(c, d.skin, 4);
  c.fillStyle = d.skinS; c.fillRect(-9, -12, 8, 18);
  c.translate(2, -4);
  HEADS[d.id](c, o.ex || {});
  c.restore();
  if (gtrMode === 'hands') { c.save(); c.translate(gC[0], gC[1]); c.rotate(gA); drawGuitar(c, d); c.restore(); drawArmB(); }
  if (gtrMode === 'swing') {
    const h = armF[2], el = armF[1], ang = Math.atan2(h[1] - el[1], h[0] - el[0]);
    c.save(); c.translate(h[0], h[1]); c.rotate(ang + Math.PI); c.translate(-138, 0); drawGuitar(c, d); c.restore();
  }
  // front arm
  limb(c, armF, [Wd.upper, Wd.fore], [d.sleeve, d.fore], [d.sleeveS, d.foreS], rim);
  drawHand(c, d, armF[2][0], armF[2][1], 15, o.horns, false);
  c.restore();
}

// =====================================================================================
//  STAGE BACKGROUND (pre-rendered) + live layers
// =====================================================================================
let bg = null, fogSpr = null, vignette = null;
function buildPost() {
  if (vignette) return;
  const n = document.createElement('canvas'); n.width = n.height = 192; const g = n.getContext('2d'), im = g.createImageData(192, 192);
  for (let i = 0; i < im.data.length; i += 4) { const v = Math.random() < 0.5 ? 0 : 255; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = Math.random() * 40; }
  g.putImageData(im, 0, 0);
  // scratches / paper fibres
  g.strokeStyle = 'rgba(255,240,220,.18)'; g.lineWidth = 0.7;
  for (let i = 0; i < 14; i++) { const x = rnd(0, 192), y = rnd(0, 192); g.beginPath(); g.moveTo(x, y); g.lineTo(x + rnd(-14, 14), y + rnd(4, 26)); g.stroke(); }
  grainEl.style.backgroundImage = `url(${n.toDataURL()})`;
  vignette = document.createElement('canvas'); vignette.width = 640; vignette.height = 360;
  const v = vignette.getContext('2d'), gr = v.createRadialGradient(320, 180, 120, 320, 180, 400);
  gr.addColorStop(0, 'rgba(40,10,0,0)'); gr.addColorStop(0.7, 'rgba(40,8,0,.18)'); gr.addColorStop(1, 'rgba(20,0,0,.62)');
  v.fillStyle = gr; v.fillRect(0, 0, 640, 360);
}
function drawPost(c) {
  c.drawImage(vignette, 0, 0, W, H);
  grainEl.style.backgroundPosition = `${(game.t * 37) % 192}px ${(game.t * 53) % 192}px`;
}
function buildBG() {
  const s = Math.min(2, Math.max(1, scale));
  bg = document.createElement('canvas'); bg.width = Math.round(W * s); bg.height = Math.round(H * s);
  const g = bg.getContext('2d'); g.scale(s, s);
  g.fillStyle = '#100611'; g.fillRect(0, 0, W, H);
  // sky
  let gr = g.createLinearGradient(0, 0, 0, 420);
  gr.addColorStop(0, '#0c0318'); gr.addColorStop(0.45, '#2e0a3c'); gr.addColorStop(0.8, '#7d1c3c'); gr.addColorStop(1, '#c2462e');
  g.fillStyle = gr; g.fillRect(0, 0, W, 430);
  for (let i = 0; i < 140; i++) { g.fillStyle = `rgba(255,240,255,${rnd(0.2, 0.9)})`; const r = Math.random() < 0.1 ? 1.6 : 0.9; g.fillRect(rnd(0, W), rnd(0, 300), r, r); }
  // huge moon
  gr = g.createRadialGradient(940, 150, 40, 940, 150, 200); gr.addColorStop(0, 'rgba(255,170,90,.55)'); gr.addColorStop(1, 'rgba(255,120,60,0)');
  g.fillStyle = gr; g.fillRect(700, 0, 480, 380);
  ell(g, 940, 150, 74, 74); inked(g, '#f6c27a', 5);
  g.fillStyle = 'rgba(190,110,60,.55)'; for (const [x, y, r] of [[915, 128, 14], [962, 170, 18], [950, 120, 7], [905, 178, 9], [985, 135, 8]]) { ell(g, x, y, r, r); g.fill(); }
  // clouds streaks
  g.fillStyle = 'rgba(30,6,40,.6)'; for (const [x, y, w] of [[120, 120, 300], [760, 240, 380], [400, 70, 220], [1000, 300, 260]]) { ell(g, x + w / 2, y, w / 2, 9); g.fill(); }
  // ink hatching in sky corners (comic feel)
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1.2;
  for (let i = 0; i < 60; i++) line(g, i * 9, 0, i * 9 - 120, 160);
  for (let i = 0; i < 60; i++) line(g, W - i * 9, 0, W - i * 9 + 120, 160);
  // horizon: lawn of the Esplanada
  g.fillStyle = '#1d0b22'; g.fillRect(0, 400, W, 80);
  // ministry blocks
  for (let side = 0; side < 2; side++) for (let i = 0; i < 6; i++) {
    const w = 60 - i * 6, x = side ? 860 + i * 70 : 360 - i * 70 - w, h = 30 - i * 2.5;
    g.fillStyle = '#20092a'; g.fillRect(x, 402 - h, w, h);
    g.fillStyle = 'rgba(255,200,120,.5)'; for (let k = 0; k < w - 6; k += 6) if (Math.random() < 0.5) g.fillRect(x + 3 + k, 402 - h + 5 + (k % 12 ? 0 : 8), 3, 3);
  }
  // Congresso Nacional silhouette (twin towers, bowl and dome)
  const C = '#260a32';
  g.fillStyle = C; g.fillRect(430, 380, 420, 24); // platform
  g.fillRect(614, 230, 22, 152); g.fillRect(642, 230, 22, 152); g.fillRect(612, 296, 54, 8);
  g.beginPath(); g.moveTo(468, 380); g.quadraticCurveTo(470, 344, 520, 338); g.lineTo(560, 338); g.quadraticCurveTo(610, 344, 612, 380); g.closePath(); g.fill(); // bowl rim
  g.fillStyle = '#3a1446'; ell(g, 540, 340, 46, 6); g.fill();
  g.fillStyle = C; g.beginPath(); g.arc(760, 380, 40, Math.PI, 0); g.fill(); // dome
  g.strokeStyle = 'rgba(255,90,170,.6)'; g.lineWidth = 2;
  line(g, 614, 232, 614, 380); line(g, 664, 232, 664, 380); g.beginPath(); g.arc(760, 380, 40, Math.PI, Math.PI * 1.5); g.stroke();
  g.fillStyle = 'rgba(255,230,160,.65)'; for (let y = 240; y < 376; y += 9) { g.fillRect(618, y, 3, 3); g.fillRect(628, y + 4, 3, 3); g.fillRect(646, y + 2, 3, 3); g.fillRect(656, y, 3, 3); }
  // stage floor (perspective)
  gr = g.createLinearGradient(0, 470, 0, 650); gr.addColorStop(0, '#1e1424'); gr.addColorStop(1, '#3a2830');
  g.fillStyle = gr; g.beginPath(); g.moveTo(110, 470); g.lineTo(1170, 470); g.lineTo(1310, 650); g.lineTo(-30, 650); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 2;
  for (let i = -10; i <= 10; i++) line(g, 640 + i * 54, 470, 640 + i * 76, 650);
  for (const y of [500, 535, 575, 620]) line(g, 0, y, W, y);
  g.fillStyle = 'rgba(255,255,255,.05)'; g.beginPath(); g.moveTo(300, 470); g.lineTo(980, 470); g.lineTo(1100, 650); g.lineTo(180, 650); g.fill();
  // stage front lip with bulbs
  g.fillStyle = '#0b060d'; g.fillRect(0, 648, W, 24);
  g.strokeStyle = OUT; g.lineWidth = 4; line(g, 0, 648, W, 648);
  for (let x = 12; x < W; x += 28) { g.fillStyle = ['#ff3a3a', '#ffd400', '#2bff5a', '#29b8ff'][(x / 28 | 0) % 4]; ell(g, x, 660, 4, 4); g.fill(); }
  // drum riser (back center)
  g.fillStyle = '#140b18'; g.fillRect(500, 430, 280, 44); g.strokeStyle = OUT; g.lineWidth = 4; g.strokeRect(500, 430, 280, 44);
  ell(g, 640, 410, 46, 46); inked(g, '#e8e2d2', 5); ell(g, 640, 410, 36, 36); inked(g, '#c8102e', 3);
  g.font = 'bold 26px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 5; g.strokeStyle = OUT; g.strokeText('GB3', 640, 412); g.fillStyle = '#ffd400'; g.fillText('GB3', 640, 412);
  for (const [x, y, r] of [[575, 400, 20], [705, 400, 20], [548, 430, 24], [732, 430, 24]]) { ell(g, x, y, r, r * 0.45); inked(g, '#7a1f2a', 3); }
  for (const [x, y] of [[530, 360], [750, 356]]) { g.strokeStyle = '#999'; g.lineWidth = 3; line(g, x, y, x, 430); ell(g, x, y, 30, 7, -0.15); inked(g, '#e8b93a', 3); }
  // amp walls left & right
  const amp = (x, y, w, h) => {
    g.fillStyle = '#121014'; g.fillRect(x, y, w, h); g.lineWidth = 5; g.strokeStyle = OUT; g.strokeRect(x, y, w, h);
    g.fillStyle = '#5e5448'; g.fillRect(x + 8, y + 8, w - 16, h - 16);
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; for (let k = -h; k < w; k += 5) line(g, x + 8 + Math.max(0, k), y + 8 + Math.max(0, -k), x + 8 + Math.min(w - 16, k + h - 16), y + 8 + Math.min(h - 16, h - 16 - k + (k + h - 16 > w - 16 ? -(k + h - 16 - (w - 16)) : 0)));
    g.strokeStyle = '#e9e2cf'; g.lineWidth = 2; g.strokeRect(x + 8, y + 8, w - 16, h - 16);
  };
  for (const flip of [0, 1]) {
    const bx = flip ? W - 190 : 20;
    amp(bx, 380, 170, 96); amp(bx, 282, 170, 96);
    g.fillStyle = '#121014'; g.fillRect(bx, 236, 170, 44); g.strokeStyle = OUT; g.lineWidth = 5; g.strokeRect(bx, 236, 170, 44);
    g.fillStyle = '#d9c38f'; g.fillRect(bx + 10, 262, 150, 10); for (let k = 0; k < 8; k++) { g.fillStyle = '#222'; ell(g, bx + 22 + k * 18, 248, 4, 4); g.fill(); }
    g.font = 'italic bold 22px Georgia, serif'; g.fillStyle = '#e9d9a0'; g.textAlign = 'center'; g.fillText('Briga', bx + 85, 330); g.fillText('Briga', bx + 85, 428);
  }
  // truss (top beam + towers)
  const truss = (x1, y1, x2, y2, vertical) => {
    g.strokeStyle = '#7d7f8a'; g.lineWidth = 4;
    if (vertical) { line(g, x1, y1, x1, y2); line(g, x2, y1, x2, y2); for (let y = y1; y < y2; y += 26) { line(g, x1, y, x2, y + 13); line(g, x2, y + 13, x1, y + 26); } }
    else { line(g, x1, y1, x2, y1); line(g, x1, y2, x2, y2); for (let x = x1; x < x2; x += 26) { line(g, x, y1, x + 13, y2); line(g, x + 13, y2, x + 26, y1); } }
  };
  g.save(); g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 6;
  truss(54, 100, 84, 480, true); truss(W - 84, 100, W - 54, 480, true); truss(54, 100, W - 54, 128, false);
  g.restore();
  for (let i = 0; i < 6; i++) { const lx = 180 + i * 184; g.fillStyle = '#1a1a20'; g.fillRect(lx - 12, 128, 24, 22); g.strokeStyle = OUT; g.lineWidth = 3; g.strokeRect(lx - 12, 128, 24, 22); }

  // fog sprite
  fogSpr = document.createElement('canvas'); fogSpr.width = 256; fogSpr.height = 128;
  const f = fogSpr.getContext('2d'); const fg = f.createRadialGradient(128, 64, 4, 128, 64, 126);
  fg.addColorStop(0, 'rgba(190,150,230,.55)'); fg.addColorStop(1, 'rgba(190,150,230,0)'); f.fillStyle = fg; f.scale(1, 0.5); f.fillRect(0, 0, 256, 256);
}

// crowd members
const CROWD = [];
for (let row = 0; row < 2; row++) for (let x = -20; x < W + 40; x += row ? 58 : 46) {
  CROWD.push({ x: x + rnd(-12, 12), row, r: row ? rnd(26, 31) : rnd(19, 23), arms: irnd(4), item: irnd(5), ph: rnd(0, TAU), sw: rnd(0.8, 1.2) });
}
const LIGHTCOLS = ['#ff2bd6', '#29d8ff', '#ffb52b', '#8a5bff', '#ff4d2b'];

function drawStageLive(c, t, beat, dark) {
  c.drawImage(bg, 0, 0, W, H);
  // light beams
  c.save(); c.globalCompositeOperation = 'lighter';
  const bar = Math.floor(beat / 4);
  for (let i = 0; i < 6; i++) {
    const lx = 180 + i * 184, ang = Math.sin(t * 0.012 + i * 1.7) * 0.45, col = LIGHTCOLS[(i + bar) % LIGHTCOLS.length];
    const tx = lx + Math.tan(ang) * 500, pulse = 0.55 + 0.45 * Math.pow(1 - (beat % 1), 3);
    const gr = c.createLinearGradient(lx, 150, tx, 640); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.globalAlpha = 0.22 * pulse * (dark ? 0.35 : 1); c.fillStyle = gr;
    c.beginPath(); c.moveTo(lx - 10, 148); c.lineTo(lx + 10, 148); c.lineTo(tx + 95, 640); c.lineTo(tx - 95, 640); c.closePath(); c.fill();
    c.globalAlpha = 0.9 * (dark ? 0.5 : 1); c.fillStyle = col; ell(c, lx, 150, 9, 5); c.fill();
    c.globalAlpha = 0.18 * pulse; ell(c, tx, 600, 110, 22); c.fill();
  }
  c.restore();
  // fog
  c.save(); c.globalAlpha = dark ? 0.3 : 0.5;
  for (let i = 0; i < 7; i++) { const x = ((t * (0.3 + i * 0.07) + i * 230) % (W + 500)) - 250; c.drawImage(fogSpr, x, 540 + (i % 3) * 22, 420, 110); }
  c.restore();
}

function drawCrowd(c, t, beat, excite) {
  const bc = LIGHTCOLS[Math.floor(beat / 4) % LIGHTCOLS.length];
  for (const p of CROWD) {
    const bob = -Math.abs(Math.sin((beat * Math.PI) + p.ph * 0.3)) * (4 + excite * 9) * p.sw;
    const s = p.row ? 1 : 0.8, baseY = p.row ? 708 : 682, y = baseY + bob, r = p.r;
    const col = p.row ? '#07030a' : '#120818';
    c.fillStyle = col; c.strokeStyle = col; c.lineCap = 'round';
    // arms
    const up = p.arms + (excite > 0.6 ? 1 : 0);
    const armsUp = up >= 3 ? [-1, 1] : up === 2 ? [1] : up === 1 && Math.sin(t * 0.05 + p.ph) > 0 ? [-1] : [];
    for (const side of armsUp) {
      const sx = p.x + side * r * 1.1, sy = y + r * 0.9, wave = Math.sin(beat * Math.PI + p.ph) * 8;
      const hx = sx + side * 12 + wave, hy = y - r * 2.2 * s - 10;
      c.lineWidth = 12 * s; line(c, sx, sy, hx, hy);
      ell(c, hx, hy, 7 * s, 7 * s); c.fill();
      if (p.item === 0) { c.fillStyle = '#ffe9a0'; ell(c, hx, hy - 12, 3, 6); c.fill(); c.fillStyle = col; }
      else if (p.item === 1) { c.fillStyle = '#cfe8ff'; c.fillRect(hx - 5, hy - 18, 10, 14); c.fillStyle = col; }
      else { c.lineWidth = 4 * s; line(c, hx - 4, hy - 4, hx - 6, hy - 16); line(c, hx + 4, hy - 4, hx + 6, hy - 15); }
    }
    // body + head
    c.beginPath(); c.moveTo(p.x - r * 1.6, H + 10); c.quadraticCurveTo(p.x - r * 1.6, y + r * 0.6, p.x, y + r * 0.5); c.quadraticCurveTo(p.x + r * 1.6, y + r * 0.6, p.x + r * 1.6, H + 10); c.fill();
    ell(c, p.x, y - r * 0.3, r * 0.82, r); c.fill();
    c.strokeStyle = bc; c.globalAlpha = 0.45; c.lineWidth = 2; c.beginPath(); c.arc(p.x, y - r * 0.3, r * 0.82, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); c.globalAlpha = 1;
  }
}

// =====================================================================================
//  PARTICLES / FX
// =====================================================================================
let parts = [], bolts = [];
function spark(x, y, n, col, spd = 9) {
  for (let i = 0; i < n; i++) { const a = rnd(0, TAU), v = rnd(spd * 0.3, spd); parts.push({ t: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 2, life: rnd(14, 26), max: 26, col }); }
}
function fire(x, y, n, spread = 10, vy = -3) {
  for (let i = 0; i < n; i++) parts.push({ t: 'fire', x: x + rnd(-spread, spread), y: y + rnd(-spread, spread), vx: rnd(-1, 1), vy: vy + rnd(-2, 1), life: rnd(20, 36), max: 36, size: rnd(10, 22) });
}
function ring(x, y, col, r = 20) { parts.push({ t: 'ring', x, y, r, life: 18, max: 18, col }); }
function pop(text, x, y, col = '#ffd400', size = 64) { parts.push({ t: 'pop', text, x, y, life: 46, max: 46, col, size, rot: rnd(-0.25, 0.25) }); }
function bolt(x1, y1, x2, y2, col = '#9fe6ff') {
  const pts = [[x1, y1]], n = 9;
  for (let i = 1; i < n; i++) { const k = i / n; pts.push([lerp(x1, x2, k) + rnd(-22, 22), lerp(y1, y2, k) + rnd(-22, 22)]); }
  pts.push([x2, y2]); bolts.push({ pts, life: 12, col });
}
function updateParts() {
  for (const p of parts) {
    p.life--;
    if (p.t === 'spark') { p.x += p.vx; p.y += p.vy; p.vy += 0.45; p.vx *= 0.95; }
    else if (p.t === 'fire') { p.x += p.vx; p.y += p.vy; p.vy -= 0.12; p.size *= 1.02; }
    else if (p.t === 'ring') p.r += 9;
    else if (p.t === 'pop') p.y -= 0.6;
    else if (p.t === 'conf') { p.x += p.vx; p.y += p.vy; p.vy = Math.min(p.vy + 0.15, 3); p.rot += p.vr; p.vx *= 0.99; }
    else if (p.t === 'qmark') { p.a += 0.09; p.x = p.owner.x + Math.cos(p.a) * 60; p.y = p.owner.y - 330 + Math.sin(p.a) * 16 - (p.max - p.life) * 0.2; }
    else if (p.t === 'paper') { p.x += p.vx + Math.sin(p.life * 0.15) * 1.2; p.y += p.vy; p.vy = Math.min(p.vy + 0.32, 2.2); p.rot += p.vr; p.vx *= 0.96; }
  }
  parts = parts.filter(p => p.life > 0);
  for (const b of bolts) b.life--;
  bolts = bolts.filter(b => b.life > 0);
}
function starburst(c, r1, r2, n) { c.beginPath(); for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1, a = i / (n * 2) * TAU; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); } c.closePath(); }
const BALLOONS = {
  sigilo: { lines: ['LIBERA O SIGILO', 'BANCÁRIO!'], sizes: [30, 36], col: '#ff3030' },
  lulinha: { lines: ['E O', 'LULINHA?'], sizes: [34, 46], col: '#0e9a48' },
};
function drawBalloons(c) {
  for (const p of projs) {
    const B = BALLOONS[p.kind];
    if (!B) continue;
    const wob = 1 + Math.sin(game.t * 0.4) * 0.05, dir = Math.sign(p.vx);
    c.save(); c.translate(p.x, p.y); c.scale(wob, wob); c.rotate(Math.sin(game.t * 0.15) * 0.06);
    c.beginPath(); c.ellipse(0, 0, 112, 64, 0, 0, TAU);
    c.moveTo(-dir * 60, 40); c.lineTo(-dir * 120, 92); c.lineTo(-dir * 20, 56);
    inked(c, '#fffdf2', 6);
    comicText(c, B.lines[0], 0, -16, B.sizes[0], '#ffffff', B.col, 'center', 6);
    comicText(c, B.lines[1], 0, 20, B.sizes[1], '#ffffff', B.col, 'center', 6);
    c.restore();
  }
}
function drawParts(c) {
  c.save(); c.globalCompositeOperation = 'lighter';
  for (const p of parts) {
    const k = p.life / p.max;
    if (p.t === 'spark') { c.strokeStyle = p.col; c.globalAlpha = k; c.lineWidth = 3; c.lineCap = 'round'; line(c, p.x, p.y, p.x - p.vx * 1.6, p.y - p.vy * 1.6); }
    else if (p.t === 'fire') { c.globalAlpha = k * 0.9; c.fillStyle = k > 0.6 ? '#ffe36a' : k > 0.35 ? '#ff7a1c' : '#c42a10'; ell(c, p.x, p.y, p.size * (0.4 + k * 0.6), p.size * (0.4 + k * 0.6)); c.fill(); }
    else if (p.t === 'ring') { c.strokeStyle = p.col; c.globalAlpha = k; c.lineWidth = 6 * k + 1; ell(c, p.x, p.y, p.r, p.r * 0.6); c.stroke(); }
  }
  c.globalAlpha = 1;
  for (const b of bolts) {
    const k = b.life / 12;
    c.lineJoin = 'round'; c.lineCap = 'round';
    for (const [w, a, col] of [[18, 0.25, b.col], [8, 0.6, b.col], [3, 1, '#ffffff']]) {
      c.globalAlpha = a * k; c.strokeStyle = col; c.lineWidth = w; c.beginPath(); c.moveTo(b.pts[0][0], b.pts[0][1]); for (const q of b.pts) c.lineTo(q[0], q[1]); c.stroke();
    }
  }
  c.restore();
  for (const p of parts) {
    if (p.t === 'conf') { c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.fillStyle = p.col; c.fillRect(-5, -3, 10, 6); c.restore(); }
    if (p.t === 'qmark') { c.save(); c.globalAlpha = clamp(p.life / 20, 0, 1); comicText(c, '?', p.x, p.y, p.size, '#ffffff', '#ffd21a'); c.restore(); }
    if (p.t === 'paper') { // bank statements fluttering out
      c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.scale(1, Math.cos(p.life * 0.2));
      c.fillStyle = '#fbf8ee'; c.fillRect(-11, -14, 22, 28); c.lineWidth = 1.5; c.strokeStyle = OUT; c.strokeRect(-11, -14, 22, 28);
      c.fillStyle = '#9a9aa8'; for (let k = 0; k < 4; k++) c.fillRect(-7, -8 + k * 5, 14 - (k % 2) * 5, 1.6);
      c.fillStyle = '#0e9a48'; c.font = `9px ${FONT}`; c.textAlign = 'center'; c.fillText('R$', 0, -9);
      c.restore();
    }
    if (p.t !== 'pop') continue;
    const age = p.max - p.life, sc = age < 6 ? lerp(0.3, 1.2, age / 6) : age < 10 ? lerp(1.2, 1, (age - 6) / 4) : 1;
    c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.scale(sc, sc); c.globalAlpha = clamp(p.life / 10, 0, 1);
    starburst(c, p.size * 1.15, p.size * 0.75, 12); inked(c, p.col, 5);
    comicText(c, p.text, 0, 4, p.size * 0.62, '#ffffff', '#e3121c');
    c.restore();
  }
}

// comic / logo text: thick ink outline + gradient fill
function comicText(c, text, x, y, size, top = '#fff6a0', bot = '#ff3a12', align = 'center', strokeW) {
  c.save(); c.font = `${size}px ${FONT}`; c.textAlign = align; c.textBaseline = 'middle'; c.lineJoin = 'round';
  c.lineWidth = strokeW || Math.max(4, size * 0.16); c.strokeStyle = OUT; c.strokeText(text, x, y);
  const g = c.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.5); g.addColorStop(0, top); g.addColorStop(1, bot);
  c.fillStyle = g; c.fillText(text, x, y);
  c.restore();
}

// =====================================================================================
//  FIGHTER LOGIC
// =====================================================================================
// =====================================================================================
//  TORCIDAS: the crowd behind each fighter. Landing hits fills its meter; when full the leader shouts
//  ("EXPLODE!!!" for Janones) and the fighter gets a boost.
// =====================================================================================
function cheerUp(f, amount) {
  if (game.phase !== 'fight' || f.ko) return;
  f.cheer = Math.min(100, f.cheer + amount);
  if (f.cheer >= 100) triggerShout(f);
}
function triggerShout(f) {
  const T = f.def.torcida;
  f.cheer = 0; f.hp = Math.min(100, f.hp + 4); f.meter = Math.min(100, f.meter + 12);
  game.shouts.push({ side: f.side, t: 0, text: T.shout, who: T.leader, col: T.col });
  game.boost[f.side] = 1; game.shake = Math.max(game.shake, 8);
  audio.sfx('roar'); audio.say(T.say, T.pitch);
}
function leaderLook(i) {
  const t = game.t, f = i ? game.f2 : game.f1, T = f.def.torcida;
  const sh = game.shouts.find(s => s.side === i), e = sh ? 1 : clamp(f.cheer / 100 + game.boost[i], 0, 1);
  const p = copyPose(sh ? POSES.cheer : POSES.chant), w = Math.sin(t * (sh ? 0.5 : 0.16 + e * 0.12));
  p.sf += w * (sh ? 14 : 20) * D; p.sb += (sh ? -w : 0) * 10 * D; p.lean += Math.abs(w) * 6 * D * (1 + e);
  return { id: f.def.id, pose: p, hop: Math.abs(w) * (sh ? 22 : 5 + e * 10), ex: { mouth: sh ? 0.9 : 0.25 + 0.5 * e * Math.abs(w), angry: false } };
}

const MOVES = {
  punch: { s: 5, a: 4, r: 9, dmg: 5, x0: 20, x1: 108, y0: -245, y1: -170, kb: 4, stun: 15, bstun: 9, meter: 7, sfx: 'punch', w: 'punchW', p: 'punchS' },
  cpunch: { s: 5, a: 4, r: 10, dmg: 4, x0: 20, x1: 108, y0: -165, y1: -95, kb: 3, stun: 14, bstun: 8, meter: 6, sfx: 'punch', w: 'cblock', p: 'cpunchS', crouch: true },
  kick: { s: 8, a: 5, r: 13, dmg: 8, x0: 20, x1: 135, y0: -165, y1: -70, kb: 6, stun: 18, bstun: 11, meter: 9, sfx: 'kick', w: 'kickW', p: 'kickS' },
  sweep: { s: 9, a: 5, r: 17, dmg: 7, x0: 20, x1: 145, y0: -45, y1: 0, kb: 5, stun: 22, bstun: 12, meter: 9, sfx: 'kick', w: 'sweepW', p: 'sweepS', kd: true, low: true, crouch: true },
  heavy: { s: 16, a: 6, r: 22, dmg: 14, x0: 10, x1: 178, y0: -320, y1: -40, kb: 13, stun: 26, bstun: 15, meter: 12, sfx: 'smash', w: 'heavyW', p: 'heavyS', kd: true, chip: 2, gtr: 'swing' },
  airk: { s: 4, a: 12, r: 4, dmg: 8, x0: 0, x1: 115, y0: -160, y1: -20, kb: 6, stun: 17, bstun: 11, meter: 8, sfx: 'kick', w: 'jump', p: 'airkS', air: true },
  airp: { s: 4, a: 10, r: 4, dmg: 6, x0: 0, x1: 105, y0: -250, y1: -120, kb: 5, stun: 15, bstun: 9, meter: 7, sfx: 'punch', w: 'jump', p: 'airpS', air: true },
  proj: { s: 14, a: 1, r: 18, w: 'projW', p: 'projS', proj: true, cost: 25 },
  proj2: { s: 16, a: 1, r: 20, w: 'projW', p: 'projS', proj: true, cost: 25, variant: 2 },
};
let projs = [];

class Fighter {
  constructor(def, side) { this.def = def; this.side = side; this.wins = 0; this.meter = 0; this.reset(); }
  reset() {
    this.cheer = 0;
    this.x = this.side === 0 ? 420 : 860; this.y = GY; this.vx = 0; this.vy = 0;
    this.facing = this.side === 0 ? 1 : -1; this.hp = 100; this.dispHp = 100; this.dispDelay = 0;
    this.state = 'idle'; this.st = 0; this.move = null; this.mf = 0; this.connected = false;
    this.stun = 0; this.combo = 0; this.inv = 0; this.ko = false; this.t = rnd(0, 100);
    this.pose = copyPose(POSES.idle); this.pad = emptyPad(); this.attackId = 0; this.mouth = 0; this.taunt = 0;
  }
  get opp() { return this.side === 0 ? game.f2 : game.f1; }
  get airborne() { return this.y < GY - 0.5; }
  get crouching() { return this.state === 'crouch' || (this.state === 'block' && this.blockLow); }
  canAct() { return this.state === 'idle' || this.state === 'walk' || this.state === 'crouch'; }
  holdingBack() { return this.facing > 0 ? this.pad.l : this.pad.r; }
  hurtbox() {
    if (this.state === 'down' || this.ko || this.inv > 0) return null;
    const top = this.crouching ? 165 : (this.state === 'attack' && this.move.crouch) ? 175 : 300;
    return [this.x - 38, this.y - top, this.x + 38, this.y];
  }
  startMove(name) {
    const mv = MOVES[name];
    if (mv.cost) { if (this.meter < mv.cost || projs.some(p => p.owner === this)) return false; this.meter -= mv.cost; }
    this.state = 'attack'; this.move = mv; this.moveName = name; this.mf = 0; this.connected = false; this.attackId++;
    if (!mv.air) this.vx = 0;
    if (name === 'heavy' || name === 'proj' || name === 'proj2') audio.sfx('whoosh', 1.2); else audio.sfx('whoosh', 0.6);
    return true;
  }
  update() {
    this.t++;
    const pad = this.pad, op = this.opp, mv = this.move;
    if (this.inv > 0) this.inv--;
    if (this.taunt > 0) this.taunt--;
    // face opponent
    if ((this.canAct() || this.state === 'block') && !this.airborne) this.facing = op.x >= this.x ? 1 : -1;
    const fwd = this.facing > 0 ? pad.r : pad.l, back = this.facing > 0 ? pad.l : pad.r;

    switch (this.state) {
      case 'idle': case 'walk': case 'crouch': {
        if (game.phase !== 'fight') { this.state = 'idle'; this.vx = 0; break; }
        if (pad.SP && this.meter >= 100) { startSolo(this); return; }
        if (pad.PR && this.startMove(pad.d ? 'proj2' : 'proj')) break;
        if (pad.H) { this.startMove('heavy'); break; }
        if (pad.K) { this.startMove(pad.d ? 'sweep' : 'kick'); break; }
        if (pad.P) { this.startMove(pad.d ? 'cpunch' : 'punch'); break; }
        if (pad.u) { this.state = 'jump'; this.vy = this.def.jump; this.vx = (fwd ? 1 : back ? -1 : 0) * this.facing * 5.2; audio.sfx('jump'); break; }
        if (pad.d) { this.state = 'crouch'; this.vx = 0; break; }
        if (fwd) { this.state = 'walk'; this.vx = this.facing * this.def.walk; }
        else if (back) { this.state = 'walk'; this.vx = -this.facing * this.def.walk * 0.8; }
        else { this.state = 'idle'; this.vx = 0; }
        break;
      }
      case 'jump': {
        if (game.phase === 'fight') { if (pad.K) this.startMove('airk'); else if (pad.P || pad.H) this.startMove('airp'); }
        break;
      }
      case 'attack': {
        this.mf++;
        const s = mv.s, a = mv.a;
        if (mv.proj && this.mf === s) spawnProj(this, mv.variant);
        if (!mv.proj && this.mf >= s && this.mf < s + a && !this.connected) {
          const x0 = this.x + this.facing * mv.x0, x1 = this.x + this.facing * mv.x1;
          if (tryHit(this, op, mv, Math.min(x0, x1), this.y + mv.y0, Math.max(x0, x1), this.y + mv.y1)) this.connected = true;
        }
        if (mv.air) { if (!this.airborne) { this.state = 'idle'; this.move = null; } }
        else if (this.mf >= s + a + mv.r) { this.state = mv.crouch && pad.d ? 'crouch' : 'idle'; this.move = null; }
        break;
      }
      case 'hit': case 'block': {
        this.st--; this.vx *= 0.88;
        if (this.st <= 0) { this.state = 'idle'; this.combo = this.state === 'hit' ? this.combo : 0; }
        break;
      }
      case 'down': {
        this.st++;
        if (!this.airborne) {
          this.vx *= 0.8;
          if (this.ko) break;
          if (this.st > 70) { this.state = 'idle'; this.inv = 24; this.combo = 0; }
        }
        break;
      }
      case 'win': case 'intro': case 'shock': case 'solo': this.vx = 0; break;
    }
    if (this.state !== 'hit') this.combo = this.state === 'down' ? this.combo : 0;

    // physics
    this.x += this.vx;
    if (this.airborne || this.vy < 0) {
      this.vy += 0.9; this.y += this.vy;
      if (this.y >= GY) { this.y = GY; this.vy = 0; if (this.state === 'jump') { this.state = 'idle'; this.vx = 0; } if (this.state === 'down') { if (this.st < 200) { spark(this.x, GY, 6, '#ffcc88', 5); game.shake = Math.max(game.shake, 6); } } }
    }
    this.x = clamp(this.x, 70, W - 70);
    this.animate();
  }
  animate() {
    const P_ = POSES; let tgt = P_.idle, rate = 0.25;
    const t = this.t;
    switch (this.state) {
      case 'idle': {
        tgt = copyPose(P_.idle); const b = Math.sin(t * 0.09);
        tgt.kf += b * 4 * D; tgt.kb -= b * 3 * D; tgt.sf += b * 3 * D; tgt.sb -= b * 3 * D; tgt.lean += b * 1.5 * D; break;
      }
      case 'walk': {
        tgt = copyPose(P_.idle); const ph = t * 0.22 * Math.sign(this.vx * this.facing || 1);
        tgt.hf = (18 + Math.sin(ph) * 22) * D; tgt.hb = (-18 - Math.sin(ph) * 22) * D;
        tgt.kf = (-22 - Math.max(0, Math.cos(ph)) * 34) * D; tgt.kb = (-8 - Math.max(0, -Math.cos(ph)) * 34) * D;
        tgt.lean += 4 * D; rate = 0.35; break;
      }
      case 'crouch': tgt = P_.crouch; break;
      case 'jump': tgt = P_.jump; break;
      case 'attack': {
        const mv = this.move;
        if (this.mf < mv.s) { tgt = P_[mv.w]; rate = 0.4; }
        else if (this.mf < mv.s + mv.a + mv.r * 0.5) { tgt = P_[mv.p]; rate = 0.6; }
        else { tgt = mv.air ? P_.jump : mv.crouch ? P_.crouch : P_.idle; rate = 0.2; }
        break;
      }
      case 'hit': tgt = P_.hit; rate = 0.5; break;
      case 'block': tgt = this.blockLow ? P_.cblock : P_.block; rate = 0.5; break;
      case 'down': tgt = P_.down; rate = this.airborne ? 0.12 : 0.25; break;
      case 'shock': {
        tgt = copyPose(P_.shock); const j = Math.sin(t * 1.3);
        tgt.sf += j * 25 * D; tgt.sb -= j * 25 * D; tgt.head += j * 8 * D; tgt.kf += j * 10 * D; rate = 0.5; break;
      }
      case 'solo': case 'intro': {
        tgt = copyPose(P_.shred); tgt.head = (8 + Math.sin(t * 0.45) * 14) * D; tgt.lean = (-10 + Math.sin(t * 0.45) * 4) * D; break;
      }
      case 'win': {
        tgt = copyPose(P_.win); tgt.sf += Math.sin(t * 0.3) * 8 * D; tgt.head += Math.sin(t * 0.3) * 4 * D; break;
      }
    }
    lerpPose(this.pose, tgt, rate);
    // face expression
    const target = this.state === 'attack' || this.state === 'solo' || this.state === 'intro' || this.state === 'win' || this.taunt > 0 ? 1 : this.state === 'hit' || this.state === 'shock' ? 0.7 : 0;
    this.mouth += (target - this.mouth) * 0.3;
  }
  // what the 3D rig needs this frame: face, guitar placement, body yaw toward the crowd
  look() {
    const st = this.state;
    const ex = {
      mouth: this.mouth * (st === 'solo' || st === 'intro' ? 0.6 + 0.4 * Math.sin(this.t * 0.3) : 1),
      angry: st === 'attack' || st === 'block' || st === 'walk' || st === 'jump',
      hurt: st === 'hit' || st === 'shock' || (st === 'down' && !this.ko),
      ko: this.ko && st === 'down',
      blink: st === 'idle' && (this.t % 170) < 6,
    };
    const heavy = st === 'attack' && this.move.gtr;
    const gtr = st === 'solo' || st === 'intro' ? 'hands' : heavy && this.def.heavy === 'guitar' ? 'swing' : 'back';
    const yaw = st === 'solo' || st === 'intro' || st === 'win' ? 0.95 : st === 'down' ? 0.25 : 0.5;
    this.yaw = this.yaw === undefined ? yaw : this.yaw + (yaw - this.yaw) * 0.12;
    return {
      id: this.def.id, pose: this.pose, x: this.x, y: this.y, facing: this.facing, yaw: this.yaw, gtr, ex, t: this.t, horns: st === 'win',
      weapon: heavy && this.def.heavy === 'hammer' ? 'hammer' : null,
      visible: !(this.inv > 0 && (this.inv >> 1) % 2),
    };
  }
  guitarTip() { return r3.guitarTip(this.def.id); }
}

function tryHit(att, def, mv, x0, y0, x1, y1, isProj) {
  const hb = def.hurtbox(); if (!hb) return false;
  if (x1 < hb[0] || x0 > hb[2] || y1 < hb[1] || y0 > hb[3]) return false;
  const cx = (Math.max(x0, hb[0]) + Math.min(x1, hb[2])) / 2, cy = (Math.max(y0, hb[1]) + Math.min(y1, hb[3])) / 2;
  const dirx = isProj ? Math.sign(isProj.vx) : att.facing;
  const blockable = (def.canAct() || def.state === 'block') && !def.airborne;
  const low = def.pad.d;
  const blocked = blockable && def.holdingBack() && (!mv.low || low) && (!mv.air || !low);
  const pw = att.def.power;
  if (blocked) {
    def.state = 'block'; def.blockLow = low; def.st = mv.bstun; def.vx = dirx * mv.kb * 0.8;
    def.hp = Math.max(1, def.hp - (mv.chip || 0.5) * pw);
    att.meter = Math.min(100, att.meter + 3); def.meter = Math.min(100, def.meter + 4);
    spark(cx, cy, 10, '#7fd9ff', 7); ring(cx, cy, '#7fd9ff', 14);
    game.hitstop = 5; audio.sfx('block');
    if (!isProj && !mv.air) att.vx = -dirx * 2.5;
    return true;
  }
  def.combo = def.state === 'hit' || (def.state === 'down' && def.airborne) ? def.combo + 1 : 1;
  const dmg = mv.dmg * pw * Math.max(0.45, 1 - (def.combo - 1) * 0.12);
  def.hp = Math.max(0, def.hp - dmg); def.dispDelay = 30;
  att.meter = Math.min(100, att.meter + mv.meter); def.meter = Math.min(100, def.meter + mv.meter * 0.6);
  cheerUp(att, 6 + dmg * 1.4);
  def.move = null;
  if (def.hp <= 0 || mv.kd || def.airborne) {
    def.state = 'down'; def.st = 0; def.vy = -9; def.y = Math.min(def.y, GY - 1); def.vx = dirx * (mv.kd ? 7 : 5);
    if (def.hp <= 0) { def.ko = true; def.vy = -12; def.vx = dirx * 9; }
  } else { def.state = 'hit'; def.st = mv.stun; def.vx = dirx * mv.kb; }
  def.facing = -dirx || def.facing;
  const big = mv.dmg >= 12 || def.hp <= 0;
  game.hitstop = big ? 12 : 7; game.shake = big ? 16 : 7; game.flash = big ? 1 : 0.6; game.flashPos = [cx, cy];
  spark(cx, cy, big ? 26 : 14, '#ffe36a', big ? 14 : 10); spark(cx, cy, 6, '#ffffff', 8); ring(cx, cy, '#ffb52b', big ? 26 : 16);
  audio.sfx(mv.sfx || 'punch', big ? 1.2 : 1);
  if (mv.gtr === 'swing') { pop(att.def.heavy === 'hammer' ? 'MARTELADA!' : ['CRASH!', 'KRRANG!', 'ROCK!'][irnd(3)], cx, cy - 60, '#ffd400', 70); for (let i = 0; i < 6; i++) parts.push({ t: 'spark', x: cx, y: cy, vx: rnd(-6, 6), vy: rnd(-12, -4), life: 30, max: 30, col: '#c0c0c0' }); }
  else if (isProj && isProj.kind === 'sigilo') {
    pop('SIGILO QUEBRADO!', cx, cy - 90, '#ff3030', 66);
    for (let i = 0; i < 34; i++) parts.push({ t: 'paper', x: cx + rnd(-20, 20), y: cy + rnd(-30, 10), vx: rnd(-7, 7), vy: rnd(-13, -4), rot: rnd(0, TAU), vr: rnd(-0.25, 0.25), life: rnd(90, 140), max: 140 });
  }
  else if (isProj && isProj.kind === 'lulinha') {
    pop('MUDOU DE ASSUNTO!', cx, cy - 90, '#ffd21a', 62);
    for (let i = 0; i < 9; i++) parts.push({ t: 'qmark', x: def.x, y: def.y - 320, a: i / 9 * TAU, life: 110, max: 110, size: rnd(26, 40), owner: def });
  }
  else if (isProj) pop(isProj.kind === 'foice' ? 'ZÁS!' : 'GOOOL!', cx, cy - 50, isProj.kind === 'foice' ? '#ff3030' : '#2bff5a', 58);
  else if (def.combo >= 3) pop(def.combo + ' HITS!', cx, cy - 70, '#29d8ff', 56);
  else if (Math.random() < 0.18) pop(['POW!', 'TUM!', 'PÁ!', 'BAM!'][irnd(4)], cx, cy - 50, '#ffd400', 50);
  game.excite = Math.min(1, game.excite + (big ? 0.6 : 0.25));
  if (Math.random() < 0.15) att.taunt = 30;
  return true;
}

const PROJ = {
  foice: { y: 195, vx: 10, r: 28, mv: { dmg: 9, kb: 7, stun: 18, bstun: 12, meter: 8, sfx: 'boom', chip: 2 } },
  sigilo: { y: 215, vx: 6.5, r: 40, mv: { dmg: 7, kb: 3, stun: 42, bstun: 14, meter: 10, sfx: 'boom', chip: 1.5 } },
  bola: { y: 190, vx: 11, r: 24, mv: { dmg: 9, kb: 7, stun: 18, bstun: 12, meter: 8, sfx: 'boom', chip: 2 } },
  lulinha: { y: 215, vx: 6.5, r: 40, mv: { dmg: 7, kb: 3, stun: 42, bstun: 14, meter: 10, sfx: 'boom', chip: 1.5 } },
};
function spawnProj(f, variant) {
  const kind = variant === 2 ? f.def.proj2 : f.def.proj, P_ = PROJ[kind];
  projs.push({ owner: f, kind, x: f.x + f.facing * 70, y: f.y - P_.y, vx: f.facing * P_.vx, r: P_.r, mv: P_.mv, rot: 0, life: 200 });
  const balloon = kind === 'sigilo' || kind === 'lulinha';
  audio.sfx(balloon ? 'cheer' : 'kick', balloon ? 0.6 : 1);
  if (kind.startsWith('bola')) ring(f.x + f.facing * 60, f.y - P_.y, '#2bff5a', 10);
  if (balloon) f.taunt = 50;
  pop(variant === 2 ? f.def.proj2Name : f.def.projName, f.x, f.y - 340, f.def.accent, 34);
}
function updateProjs() {
  for (const p of projs) {
    p.x += p.vx; p.life--; p.rot += p.vx * 0.04;
    const trail = p.kind === 'foice' ? ['#ff3030', '#ffd400'] : p.kind === 'bola' ? ['#2bff5a', '#ffd21a'] : null;
    if (trail && game.t % 2 === 0) parts.push({ t: 'spark', x: p.x, y: p.y + rnd(-14, 14), vx: -p.vx * 0.3, vy: 0, life: 12, max: 26, col: trail[irnd(2)] });
    const target = p.owner.opp;
    if (tryHit(p.owner, target, p.mv, p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r, p)) { p.life = 0; if (!trail) ring(p.x, p.y, '#ffffff', 30); else fire(p.x, p.y, 14, 16); }
    if (p.x < -60 || p.x > W + 60) p.life = 0;
  }
  // clash
  for (let i = 0; i < projs.length; i++) for (let j = i + 1; j < projs.length; j++) {
    const a = projs[i], b = projs[j];
    if (a.owner !== b.owner && a.life > 0 && b.life > 0 && Math.abs(a.x - b.x) < 44 && Math.abs(a.y - b.y) < 70) { a.life = b.life = 0; fire((a.x + b.x) / 2, a.y, 22, 20); ring((a.x + b.x) / 2, a.y, '#ffb52b', 20); audio.sfx('boom'); game.shake = 8; }
  }
  projs = projs.filter(p => p.life > 0);
}

// =====================================================================================
//  SOLO (rhythm super move, Guitar-Hero style)
// =====================================================================================
const LANE_COL = ['#2bff5a', '#ff3030', '#ffd400'];
const TRAVEL = 70;
function startSolo(att) {
  const def = att.opp;
  att.meter = 0; att.state = 'solo'; att.vx = 0; att.move = null;
  def.state = 'shock'; def.vx = 0; def.move = null; def.y = GY; def.vy = 0;
  // spread both rockers so the note highway sits between them
  const side = Math.sign(def.x - att.x) || att.facing, mid = clamp((att.x + def.x) / 2, 330, W - 330);
  att.x = mid - side * 210; def.x = mid + side * 210;
  att.facing = def.x > att.x ? 1 : -1; def.facing = -att.facing;
  const notes = []; let t = 120;
  const gaps = [12, 12, 25, 12, 18, 25];
  for (let i = 0; i < 10; i++) { notes.push({ t, lane: irnd(3), res: null }); t += gaps[irnd(gaps.length)]; }
  game.solo = { att, def, t: 0, notes, end: t + 30, fb: [], hits: 0 };
  game.pyro = 90; audio.sfx('cheer', 1.2); audio.sfx('smash', 0.7);
  att.aiNotes = null;
}
function updateSolo() {
  const S = game.solo; S.t++;
  const att = S.att, def = S.def;
  att.animate(); def.animate(); att.t++; def.t++;
  const pad = att.pad;
  const presses = []; if (pad.P) presses.push(0); if (pad.K) presses.push(1); if (pad.H) presses.push(2);
  for (const lane of presses) {
    let best = null, bd = 99;
    for (const n of S.notes) if (!n.res && n.lane === lane) { const d = Math.abs(n.t - S.t); if (d < bd) { bd = d; best = n; } }
    if (best && bd <= 8) {
      best.res = bd <= 3 ? 'perfect' : 'good';
      const dmg = (best.res === 'perfect' ? 4 : 2.5) * att.def.power;
      def.hp = Math.max(0, def.hp - dmg); def.dispDelay = 30; S.hits++;
      const tip = att.guitarTip();
      bolt(tip[0], tip[1], def.x + rnd(-20, 20), def.y - rnd(120, 260), LANE_COL[lane]);
      spark(def.x, def.y - 180, 12, LANE_COL[lane], 10);
      audio.lead(lane, best.res === 'perfect'); audio.sfx('punch', 0.5); cheerUp(att, 5);
      S.fb.push({ text: best.res === 'perfect' ? 'PERFEITO!' : 'BOA!', lane, life: 30 });
      game.shake = Math.max(game.shake, 5); game.excite = 1;
    } else { audio.sfx('miss', 0.7); }
  }
  for (const n of S.notes) if (!n.res && S.t - n.t > 8) { n.res = 'miss'; S.fb.push({ text: 'ERROU!', lane: n.lane, life: 30 }); audio.sfx('miss'); }
  for (const f of S.fb) f.life--;
  S.fb = S.fb.filter(f => f.life > 0);
  if (game.t % 6 === 0) { fire(200, 480, 3, 10, -9); fire(W - 200, 480, 3, 10, -9); }
  if (S.t >= S.end) {
    const perfect = S.hits >= S.notes.length;
    att.state = 'idle';
    def.state = 'down'; def.st = 0; def.vy = -10; def.y = GY - 1; def.vx = att.facing * 8;
    if (def.hp <= 0) def.ko = true;
    game.shake = 18; game.hitstop = 10; audio.sfx('boom', 1.2); audio.sfx(S.hits >= 7 ? 'cheer' : 'boo', 1.2);
    pop(perfect ? 'SOLO PERFEITO!' : S.hits >= 7 ? 'ARRASOU!' : S.hits >= 4 ? 'MANDOU BEM!' : 'VAIADO!', def.x, def.y - 300, perfect ? '#29d8ff' : '#ffd400', 70);
    ring(def.x, def.y - 150, '#ffffff', 30);
    game.solo = null;
  }
}
function drawSoloOverlay(c) {
  const S = game.solo;
  // dark vignette
  c.fillStyle = 'rgba(5,0,12,.3)'; c.fillRect(0, 0, W, H);
  const intro = clamp(S.t / 30, 0, 1);
  // banner
  if (S.t < 100) {
    const k = ease(S.t / 14) * (S.t > 80 ? 1 - (S.t - 80) / 20 : 1);
    c.save(); c.globalAlpha = clamp(k, 0, 1); c.translate(W / 2, 560); c.rotate(-0.05);
    c.fillStyle = S.att.def.accent; c.beginPath(); c.moveTo(-460, -50); c.lineTo(470, -60); c.lineTo(450, 50); c.lineTo(-470, 58); c.closePath(); inked(c, S.att.def.accent, 6);
    comicText(c, S.att.def.superName + '!', 0, 2, 70, '#ffffff', '#ffcf3a');
    c.restore();
  }
  // highway (perspective)
  const cx = W / 2, yT = 120, yB = 370, wT = 70, wB = 170;
  c.save(); c.globalAlpha = intro;
  c.beginPath(); c.moveTo(cx - wT, yT); c.lineTo(cx + wT, yT); c.lineTo(cx + wB, yB + 20); c.lineTo(cx - wB, yB + 20); c.closePath();
  const gr = c.createLinearGradient(0, yT, 0, yB); gr.addColorStop(0, 'rgba(20,10,30,.3)'); gr.addColorStop(1, 'rgba(25,12,20,.92)'); c.fillStyle = gr; c.fill();
  c.lineWidth = 5; c.strokeStyle = '#d9d2ff'; c.stroke();
  // frets scrolling
  c.strokeStyle = 'rgba(220,210,255,.35)'; c.lineWidth = 2;
  for (let i = 0; i < 8; i++) { const k = ((i * 12 + S.t) % 96) / 96, y = lerp(yT, yB + 20, k * k), w = lerp(wT, wB, k * k); line(c, cx - w, y, cx + w, y); }
  for (let l = 1; l < 3; l++) { const u = l / 3 * 2 - 1; c.strokeStyle = 'rgba(220,210,255,.25)'; line(c, cx + u * wT, yT, cx + u * wB, yB + 20); }
  // strike buttons
  const laneX = (lane, k) => { const w = lerp(wT, wB, k); return cx + ((lane + 0.5) / 3 * 2 - 1) * w; };
  const kStrike = 1;
  const labels = S.att.ctrl === 'p2' ? ['J', 'K', 'L'] : S.att.ctrl === 'cpu' ? ['', '', ''] : isTouch ? ['SOCO', 'CHUTE', 'GUIT'] : ['F', 'G', 'H'];
  for (let l = 0; l < 3; l++) {
    const x = laneX(l, kStrike), y = yB;
    ell(c, x, y, 30, 14); inked(c, '#1a1020', 5); ell(c, x, y, 22, 9); c.lineWidth = 5; c.strokeStyle = LANE_COL[l]; c.stroke();
    if (labels[l]) comicText(c, labels[l], x, y + 34, labels[l].length > 1 ? 18 : 24, '#ffffff', LANE_COL[l]);
  }
  // notes
  for (const n of S.notes) {
    if (n.res && n.res !== 'miss') continue;
    const k = 1 - (n.t - S.t) / TRAVEL; if (k < 0 || k > 1.25) continue;
    const kk = k * k, y = lerp(yT, yB, kk), x = laneX(n.lane, kk), s = lerp(0.35, 1, kk);
    c.globalAlpha = intro * (n.res === 'miss' ? 0.35 : 1);
    ell(c, x, y, 28 * s, 13 * s); inked(c, LANE_COL[n.lane], 4 * s + 1);
    ell(c, x, y - 2 * s, 14 * s, 6 * s); c.fillStyle = '#ffffff'; c.fill();
    c.globalAlpha = intro;
  }
  for (const f of S.fb) {
    const k = f.life / 30; c.globalAlpha = k;
    comicText(c, f.text, laneX(f.lane, 1), yB - 50 - (1 - k) * 30, 30, '#ffffff', f.text === 'ERROU!' ? '#ff3030' : LANE_COL[f.lane]);
  }
  c.restore();
  // hit counter
  comicText(c, `${S.hits} / ${S.notes.length}`, cx + (S.att.x > cx ? -1 : 1) * (wB + 80), yB - 10, 40, '#ffffff', '#29d8ff');
}

// =====================================================================================
//  AI
// =====================================================================================
class AI {
  constructor(me) { this.me = me; this.plan = 'approach'; this.planT = 0; this.held = 0; this.lastAtt = -1; this.willBlock = false; this.blockT = 0; this.queued = null; this.jumpAtk = false; }
  read() {
    const me = this.me, op = me.opp, pad = emptyPad();
    const dist = Math.abs(op.x - me.x), fwdK = op.x > me.x ? 'r' : 'l', backK = fwdK === 'r' ? 'l' : 'r';
    if (game.solo) {
      if (game.solo.att === me) {
        const S = game.solo;
        if (!me.aiNotes) me.aiNotes = S.notes.map(() => ({ hit: Math.random() < 0.74, off: irnd(9) - 4 }));
        S.notes.forEach((n, i) => { const a = me.aiNotes[i]; if (!n.res && a.hit && S.t === n.t + a.off) pad[['P', 'K', 'H'][n.lane]] = true; });
      }
      return pad;
    }
    if (game.phase !== 'fight') return pad;
    // reactive defense
    const incoming = projs.find(p => p.owner === op && Math.sign(p.vx) === Math.sign(me.x - p.x) && Math.abs(p.x - me.x) < 280);
    if (op.state === 'attack' && op.attackId !== this.lastAtt) { this.lastAtt = op.attackId; this.willBlock = Math.random() < 0.5; }
    if (incoming && this.blockT <= 0) { this.blockT = 30; this.incomingJump = Math.random() < 0.35 && dist > 200; }
    if (this.blockT > 0) {
      this.blockT--;
      if (this.incomingJump && me.canAct()) { pad.u = true; pad[fwdK] = true; this.incomingJump = false; return pad; }
      if (incoming) { pad[backK] = true; return pad; }
    }
    if (op.state === 'attack' && dist < 210 && this.willBlock && op.mf < op.move.s + op.move.a + 2) {
      pad[backK] = true; if (op.move.low) pad.d = true; return pad;
    }
    if (me.state === 'jump' && this.jumpAtk && dist < 140 && me.vy > -4) { pad.K = true; this.jumpAtk = false; return pad; }
    if (!me.canAct()) return pad;
    const want = items.find(it => (it.kind === 'vacina' && me.hp < 85) || (it.kind === 'cdb' && it.y >= GY - 6 && me.meter < 100));
    if (want && Math.abs(want.x - me.x) < 420 && this.plan !== 'attack') { pad[want.x > me.x ? 'r' : 'l'] = true; return pad; }
    if (--this.planT <= 0) {
      const r = Math.random();
      if (me.meter >= 100 && dist < 600 && r < 0.6) this.plan = 'super';
      else if (dist > 330 && me.meter >= 25 && r < 0.35) this.plan = 'proj';
      else if (dist > 170) this.plan = r < 0.12 ? 'jumpin' : r < 0.2 ? 'wait' : 'approach';
      else this.plan = r < 0.72 ? 'attack' : r < 0.84 ? 'retreat' : r < 0.92 ? 'crouch' : 'jumpin';
      this.planT = this.plan === 'approach' ? 30 : this.plan === 'wait' ? 25 : this.plan === 'retreat' ? 18 : 1;
    }
    switch (this.plan) {
      case 'super': pad.SP = true; this.planT = 0; break;
      case 'proj': pad.PR = true; pad.d = Math.random() < 0.4; this.planT = 20; this.plan = 'wait'; break;
      case 'approach': pad[fwdK] = true; if (dist < 140) this.planT = 0; break;
      case 'retreat': pad[backK] = true; break;
      case 'crouch': pad.d = true; if (Math.random() < 0.08) pad.K = true; break;
      case 'jumpin': pad.u = true; pad[fwdK] = true; this.jumpAtk = true; this.plan = 'wait'; this.planT = 30; break;
      case 'attack': {
        const r = Math.random();
        if (dist < 115) { if (r < 0.45) pad.P = true; else if (r < 0.75) pad.K = true; else if (r < 0.88) { pad.d = true; pad.K = true; } else pad.H = true; }
        else if (dist < 175) { if (r < 0.55) pad.K = true; else pad.H = true; }
        else pad[fwdK] = true;
        this.plan = 'wait'; this.planT = 8 + irnd(14);
        break;
      }
    }
    return pad;
  }
}

// =====================================================================================
//  GAME FLOW
// =====================================================================================
const game = {
  scene: 'title', t: 0, mode: 1, modeSel: 0, charSel: 0, f1: null, f2: null, ctl1: null, ctl2: null,
  round: 1, phase: 'intro', phaseT: 0, timer: 99, hitstop: 0, shake: 0, excite: 0, solo: null, pyro: 0,
  winner: null, sceneT: 0, paused: false, pauseSel: 0, lastRoundWinner: null,
  shouts: [], boost: [0, 0],
};
function setScene(s) { game.scene = s; game.sceneT = 0; }
function newMatch() {
  const ids = ['lula', 'flavio'], a = ids[game.charSel], b = ids[1 - game.charSel];
  game.f1 = new Fighter(CHARS[a], 0); game.f2 = new Fighter(CHARS[b], 1);
  game.f1.ctrl = game.mode === 1 ? 'p1+' : 'p1'; game.f2.ctrl = game.mode === 1 ? 'cpu' : 'p2';
  game.ai = game.mode === 1 ? new AI(game.f2) : null;
  game.round = 1; startRound(); setScene('fight');
  if (r3) r3.setTorcidas([game.f1.def.id, game.f2.def.id]);
}
function startRound() {
  for (const f of [game.f1, game.f2]) f.reset();
  projs = []; parts = []; bolts = []; items = []; game.solo = null; game.cameo = null; game.shouts = []; game.boost = [0, 0];
  game.nextCameo = 700 + irnd(600); game.cameoN = game.cameoN || irnd(2);
  game.phase = 'intro'; game.phaseT = 0; game.timer = 99; game.timerF = 0; game.hitstop = 0; game.winner = null;
  if (game.round === 1) { game.f1.state = game.f2.state = 'intro'; }
}
function readPad(f) {
  if (f.ctrl === 'cpu') return game.ai.read();
  if (f.ctrl === 'p1+') return orPad(readBind(BIND.p1), readBind(BIND.p2));
  return readBind(BIND[f.ctrl]);
}
function updateFight() {
  const f1 = game.f1, f2 = game.f2;
  if (anyEdge('Escape', 'KeyP')) { game.paused = !game.paused; game.pauseSel = 0; audio.sfx('select'); return; }
  if (game.paused) {
    if (anyEdge('ArrowUp', 'KeyW', 'ArrowDown', 'KeyS')) { game.pauseSel = 1 - game.pauseSel; audio.sfx('select'); }
    if (tap) { game.pauseSel = tap.y > 420 ? 1 : 0; }
    if (confirmEdge() || tap) { if (game.pauseSel === 0) game.paused = false; else { game.paused = false; setScene('title'); } audio.sfx('confirm'); }
    return;
  }
  game.excite *= 0.985; game.flash = (game.flash || 0) * 0.85;
  for (const f of [f1, f2]) f.cheer = Math.max(0, f.cheer - 0.02);
  for (let i = 0; i < 2; i++) game.boost[i] *= 0.985;
  if (game.winner) game.boost[game.winner.side] = 1;
  for (const sh of game.shouts) sh.t++;
  game.shouts = game.shouts.filter(sh => sh.t < 95);
  if (game.pyro > 0) { game.pyro--; if (game.t % 3 === 0) { fire(200, 480, 2, 10, -10); fire(W - 200, 480, 2, 10, -10); } }
  updateParts();
  if (game.shake > 0) game.shake *= 0.85;
  for (const f of [f1, f2]) { if (f.dispDelay > 0) f.dispDelay--; else f.dispHp += (f.hp - f.dispHp) * 0.08; }
  f1.pad = readPad(f1); f2.pad = readPad(f2);
  if (game.hitstop > 0) { game.hitstop--; return; }
  if (game.solo) { updateSolo(); return; }
  game.phaseT++;
  // slow-mo on KO
  if (game.phase === 'ko' && game.phaseT < 60 && game.phaseT % 2) return;
  switch (game.phase) {
    case 'intro':
      if (game.round === 1 && game.phaseT === 70) { f1.state = f2.state = 'idle'; }
      if (game.phaseT === 1) audio.sfx('cheer', 0.8);
      if (game.phaseT === 100) { game.phase = 'fight'; audio.sfx('smash', 0.8); }
      break;
    case 'fight':
      if (++game.timerF >= 60) { game.timerF = 0; game.timer--; }
      if (f1.ko || f2.ko) { game.phase = 'ko'; game.phaseT = 0; audio.sfx('ko'); game.pyro = 120; confetti(); }
      else if (game.timer <= 0) { game.phase = 'timeup'; game.phaseT = 0; audio.sfx('ko'); }
      break;
    case 'ko': case 'timeup':
      if (game.phaseT === 100) {
        const w = f1.hp === f2.hp ? null : f1.hp > f2.hp ? f1 : f2;
        game.winner = w; if (w) { w.wins++; w.state = 'win'; w.vx = 0; }
      }
      if (game.phaseT === 230) {
        if (f1.wins >= 2 || f2.wins >= 2) { setScene('result'); game.champ = f1.wins >= 2 ? f1 : f2; game.quote = game.champ.def.quotes[irnd(game.champ.def.quotes.length)]; audio.sfx('cheer', 1.5); }
        else { game.round++; startRound(); }
      }
      break;
  }
  f1.update(); f2.update();
  updateCameo(); updateItems();
  // spacing
  if (f1.state !== 'down' && f2.state !== 'down' && Math.abs(f1.y - f2.y) < 140) {
    const dx = f2.x - f1.x, min = 104;
    if (Math.abs(dx) < min) { const push = (min - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1); f1.x = clamp(f1.x - push, 70, W - 70); f2.x = clamp(f2.x + push, 70, W - 70); }
  }
  updateProjs();
}
// =====================================================================================
//  PARTICIPAÇÕES ESPECIAIS (random cameos + pickups, for both fighters)
// =====================================================================================
let items = [];
const CAMEOS = {
  gotinha: { name: 'ZÉ GOTINHA', speed: 5 },
  vorcaro: { name: 'VORCARO', speed: 6.5 },
};
function startCameo() {
  const kind = ['gotinha', 'vorcaro'][game.cameoN++ % 2], dir = Math.random() < 0.5 ? 1 : -1;
  game.cameo = { kind, dir, x: dir > 0 ? -90 : W + 90, t: 0, state: 'enter', stopX: rnd(380, 900), pose: copyPose(POSES.idle) };
  if (kind === 'gotinha') { audio.sfx('jingle'); }
  else { audio.sfx('kaching'); pop('CDB A 140% DO CDI!', W / 2, 330, '#2bff5a', 46); }
}
function updateCameo() {
  if (game.phase !== 'fight') return;
  const cm = game.cameo;
  if (!cm) { if (--game.nextCameo <= 0) { startCameo(); game.nextCameo = 1100 + irnd(700); } return; }
  cm.t++;
  const sp = CAMEOS[cm.kind].speed;
  if (cm.kind === 'gotinha') {
    if (cm.state === 'enter') { cm.x += cm.dir * sp; if ((cm.x - cm.stopX) * cm.dir >= 0) { cm.state = 'act'; cm.actT = 0; } }
    else if (cm.state === 'act') {
      if (++cm.actT === 20) { items.push({ kind: 'vacina', x: cm.x + cm.dir * 40, y: GY - 34, life: 600 }); pop('OLHA A VACINA!', cm.x, GY - 260, '#29d8ff', 46); audio.sfx('heal', 0.6); }
      if (cm.actT > 70) cm.state = 'exit';
    } else cm.x += cm.dir * sp * 1.3;
  } else {
    cm.x += cm.dir * sp;
    // run cycle
    const ph = cm.t * 0.35, P_ = cm.pose;
    P_.lean = 16 * D; P_.hf = (10 + Math.sin(ph) * 38) * D; P_.hb = (-10 - Math.sin(ph) * 38) * D;
    P_.kf = (-30 - Math.max(0, Math.cos(ph)) * 60) * D; P_.kb = (-30 - Math.max(0, -Math.cos(ph)) * 60) * D;
    P_.sf = (20 - Math.sin(ph) * 50) * D; P_.ef = 80 * D; P_.sb = (10 + Math.sin(ph) * 40) * D; P_.eb = 20 * D; P_.head = -6 * D;
    if (cm.t % 8 === 0 && cm.x > 120 && cm.x < W - 120) { items.push({ kind: 'cdb', x: cm.x, y: GY - 200, vx: rnd(-2.5, 2.5), vy: rnd(-5, -1), rot: rnd(0, TAU), life: 1e9 }); audio.sfx('coin', 0.4); }
  }
  if (cm.x < -140 || cm.x > W + 140) {
    if (cm.kind === 'vorcaro') {
      pop('BANCO MASTER: LIQUIDADO!', W / 2, 330, '#ff3030', 58); audio.sfx('boo', 1);
      for (const it of items) if (it.kind === 'cdb') { fire(it.x, it.y, 3, 6, -2); it.life = 0; }
    }
    game.cameo = null;
  }
}
function updateItems() {
  for (const it of items) {
    it.life--;
    if (it.kind === 'cdb') {
      if (it.y < GY - 6) { it.vy = Math.min(it.vy + 0.18, 2); it.x += it.vx + Math.sin(game.t * 0.1 + it.rot) * 0.8; it.y += it.vy; it.vx *= 0.97; it.rot += 0.08; }
      else it.y = GY - 6;
    }
    for (const f of [game.f1, game.f2]) {
      if (it.life <= 0 || f.state === 'down' || Math.abs(f.x - it.x) > 46 || it.y < f.y - 300) continue;
      if (it.kind === 'cdb') { f.meter = Math.min(100, f.meter + 6); pop('+CDB', it.x, it.y - 30, '#2bff5a', 26); audio.sfx('coin'); }
      else { f.hp = Math.min(100, f.hp + 15); spark(it.x, it.y - 40, 18, '#29d8ff', 9); ring(it.x, it.y, '#2bffb0', 30); pop('VACINADO! +15', it.x, it.y - 120, '#29d8ff', 44); audio.sfx('heal'); }
      it.life = 0;
    }
  }
  items = items.filter(it => it.life > 0);
}
function drawItems(c) {
  for (const it of items) {
    if (it.kind !== 'cdb') continue;
    c.save(); c.translate(it.x, it.y); c.rotate(Math.sin(it.rot) * 0.5); c.scale(1, it.y < GY - 6 ? Math.cos(it.rot * 2) : 1);
    c.fillStyle = '#7fd36a'; c.fillRect(-20, -10, 40, 20); c.lineWidth = 2; c.strokeStyle = OUT; c.strokeRect(-20, -10, 40, 20);
    c.fillStyle = '#2f7a2a'; c.font = `10px ${FONT}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('CDB 140%', 0, 0);
    c.restore();
  }
}
function confetti() {
  const cols = ['#ff3030', '#ffd400', '#2bff5a', '#29b8ff', '#ff2bd6', '#ffffff'];
  for (let i = 0; i < 120; i++) parts.push({ t: 'conf', x: rnd(0, W), y: rnd(-200, 0), vx: rnd(-2, 2), vy: rnd(0, 3), rot: rnd(0, TAU), vr: rnd(-0.2, 0.2), life: 260, max: 260, col: cols[irnd(cols.length)] });
}

// =====================================================================================
//  HUD
// =====================================================================================
function portrait(c, d, x, y, r, flip) {
  c.save(); ell(c, x, y, r, r); c.clip();
  const g = c.createRadialGradient(x, y, 4, x, y, r); g.addColorStop(0, d.bg[1]); g.addColorStop(1, d.bg[0]); c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  c.translate(x - (flip ? -6 : 6) * r / 46, y + r * 0.95); c.scale((flip ? -1 : 1) * r / 52, r / 52); HEADS[d.id](c, { mouth: 0.3 });
  c.restore();
  ell(c, x, y, r, r); c.lineWidth = 6; c.strokeStyle = OUT; c.stroke(); c.lineWidth = 2.5; c.strokeStyle = '#d8d8e8'; c.stroke();
}
function drawHUD(c) {
  const f1 = game.f1, f2 = game.f2;
  for (const f of [f1, f2]) {
    const L = f.side === 0, x0 = L ? 112 : W - 112, dir = L ? 1 : -1, bw = 450;
    const bx = L ? x0 : x0 - bw;
    // frame
    c.save(); c.beginPath(); c.moveTo(bx - 6, 26); c.lineTo(bx + bw + 14, 26); c.lineTo(bx + bw + 4, 64); c.lineTo(bx - 6, 64); c.closePath();
    if (!L) { c.setTransform(1, 0, 0, 1, 0, 0); c.restore(); c.save(); c.beginPath(); c.moveTo(bx + bw + 6, 26); c.lineTo(bx - 14, 26); c.lineTo(bx - 4, 64); c.lineTo(bx + bw + 6, 64); c.closePath(); }
    const fg = c.createLinearGradient(0, 26, 0, 64); fg.addColorStop(0, '#f2f2f8'); fg.addColorStop(0.5, '#6a6a7a'); fg.addColorStop(1, '#2a2a34');
    c.fillStyle = fg; c.fill(); c.lineWidth = 5; c.strokeStyle = OUT; c.stroke(); c.restore();
    c.fillStyle = '#16060c'; c.fillRect(bx, 32, bw, 26);
    // trailing damage
    const dw = bw * clamp(f.dispHp / 100, 0, 1), hw = bw * clamp(f.hp / 100, 0, 1);
    c.fillStyle = '#fff'; c.fillRect(L ? bx + bw - dw : bx, 32, dw, 26);
    const low = f.hp < 25, col = f.hp > 55 ? ['#9dff6a', '#1fbf2a'] : f.hp > 25 ? ['#fff36a', '#e0a000'] : ['#ff7a6a', '#c8101a'];
    const hg = c.createLinearGradient(0, 32, 0, 58); hg.addColorStop(0, col[0]); hg.addColorStop(1, col[1]);
    c.fillStyle = hg; if (!(low && (game.t >> 3) % 2)) c.fillRect(L ? bx + bw - hw : bx, 32, hw, 26);
    c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(bx, 34, bw, 5);
    c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 2; for (let i = 1; i < 10; i++) line(c, bx + i * bw / 10, 32, bx + i * bw / 10, 58);
    // name
    comicText(c, f.def.full, L ? bx + 6 : bx + bw - 6, 82, 26, '#ffffff', f.def.accent, L ? 'left' : 'right', 5);
    // round wins (guitar picks)
    for (let i = 0; i < 2; i++) {
      const px = L ? bx + bw - 20 - i * 30 : bx + 20 + i * 30;
      c.beginPath(); c.moveTo(px - 11, 74); c.quadraticCurveTo(px, 68, px + 11, 74); c.quadraticCurveTo(px + 8, 88, px, 96); c.quadraticCurveTo(px - 8, 88, px - 11, 74); c.closePath();
      inked(c, i < f.wins ? '#ffd400' : '#2a1a2a', 3.5);
    }
    // star power meter
    const mw = 300, mx = L ? bx + 6 : bx + bw - 6 - mw, my = 100;
    c.fillStyle = '#0a0a18'; c.fillRect(mx - 3, my - 3, mw + 6, 20); c.lineWidth = 3; c.strokeStyle = OUT; c.strokeRect(mx - 3, my - 3, mw + 6, 20);
    const full = f.meter >= 100, mwv = mw * f.meter / 100;
    const mg = c.createLinearGradient(0, my, 0, my + 14); mg.addColorStop(0, full ? '#e6fbff' : '#7fe0ff'); mg.addColorStop(1, full ? '#29b8ff' : '#0a62c8');
    c.fillStyle = mg; c.fillRect(L ? mx : mx + mw - mwv, my, mwv, 14);
    c.strokeStyle = OUT; c.lineWidth = 2; for (let i = 1; i < 4; i++) line(c, mx + i * mw / 4, my, mx + i * mw / 4, my + 14);
    if (full) { c.save(); c.globalAlpha = 0.5 + 0.5 * Math.sin(game.t * 0.25); comicText(c, isTouch && f.ctrl !== 'cpu' ? 'SOLO PRONTO!' : f.ctrl === 'cpu' ? 'SOLO PRONTO!' : `SOLO PRONTO! [${f.ctrl === 'p2' ? 'I' : 'T'}]`, L ? mx + mw + 12 : mx - 12, my + 7, 20, '#ffffff', '#29b8ff', L ? 'left' : 'right', 4); c.restore(); }
    else comicText(c, 'STAR POWER', L ? mx + mw + 10 : mx - 10, my + 7, 15, '#bfefff', '#29b8ff', L ? 'left' : 'right', 3.5);
    // torcida meter
    const T = f.def.torcida, ty = 134;
    comicText(c, T.name, L ? mx : mx + mw, ty, 15, '#ffffff', '#ffd9a0', L ? 'left' : 'right', 3.5);
    c.fillStyle = '#0a0a18'; c.fillRect(mx - 2, ty + 10, mw + 4, 11); c.lineWidth = 2.5; c.strokeStyle = OUT; c.strokeRect(mx - 2, ty + 10, mw + 4, 11);
    const cw = mw * f.cheer / 100; c.fillStyle = f.cheer > 80 ? '#ffffff' : T.col; c.fillRect(L ? mx : mx + mw - cw, ty + 12, cw, 7);
    portrait(c, f.def, L ? 62 : W - 62, 58, 46, !L);
  }
  // timer badge
  c.save(); c.translate(W / 2, 52);
  starburst(c, 52, 40, 14); inked(c, '#e3121c', 5);
  ell(c, 0, 0, 36, 36); inked(c, '#16060c', 4);
  comicText(c, String(Math.max(0, game.timer)).padStart(2, '0'), 0, 3, 44, '#ffffff', game.timer <= 10 ? '#ff3030' : '#ffd400');
  c.restore();
}

// =====================================================================================
//  SCENES — render
// =====================================================================================
function bannerText(text, t, top = '#fff6a0', bot = '#ff3a12', size = 110) {
  const k = t < 8 ? ease(t / 8) : 1;
  ctx.save(); ctx.translate(W / 2, 330); ctx.scale(lerp(2.2, 1, k), lerp(2.2, 1, k)); ctx.globalAlpha = k; ctx.rotate(-0.04);
  comicText(ctx, text, 0, 0, size, top, bot);
  ctx.restore();
}
// fighting-game camera: frames both rockers, zooms in for the solo and the K.O.
function fightCam() {
  const f1 = game.f1, f2 = game.f2, pt = game.phaseT;
  const cam = { x: (f1.x + f2.x) / 2, y: 410, w: clamp(Math.abs(f1.x - f2.x) + 660, 980, 1360), orbit: 0 };
  cam.y -= (GY - Math.min(f1.y, f2.y)) * 0.35;
  if (game.solo) {
    const a = game.solo.att, d = game.solo.def;
    cam.x = lerp(a.x, d.x, 0.4); cam.w = 1040; cam.y = 400; cam.orbit = Math.sin(game.t * 0.01) * 0.08 - a.facing * 0.14;
  } else if (game.phase === 'intro' && game.round === 1) {
    const k = ease(pt / 100); cam.orbit = (1 - k) * 0.75; cam.w = lerp(1000, cam.w, k);
  } else if (game.phase === 'ko' || game.phase === 'timeup') {
    const focus = pt < 100 ? (f1.ko ? f1 : f2.ko ? f2 : null) : game.winner;
    if (focus) { cam.x = focus.x; cam.w = 860; cam.y = 420; cam.orbit = (pt < 100 ? 0.18 : -0.22) * focus.facing; }
  }
  return cam;
}
function renderFight() {
  const c = ctx, f1 = game.f1, f2 = game.f2;
  c.clearRect(0, 0, W, H);
  if (!r3) { comicText(c, 'WebGL indisponível neste navegador', W / 2, H / 2, 40); return; }
  r3.render({
    mode: 'fight', t: game.t, beat: music.beat, excite: game.excite, dark: !!game.solo, shake: game.shake,
    flash: game.flash, flashPos: game.flashPos, cam: fightCam(), actors: [f1.look(), f2.look()], projs,
    cameo: game.cameo, items,
    torcidas: [leaderLook(0), leaderLook(1)],
    cheer: [0, 1].map(i => clamp((i ? f2 : f1).cheer / 100 * 0.5 + game.boost[i] + game.excite * 0.3, 0, 1.4)),
  });
  // sparks, fire, comic pops and lightning live on the fight plane: draw them through the camera
  const T = r3.planeTransform((f1.x + f2.x) / 2, 420);
  c.setTransform(T[0] * scale, T[1] * scale, T[2] * scale, T[3] * scale, T[4] * scale, T[5] * scale);
  drawBalloons(c);
  drawItems(c);
  drawParts(c);
  c.setTransform(scale, 0, 0, scale, 0, 0);
  if (game.solo) drawSoloOverlay(c);
  drawHUD(c);
  drawShouts(c);
  drawTorcidaIntro(c);
  if (game.cameo && game.cameo.t < 130) {
    const k = clamp(Math.min(game.cameo.t, 130 - game.cameo.t) / 12, 0, 1);
    c.save(); c.globalAlpha = k; c.translate(W / 2, 162); c.rotate(-0.02);
    c.beginPath(); c.moveTo(-250, -22); c.lineTo(260, -26); c.lineTo(250, 22); c.lineTo(-260, 26); c.closePath(); inked(c, '#16060c', 4);
    comicText(c, 'PARTICIPAÇÃO ESPECIAL: ' + CAMEOS[game.cameo.kind].name, 0, 1, 26, '#ffffff', '#ffd400', 'center', 5);
    c.restore();
  }
  // banners
  const pt = game.phaseT;
  if (game.phase === 'intro') {
    if (pt < 60) bannerText('ROUND ' + game.round, pt);
    else if (pt < 100) bannerText('BORA, ROCK!', pt - 60, '#ffffff', '#ffd400', 120);
  } else if (game.phase === 'ko' || game.phase === 'timeup') {
    if (pt < 100) bannerText(game.phase === 'ko' ? 'K.O.!' : 'TEMPO!', pt, '#ffffff', '#ff2020', 150);
    else if (game.winner) { bannerText(game.winner.def.name + ' VENCE!', pt - 100, '#ffffff', game.winner.def.accent, 90); }
    else bannerText('EMPATE!', pt - 100);
  }
  if (game.paused) {
    c.fillStyle = 'rgba(5,0,12,.72)'; c.fillRect(0, 0, W, H);
    comicText(c, 'PAUSADO', W / 2, 200, 100);
    ['CONTINUAR', 'SAIR PARA O MENU'].forEach((s, i) => comicText(c, (game.pauseSel === i ? '▶ ' : '') + s, W / 2, 340 + i * 90, game.pauseSel === i ? 56 : 44, '#ffffff', game.pauseSel === i ? '#ffd400' : '#8a8a9a'));
    drawControlsHelp(c, 560);
  }
}
// the leader's shout: a big comic burst on that fighter's half of the screen
function drawShouts(c) {
  for (const s of game.shouts) {
    const age = s.t, k = age < 7 ? lerp(0.3, 1.18, age / 7) : age < 12 ? lerp(1.18, 1, (age - 7) / 5) : 1, fade = clamp((95 - age) / 15, 0, 1);
    const long = s.text.length > 12, x = s.side === 0 ? 330 : 950;
    c.save(); c.translate(x, 245 + Math.sin(age * 0.5) * 3); c.rotate((s.side ? 0.07 : -0.07)); c.scale(k, k); c.globalAlpha = fade;
    starburst(c, long ? 185 : 150, long ? 138 : 110, 14); inked(c, s.col, 6);
    comicText(c, s.text, 0, 6, long ? 38 : 56, '#ffffff', '#ffd400', 'center', 8);
    comicText(c, s.who + ' GRITA:', 0, long ? -52 : -44, 17, '#ffffff', '#ffe9a0', 'center', 4);
    c.restore();
  }
}
// round 1 only: the two torcidas are introduced with their leaders
function drawTorcidaIntro(c) {
  if (game.phase !== 'intro' || game.round !== 1 || game.phaseT > 130) return;
  const pt = game.phaseT, k = ease(Math.min(pt, 14) / 14) * (pt > 110 ? 1 - (pt - 110) / 20 : 1);
  [game.f1, game.f2].forEach((f, i) => {
    const T = f.def.torcida, w = 470, h = 78, x = i ? W - 18 - w : 18, y = 596, off = (1 - k) * (i ? 1 : -1) * 520;
    c.save(); c.translate(x + off, y);
    c.beginPath(); if (i) { c.moveTo(24, 0); c.lineTo(w, 0); c.lineTo(w, h); c.lineTo(0, h); } else { c.moveTo(0, 0); c.lineTo(w - 24, 0); c.lineTo(w, h); c.lineTo(0, h); } c.closePath();
    inked(c, T.col, 6);
    comicText(c, T.name, w / 2, 27, 36, '#ffffff', '#ffd400', 'center', 6);
    comicText(c, 'comandada por ' + T.leader, w / 2, 58, 21, '#ffffff', '#ffe9a0', 'center', 4);
    c.restore();
  });
}
function drawControlsHelp(c, y) {
  const lines = game.mode === 2
    ? ['J1: A/D andar · W pular · S agachar/defender baixo · F soco · G chute · H pesado · R / S+R especiais · T solo',
       'J2: setas · J soco · K chute · L pesado · U / ↓+U especiais · I solo (ou Numpad 1-5)']
    : ['A/D ou ←/→ andar · W pular · S agachar · segure TRÁS para defender',
       'F soco · G chute · H golpe pesado · R / S+R especiais (¼ star power) · T SOLO (star power cheio)'];
  c.save(); c.font = `20px ${FONT}`; c.textAlign = 'center'; c.fillStyle = '#e9e2ff';
  lines.forEach((l, i) => { c.lineWidth = 4; c.strokeStyle = OUT; c.strokeText(l, W / 2, y + i * 28); c.fillText(l, W / 2, y + i * 28); });
  c.restore();
}

function rays(c, x, y, t, cols, n = 18, a0 = 0.06) {
  c.save(); c.translate(x, y); c.rotate(t * 0.004);
  for (let i = 0; i < n; i++) { c.fillStyle = cols[i % cols.length]; c.beginPath(); c.moveTo(0, 0); const a = i / n * TAU; c.arc(0, 0, 1600, a, a + TAU / n * 0.55); c.closePath(); c.fill(); }
  c.restore();
}
function halftone(c, x0, y0, w, h, col, step = 14) {
  c.fillStyle = col;
  for (let y = y0; y < y0 + h; y += step) for (let x = x0 + ((y / step) % 2) * step / 2; x < x0 + w; x += step) { const r = (y - y0) / h * step * 0.42; if (r > 0.4) { ell(c, x, y, r, r); c.fill(); } }
}

function drawLogo(c, x, y, s) {
  c.save(); c.translate(x, y); c.scale(s, s);
  // flames behind logo
  for (let i = 0; i < 22; i++) {
    const fx = -360 + i * 34, h = 60 + Math.abs(Math.sin(game.t * 0.08 + i * 1.3)) * 50 + (i % 3) * 14;
    c.beginPath(); c.moveTo(fx - 26, 20); c.quadraticCurveTo(fx - 16, -h * 0.6, fx + 4, -h); c.quadraticCurveTo(fx + 2, -h * 0.4, fx + 26, 20); c.closePath();
    c.fillStyle = i % 2 ? '#ff5a12' : '#ffb21a'; c.fill();
  }
  c.save(); c.rotate(-0.04);
  comicText(c, 'GUITAR BRIGA', 0, -10, 118, '#ffffff', '#ffb000', 'center', 16);
  // chrome shine stripe
  c.restore();
  // III badge
  c.save(); c.translate(318, -64); c.rotate(0.15); starburst(c, 56, 42, 12); inked(c, '#e3121c', 6); comicText(c, 'III', 0, 4, 54, '#ffffff', '#ffd400'); c.restore();
  // ribbon
  c.save(); c.translate(0, 74); c.rotate(-0.02);
  c.beginPath(); c.moveTo(-330, -30); c.lineTo(330, -30); c.lineTo(350, 0); c.lineTo(330, 30); c.lineTo(-330, 30); c.lineTo(-350, 0); c.closePath(); inked(c, '#16060c', 6);
  comicText(c, 'LENDAS DO PLANALTO', 0, 2, 44, '#ffffff', '#ff3a3a', 'center', 7);
  c.restore();
  c.restore();
}

function renderTitle() {
  const c = ctx, t = game.t;
  c.fillStyle = '#12020a'; c.fillRect(0, 0, W, H);
  rays(c, W / 2, 330, t, ['#2a0410', '#160208']);
  c.save(); c.globalAlpha = 0.5; drawStageLive(c, t, music.beat, true); c.restore();
  c.fillStyle = 'rgba(20,0,10,.5)'; c.fillRect(0, 0, W, H);
  // characters
  const bob = Math.sin(t * 0.1) * 4;
  const pl = copyPose(POSES.shred); pl.head = (8 + Math.sin(t * 0.3) * 10) * D;
  c.save(); c.translate(0, bob);
  drawFigure(c, CHARS.lula, pl, 290, 740, 1, 1.45, { gtr: 'hands', t, ex: { mouth: 0.6 + Math.sin(t * 0.3) * 0.3 } });
  c.restore();
  const pf = copyPose(POSES.shred); pf.head = (8 + Math.sin(t * 0.3 + 1) * 10) * D;
  c.save(); c.translate(0, -bob);
  drawFigure(c, CHARS.flavio, pf, 990, 740, -1, 1.4, { gtr: 'hands', t: t + 20, ex: { mouth: 0.6 + Math.sin(t * 0.3 + 1) * 0.3 } });
  c.restore();
  splat(c, 640, 190, 120, 'rgba(0,0,0,.55)', 7);
  drawLogo(c, W / 2, 180, 1);
  drawCrowd(c, t, music.beat, 0.4);
  tornPaper(c, W / 2, 560, 470, 74, -0.02, '#f1e6c8', 3);
  if ((t >> 5) % 2 === 0) comicText(c, isTouch ? 'TOQUE PARA COMEÇAR' : 'APERTE ENTER', W / 2, 560, 46, '#ffffff', '#e3121c');
  c.save(); c.font = `16px ${FONT}`; c.textAlign = 'center'; c.fillStyle = 'rgba(255,255,255,.7)';
  c.fillText('Paródia / sátira. Personagens caricatos — é só um jogo, nada de política aqui.  ·  M: som', W / 2, 706); c.restore();
}

// torn-paper scrap with tape (GH3 menu collage look)
function tornPaper(c, x, y, w, h, rot, col, seed = 1) {
  let r = seed * 9301 + 49297; const R = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  c.save(); c.translate(x, y); c.rotate(rot);
  c.beginPath(); const j = 7;
  for (let px = -w / 2; px < w / 2; px += 14) c.lineTo(px, -h / 2 + R() * j);
  for (let py = -h / 2; py < h / 2; py += 12) c.lineTo(w / 2 - R() * j, py);
  for (let px = w / 2; px > -w / 2; px -= 14) c.lineTo(px, h / 2 - R() * j);
  for (let py = h / 2; py > -h / 2; py -= 12) c.lineTo(-w / 2 + R() * j, py);
  c.closePath();
  c.shadowColor = 'rgba(0,0,0,.6)'; c.shadowBlur = 14; c.shadowOffsetY = 6; c.fillStyle = col; c.fill(); c.shadowColor = 'transparent';
  c.lineWidth = 3; c.strokeStyle = OUT; c.stroke();
  c.save(); c.clip(); c.globalAlpha = 0.12; hatch(c, -w / 2, -h / 2, w / 2, h / 2, 7, '#000', 1); c.restore();
  for (const sx of [-1, 1]) { c.save(); c.translate(sx * w * 0.42, -h / 2); c.rotate(sx * 0.5); c.fillStyle = 'rgba(240,230,190,.75)'; c.fillRect(-26, -10, 52, 20); c.restore(); }
  c.restore();
}
function splat(c, x, y, r, col, seed) {
  let q = seed; const R = () => ((q = (q * 16807) % 2147483647) / 2147483647);
  c.fillStyle = col; ell(c, x, y, r, r * 0.9); c.fill();
  for (let i = 0; i < 12; i++) { const a = R() * TAU, d = r * (0.9 + R() * 1.4), s = r * (0.08 + R() * 0.22); ell(c, x + Math.cos(a) * d, y + Math.sin(a) * d, s, s); c.fill(); c.lineWidth = s; c.strokeStyle = col; line(c, x, y, x + Math.cos(a) * d * 0.9, y + Math.sin(a) * d * 0.9); }
}
function menuBox(c, x, y, w, h, sel, title, sub) {
  tornPaper(c, x, y, w, h, sel ? -0.025 : 0.012, sel ? '#d8122a' : '#3a2230', title.length);
  c.save(); c.translate(x, y); c.rotate(sel ? -0.025 : 0.012);
  comicText(c, title, 0, -10, sel ? 56 : 46, '#ffffff', sel ? '#ffd400' : '#9a8a9a');
  c.font = `20px ${FONT}`; c.textAlign = 'center'; c.fillStyle = sel ? '#ffe9b0' : '#8a7a8a'; c.fillText(sub, 0, 32);
  c.restore();
}
function renderMode() {
  const c = ctx, t = game.t;
  c.fillStyle = '#12020a'; c.fillRect(0, 0, W, H);
  rays(c, W / 2, 360, t, ['#2a0410', '#160208']);
  drawLogo(c, W / 2, 130, 0.6);
  menuBox(c, W / 2, 330, 560, 110, game.modeSel === 0, '1 JOGADOR', 'você contra a CPU');
  menuBox(c, W / 2, 470, 560, 110, game.modeSel === 1, '2 JOGADORES', 'no mesmo teclado');
  game.mode = game.modeSel + 1;
  drawControlsHelp(c, 620);
}
const panelPath = (c, x) => { c.beginPath(); c.moveTo(x - 270, 110); c.lineTo(x + 280, 110); c.lineTo(x + 260, 620); c.lineTo(x - 290, 620); c.closePath(); };
function renderSelect() {
  const t = game.t, ids = ['lula', 'flavio'];
  const b = bgx; b.setTransform(scale, 0, 0, scale, 0, 0);
  b.fillStyle = '#0c0108'; b.fillRect(0, 0, W, H);
  ids.forEach((id, i) => {
    const d = CHARS[id], x = i === 0 ? 330 : 950, sel = game.charSel === i;
    b.save(); panelPath(b, x); b.clip();
    const g = b.createLinearGradient(0, 110, 0, 620); g.addColorStop(0, d.bg[1]); g.addColorStop(1, d.bg[0]); b.fillStyle = g; b.fillRect(x - 300, 100, 600, 540);
    rays(b, x, 380, t * (sel ? 1 : 0), ['rgba(255,255,255,.08)', 'rgba(0,0,0,0)'], 16);
    halftone(b, x - 300, 420, 600, 200, 'rgba(0,0,0,.35)');
    b.restore();
  });
  const c = ctx; c.clearRect(0, 0, W, H);
  if (r3) {
    const actors = ids.map((id, i) => {
      const sel = game.charSel === i, p = copyPose(sel ? POSES.win : POSES.idle);
      if (sel) p.sf += Math.sin(t * 0.3) * 8 * D; else p.kf += Math.sin(t * 0.09) * 4 * D;
      return { id, pose: p, x: i === 0 ? 320 : 940, y: 602, facing: i === 0 ? 1 : -1, yaw: 0.55 + Math.sin(t * 0.022 + i * 2) * 0.4, gtr: 'back',
        ex: { mouth: sel ? 0.8 : 0.1, blink: (t + i * 50) % 160 < 6 }, horns: sel, t, scale: 1.08 };
    });
    r3.render({ mode: 'showcase', t, beat: music.beat, cam: { x: 640, y: 360, w: 1280, snap: true }, actors, projs: [] });
  }
  comicText(c, 'ESCOLHA SEU ROQUEIRO', W / 2, 60, 62);
  ids.forEach((id, i) => {
    const d = CHARS[id], x = i === 0 ? 330 : 950, sel = game.charSel === i;
    if (!sel) { panelPath(c, x); c.fillStyle = 'rgba(8,0,12,.5)'; c.fill(); }
    panelPath(c, x); c.lineWidth = sel ? 10 : 6; c.strokeStyle = sel ? '#ffd400' : OUT; c.stroke();
    comicText(c, d.name, x, 150, 64, '#ffffff', d.accent);
    comicText(c, d.nick, x, 200, 32, '#ffffff', '#cccccc');
    d.stats.forEach(([n, v], k) => {
      const sx = x - 220, sy = 470 + k * 34;
      c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(sx - 6, sy - 14, 218, 28);
      c.font = `20px ${FONT}`; c.textAlign = 'left'; c.fillStyle = '#fff'; c.fillText(n, sx, sy + 7);
      for (let j = 0; j < 5; j++) { c.beginPath(); c.rect(sx + 136 + j * 14, sy - 8, 10, 16); inked(c, j < v ? d.accent : '#333', 2); }
    });
    comicText(c, d.torcida.name, x, 586, 24, '#ffffff', d.torcida.col, 'center', 5);
    comicText(c, 'puxada por ' + d.torcida.leader, x, 608, 15, '#ffffff', '#ffe9a0', 'center', 3.5);
    c.save(); c.font = `17px ${FONT}`; c.textAlign = 'right'; c.lineWidth = 4; c.strokeStyle = OUT; c.fillStyle = '#fff3b0';
    d.moves.forEach((m, k) => { c.strokeText(m, x + 250, 254 + k * 24); c.fillText(m, x + 250, 254 + k * 24); }); c.restore();
    if (sel) { c.save(); c.translate(x, 650 + Math.sin(t * 0.2) * 4); starburst(c, 34, 26, 10); inked(c, '#e3121c', 4); comicText(c, 'J1', 0, 2, 30, '#fff', '#ffd400'); c.restore(); }
    else comicText(c, game.mode === 1 ? 'CPU' : 'J2', x, 650, 30, '#ffffff', '#888');
  });
  comicText(c, 'VS', W / 2, 370, 110, '#ffffff', '#ff2020');
  c.save(); c.font = `20px ${FONT}`; c.textAlign = 'center'; c.fillStyle = '#e9e2ff';
  c.fillText(isTouch ? 'toque no personagem e de novo para confirmar' : '◀ ▶ escolher · ENTER confirmar · ESC voltar', W / 2, 700); c.restore();
}
function renderVS() {
  const c = ctx, t = game.sceneT, f1 = game.f1, f2 = game.f2;
  const slide = ease(t / 20);
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  for (const [f, L] of [[f1, true], [f2, false]]) {
    const d = f.def;
    c.save();
    c.beginPath(); if (L) { c.moveTo(0, 0); c.lineTo(W / 2 + 90, 0); c.lineTo(W / 2 - 90, H); c.lineTo(0, H); } else { c.moveTo(W / 2 + 90, 0); c.lineTo(W, 0); c.lineTo(W, H); c.lineTo(W / 2 - 90, H); } c.closePath(); c.clip();
    c.translate((L ? -1 : 1) * (1 - slide) * 700, 0);
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, d.bg[1]); g.addColorStop(1, d.bg[0]); c.fillStyle = g; c.fillRect(0, 0, W, H);
    rays(c, L ? 320 : 960, 360, game.t, ['rgba(255,255,255,.07)', 'rgba(0,0,0,0)'], 20);
    halftone(c, 0, 380, W, 340, 'rgba(0,0,0,.4)', 16);
    // big bust portrait
    c.save(); c.translate(L ? 330 : 950, 640); c.scale(L ? 2.55 : -2.55, 2.55); drawFacing = L ? 1 : -1;
    drawTorso(c, d, d.len.torso, game.t);
    c.save(); c.translate(0, -d.len.torso); c.beginPath(); c.rect(-11, -14, 24, 22); inked(c, d.skin, 4); c.translate(2, -4); HEADS[d.id](c, { mouth: 0.5 + 0.3 * Math.sin(game.t * 0.2), angry: true }); c.restore();
    c.restore();
    comicText(c, d.name, L ? 300 : 980, 610, 96, '#ffffff', d.accent);
    comicText(c, d.nick, L ? 300 : 980, 672, 40, '#ffffff', '#ffffff');
    c.restore();
  }
  c.strokeStyle = OUT; c.lineWidth = 14; line(c, W / 2 + 90, 0, W / 2 - 90, H); c.strokeStyle = '#ffd400'; c.lineWidth = 5; line(c, W / 2 + 90, 0, W / 2 - 90, H);
  const k = ease((t - 18) / 10);
  if (k > 0) {
    c.save(); c.translate(W / 2, 330); c.scale(lerp(3, 1, k), lerp(3, 1, k)); c.globalAlpha = k; c.rotate(-0.08);
    for (let i = 0; i < 10; i++) { const fx = -110 + i * 24, h = 70 + Math.abs(Math.sin(game.t * 0.2 + i)) * 40; c.beginPath(); c.moveTo(fx - 20, 40); c.quadraticCurveTo(fx - 8, -h * 0.5, fx + 2, -h); c.quadraticCurveTo(fx + 4, -h * 0.4, fx + 20, 40); c.fillStyle = i % 2 ? '#ff5a12' : '#ffb21a'; c.fill(); }
    comicText(c, 'VS', 0, 0, 170, '#ffffff', '#ff2020', 'center', 18);
    c.restore();
  }
}
function renderResult() {
  const c = ctx, ch = game.champ, d = ch.def;
  c.clearRect(0, 0, W, H);
  if (r3) {
    const p = copyPose(POSES.shred); p.head = (8 + Math.sin(game.t * 0.45) * 14) * D;
    r3.render({
      mode: 'fight', t: game.t, beat: music.beat, excite: 1, cam: { x: 600, y: 420, w: 900, orbit: 0.12 + Math.sin(game.t * 0.006) * 0.22 }, projs: [],
      actors: [{ id: d.id, pose: p, x: 470, y: GY, facing: 1, yaw: 0.95, gtr: 'hands', t: game.t, ex: { mouth: 0.6 + 0.4 * Math.sin(game.t * 0.3) } }],
    });
  }
  const g = c.createLinearGradient(560, 0, 820, 0); g.addColorStop(0, 'rgba(10,0,14,0)'); g.addColorStop(1, 'rgba(10,0,14,.7)');
  c.fillStyle = g; c.fillRect(560, 0, W - 560, H);
  drawParts(c); updateParts();
  if (game.t % 40 === 0) confetti();
  comicText(c, 'VITÓRIA!', 930, 110, 120, '#ffffff', '#ffd400');
  comicText(c, d.full, 930, 205, 50, '#ffffff', d.accent);
  // speech bubble
  const bx = 660, by = 270, bw = 560, bh = 170;
  c.beginPath(); c.moveTo(bx + 20, by); c.lineTo(bx + bw - 20, by); c.quadraticCurveTo(bx + bw, by, bx + bw, by + 20); c.lineTo(bx + bw, by + bh - 20); c.quadraticCurveTo(bx + bw, by + bh, bx + bw - 20, by + bh);
  c.lineTo(bx + 90, by + bh); c.lineTo(bx - 60, by + bh + 40); c.lineTo(bx + 50, by + bh); c.lineTo(bx + 20, by + bh); c.quadraticCurveTo(bx, by + bh, bx, by + bh - 20); c.lineTo(bx, by + 20); c.quadraticCurveTo(bx, by, bx + 20, by); c.closePath();
  inked(c, '#fffdf2', 6);
  c.save(); c.font = `30px ${FONT}`; c.fillStyle = OUT; c.textAlign = 'left';
  const words = ('"' + game.quote + '"').split(' '); let ln = '', yy = by + 48;
  for (const w of words) { if (c.measureText(ln + w).width > bw - 50) { c.fillText(ln, bx + 26, yy); ln = ''; yy += 38; } ln += w + ' '; }
  c.fillText(ln, bx + 26, yy); c.restore();
  const f1 = game.f1, f2 = game.f2;
  comicText(c, `${f1.def.name} ${f1.wins}  ×  ${f2.wins} ${f2.def.name}`, 940, 520, 44, '#ffffff', '#ffd400');
  if ((game.t >> 5) % 2 === 0) comicText(c, isTouch ? 'TOQUE PARA REVANCHE' : 'ENTER: REVANCHE  ·  ESC: MENU', 940, 610, 34, '#ffffff', '#29d8ff');
}

// =====================================================================================
//  MAIN LOOP
// =====================================================================================
function update() {
  game.t++; game.sceneT++;
  if (edge.has('KeyM')) audio.toggleMute();
  switch (game.scene) {
    case 'title':
      if (confirmEdge() || tap) { audio.unlock(); audio.sfx('confirm'); setScene('mode'); }
      break;
    case 'mode':
      if (anyEdge('ArrowUp', 'KeyW', 'ArrowDown', 'KeyS')) { game.modeSel = 1 - game.modeSel; audio.sfx('select'); }
      if (tap) { const s = tap.y < 400 ? 0 : 1; if (s === game.modeSel || isTouch) { game.modeSel = s; game.mode = s + 1; audio.sfx('confirm'); setScene('select'); } else { game.modeSel = s; audio.sfx('select'); } }
      else if (confirmEdge()) { game.mode = game.modeSel + 1; audio.sfx('confirm'); setScene('select'); }
      else if (anyEdge('Escape')) setScene('title');
      break;
    case 'select':
      if (anyEdge('ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD')) { game.charSel = 1 - game.charSel; audio.sfx('select'); }
      if (tap) { const s = tap.x < W / 2 ? 0 : 1; if (s === game.charSel && game.sceneT > 10) { audio.sfx('confirm'); newMatch(); setScene('vs'); } else { game.charSel = s; audio.sfx('select'); } }
      else if (confirmEdge() && game.sceneT > 5) { audio.sfx('confirm'); newMatch(); setScene('vs'); }
      else if (anyEdge('Escape')) setScene('mode');
      break;
    case 'vs':
      if (game.sceneT === 20) audio.sfx('smash');
      if (game.sceneT > 170 || (game.sceneT > 40 && (confirmEdge() || tap))) setScene('fight');
      break;
    case 'fight': updateFight(); break;
    case 'result':
      if (game.sceneT > 40 && (confirmEdge() || tap)) { audio.sfx('confirm'); newMatch(); setScene('vs'); }
      else if (anyEdge('Escape')) setScene('title');
      break;
  }
  edge.clear(); tap = null;
}
function render() {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  const sc = game.scene;
  glCv.style.visibility = sc === 'fight' || sc === 'select' || sc === 'result' ? 'visible' : 'hidden';
  bgCv.style.visibility = sc === 'select' ? 'visible' : 'hidden';
  switch (game.scene) {
    case 'title': renderTitle(); break;
    case 'mode': renderMode(); break;
    case 'select': renderSelect(); break;
    case 'vs': renderVS(); break;
    case 'fight': renderFight(); break;
    case 'result': renderResult(); break;
  }
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawPost(ctx);
  touchEl.classList.toggle('on', isTouch && game.scene === 'fight');
}
let last = performance.now(), acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  acc += Math.min(100, now - last); last = now;
  let n = 0;
  while (acc >= 1000 / 60 && n < 4) { update(); acc -= 1000 / 60; n++; }
  if (n === 4) acc = 0;
  render();
}
try { r3 = new Stage3D(glCv, CHARS); } catch (e) { console.error(e); }
addEventListener('resize', resize);
resize();

// test / automation hooks: ?scene=fight&p=lula&mode=1, window.__gb
if (URLP.get('scene')) {
  game.charSel = URLP.get('p') === 'flavio' ? 1 : 0; game.mode = +(URLP.get('mode') || 1);
  const s = URLP.get('scene');
  if (s === 'fight' || s === 'vs' || s === 'result') { newMatch(); if (s === 'result') { game.champ = game.f1; game.f1.wins = 2; game.quote = game.f1.def.quotes[0]; } setScene(s); }
  else setScene(s);
}
window.__gb = { game, keys, edge, POSES, startSolo, Fighter, CHARS, drawFigure, get r3() { return r3; }, step(n) { for (let i = 0; i < n; i++) update(); } };
requestAnimationFrame(frame);
