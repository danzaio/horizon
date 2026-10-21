// Node tests for the minigame toolkit: schema hardening, share-code round-trip, templates, and the rule engine driven by a fake host.
// Run: node src/features/minigame/minigame.test.mjs
import assert from 'node:assert/strict';
import { validateGameDef, emptyGameDef, LIMITS, lintGameDef, entityBox } from './schema.js';
import { exportCode, importCode, importAny, crc32 } from './codec.js';
import { makeTemplates } from './templates.js';
import { GameRuntime } from './runtime.js';

let n = 0; const t = async (name, fn) => { try { await fn(); n++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n', e); process.exitCode = 1; } };

/** Fake host: players are plain records; blocks are a Map; fx calls are recorded. */
function fakeHost(ids) {
  const players = ids.map((id) => ({ id, name: id.toUpperCase(), x: 0, y: 0, z: 0, alive: true })), blocks = new Map(), log = [];
  const h = { localId: ids[0], players, blocks, log, listPlayers: () => players, getBlock: (x, y, z) => blocks.get(x + ',' + y + ',' + z) || 0, setBlock: (x, y, z, id) => { if (id) blocks.set(x + ',' + y + ',' + z, id); else blocks.delete(x + ',' + y + ',' + z); },
    fx: (to, type, data) => { log.push({ to, type, data }); const list = to ? players.filter((p) => to.includes(p.id)) : players; if (type === 'tp') for (const p of list) { p.x = data.x; p.y = data.y; p.z = data.z; } } };
  h.fx = h.fx.bind(h); return h;
}
const run = (rt, secs) => { for (let i = 0; i < secs * 15 + 1; i++) rt.update(1 / 15); };
const tpl = Object.fromEntries(makeTemplates().map((x) => [x.id, x]));
const centre = (rt, id) => { const b = rt.box.get(id); return { x: (b[0] + b[3]) / 2, y: b[1] + 0.05, z: (b[2] + b[5]) / 2 }; };
const place = (host, i, pt) => Object.assign(host.players[i], pt);

console.log('schema');
await t('empty def validates', () => { const { def } = validateGameDef(emptyGameDef()); assert.equal(def.v, 1); assert.equal(def.entities.length, 0); });
await t('rejects garbage', () => { assert.throws(() => validateGameDef(null)); assert.throws(() => validateGameDef({ v: 99 })); assert.throws(() => validateGameDef([])); });
await t('clamps and strips hostile input', () => {
  const raw = emptyGameDef(); raw.meta.name = '<img src=x onerror=alert(1)>'.repeat(10); raw.meta.maxPlayers = 99999; raw.meta.timeLimit = -5; raw.anchor = { x: 'NaN', y: 9999, z: 1e99 };
  raw.entities = [{ id: 'a', type: 'goal', x: 1e9, y: -1e9, z: 1.7, w: 1e6, h: 0, d: 'x', p: { evil: 1 }, __proto__: { polluted: 1 } }, { type: 'nope' }, null, 5];
  raw.rules = [{ when: { ev: 'tick', every: 0.0001 }, if: [{ c: 'eval', code: 'alert(1)' }], then: [{ a: 'message', who: 'alert', text: 'x'.repeat(5000) + '<b>' }, { a: 'hack' }] }];
  const { def } = validateGameDef(raw);
  assert.ok(!def.meta.name.includes('<')); assert.ok(def.meta.name.length <= LIMITS.name); assert.equal(def.meta.maxPlayers, LIMITS.players); assert.equal(def.meta.timeLimit, 0);
  assert.equal(def.anchor.y, 180); assert.ok(Math.abs(def.anchor.z) <= 30000000); assert.equal(def.entities.length, 1);
  const e = def.entities[0]; assert.ok(Math.abs(e.x) <= LIMITS.coord); assert.ok(e.w <= LIMITS.size && e.h >= 1 && e.d >= 1); assert.equal(e.p.evil, undefined); assert.equal(({}).polluted, undefined);
  assert.equal(def.rules[0].when.every, 0.5); assert.equal(def.rules[0].if.length, 0); assert.equal(def.rules[0].then.length, 1); assert.equal(def.rules[0].then[0].who, 'actor'); assert.ok(def.rules[0].then[0].text.length <= LIMITS.text);
});
await t('caps counts', () => {
  const raw = emptyGameDef(); raw.entities = Array.from({ length: 1000 }, (_, i) => ({ id: 'x' + i, type: 'trigger', x: i, y: 0, z: 0 })); raw.rules = Array.from({ length: 1000 }, () => ({ when: { ev: 'gameStart' }, then: [{ a: 'message', text: 'hi' }] }));
  const { def, warnings } = validateGameDef(raw); assert.equal(def.entities.length, LIMITS.entities); assert.equal(def.rules.length, LIMITS.rules); assert.ok(warnings.length);
});
await t('dangling entity references are cleared', () => {
  const raw = emptyGameDef(); raw.entities = [{ id: 'a', type: 'button', x: 0, y: 0, z: 0 }];
  raw.rules = [{ when: { ev: 'buttonPressed', entity: 'a' }, then: [{ a: 'openDoor', entity: 'ghost' }, { a: 'message', text: 'ok' }] }];
  const { def } = validateGameDef(raw); assert.equal(def.rules[0].when.entity, 'a'); assert.equal(def.rules[0].then[0].entity, '');
});

console.log('codec');
await t('crc32 known vector', () => assert.equal(crc32(new TextEncoder().encode('123456789')), 'cbf43926'));
await t('code round-trip for every template', async () => {
  for (const x of Object.values(tpl)) { const code = await exportCode(x.def); assert.ok(code.startsWith('HZG1.')); const { def } = await importCode(code); assert.deepEqual(def, x.def, x.id); }
});
await t('codes are compact', async () => { const c = await exportCode(tpl.parkour.def); assert.ok(c.length < 4000, 'parkour code ' + c.length); });
await t('link / json / whitespace tolerant', async () => {
  const c = await exportCode(tpl.spleef.def); assert.equal((await importAny('https://x.github.io/horizon/?game=' + c)).def.meta.name, 'Spleef'); assert.equal((await importAny('olha: https://x.io/h/?game=' + c + '&utm=1 valeu')).def.meta.name, 'Spleef'); assert.equal((await importAny('meu jogo: ' + c + ' valeu pessoal')).def.meta.name, 'Spleef'); assert.equal((await importAny(c.slice(0, 20) + '\n ' + c.slice(20))).def.meta.name, 'Spleef');
  assert.equal((await importAny(JSON.stringify(tpl.tntrun.def))).def.meta.name, 'TNT Run');
});
await t('tampered / truncated / bomb codes fail cleanly', async () => {
  const c = await exportCode(tpl.parkour.def); const i = c.indexOf('.') + 10;
  await assert.rejects(importCode(c.slice(0, i) + (c[i] === 'A' ? 'B' : 'A') + c.slice(i + 1))); await assert.rejects(importCode(c.slice(0, -20))); await assert.rejects(importCode('hello')); await assert.rejects(importCode(''));
  const bomb = await exportCode({ v: 1, meta: { name: 'x'.repeat(5_000_000) } }); await assert.rejects(importCode(bomb));
});

console.log('templates');
await t('all 12 templates validate with no warnings and lint clean', () => {
  assert.equal(Object.keys(tpl).length, 12);
  for (const x of Object.values(tpl)) { assert.ok(x.def.entities.length > 1, x.id); assert.ok(x.def.arena.length > 0 || x.def.entities.some((e) => e.type === 'area'), x.id); assert.deepEqual(lintGameDef(x.def), [], x.id); }
});

console.log('runtime');
const mk = (id, ids = ['a'], anchor = { x: 100, y: 50, z: 100 }, opts = {}) => { const def = structuredClone(tpl[id].def); def.anchor = anchor; const host = fakeHost(ids), rt = new GameRuntime(def, host, opts); return { def, host, rt }; };

await t('parkour: countdown, checkpoint, kill-zone respawn at checkpoint, goal ends the game', async () => {
  const { def, host, rt } = mk('parkour'); rt.open(); rt.start(); assert.equal(rt.phase, 'countdown');
  run(rt, 1); assert.equal(rt.phase, 'countdown'); // arena is being rebuilt first (block queue), then 3-2-1
  run(rt, 12); assert.equal(rt.phase, 'running'); assert.ok(host.blocks.size > 100, 'arena built');
  assert.ok(host.log.some((f) => f.type === 'title' && f.data.text === 'VAI!'));
  const cps = def.entities.filter((e) => e.type === 'checkpoint'); place(host, 0, centre(rt, cps[0].id)); run(rt, 0.5);
  assert.equal(rt.players.get('a').cpOrder, 1);
  const kz = def.entities.find((e) => e.type === 'killzone'); place(host, 0, centre(rt, kz.id)); run(rt, 0.3);
  assert.ok(rt.players.get('a').dead, 'died'); run(rt, 2);
  const p = host.players[0]; const c0 = centre(rt, cps[0].id); assert.ok(Math.abs(p.x - c0.x) < 0.01 && Math.abs(p.z - c0.z) < 0.01, 'respawned at checkpoint');
  assert.equal(rt.players.get('a').deaths, 1);
  const goal = def.entities.find((e) => e.type === 'goal'); place(host, 0, centre(rt, goal.id)); run(rt, 0.5);
  assert.equal(rt.phase, 'ended'); assert.equal(rt.results.winner.id, 'a'); assert.ok(rt.results.rows[0].time > 0);
  assert.equal(rt.view().res.rows.length, 1);
});
await t('spleef: only the floor area is breakable, no placing, last alive wins', async () => {
  const { def, host, rt } = mk('spleef', ['a', 'b', 'c']); rt.open(); rt.start(); run(rt, 20); assert.equal(rt.phase, 'running');
  const floor = def.entities.find((e) => e.type === 'area'); const b = entityBox(def, floor);
  assert.equal(rt.allows('break', { x: b[0] + 1, y: b[1], z: b[2] + 1 }), true); assert.equal(rt.allows('break', { x: b[0] + 1, y: b[1] + 30, z: b[2] + 1 }), false);
  assert.equal(rt.allows('place', { x: b[0], y: b[1] + 1, z: b[2] }), false); assert.equal(rt.allows('pvp', {}), false);
  assert.equal(host.getBlock(b[0] + 3, b[1], b[2] + 3), 6, 'snow floor rebuilt');
  const kz = def.entities.find((e) => e.type === 'killzone');
  place(host, 1, centre(rt, kz.id)); run(rt, 0.3); assert.equal(rt.players.get('b').spectator, true); assert.equal(rt.phase, 'running');
  place(host, 2, centre(rt, kz.id)); run(rt, 0.5); assert.equal(rt.phase, 'ended'); assert.equal(rt.results.winner.id, 'a');
  assert.equal(rt.allows('place', {}), true, 'permissions free after the game');
});
await t('tnt run: block under a standing player vanishes after 0.6 s', async () => {
  const { def, host, rt } = mk('tntrun', ['a']); rt.open(); rt.start(); run(rt, 20); assert.equal(rt.phase, 'running');
  const floor = def.entities.find((e) => e.type === 'area'), b = entityBox(def, floor); const x = b[0] + 5.5, z = b[2] + 5.5, y = b[4];
  assert.equal(host.getBlock(b[0] + 5, b[1], b[2] + 5), 4); place(host, 0, { x, y, z }); run(rt, 0.3); assert.equal(host.getBlock(b[0] + 5, b[1], b[2] + 5), 4, 'still there at 0.3s');
  run(rt, 0.5); assert.equal(host.getBlock(b[0] + 5, b[1], b[2] + 5), 0, 'gone after 0.6s');
});
await t('ctf: pick up enemy flag, capture, team score, win at 3', async () => {
  const { def, host, rt } = mk('ctf', ['a', 'b']); rt.open(); rt.start(); run(rt, 25); assert.equal(rt.phase, 'running');
  const A = rt.players.get('a'), B = rt.players.get('b'); assert.notEqual(A.team, B.team);
  const flags = def.entities.filter((e) => e.type === 'flag'), own = flags.find((f) => f.p.team === A.team), enemy = flags.find((f) => f.p.team !== A.team);
  place(host, 1, { x: 0, y: 0, z: 0 }); // b far away
  for (let i = 0; i < 3; i++) { place(host, 0, centre(rt, enemy.id)); run(rt, 0.3); assert.equal(A.carrying, enemy.id); place(host, 0, centre(rt, own.id)); run(rt, 0.3); assert.equal(A.carrying, ''); }
  assert.equal(rt.teamScore[A.team], 3); assert.equal(rt.phase, 'ended'); assert.equal(rt.results.winner.kind, 'team'); assert.equal(rt.results.winner.id, A.team);
});
await t('rules: event -> conditions -> actions, once, timers, vars, action budget', async () => {
  const raw = emptyGameDef(); raw.meta.countdown = 0; raw.win = { type: 'none', target: 1 };
  raw.entities = [{ id: 'sp', type: 'spawn', x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 }, { id: 'tr', type: 'trigger', x: 10, y: 0, z: 0, w: 2, h: 2, d: 2 }];
  raw.rules = [
    { id: 'r1', when: { ev: 'playerEnter', entity: 'tr' }, if: [{ c: 'variable', name: 'hits', op: '<', value: 2 }], then: [{ a: 'addScore', who: 'actor', amount: 5, to: 'player' }, { a: 'setVar', name: 'hits', mode: 'add', value: 1 }, { a: 'startTimer', id: 't1', seconds: 1, repeat: false }] },
    { id: 'r2', when: { ev: 'timer', id: 't1' }, if: [], then: [{ a: 'message', who: 'all', text: 'tempo!' }] },
    { id: 'r3', when: { ev: 'scoreReached', value: 10 }, if: [], then: [{ a: 'endGame', winner: 'actor', team: '' }], once: true },
    { id: 'r4', when: { ev: 'gameStart' }, if: [], then: Array.from({ length: 16 }, () => ({ a: 'message', who: 'all', text: 'spam' })) },
  ];
  const { def } = validateGameDef(raw); def.anchor = { x: 0, y: 10, z: 0 }; const host = fakeHost(['a']), rt = new GameRuntime(def, host); rt.open(); rt.start(); run(rt, 0.5);
  assert.equal(rt.phase, 'running'); assert.ok(host.log.filter((f) => f.data.text === 'spam').length <= 16);
  const inside = { x: 11, y: 10, z: 1 }, out = { x: 0, y: 10, z: 0 };
  place(host, 0, inside); run(rt, 0.2); assert.equal(rt.players.get('a').score, 5); assert.equal(rt.vars.hits, 1);
  run(rt, 1.2); assert.ok(host.log.some((f) => f.data.text === 'tempo!'), 'timer fired');
  place(host, 0, out); run(rt, 0.2); place(host, 0, inside); run(rt, 0.3); assert.equal(rt.phase, 'ended', 'score 10 ended the game'); assert.equal(rt.results.winner.id, 'a'); assert.equal(rt.vars.hits, 2);
});
await t('tag: infection spreads and the infected team wins', async () => {
  const { host, rt } = mk('tag', ['a', 'b']); rt.open(); rt.start(); run(rt, 20); assert.equal(rt.phase, 'running');
  const teams = [rt.players.get('a').team, rt.players.get('b').team].sort(); assert.deepEqual(teams, ['inf', 'run']);
  place(host, 0, { x: 5, y: 60, z: 5 }); place(host, 1, { x: 5.5, y: 60, z: 5.5 }); run(rt, 7);
  assert.equal(rt.phase, 'ended'); assert.equal(rt.results.winner.id, 'inf');
});
await t('time limit ends a goal game with no winner', async () => {
  const { def, host, rt } = mk('parkour', ['a']); def.meta.timeLimit = 5; rt.open(); rt.start(); run(rt, 20); assert.equal(rt.phase, 'ended'); assert.equal(rt.results.winner, null);
});
await t('mid-game join and leave', async () => {
  const { host, rt } = mk('last', ['a']); rt.open(); rt.start(); run(rt, 25); host.players.push({ id: 'z', name: 'Z', x: 0, y: 0, z: 0, alive: true }); run(rt, 0.3);
  assert.ok(rt.players.has('z')); host.players.pop(); run(rt, 0.3); assert.ok(!rt.players.has('z'));
});
await t('idle runtime does zero work', () => { const { host, rt } = mk('parkour'); let calls = 0; const lp = host.listPlayers; host.listPlayers = () => { calls++; return lp(); }; rt.update(1); rt.update(1); assert.equal(calls, 0); });
await t('block ops are capped per tick', () => {
  const { def, host, rt } = mk('corrida', ['a'], undefined, { blocksPerTick: 500 }); const before = host.blocks.size; rt.open(); rt.start(); rt.update(1 / 15); assert.ok(host.blocks.size - before <= 500 + 5, 'placed ' + (host.blocks.size - before));
});

await t('blockBroken + itemUsed + hasItem conditions', async () => {
  const raw = emptyGameDef(); raw.meta.countdown = 0; raw.win = { type: 'none', target: 1 };
  raw.entities = [{ id: 'sp', type: 'spawn', x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 }, { id: 'fl', type: 'area', x: 5, y: 0, z: 5, w: 4, h: 1, d: 4, p: { kind: 'floor', material: 'snow', breakable: true } }];
  raw.rules = [{ id: 'b', when: { ev: 'blockBroken', entity: 'fl' }, then: [{ a: 'addScore', who: 'actor', amount: 1, to: 'player' }] },
    { id: 'u', when: { ev: 'itemUsed', item: 'bow' }, if: [{ c: 'hasItem', item: 'arrow' }], then: [{ a: 'addScore', who: 'actor', amount: 10, to: 'player' }] }];
  const { def } = validateGameDef(raw); def.anchor = { x: 0, y: 10, z: 0 }; const host = fakeHost(['a']); host.players[0].has = (i) => i === 'arrow';
  const rt = new GameRuntime(def, host); rt.open(); rt.start(); run(rt, 0.5); assert.equal(rt.phase, 'running');
  rt.blockBroken(6, 10, 6, 'a'); rt.blockBroken(60, 10, 60, 'a'); assert.equal(rt.players.get('a').score, 1, 'only the area counts');
  rt.itemUsed('a', 'bow'); assert.equal(rt.players.get('a').score, 11); rt.itemUsed('a', 'sword'); assert.equal(rt.players.get('a').score, 11);
  host.players[0].has = () => false; rt.itemUsed('a', 'bow'); assert.equal(rt.players.get('a').score, 11, 'no arrow, no points');
});
await t('hostile rule flood stays bounded (blocks per tick, per round, actions per tick)', async () => {
  const raw = emptyGameDef(); raw.meta.countdown = 0; raw.win = { type: 'none', target: 1 };
  raw.entities = [{ id: 'sp', type: 'spawn', x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 }, { id: 'big', type: 'trigger', x: 0, y: 0, z: 0, w: 96, h: 12, d: 96 }];
  raw.rules = Array.from({ length: 200 }, (_, i) => ({ id: 'f' + i, when: { ev: 'tick', every: 0.5 }, then: Array.from({ length: 16 }, () => ({ a: 'fillArea', entity: 'big', material: 'stone' })) }));
  const { def } = validateGameDef(raw); const host = fakeHost(['a']); let maxPerTick = 0, last = 0; const sb = host.setBlock; host.setBlock = (...a) => { sb(...a); last++; };
  const rt = new GameRuntime(def, host, { blocksPerTick: 800 }); rt.open(); rt.start(); let placed = 0;
  for (let i = 0; i < 15 * 30; i++) { last = 0; rt.update(1 / 15); maxPerTick = Math.max(maxPerTick, last); placed += last; }
  assert.ok(maxPerTick <= 800, 'per tick ' + maxPerTick); assert.ok(rt.roundBlocks <= 600000, 'round ' + rt.roundBlocks); assert.ok(rt.blockQN <= 500000);
});
await t('worst-case def (300 entities, 200 rules, 16 players) ticks fast', async () => {
  const raw = emptyGameDef(); raw.meta.countdown = 0; raw.meta.mode = 'ffa'; raw.win = { type: 'none', target: 1 };
  raw.entities = Array.from({ length: 300 }, (_, i) => ({ id: 't' + i, type: i % 3 ? 'trigger' : 'zone', x: (i % 20) * 6, y: 0, z: Math.floor(i / 20) * 6, w: 5, h: 4, d: 5, p: {} }));
  raw.rules = Array.from({ length: 200 }, (_, i) => ({ id: 'r' + i, when: i % 2 ? { ev: 'playerEnter', entity: 't' + (i % 300) } : { ev: 'tick', every: 0.5 }, if: [{ c: 'score', op: '>=', value: 0 }], then: [{ a: 'addScore', who: 'actor', amount: 1, to: 'player' }, { a: 'setVar', name: 'v', mode: 'add', value: 1 }, { a: 'message', who: 'all', text: 'x' }] }));
  const { def } = validateGameDef(raw); def.anchor = { x: 0, y: 10, z: 0 }; const host = fakeHost(Array.from({ length: 16 }, (_, i) => 'p' + i)); const rt = new GameRuntime(def, host); rt.open(); rt.start(); run(rt, 0.3);
  const t0 = performance.now(); let ticks = 0;
  for (let k = 0; k < 600; k++) { for (const [i, p] of host.players.entries()) { p.x = (k * 0.7 + i * 9) % 120; p.y = 10; p.z = (k * 0.4 + i * 5) % 120; } rt.update(1 / 15); ticks++; }
  const ms = (performance.now() - t0) / ticks; console.log('       avg tick', ms.toFixed(3), 'ms'); assert.ok(ms < 15, 'tick too slow: ' + ms);
});
await t('lives: respawn until the last life, then eliminated; spectators cannot rejoin', async () => {
  const { def, host, rt } = mk('parkour', ['a', 'b']); def.meta.lives = 2; rt.open(); rt.start(); run(rt, 20); assert.equal(rt.phase, 'running');
  const kz = centre(rt, def.entities.find((e) => e.type === 'killzone').id); place(host, 0, kz); run(rt, 0.4); assert.equal(rt.players.get('a').lives, 1); assert.equal(rt.players.get('a').spectator, false); run(rt, 2);
  place(host, 0, kz); run(rt, 0.4); assert.equal(rt.players.get('a').spectator, true); assert.equal(rt.phase, 'running', 'b still plays');
});

console.log(`\n${n} passed${process.exitCode ? ' (with failures)' : ''}`);
