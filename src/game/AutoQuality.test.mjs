// Run: node src/game/AutoQuality.test.mjs
import assert from 'node:assert/strict';
import { AutoQuality, guessInitialTier, SCALE_FACTORS } from './AutoQuality.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };

/** Drive the controller with a frame-time function ms(state, t) for `seconds` of simulated time; returns the change log. */
function simulate(aq, seconds, msFn, t0 = 0) {
  const log = []; let t = t0;
  const end = t0 + seconds * 1000;
  aq.applyFn = (s) => log.push({ t, tier: s.tier, scale: aq.scaleFactor, renderScale: s.renderScale });
  while (t < end) { const ms = msFn(aq, t); t += ms; aq.feed(ms, t); }
  return log;
}

test('step order: renderScale first, then one tier lower at 0.85; and back up', () => {
  const aq = new AutoQuality({ initialTier: 3 });
  const seen = [];
  for (let i = 0; i < 6; i++) { seen.push([aq.tier, aq.scaleFactor]); aq._step(1, i * 20000); }
  assert.deepEqual(seen, [[3, 1], [3, 0.85], [3, 0.7], [3, 0.55], [3, 0.4], [2, 0.85]]);
  for (let i = 0; i < 3; i++) aq._step(-1, 200000 + i * 20000);
  assert.equal(aq.tier, 3); assert.equal(aq.scaleFactor, 0.85, 'tier up lands at x0.85');
  aq._step(-1, 400000); assert.equal(aq.scaleFactor, 1); assert.equal(aq._canStep(-1), false, 'capped at maxTier');
  const lo = new AutoQuality({ initialTier: 0 });
  assert.equal(lo.current.tierName, 'potato'); assert.equal(lo.scaleFactor, 1);
});

test('initial guess: software renderers are potato', () => {
  assert.equal(guessInitialTier({ glRenderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)' }), 0);
  assert.equal(guessInitialTier({ glRenderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' }), 0);
  assert.ok(guessInitialTier({ mobile: true, cores: 8, memory: 4, glRenderer: 'Adreno (TM) 530' }) <= 1);
  assert.ok(guessInitialTier({ cores: 16, memory: 8, glRenderer: 'NVIDIA GeForce RTX 3070' }) >= 3);
  assert.ok(guessInitialTier({ cores: 2, memory: 2, glRenderer: 'Intel(R) HD Graphics 4000' }) <= 1);
});

test('steady 60 fps: never changes', () => {
  const aq = new AutoQuality({ initialTier: 2 }); aq.resume(0);
  const log = simulate(aq, 120, () => 16.6);
  assert.equal(log.length, 0);
});

test('slow device (30 fps): steps down, respects warmup + hysteresis, stops at the floor', () => {
  const aq = new AutoQuality({ initialTier: 3 }); aq.resume(0);
  const log = simulate(aq, 400, () => 40);
  assert.ok(log.length >= 5, 'must step down repeatedly');
  assert.ok(log[0].t >= 4000 + 2 * 2000 - 100, 'first change only after warmup + 2 bad windows, got ' + log[0].t);
  for (let i = 1; i < log.length; i++) assert.ok(log[i].t - log[i - 1].t >= 8000 - 1, 'min 8 s between changes');
  assert.equal(aq._canStep(1), false, 'reaches the worst state');
  assert.equal(aq.tier, 0); assert.equal(aq.scaleFactor, 0.4);
  assert.ok(aq.renderScale >= 0.3);
});

test('cost model converges without oscillating', () => {
  // frame cost ~ tier cost * renderScale^2 : medium@1 = 30 ms, each tier ~ 0.6x cheaper
  const cost = (aq) => 30 * Math.pow(0.6, 2 - aq.tier) * aq.renderScale * aq.renderScale / (aq.tier >= 2 ? 1 : 1);
  const aq = new AutoQuality({ initialTier: 2 }); aq.resume(0);
  const log = simulate(aq, 600, (a) => Math.max(4, cost(a)));
  assert.ok(log.length >= 1 && log.length <= 8, 'bounded number of changes, got ' + log.length);
  const last = log[log.length - 1].t;
  assert.ok(last < 300000, 'settled early');
  assert.ok(cost(aq) < 16.667 * 1.3, 'settled state is playable: ' + cost(aq).toFixed(1) + ' ms');
});

test('recovers upward after sustained fast frames (>=10 s)', () => {
  const aq = new AutoQuality({ initialTier: 3 }); aq.resume(0);
  let log = simulate(aq, 60, () => 40);
  const down = aq.rank; assert.ok(down < 3 * 5);
  log = simulate(aq, 120, () => 6, 60000);
  assert.ok(log.length >= 1 && aq.rank > down, 'stepped up');
  assert.ok(log[0].t - 60000 >= 10000 - 1, 'not before 10 s of good frames');
  for (let i = 1; i < log.length; i++) assert.ok(log[i].t - log[i - 1].t >= 8000 - 1);
});

test('up/down flapping triggers backoff', () => {
  const aq = new AutoQuality({ initialTier: 3 }); aq.resume(0);
  // fast at scale 1.0 on high, too slow when it actually steps up past the (hidden) limit: emulate a device that is fine on idx>=2 only
  const log = simulate(aq, 600, (a) => (a.rank <= 15 - 2 ? 6 : 40));
  assert.ok(aq.upBackoff >= 20000, 'backoff engaged');
  assert.ok(log.filter((c) => c.t > 300000).length <= 6, 'retries become rare: ' + log.filter((c) => c.t > 300000).length);
  const gaps = log.slice(1).map((c, i) => c.t - log[i].t);
  assert.ok(Math.max(...gaps) > 60000, 'later up-trials are spaced out');
});

test('paused / hidden / hitch frames are ignored', () => {
  const aq = new AutoQuality({ initialTier: 3 });          // starts paused (loading)
  let log = simulate(aq, 60, () => 100);
  assert.equal(log.length, 0, 'paused while loading');
  aq.resume(60000);
  log = simulate(aq, 3, () => 100, 60000);
  assert.equal(log.length, 0, 'warmup ignored');
  aq.pause();
  log = simulate(aq, 60, () => 100, 70000);
  assert.equal(log.length, 0);
  aq.resume(140000);
  log = simulate(aq, 40, (a, t) => (t % 1000 < 20 ? 900 : 16.6), 140000);  // only rare tab-switch hitches
  assert.equal(log.length, 0, 'isolated >250 ms hitches ignored');
});

test('very slow device (4 fps) still gets evaluated and degraded', () => {
  const aq = new AutoQuality({ initialTier: 3 }); aq.resume(0);
  const log = simulate(aq, 120, () => 250);
  assert.ok(log.length >= 1, 'must react even with < 12 samples per window');
});

test('fixed preset locks quality (no automatic changes) and applies once', () => {
  const calls = [];
  const aq = new AutoQuality({ initialTier: 2, apply: (s) => calls.push(s) }); aq.resume(0);
  aq.setMode('ultra');
  assert.equal(calls.length, 1); assert.equal(calls[0].tierName, 'ultra'); assert.equal(calls[0].renderScale, 1);
  const log = simulate(aq, 200, () => 80);
  assert.equal(log.length, 0);
  assert.equal(aq.current.mode, 'fixed');
  aq.setMode('auto');
  assert.equal(aq.current.mode, 'auto'); assert.equal(aq.current.tierName, 'high', 'auto caps at high');
});

console.log(`\n${passed} tests passed`);
