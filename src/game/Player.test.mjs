// Run: node src/game/Player.test.mjs  — physics sanity checks on a synthetic voxel world (no browser).
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Player } from './Player.js';
import { B } from '../shared/blocks.js';

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok -', name); };
// floor: solid for y <= 63; a 3-high wall at x = 20 (all z); a 1-high step at x = -10; column x > 100 unloaded.
const world = {
  getBlock(x, y, z) {
    if (x > 100) return B.UNLOADED;
    if (y < 0) return B.BEDROCK; if (y > 191) return B.AIR;
    if (y <= 63) return B.STONE;
    if (x === 20 && y <= 66) return B.STONE;
    if (x <= -10 && x >= -12 && y === 64) return B.STONE;
    return B.AIR;
  },
};
const make = () => { const cam = new THREE.PerspectiveCamera(75, 1.7, 0.3, 1000); const p = new Player(world, cam); p.teleport(0.5, 70, 0.5); return p; };
const run = (p, seconds, dt = 1 / 60) => { for (let t = 0; t < seconds; t += dt) p.update(dt); };

test('falls and rests on the floor', () => {
  const p = make(); run(p, 3);
  assert.ok(p.onGround); assert.ok(Math.abs(p.y - 64) < 1e-6, 'y=' + p.y);
});
test('jump reaches ~1.3 blocks and lands back', () => {
  const p = make(); run(p, 1); p.input.jump = true; let max = p.y; for (let i = 0; i < 90; i++) { p.update(1 / 60); max = Math.max(max, p.y); if (i > 3) p.input.jump = false; }
  assert.ok(max - 64 > 1.1 && max - 64 < 1.6, 'jump height ' + (max - 64)); assert.ok(p.onGround);
});
test('walking into a 3-high wall stops at its face (no tunnelling, any dt)', () => {
  for (const dt of [1 / 144, 1 / 60, 1 / 20, 0.1]) {
    const p = make(); p.setLook(-Math.PI / 2, 0); // face +X
    run(p, 1, 1 / 60); p.autoWalk = true; p.input.sprint = true; run(p, 8, dt);
    assert.ok(p.x < 20 - 0.3 + 1e-6 && p.x > 18.5, 'dt ' + dt + ' x=' + p.x);
  }
});
test('flying at 600 blocks/s cannot pass through the wall', () => {
  for (const dt of [1 / 60, 1 / 10]) {
    const p = make(); p.flying = true; p.flySpeed = 230; p.input.sprint = true; p.setLook(-Math.PI / 2, 0); p.teleport(0.5, 65, 0.5); p.autoWalk = true;
    run(p, 3, dt); assert.ok(p.x <= 20 - 0.3 + 1e-6, 'x=' + p.x);
    assert.ok(!p._collides(), 'not embedded');
  }
});
test('sprint auto-steps up a 1-block ledge but a normal walk does not', () => {
  const a = make(); a.setLook(Math.PI / 2, 0); a.teleport(-5.5, 64, 0.5); run(a, 0.2); a.autoWalk = true; a.input.sprint = true; run(a, 3);
  assert.ok(a.x < -12, 'sprinted past the ledge x=' + a.x);
  const b = make(); b.setLook(Math.PI / 2, 0); b.teleport(-5.5, 64, 0.5); run(b, 0.2); b.autoWalk = true; run(b, 3);
  assert.ok(b.x > -10.3, 'walking is blocked x=' + b.x);
});
test('frozen (no gravity) while the column is unloaded', () => {
  const p = make(); p.teleport(150.5, 80, 0.5); run(p, 2); assert.ok(p.frozen); assert.equal(p.y, 80);
});
test('crouching does not walk off ledges', () => {
  const w2 = { getBlock: (x, y, z) => (y < 0 ? B.BEDROCK : y <= 63 && x < 5 ? B.STONE : B.AIR) };
  const p = new Player(w2, new THREE.PerspectiveCamera()); p.teleport(2.5, 64, 0.5); p.setLook(-Math.PI / 2, 0); run(p, 0.5);
  p.autoWalk = true; p.input.crouch = true; run(p, 4);
  assert.ok(p.onGround && p.y === 64 && p.x < 5.3, `x=${p.x} y=${p.y}`);
});
console.log(`\n${passed} tests passed`);
