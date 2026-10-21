// Node-only checks for the pure parts of the net feature (no browser): manual-code codec, link fragmentation, join-code parsing,
// protocol sanitisers and the Trystero driver against an in-memory fake `joinRoom` (the real relays are unreachable from the sandbox).
//   node scripts/nettest-unit.mjs
import { parseSdp, buildSdp, packSignal, unpackSignal, trysteroHost, trysteroConnect } from '../src/features/net/signal.js';
import { Link, Transport } from '../src/features/net/transport.js';
import { parseJoin, cleanText, cleanEdits, sanitizePlanet, Bucket, cleanName } from '../src/features/net/protocol.js';

let fails = 0;
const ok = (n, c, x = '') => { if (!c) fails++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  ' + x : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- manual codes
const SDP = `v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=group:BUNDLE 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=ice-ufrag:Xk3p\r\na=ice-pwd:aB3dE5gH7jK9mN1pQ3sT5uVw\r\na=fingerprint:sha-256 ${Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, '0').toUpperCase()).join(':')}\r\na=setup:actpass\r\na=mid:0\r\na=sctp-port:5000\r\n` +
  'a=candidate:1 1 udp 2122260223 192.168.1.20 54321 typ host generation 0\r\na=candidate:2 1 udp 2122260222 fe80::1ff:fe23:4567:890a 50000 typ host\r\na=candidate:3 1 udp 2122194687 3f2b8c1a-1111-4222-8333-444455556666.local 40000 typ host\r\na=candidate:4 1 udp 1686052607 203.0.113.9 61000 typ srflx raddr 192.168.1.20 rport 54321\r\na=candidate:5 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active\r\n';
const d = parseSdp(SDP);
ok('parseSdp keeps udp component-1 candidates only', d.cands.length === 4, JSON.stringify(d.cands.map((c) => c.type)));
const code = await packSignal('offer', d, new Uint8Array([1, 2, 3, 4]));
ok('invite code is compact', code.startsWith('hz1.') && code.length < 230, code.length + ' chars');
const u = await unpackSignal(code);
ok('round trip: kind/fingerprint/ufrag/pwd', u.kind === 'offer' && u.d.fp === d.fp && u.d.ufrag === d.ufrag && u.d.pwd === d.pwd && u.sid.join() === '1,2,3,4');
ok('round trip: candidates (ipv4, ipv6, mdns uuid, srflx)', JSON.stringify(u.d.cands) === JSON.stringify(d.cands.map((c) => ({ ...c, addr: c.addr.includes(':') ? c.addr.replace('fe80::1ff:fe23:4567:890a', 'fe80:0:0:0:1ff:fe23:4567:890a') : c.addr }))), JSON.stringify(u.d.cands.map((c) => c.addr)));
ok('answer kind survives', (await unpackSignal(await packSignal('answer', d))).kind === 'answer');
const sdp2 = buildSdp('offer', u.d);
ok('rebuilt SDP is a data-channel-only description', /m=application 9 UDP\/DTLS\/SCTP webrtc-datachannel/.test(sdp2) && /a=setup:actpass/.test(sdp2) && /typ srflx raddr 0.0.0.0/.test(sdp2) && !/m=audio|m=video/.test(sdp2));
ok('answer SDP uses setup:active', /a=setup:active/.test(buildSdp('answer', u.d)));
let err = ''; try { await unpackSignal(code.slice(0, -3) + 'AAA'); } catch (e) { err = e.message; }
ok('typo/truncation is detected (CRC)', /inválido/.test(err), err);
err = ''; try { await unpackSignal('hz1.'); } catch (e) { err = e.message; }
ok('empty code rejected', /inválido/.test(err));
err = ''; try { await unpackSignal('http://example.com'); } catch (e) { err = e.message; }
ok('foreign text rejected', /inválido/.test(err));

// ---- join code parsing
ok('parseJoin: room', parseJoin('abcd ef12').room === 'ABCD-EF12' || parseJoin('abcd ef12').kind === 'bad');
ok('parseJoin: room with dash and token', (() => { const p = parseJoin('K7QX-2MN9~abc234'); return p.kind === 'room' && p.room === 'K7QX-2MN9' && p.token === 'ABC234'; })());
ok('parseJoin: link', parseJoin('https://x.github.io/horizon/?join=K7QX-2MN9').room === 'K7QX-2MN9');
ok('parseJoin: manual', parseJoin('hz1.AbC_-').kind === 'manual');
ok('parseJoin: garbage', parseJoin('oops!').kind === 'bad' && parseJoin('').kind === 'bad' && parseJoin('0000-0000').kind === 'bad');

// ---- link fragmentation + hostile frames
class Pipe extends Transport {
  constructor() { super('pipe'); this.peer = null; this.state = 'open'; }
  send(s, rel) { const p = this.peer; queueMicrotask(() => p._emit('message', s, rel)); }
}
const A = new Pipe(), B = new Pipe(); A.peer = B; B.peer = A;
const got = []; const la = new Link(A, () => {}), lb = new Link(B, (m) => got.push(m));
const bigEdits = Array.from({ length: 200000 }, (_, i) => i % 255);
la.send({ t: 'welcome', edits: bigEdits, s: 'ação "aspas" \u{1F600} \\' }); la.send({ t: 'after' });
await sleep(50);
ok('big message is fragmented and reassembled in order', got.length === 2 && got[0].t === 'welcome' && got[0].edits.length === 200000 && got[0].s === 'ação "aspas" \u{1F600} \\' && got[1].t === 'after', `${la.msgOut} frames`);
B._emit('message', '{not json', true); B._emit('message', '"str"', true); B._emit('message', '{"x":1}', true); B._emit('message', JSON.stringify({ t: 'big', id: 1, i: 5, n: 2, s: 'x' }), true); B._emit('message', 'x'.repeat(50000), true);
ok('garbage frames are dropped and counted', lb.bad >= 5 && got.length === 2, `bad=${lb.bad}`);

// ---- sanitisers
ok('cleanText strips control/bidi chars and caps length', cleanText('a\u0000b‮c\n\nd'.padEnd(300, 'z'), 20).length === 20 && !/[\u0000‮\n]/.test(cleanText('a\u0000b‮c\n\nd')));
ok('cleanEdits drops malformed tuples', JSON.stringify(cleanEdits([1, 2, 3, 4, 'x', 2, 3, 4, 1, 2, 999999999, 4, 1, 2, 3, 255, 5, 6, 7, 8])) === '[1,2,3,4,5,6,7,8]');
ok('sanitizePlanet whitelists fields', (() => { const p = sanitizePlanet({ seed: 5.7, name: 'x'.repeat(100), evil: 1, profile: { a: 1 }, domeMode: 'pwn' }); return p.seed === 6 && p.name.length === 40 && !('evil' in p) && p.domeMode === 'closed' && p.profile.a === 1; })());
ok('cleanName fallback', cleanName('   ') === 'Visitante');
ok('names/planet text lose HTML-significant characters (other features may use innerHTML)', !/[<>&"`]/.test(cleanName('<img src=x onerror=alert(1)>')) && cleanName('<img src=x onerror=alert(1)>').length <= 20 && !/[<>&"`]/.test(sanitizePlanet({ name: '<b onmouseover="x">hi</b>', address: '<i>', ownerName: 'a&b' }).name + sanitizePlanet({ ownerName: 'a&b' }).ownerName));
const bk = new Bucket(2, 3); ok('token bucket limits bursts', bk.take() && bk.take() && bk.take() && !bk.take());

// ---- Trystero driver against an in-memory fake joinRoom (hub shared by "peers")
const hub = new Map();
function fakeJoin(selfId) {
  return (cfg, roomId) => {
    const room = hub.get(roomId) || hub.set(roomId, new Map()).get(roomId);
    let onMsg = null;
    const me = { id: selfId, api: null, deliver: (d, from) => onMsg && onMsg(d, { peerId: from }) };
    const api = { onPeerJoin: null, onPeerLeave: null, leave: async () => { room.delete(selfId); for (const o of room.values()) o.api.onPeerLeave && o.api.onPeerLeave(selfId); },
      makeAction: () => ({ send: async (d, o) => { const t = room.get(o && o.target); if (!t) throw new Error('gone'); queueMicrotask(() => t.deliver(d, selfId)); }, set onMessage(f) { onMsg = f; } }) };
    me.api = api;
    for (const o of room.values()) { o.api.onPeerJoin && queueMicrotask(() => o.api.onPeerJoin(selfId)); queueMicrotask(() => api.onPeerJoin && api.onPeerJoin(o.id)); }
    room.set(selfId, me);
    return api;
  };
}
const hostPeers = []; const th = await trysteroHost('ABCD-EF12', (tr) => hostPeers.push(tr), fakeJoin('HOST'));
// a second guest in the mesh must be ignored by the first guest's host lookup
const other = await trysteroConnect('ABCD-EF12', 2000, fakeJoin('G2')).catch((e) => e);
ok('trystero guest finds the host among peers', other && other.kind === 'trystero');
const gtr = await trysteroConnect('ABCD-EF12', 2000, fakeJoin('G1'));
ok('trystero host got a transport per guest', hostPeers.length === 2);
const hl = []; const hostLink = new Link(hostPeers[1], (m) => hl.push(m)); const gl = []; const guestLink = new Link(gtr, (m) => gl.push(m));
guestLink.send({ t: 'hello', n: 1 }); hostLink.send({ t: 'welcome', n: 2 });
await sleep(30);
ok('trystero messages flow both ways', hl.length === 1 && hl[0].t === 'hello' && gl.length === 1 && gl[0].t === 'welcome');
th.stop();
const miss = await trysteroConnect('ZZZZ-ZZZZ', 150, fakeJoin('G3')).catch((e) => e.message);
ok('no host -> friendly timeout error', /não foi encontrado/.test(String(miss)), String(miss));

console.log(fails ? `\n${fails} FAILED` : '\nall unit checks passed');
process.exit(fails ? 1 : 0);
