// Browser-level replication check (host <-> guest) with a FAKE linked net, using the real Session/Runtime/HUD code in a real game page.
// Usage: (dev server running)  node src/features/minigame/dev/replication.mjs [http://127.0.0.1:5304]
// Asserts: guest receives the game, team assignment, state, flag pickup/capture shown in the guest HUD, guest permissions, snapshot for late joiners, end + stop.
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://127.0.0.1:5304';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = []; page.on('pageerror', (e) => errors.push(String(e))); page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
await page.goto(`${base}/?autostart=1&quality=potato&seed=1337&time=12&weather=clear`);
await page.waitForFunction(() => window.__hz && window.__hz.ready && window.__hz.ctx && window.__hz.ctx() && window.__hz.ctx().mg, null, { timeout: 120000 });
const out = await page.evaluate(async () => {
  const real = window.__hz.ctx(), THREE = real.THREE, { Session } = await import('/src/features/minigame/session.js'), { EventBus } = await import('/src/features/events.js'), { Permissions } = await import('/src/features/permissions.js');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), res = [], ok = (name, cond, info) => res.push([name, !!cond, info]);
  const mkNet = (id, role) => { const h = new Map(); return { role, isAuthority: role === 'host', localId: id, players: new Map(), peer: null, snaps: new Map(),
    on(t, f) { (h.get(t) || h.set(t, []).get(t)).push(f); return () => {}; }, _recv(t, d, from) { for (const f of h.get(t) || []) f(JSON.parse(JSON.stringify(d)), from); },
    send(t, d) { const m = JSON.parse(JSON.stringify(d)); queueMicrotask(() => this.peer._recv(t, m, this.localId)); }, broadcast(t, d) { const m = JSON.parse(JSON.stringify(d)); queueMicrotask(() => this.peer._recv(t, m, this.localId)); },
    registerSnapshot(k, o) { this.snaps.set(k, o); } }; };
  const hn = mkNet('H', 'host'), gn = mkNet('G', 'guest'); hn.peer = gn; gn.peer = hn;
  const gpos = new THREE.Vector3(); hn.players.set('G', { id: 'G', name: 'Convidado', pos: gpos, alive: true });
  const gp = { x: 0, y: 0, z: 0, yaw: 0, vx: 0, vy: 0, vz: 0, flying: false, onGround: true, teleport(x, y, z) { this.x = x; this.y = y; this.z = z; } };
  const base = { events: null, permissions: null, localState: null, health: null, inventory: null, items: null };
  const mk = (net, id, extra = {}) => Object.assign(Object.create(real), base, { net, events: new EventBus(), permissions: new Permissions(), localState: { team: null, hp: 20, extra: {} }, identity: { id, name: id, color: '#fff' } }, extra);
  const hctx = mk(hn, 'H'), gctx = mk(gn, 'G', { player: gp });
  const hs = new Session(hctx), gs = new Session(gctx);
  const def = structuredClone(real.mg._api.templates.find((x) => x.id === 'ctf').def); real.mg._api.placeHere(def, 18);
  hs.start(def, { lobby: true });
  const tick = async (n) => { for (let i = 0; i < n; i++) { hs.update(1 / 15); gs.update(1 / 15); await sleep(n < 40 ? 40 : 0); } };
  await tick(8); await sleep(300); await tick(2);
  ok('lobby on both sides, guest listed', hs.state === 'lobby' && gs.state === 'lobby' && hs.rt.players.has('G'), [hs.state, gs.state]);
  hs.begin(); await tick(300);
  ok('guest received the game', gs.guest && gs.def && gs.def.meta.name === def.meta.name); ok('both running', hs.state === 'running' && gs.state === 'running', [hs.state, gs.state]);
  ok('teams assigned to both', hctx.localState.team && gctx.localState.team && hctx.localState.team !== gctx.localState.team, [hctx.localState.team, gctx.localState.team]);
  ok('guest was teleported to its spawn', Math.hypot(gp.x - def.anchor.x, gp.z - def.anchor.z) < 80, [gp.x, gp.z]);
  ok('guest permissions: no placing / breaking, pvp on', !gctx.permissions.can('place', {}) && !gctx.permissions.can('break', { x: 0, y: 70, z: 0 }) && gctx.permissions.can('pvp', {}));
  const G = hs.rt.players.get('G'), enemy = def.entities.find((e) => e.type === 'flag' && e.p.team !== G.team), own = def.entities.find((e) => e.type === 'flag' && e.p.team === G.team);
  const at = (e) => { const b = hs.rt.box.get(e.id); gpos.set((b[0] + b[3]) / 2, b[1] + 0.1, (b[2] + b[5]) / 2); };
  at(enemy); await tick(10); ok('host sees guest pick up the flag', G.carrying === enemy.id); ok('guest view shows the carrier bit', (gs.rv.p.find((r) => r[0] === 'G')[4] & 8) === 8);
  at(own); await tick(10); ok('capture scores for the guest team', hs.rt.teamScore[G.team] === 1 && gs.rv.ts.find((t) => t[0] === G.team)[1] === 1, hs.rt.teamScore);
  const snap = hn.snaps.get('mg').get(); ok('late-join snapshot has code + view', snap && snap.code && snap.view);
  for (let i = 0; i < 2; i++) { at(enemy); await tick(10); at(own); await tick(10); }
  await sleep(300); ok('game ended on both sides', hs.state === 'ended' && gs.state === 'ended', [hs.state, gs.state]);
  hs.stop(); await tick(3); ok('stop propagates', gs.state === 'idle', gs.state);
  return res;
});
let bad = 0; for (const [n, c, i] of out) { console.log(c ? '  ok  ' : '  FAIL', n, c ? '' : JSON.stringify(i)); if (!c) bad++; }
if (errors.length) { console.log('console errors:', errors); bad++; }
await browser.close(); process.exit(bad ? 1 : 0);
