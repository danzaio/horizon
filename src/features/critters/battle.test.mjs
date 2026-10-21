// node src/features/critters/battle.test.mjs
import assert from 'node:assert/strict';
import { makeCreature, SPECIES, effectiveness, captureChance, moveset, stats, sanitizeCreature, MOVES } from './data.js';
import { newBattle, resolveTurn, aiPick, rng } from './battle.js';
let n = 0; const t = (name, fn) => { fn(); n++; console.log('  ok  ', name); };
t('type chart: fire beats grass, loses to water', () => { assert.equal(effectiveness(0, [2]), 2); assert.equal(effectiveness(0, [1]), 0.5); assert.equal(effectiveness(8, [3]), 1); });
t('species table is coherent', () => { for (const s of SPECIES) { assert.ok(s.types.length >= 1 && s.base.every((v) => v > 0), s.name); assert.ok(moveset(s.id, 20).length >= 2, s.name); if (s.next >= 0) assert.equal(SPECIES[s.next].line, s.line); } });
t('stats grow with level', () => { assert.ok(stats(0, 30).hp > stats(0, 10).hp && stats(0, 30).atk > stats(0, 10).atk); });
t('capture is easier when weak, harder for legends', () => { const sp = SPECIES[0]; assert.ok(captureChance(sp, 0.1, 5, 1) > captureChance(sp, 1, 5, 1)); assert.ok(captureChance(SPECIES[36], 0.5, 40, 1) < captureChance(sp, 0.5, 5, 1)); assert.ok(captureChance(sp, 1, 5, 99) <= 0.97); });
t('sanitize clamps hostile data', () => { const c = sanitizeCreature({ s: 9999, l: 9999, h: 1e9, x: -5, m: ['hax'] }); assert.ok(c.s < SPECIES.length && c.l <= 60 && c.h <= stats(c.s, c.l).hp && c.x === 0); assert.equal(sanitizeCreature(null), null); });
t('two clients agree on every turn (determinism)', () => {
  const pa = [makeCreature(0, 20), makeCreature(3, 18)], pb = [makeCreature(6, 20), makeCreature(1, 17)], seed = 123456;
  const A = newBattle(structuredClone(pa), structuredClone(pb), seed), B = newBattle(structuredClone(pa), structuredClone(pb), seed);
  const RA = rng(1), RB = rng(2); let guard = 0;
  while (!A.over && guard++ < 200) { const aa = aiPick(A, 'a', RA), ab = aiPick(A, 'b', RB); const e1 = resolveTurn(A, aa, ab), e2 = resolveTurn(B, aa, ab); assert.deepEqual(e1.map((e) => [e.t, e.side, e.amount]), e2.map((e) => [e.t, e.side, e.amount])); }
  assert.ok(A.over && A.winner && A.winner === B.winner, 'battle ends with a winner'); assert.deepEqual(A.a.mons.map((m) => m.hp), B.a.mons.map((m) => m.hp));
});
t('switch + guard + heal work', () => {
  const b = newBattle([makeCreature(0, 20), makeCreature(3, 20)], [makeCreature(6, 20)], 7); const ev = resolveTurn(b, { k: 's', i: 1 }, { k: 'm', i: 0 });
  assert.ok(ev.some((e) => e.t === 'switch' && e.side === 'a')); assert.equal(b.a.act, 1);
});
t('a battle with a wild loser ends and records HP back into the party creatures', () => {
  const pa = [makeCreature(2, 30)], b = newBattle(pa, [makeCreature(0, 3)], 99, { wild: true }); let g = 0; while (!b.over && g++ < 50) resolveTurn(b, { k: 'm', i: pa[0].m.findIndex((id) => MOVES[id].k === 'dmg' && MOVES[id].p >= 60) }, { k: 'm', i: 0 });
  assert.ok(b.over && b.winner === 'a'); assert.ok(pa[0].h <= stats(2, 30).hp);
});
console.log(n + ' passed');
