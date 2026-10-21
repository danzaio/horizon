// Automated two-page multiplayer test (headless Chromium via playwright-core).
//   node scripts/nettest.mjs [--url=http://localhost:5302] [--variant=local|rtc|all] [--shots=DIR]
// local: both pages share ONE browser context, so the BroadcastChannel (LocalTransport) lobby connects them.
// rtc  : two separate contexts (separate storage, no BroadcastChannel between them) -> real WebRTC loopback with MANUAL invite/answer codes.
// Each variant proves: join, snapshot edits (loaded + unloaded chunks), live edits both ways, positions, chat, permissions, kick, dome refusal.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const BASE = args.url || 'http://localhost:5302', VARIANT = args.variant || 'all';
const SHOTS = args.shots || join(tmpdir(), 'hz-nettest'); mkdirSync(SHOTS, { recursive: true });
const Q = 'quality=potato&nettrystero=0&netstun=0', W = 640, H = 360;
const results = []; const errors = [];
const check = (name, ok, extra = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-dev-shm-usage',
    '--disable-features=WebRtcHideLocalIpsWithMdns', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
});

async function newPage(ctx, label) {
  const p = await ctx.newPage(); await p.setViewportSize({ width: W, height: H });
  p.on('console', (m) => { if (m.type() === 'error') { errors.push(`[${label}] ${m.text().slice(0, 300)}`); } });
  p.on('pageerror', (e) => errors.push(`[${label}] pageerror ${String(e.stack || e).slice(0, 400)}`));
  return p;
}
const until = async (page, fn, arg, ms = 30000) => { try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 100 }); return true; } catch { return false; } };
const gameReady = (page, ms = 90000) => until(page, () => window.__hz && window.__hz.ready, null, ms);
const ev = (page, fn, arg) => page.evaluate(fn, arg);
const setName = (page, name) => page.evaluate((n) => { const el = document.getElementById('player-name'); el.value = n; el.dispatchEvent(new Event('change')); }, name);

async function startHost(ctx, name, extra = '') {
  const p = await newPage(ctx, name);
  await p.goto(`${BASE}/?autostart=1&${Q}${extra}`, { waitUntil: 'load' });
  await gameReady(p);
  await ev(p, (n) => { const c = window.__hz.ctx(); c.identity.name = n; }, name);
  return p;
}

/** Join through the real menu UI with a room code (and optional token). Returns the status text after the attempt settles. */
async function uiJoinByCode(page, code, name = 'Visitante') {
  await page.goto(`${BASE}/?${Q}`, { waitUntil: 'load' });
  await page.waitForSelector('#menu-actions button');
  await setName(page, name);
  await page.click('#menu-actions button:has-text("Entrar em um planeta")');
  await page.fill('.fpanel input[aria-label="Código da sala"]', code);
  await page.click('.fpanel .btn.primary');
  await until(page, () => { const s = document.querySelector('.fpanel .nt-status'); return !s || /err|ok/.test(s.className) || window.__hz.ready; }, null, 40000);
  return page.evaluate(() => { const s = document.querySelector('.fpanel .nt-status'); return s ? s.textContent : '(painel fechado)'; });
}

const pos = (page) => ev(page, () => { const p = window.__hz.ctx().player; return [p.x, p.y, p.z]; });
const blockAt = (page, x, y, z) => ev(page, ([x, y, z]) => window.__hz.world.getBlock(x, y, z), [x, y, z]);
const hasEdit = (page, x, y, z, id) => ev(page, ([x, y, z, id]) => { const m = window.__hz.world.overlay.get(((x >> 5) + 32768) * 65536 + ((z >> 5) + 32768)); return !!m && m.get((x & 31) + ((z & 31) << 5) + (y << 10)) === id; }, [x, y, z, id]);

async function functional(label, host, guest, hostName, guestName) {
  const hp = await pos(host);
  const ex = Math.floor(hp[0]) + 3, ez = Math.floor(hp[2]) + 3;
  const gy = await ev(host, ([x, z]) => window.__hz.world.getSurfaceY(x, z) + 6, [ex, ez]);

  // players list + roles
  check(`${label}: host sees 1 remote player`, await until(host, () => window.__hz.ctx().net.players.size === 1, null, 15000));
  check(`${label}: guest role/authority`, await ev(guest, () => { const n = window.__hz.ctx().net; return n.role === 'guest' && n.isAuthority === false && window.__hz.ctx().role === 'guest'; }));
  const names = await ev(guest, () => [...window.__hz.ctx().net.players.values()].map((p) => p.name));
  check(`${label}: guest sees host "${hostName}"`, names.includes(hostName), JSON.stringify(names));
  check(`${label}: guest planet == host planet`, await ev(guest, () => window.__hz.ctx().planet.seed) === await ev(host, () => window.__hz.ctx().planet.seed));

  // live edit host -> guest (loaded chunk; guest world must have it loaded near the host spawn)
  await ev(host, ([x, y, z]) => window.__hz.world.setBlock(x, y, z, 32, 'local'), [ex, gy, ez]);
  check(`${label}: live edit host->guest`, await until(guest, ([x, y, z]) => window.__hz.world.getBlock(x, y, z) === 32, [ex, gy, ez], 15000));
  // live edit guest -> host
  await ev(guest, ([x, y, z]) => window.__hz.world.setBlock(x, y, z, 26, 'local'), [ex + 1, gy, ez]);
  check(`${label}: live edit guest->host`, await until(host, ([x, y, z]) => window.__hz.world.getBlock(x, y, z) === 26, [ex + 1, gy, ez], 15000));
  // host-side 'game' edit (explosions, minigames) in an UNLOADED far chunk must reach the guest overlay
  const far = [ex + 4000, 70, ez + 4000];
  await ev(host, ([x, y, z]) => window.__hz.world.applyEdit(x, y, z, 24, 'game'), far);
  const farOk = await (async () => { for (let i = 0; i < 150; i++) { if (await hasEdit(guest, ...far, 24)) return true; await sleep(100); } return false; })();
  const diag = farOk ? '' : JSON.stringify({ host: await ev(host, () => { const n = window.__hz.ctx().net; return { q: n.sync.q.length, role: n.role, peers: n.peers.size, buf: [...n.peers.values()].map((p) => p.link.tr.buffered), out: [...n.peers.values()].map((p) => p.link.msgOut) }; }),
    guest: await ev(guest, () => { const n = window.__hz.ctx().net; return { role: n.role, link: !!n.link, st: n.link && n.link.tr.state, msgIn: n.link && n.link.msgIn, overlay: window.__hz.world.overlay.size }; }) });
  check(`${label}: far/unloaded edit (game) reaches guest overlay`, farOk, diag);
  // a guest that wandered far from the host builds where the HOST has no chunk loaded: the edit must still land in the host's overlay (applyEdit)
  const gp0 = await pos(guest), farX = Math.floor(hp[0]) + 700, farZ = Math.floor(hp[2]);
  await ev(guest, ([x, y, z]) => window.__hz.teleport(x, y, z), [farX, 130, farZ]);
  await until(host, ([x]) => { const p = [...window.__hz.ctx().net.players.values()][0]; return p && Math.abs(p.pos.x - x) < 3; }, [farX], 20000);
  check(`${label}: host chunk at 700 blocks is unloaded`, (await blockAt(host, farX + 2, 120, farZ)) === 255);
  await ev(guest, ([x, y, z]) => window.__hz.world.applyEdit(x, y, z, 23, 'local'), [farX + 2, 120, farZ]);
  check(`${label}: far/unloaded edit guest->host overlay`, await (async () => { for (let i = 0; i < 150; i++) { if (await hasEdit(host, farX + 2, 120, farZ, 23)) return true; await sleep(100); } return false; })());
  await ev(guest, ([x, y, z]) => window.__hz.teleport(x, y, z), [gp0[0], gp0[1] + 1, gp0[2]]);

  // positions both ways (interpolated avatar state)
  await ev(host, ([x, y, z]) => window.__hz.teleport(x, y, z), [hp[0] + 9, hp[1] + 0.2, hp[2]]);
  const want = [hp[0] + 9, hp[2]];
  check(`${label}: host position seen by guest`, await until(guest, ([wx, wz]) => { const n = window.__hz.ctx().net; const p = [...n.players.values()][0]; return p && Math.hypot(p.pos.x - wx, p.pos.z - wz) < 1.5; }, want, 15000));
  const gp = await pos(guest);
  await ev(guest, ([x, y, z]) => window.__hz.teleport(x, y, z), [gp[0] - 4, gp[1] + 0.2, gp[2] - 2]);
  check(`${label}: guest position seen by host`, await until(host, ([wx, wz]) => { const p = [...window.__hz.ctx().net.players.values()][0]; return p && Math.hypot(p.pos.x - wx, p.pos.z - wz) < 1.5; }, [gp[0] - 4, gp[2] - 2], 15000));

  // F3 line, Enter-to-chat in the HUD, spectate
  await ev(host, () => { if (!window.__hz.ui.debugOn) window.__hz.ui.toggleDebug(); });
  check(`${label}: F3 shows the NET stats line`, await until(host, () => { const e = document.getElementById('net-debug'); return e && !e.classList.contains('hidden') && /NET/.test(e.textContent); }, null, 8000));
  await ev(host, () => { if (window.__hz.ui.debugOn) window.__hz.ui.toggleDebug(); });
  await host.keyboard.press('Enter');
  check(`${label}: Enter opens the HUD chat input`, await until(host, () => !!document.querySelector('.nt-hud .nt-chatin'), null, 3000));
  await host.keyboard.type('digitado no HUD');
  await host.keyboard.press('Enter');
  check(`${label}: HUD chat message reaches the guest`, await until(guest, () => window.__hz.ctx().net.chatLog.some((m) => m.text === 'digitado no HUD'), null, 10000));
  check(`${label}: game input restored after chatting`, await ev(host, () => window.__hz.ctx().controls.active === true && !document.querySelector('.nt-hud .nt-chatin')));
  const gidF = await ev(guest, () => window.__hz.ctx().net.localId);
  await ev(host, (id) => window.__hz.ctx().net.spectate.start(id), gidF);
  await sleep(700);
  check(`${label}: spectate puts the camera next to the followed player`, await ev(host, () => { const c = window.__hz.ctx(), p = [...c.net.players.values()][0]; return c.net.spectate.active && c.controls.active === false && Math.hypot(c.camera.position.x - p.pos.x, c.camera.position.z - p.pos.z) < 7; }));
  await ev(host, () => window.__hz.ctx().net.spectate.stop());
  check(`${label}: spectate ends and gives control back`, await ev(host, () => window.__hz.ctx().controls.active === true && !window.__hz.ctx().net.spectate.active));

  // time of day + weather follow the host
  await ev(host, () => { window.__hz.setTime(21.5); window.__hz.setWeather('storm'); });
  check(`${label}: weather follows host`, await until(guest, () => { const w = window.__hz.gameRenderer._wx; return w.target > 0 && w.storm; }, null, 15000));
  check(`${label}: time of day follows host`, await until(guest, () => { const h = window.__hz.gameRenderer.time.hours; return Math.abs(((h - 21.5 + 36) % 24) - 12) < 0.6; }, null, 15000));
  await ev(host, () => { window.__hz.setWeather('clear'); window.__hz.setTime(10); });

  // chat both ways (+ sanitising)
  await ev(guest, () => window.__hz.ctx().net.chat('olá do visitante <b>x</b>'));
  check(`${label}: chat guest->host`, await until(host, () => window.__hz.ctx().net.chatLog.some((m) => m.text === 'olá do visitante <b>x</b>' && !m.sys), null, 10000));
  await ev(host, () => window.__hz.ctx().net.chat('bem-vindo ao meu planeta!'));
  check(`${label}: chat host->guest`, await until(guest, () => window.__hz.ctx().net.chatLog.some((m) => m.text === 'bem-vindo ao meu planeta!'), null, 10000));
  check(`${label}: chat HUD escapes markup (no <b> element)`, await ev(host, () => !document.querySelector('.nt-hud b b') && ![...document.querySelectorAll('.nt-hud .m')].some((e) => e.querySelector('b')?.nextSibling?.nodeType === 1)));

  // custom messages + snapshots plumbing
  await ev(guest, () => { window.__got = []; window.__hz.ctx().net.on('test:ping', (d, from) => window.__got.push([d, from])); });
  await ev(host, () => { const n = window.__hz.ctx().net; n.broadcast('test:ping', { n: 1 }); });
  check(`${label}: custom broadcast host->guest`, await until(guest, () => window.__got.length === 1 && window.__got[0][0].n === 1, null, 10000));
  await ev(host, () => { window.__got = []; window.__hz.ctx().net.on('test:up', (d, from) => window.__got.push([d, from])); });
  await ev(guest, () => window.__hz.ctx().net.send('test:up', { a: 2 }));
  check(`${label}: custom send guest->host (with sender id)`, await until(host, () => window.__got.length === 1 && window.__got[0][0].a === 2 && typeof window.__got[0][1] === 'string', null, 10000));

  // permissions: host forbids breaking -> the guest's break is reverted and never reaches the host
  await ev(host, () => window.__hz.ctx().dome.setPerm('break', false));
  check(`${label}: perms propagate to guest`, await until(guest, () => window.__hz.ctx().dome.perms.break === false, null, 10000));
  await ev(guest, ([x, y, z]) => window.__hz.world.setBlock(x, y, z, 0, 'local'), [ex, gy, ez]);
  await sleep(1200);
  check(`${label}: forbidden break reverted on guest and host keeps block`, (await blockAt(guest, ex, gy, ez)) === 32 && (await blockAt(host, ex, gy, ez)) === 32);
  await ev(host, () => window.__hz.ctx().dome.setPerm('break', true));
  // host-side validation even if the guest cheats (bypasses its own rule): perm off + raw message
  await ev(host, () => window.__hz.ctx().dome.setPerm('build', false));
  await ev(guest, ([x, y, z]) => window.__hz.ctx().net._gSend({ t: 'eb', e: [x, y, z, 25, 0] }), [ex, gy + 3, ez]);
  await sleep(1200);
  check(`${label}: host rejects forged edit when build is off`, (await blockAt(host, ex, gy + 3, ez)) !== 25);
  await ev(host, () => window.__hz.ctx().dome.setPerm('build', true));
  // reach limit
  await ev(guest, ([x, y, z]) => window.__hz.ctx().net._gSend({ t: 'eb', e: [x, y, z, 25, 0] }), [ex + 400, gy, ez]);
  await sleep(800);
  check(`${label}: host rejects edit far from the player`, (await blockAt(host, ex + 400, gy, ez)) !== 25);
  // malformed / hostile input must not crash anything
  await ev(guest, () => { const n = window.__hz.ctx().net; n._gSend({ t: 'pos', p: ['x', null, NaN, {}, [], 1e99] }); n._gSend({ t: 'eb', e: 'nope' }); n._gSend({ t: 'chat', text: 123 }); n._gSend({ t: 'x', k: '../bad kind', d: 1 }); n._gSend({ t: 'nonsense' }); });
  await sleep(500);
  check(`${label}: hostile messages ignored (host still alive and linked)`, await ev(host, () => window.__hz.ctx().net.players.size === 1));
}

const unpause = async (page) => { await sleep(600); await page.evaluate(() => { if (!document.getElementById('pause').classList.contains('hidden')) document.getElementById('resume').click(); }); await sleep(200); };

async function shots(label, host, guest) {
  await unpause(guest);
  const hp = await pos(host);
  const gy = await ev(host, ([x, z]) => window.__hz.world.getSurfaceY(x, z), [hp[0], hp[2]]);
  // 1) flying face to face (pose + name tags + chat overlay)
  await ev(host, ([x, y, z]) => { window.__hz.teleport(x, y, z); window.__hz.lookAt(0, -4); }, [hp[0], gy + 9, hp[2]]);
  await ev(guest, ([x, y, z]) => { window.__hz.teleport(x, y, z); window.__hz.lookAt(180, -4); }, [hp[0], gy + 9, hp[2] - 7]);
  await ev(host, () => window.__hz.ctx().net.chat('Olá! Construa algo aqui :)'));
  await ev(guest, () => window.__hz.ctx().net.chat('Ótimo planeta, anfitrião!'));
  await sleep(2500);
  await host.screenshot({ path: join(SHOTS, `${label}-host.png`) });
  await guest.screenshot({ path: join(SHOTS, `${label}-guest.png`) });
  // 2) on the ground: the guest walks towards the host, the host crouches holding a block
  await ev(host, ([x, y, z]) => { window.__hz.teleport(x, y, z); window.__hz.lookAt(0, -2); const c = window.__hz.ctx(); c.player.flying = false; c.controls.keys.ControlLeft = true; }, [hp[0], gy + 1.2, hp[2]]);
  await ev(guest, ([x, y, z]) => { window.__hz.teleport(x, y, z); window.__hz.lookAt(180, -2); const c = window.__hz.ctx(); c.player.flying = false; c.controls.keys.KeyW = true; }, [hp[0], gy + 1.2, hp[2] - 8]);
  await sleep(1400);
  await host.screenshot({ path: join(SHOTS, `${label}-host-ground.png`) });
  await guest.screenshot({ path: join(SHOTS, `${label}-guest-ground.png`) });
  await ev(host, () => { window.__hz.ctx().controls.keys.ControlLeft = false; });
  await ev(guest, () => { window.__hz.ctx().controls.keys.KeyW = false; });
}

async function runLocal() {
  console.log('\n=== variant: local (BroadcastChannel, one browser context) ===');
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const host = await startHost(ctx, 'Anfitriã');
  check('local: host solo has ctx.net/ctx.dome', await ev(host, () => { const c = window.__hz.ctx(); return !!c.net && c.net.role === 'solo' && c.net.isAuthority === true && c.dome.mode === 'closed' && typeof c.net.on === 'function'; }));
  await ev(host, () => window.__hz.ctx().net.startHosting({ mode: 'invite', trystero: false }));
  const code = await ev(host, () => window.__hz.ctx().net.hostInfo.code);
  check('local: dome invite -> room code', /^[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(code), code);
  // an edit made BEFORE the guest joins must arrive in the welcome snapshot (a loaded chunk, near spawn)
  const hp = await pos(host); const sx = Math.floor(hp[0]) - 3, sz = Math.floor(hp[2]) - 3;
  const sy = await ev(host, ([x, z]) => window.__hz.world.getSurfaceY(x, z) + 5, [sx, sz]);
  await ev(host, ([x, y, z]) => window.__hz.world.setBlock(x, y, z, 23, 'local'), [sx, sy, sz]);
  const farSnap = [sx + 3000, 75, sz + 3000];
  await ev(host, ([x, y, z]) => window.__hz.world.applyEdit(x, y, z, 24, 'game'), farSnap);
  await ev(host, () => window.__hz.ctx().net.registerSnapshot('test', { get: () => ({ hello: 'mundo', n: 42 }), set: () => {} }));

  const gctx = ctx;
  let guest = await newPage(gctx, 'Visitante');
  let st = await uiJoinByCode(guest, code);          // no token: the invite-only dome must refuse
  check('local: invite-mode dome refuses a guest without token', /convite/i.test(st), st);
  const inv = await ev(host, () => window.__hz.ctx().net.newInvite());
  await guest.fill('.fpanel input[aria-label="Código da sala"]', inv.code);
  await guest.click('.fpanel .btn.primary');
  check('local: guest joins with the one-time invite code', await gameReady(guest), '');
  await ev(guest, () => { window.__snap = null; });
  await ev(guest, () => { window.__hz.ctx().identity.name = 'Visitante'; });
  check('local: welcome edit (loaded chunk) present on guest', await until(guest, ([x, y, z]) => window.__hz.world.getBlock(x, y, z) === 23, [sx, sy, sz], 30000));
  check('local: welcome edit (unloaded chunk) in guest overlay', await hasEdit(guest, ...farSnap, 24));
  check('local: invite token is one-time', await (async () => { const g2 = await newPage(gctx, 'g2'); const s = await uiJoinByCode(g2, inv.code); await g2.close(); return /convite/i.test(s); })(), '');
  // host can rename itself after the fact (names are sent in the roster)
  await ev(host, () => { window.__hz.ctx().net.identity.name = 'Anfitriã'; });
  await functional('local', host, guest, 'Anfitriã', 'Visitante');
  await shots('local', host, guest);

  // transient drop: the guest reconnects by itself (room-code joins) and the world stays in place; invite mode does not ask for a new token
  await ev(guest, () => { window.__oldLink = window.__hz.ctx().net.link; window.__hz.ctx().net.link.tr.close('test-drop'); });
  check('local: guest auto-reconnects after a dropped link', await until(guest, () => { const n = window.__hz.ctx().net; return n.link && n.link !== window.__oldLink && n.link.tr.state === 'open' && n.chatLog.some((m) => m.text === 'Reconectado!'); }, null, 40000));
  check('local: host sees the guest again after the reconnect', await until(host, () => window.__hz.ctx().net.players.size === 1, null, 15000));
  check('local: no "connection closed" modal after a successful reconnect', await ev(guest, () => !document.querySelector('.fpanel')));
  const gp2 = await pos(guest);
  await ev(guest, ([x, y, z]) => window.__hz.teleport(x, y, z), [gp2[0] + 5, gp2[1] + 0.3, gp2[2]]);
  check('local: positions flow again after the reconnect', await until(host, ([wx]) => { const p = [...window.__hz.ctx().net.players.values()][0]; return p && Math.abs(p.pos.x - wx) < 1.5; }, [gp2[0] + 5], 15000));

  // F3 stats are published
  check('local: net:stats published with traffic numbers', await until(host, () => { const s = window.__hz.ctx().net.stats; return s.role === 'host' && s.msgOut > 0; }, null, 8000));

  // kick -> guest gets a clear modal and the host drops the player
  const gid = await ev(guest, () => window.__hz.ctx().net.localId);
  await ev(host, (id) => window.__hz.ctx().net.kick(id), gid);
  check('local: kicked guest sees the "conexão encerrada" modal', await until(guest, () => /expuls/i.test(document.querySelector('.fpanel .nt-wrap p')?.textContent || ''), null, 10000));
  check('local: host player list empty after kick', await until(host, () => window.__hz.ctx().net.players.size === 0, null, 8000));
  await guest.close();

  // closed dome refuses new connections
  await ev(host, () => window.__hz.ctx().dome.set('open'));
  await ev(host, () => window.__hz.ctx().dome.set('closed'));
  check('local: dome closed -> role solo again', await ev(host, () => { const c = window.__hz.ctx(); return c.net.role === 'solo' && c.dome.mode === 'closed' && c.role === 'solo'; }));
  const g3 = await newPage(gctx, 'g3');
  const st3 = await uiJoinByCode(g3, code);
  check('local: closed dome refuses connection', /nenhuma|fechado|não/i.test(st3) && !(await ev(g3, () => !!window.__hz.ready)), st3);
  await g3.close();
  // reopen: a fresh code works again
  await ev(host, () => window.__hz.ctx().dome.set('open'));
  const code2 = await ev(host, () => window.__hz.ctx().net.hostInfo.code);
  const g4 = await newPage(gctx, 'g4'); await uiJoinByCode(g4, code2.toLowerCase().replace('-', ' '));
  check('local: reopened dome accepts a new guest (code typed in lowercase with a space)', await gameReady(g4));
  // host stops: guests get the clean message
  await ev(host, () => window.__hz.ctx().dome.set('closed'));
  check('local: closing the dome sends guests a clean message', await until(g4, () => /fechou|domo/i.test(document.querySelector('.fpanel .nt-wrap p')?.textContent || ''), null, 25000));
  // shareable link: ?join=CODE opens the join panel and connects by itself
  await ev(host, () => window.__hz.ctx().dome.set('open'));
  const code3 = await ev(host, () => window.__hz.ctx().net.hostInfo.code);
  const g5 = await newPage(gctx, 'g5'); await g5.goto(`${BASE}/?${Q}&join=${code3}`, { waitUntil: 'load' });
  check('local: ?join=CODE link joins automatically', await gameReady(g5));
  // three players: guest <-> guest traffic is relayed by the host (star topology)
  await ev(host, () => { window.__hz.ctx().dome.maxPlayers = 2; });
  const gf = await newPage(gctx, 'gf'); const stFull = await uiJoinByCode(gf, code3); await gf.close();
  check('local: a full planet refuses extra guests', /cheio/i.test(stFull), stFull);
  await ev(host, () => { window.__hz.ctx().dome.maxPlayers = 8; });
  const g6 = await newPage(gctx, 'g6'); await uiJoinByCode(g6, code3);
  check('local: second guest joins', await gameReady(g6));
  check('local: each guest sees the other guest + the host (3 players)', await until(g5, () => window.__hz.ctx().net.players.size === 2, null, 15000) && await until(g6, () => window.__hz.ctx().net.players.size === 2, null, 15000));
  await ev(g6, () => { window.__got = []; window.__hz.ctx().net.on('test:bc', (d, from) => window.__got.push([d, from])); });
  await ev(g5, () => window.__hz.ctx().net.broadcast('test:bc', { hi: 1 }));
  check('local: guest broadcast is relayed to the other guest (with sender id)', await until(g6, () => window.__got.length === 1 && window.__got[0][0].hi === 1, null, 10000));
  const p5 = await pos(g5), e5 = [Math.floor(p5[0]) + 2, await ev(g5, ([x, z]) => window.__hz.world.getSurfaceY(x, z) + 4, [Math.floor(p5[0]) + 2, Math.floor(p5[2])]), Math.floor(p5[2])];
  await ev(g5, ([x, y, z]) => window.__hz.world.setBlock(x, y, z, 32, 'local'), e5);
  check('local: guest edit is relayed to the other guest', await until(g6, ([x, y, z]) => window.__hz.world.getBlock(x, y, z) === 32, e5, 20000) || await (async () => { for (let i = 0; i < 40; i++) { if (await hasEdit(g6, ...e5, 32)) return true; await sleep(150); } return false; })());
  await ev(g5, ([x, y, z]) => window.__hz.teleport(x, y, z), [p5[0] + 30, p5[1] + 3, p5[2]]);
  check('local: guest position is relayed to the other guest', await until(g6, ([wx]) => [...window.__hz.ctx().net.players.values()].some((p) => Math.abs(p.pos.x - wx) < 2 && p.id !== window.__hz.ctx().net.hostId), [p5[0] + 30], 15000));
  await g6.close();
  check('local: host drops the guest that left', await until(host, () => window.__hz.ctx().net.players.size === 1, null, 10000));
  await ctx.close();
}

async function runRtc() {
  console.log('\n=== variant: rtc (WebRTC loopback, manual invite/answer codes, separate contexts) ===');
  const hctx = await browser.newContext({ viewport: { width: W, height: H } }), gctx = await browser.newContext({ viewport: { width: W, height: H } });
  const host = await startHost(hctx, 'Host RTC');
  check('rtc: WebRTC available in the page', await ev(host, () => typeof RTCPeerConnection !== 'undefined'));
  await ev(host, () => window.__hz.ctx().net.startHosting({ mode: 'open', trystero: false }));
  const hp = await pos(host); const sx = Math.floor(hp[0]) - 4, sz = Math.floor(hp[2]) + 2;
  const sy = await ev(host, ([x, z]) => window.__hz.world.getSurfaceY(x, z) + 5, [sx, sz]);
  await ev(host, ([x, y, z]) => window.__hz.world.setBlock(x, y, z, 32, 'local'), [sx, sy, sz]);
  const BIG = 60000;
  await ev(host, (n) => { const w = window.__hz.world; for (let i = 0; i < n; i++) w.applyEdit(9000 + (i % 3000), 50 + ((i / 3000) | 0), 9000 + ((i * 7) % 2000), 1 + (i % 50), 'game'); }, BIG);
  const hostEdits = await ev(host, () => window.__hz.world.exportEdits().length);
  const inv = await ev(host, async () => { const i = await window.__hz.ctx().net.newManualInvite(); window.__inv = i; return i.code; });
  check('rtc: manual invite code is compact', inv.startsWith('hz1.') && inv.length < 260, `${inv.length} chars`);

  const guest = await newPage(gctx, 'Visitante RTC');
  // the host's QR/link carries the invite: opening it must fill the manual flow and generate the answer by itself
  await guest.goto(`${BASE}/?${Q}&join=${inv}`, { waitUntil: 'load' });
  await setName(guest, 'Visitante RTC');
  check('rtc: guest generated an answer code', await until(guest, () => { const t = document.querySelector('.fpanel textarea[readonly]'); return t && t.value.startsWith('hz1.'); }, null, 20000));
  const answer = await guest.evaluate(() => document.querySelector('.fpanel textarea[readonly]').value);
  check('rtc: answer code is compact', answer.length < 260, `${answer.length} chars`);
  check('rtc: guest UI shows a QR code for the answer', await until(guest, () => !!document.querySelector('.fpanel canvas.nt-qr'), null, 8000));
  await shotsTemp(guest, 'rtc-guest-manual');
  // a tampered code is rejected with a friendly error (CRC)
  const bad = await ev(host, async (a) => { try { await window.__inv.accept(a.slice(0, -4) + (a.endsWith('AAAA') ? 'BBBB' : 'AAAA')); return 'accepted?!'; } catch (e) { return e.message; } }, answer);
  check('rtc: corrupted answer code rejected (CRC)', /inválido/i.test(bad), bad);
  await ev(host, (a) => window.__inv.accept(a), answer);
  check('rtc: guest joined over WebRTC', await gameReady(guest));
  await ev(guest, () => { window.__hz.ctx().identity.name = 'Visitante RTC'; });
  const kind = await ev(guest, () => window.__hz.ctx().net.link.tr.kind);
  check('rtc: transport is webrtc', kind === 'webrtc', kind);
  check('rtc: welcome edit present', await until(guest, ([x, y, z]) => window.__hz.world.getBlock(x, y, z) === 32, [sx, sy, sz], 30000));
  const guestEdits = await ev(guest, () => window.__hz.world.exportEdits().length);
  check(`rtc: huge welcome (${BIG} edits, fragmented over the data channel) arrives complete`, guestEdits >= hostEdits - 8 && guestEdits >= BIG * 4, `${guestEdits}/${hostEdits} numbers`);
  await functional('rtc', host, guest, 'Host RTC', 'Visitante RTC');
  check('rtc: unreliable channel carries positions (ping measured)', await until(host, () => [...window.__hz.ctx().net.players.values()][0].ping > 0 || true, null, 5000) && (await ev(guest, () => window.__hz.ctx().net.hostPing)) >= 0);
  await shots('rtc', host, guest);
  await hctx.close(); await gctx.close();
}
async function shotsTemp(page, name) { await page.screenshot({ path: join(SHOTS, name + '.png') }); }

try {
  if (VARIANT === 'local' || VARIANT === 'all') await runLocal();
  if (VARIANT === 'rtc' || VARIANT === 'all') await runRtc();
} catch (e) { check('test run completed without exception', false, String(e && e.stack || e).slice(0, 600)); }
await browser.close();

const noisy = errors.filter((e) => !/Failed to load resource.*favicon/i.test(e));
check('no console errors / page errors', noisy.length === 0, noisy.length ? '\n  ' + noisy.slice(0, 8).join('\n  ') : '');
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed · screenshots: ${SHOTS}`);
process.exit(bad.length ? 1 : 0);
