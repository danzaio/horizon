// Signalers: how two peers find each other and end up holding a Transport.
//  * Manual   - invite/answer codes (compressed SDP + ICE) copied by hand or QR; 100% serverless.
//  * Local    - BroadcastChannel lobby for tabs of the same browser (local multiplayer, automated tests).
//  * Trystero - public BitTorrent/Nostr relays are only the rendezvous; short room code. NOT TESTED on the dev machine (no egress).
import { LocalTransport, RtcTransport, Transport, makePeerConnection, ICE_SERVERS, TURN_SERVERS } from './transport.js';
import { randomString, ROOM_APP_ID } from './protocol.js';

// ---------------------------------------------------------------------------------------------------------------------
// Manual codes. Binary layout (then optional deflate-raw, CRC16, base64url, prefix "hz1."):
//   byte0 = kind(1=answer)<<3 | deflate<<2 ; offer only: sid[4] ; fingerprint[32] ; ufrag(len+ascii) ; pwd(len+ascii) ;
//   n ; n x { byte(type<<4|addrKind<<2) , addr (4 | 16 | uuid 16 | len+ascii) , port[2] }
// A typical invite is ~140 characters (a deflated raw SDP is 400+), small enough for a QR code and a chat message.
// ---------------------------------------------------------------------------------------------------------------------
const CODE_PREFIX = 'hz1.';
const TYPES = ['host', 'srflx', 'prflx', 'relay'];
const b64u = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
function crc16(u8) { let c = 0xffff; for (let i = 0; i < u8.length; i++) { c ^= u8[i] << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff; } return c; }
async function pipe(bytes, stream) { const w = stream.writable.getWriter(); w.write(bytes); w.close(); return new Uint8Array(await new Response(stream.readable).arrayBuffer()); }
const deflate = (u8) => pipe(u8, new CompressionStream('deflate-raw'));
const inflate = (u8) => pipe(u8, new DecompressionStream('deflate-raw'));
const hex2 = (h) => Uint8Array.from(h.split(':').map((x) => parseInt(x, 16)));
const toHex = (u8) => Array.from(u8, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 127);

/** @param {string} sdp  @returns {{fp:string, ufrag:string, pwd:string, cands:{type:number, addr:string, port:number}[]}} */
export function parseSdp(sdp) {
  const g = (re) => { const m = sdp.match(re); return m ? m[1].trim() : ''; };
  const out = { fp: g(/a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/), ufrag: g(/a=ice-ufrag:(\S+)/), pwd: g(/a=ice-pwd:(\S+)/), cands: [] };
  const seen = new Set();
  for (const m of sdp.matchAll(/a=candidate:\S+ (\d+) (\w+) \d+ (\S+) (\d+) typ (\w+)/g)) {
    if (m[1] !== '1' || m[2].toLowerCase() !== 'udp') continue;          // component 1, UDP only
    const type = TYPES.indexOf(m[5]); if (type < 0) continue;
    const key = m[3] + ':' + m[4]; if (seen.has(key)) continue; seen.add(key);
    out.cands.push({ type, addr: m[3], port: +m[4] });
  }
  if (!out.fp || !out.ufrag || !out.pwd) throw new Error('SDP sem fingerprint/ICE');
  return out;
}

/** Rebuilds a minimal data-channel-only SDP (the template below is all a WebRTC stack needs for an application m-section). */
export function buildSdp(kind, d) {
  const L = ['v=0', 'o=- 1 1 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    'a=ice-ufrag:' + d.ufrag, 'a=ice-pwd:' + d.pwd, 'a=ice-options:trickle', 'a=fingerprint:sha-256 ' + d.fp, 'a=setup:' + (kind === 'offer' ? 'actpass' : 'active'), 'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144'];
  d.cands.forEach((c, i) => {
    const prio = (c.type === 0 ? 2122252543 : c.type === 1 ? 1686052607 : 1677729535) - i;
    L.push(`a=candidate:${i + 1} 1 udp ${prio} ${c.addr} ${c.port} typ ${TYPES[c.type]}` + (c.type ? ' raddr 0.0.0.0 rport 0' : ''));
  });
  L.push('a=end-of-candidates');
  return L.join('\r\n') + '\r\n';
}

const UUID_RE = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;
/** @returns {Promise<string>} */
export async function packSignal(kind, d, sid) {
  const body = [];
  if (kind === 'offer') body.push(...sid);
  body.push(...hex2(d.fp));
  const u = ascii(d.ufrag), p = ascii(d.pwd);
  body.push(u.length, ...u, p.length, ...p, Math.min(d.cands.length, 12));
  for (const c of d.cands.slice(0, 12)) {
    let ak = 3, ab;
    const v4 = c.addr.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/), um = c.addr.match(UUID_RE);
    if (v4) { ak = 0; ab = [+v4[1], +v4[2], +v4[3], +v4[4]]; }
    else if (c.addr.includes(':')) { ak = 1; ab = ipv6Bytes(c.addr); }
    else if (um) { ak = 2; ab = hex2((um[1] + um[2] + um[3] + um[4] + um[5]).replace(/(..)/g, '$1:').slice(0, -1)); }
    if (!ab) { ak = 3; const a = ascii(c.addr); ab = [a.length, ...a]; }
    body.push((c.type << 4) | (ak << 2), ...ab, c.port >> 8, c.port & 255);
  }
  let raw = Uint8Array.from(body), flag = 0;
  if (typeof CompressionStream !== 'undefined') { try { const z = await deflate(raw); if (z.length < raw.length) { raw = z; flag = 1; } } catch { /* keep raw */ } }
  const out = new Uint8Array(raw.length + 3);
  out[0] = (kind === 'answer' ? 8 : 0) | (flag << 2); out.set(raw, 1);
  const c = crc16(out.subarray(0, raw.length + 1)); out[raw.length + 1] = c >> 8; out[raw.length + 2] = c & 255;
  return CODE_PREFIX + b64u(out);
}

function ipv6Bytes(a) {
  const halves = a.split('::'); if (halves.length > 2) return null;
  const parse = (s) => (s ? s.split(':').map((x) => parseInt(x, 16)) : []);
  const h = parse(halves[0]), t = halves.length === 2 ? parse(halves[1]) : [];
  const mid = halves.length === 2 ? new Array(8 - h.length - t.length).fill(0) : [];
  const w = [...h, ...mid, ...t]; if (w.length !== 8 || w.some((x) => !(x >= 0 && x <= 0xffff))) return null;
  return w.flatMap((x) => [x >> 8, x & 255]);
}
const ipv6Str = (b) => { const w = []; for (let i = 0; i < 16; i += 2) w.push(((b[i] << 8) | b[i + 1]).toString(16)); return w.join(':'); };

/** @returns {Promise<{kind:'offer'|'answer', sid:Uint8Array|null, d:object}>} throws Error('Código inválido…') */
export async function unpackSignal(code) {
  const bad = (why) => new Error('Código inválido' + (why ? ' (' + why + ')' : ''));
  const s = String(code || '').replace(/\s+/g, '');
  if (!s.toLowerCase().startsWith(CODE_PREFIX)) throw bad('prefixo');
  let u; try { u = unb64u(s.slice(CODE_PREFIX.length)); } catch { throw bad('base64'); }
  if (u.length < 40) throw bad('curto demais');
  const c = crc16(u.subarray(0, u.length - 2));
  if (c !== ((u[u.length - 2] << 8) | u[u.length - 1])) throw bad('cópia incompleta ou com erro de digitação');
  const kind = u[0] & 8 ? 'answer' : 'offer';
  let raw = u.subarray(1, u.length - 2);
  if (u[0] & 4) { try { raw = await inflate(raw); } catch { throw bad('compressão'); } }
  let i = 0; const need = (n) => { if (i + n > raw.length) throw bad('truncado'); };
  let sid = null; if (kind === 'offer') { need(4); sid = raw.slice(0, 4); i = 4; }
  need(32); const fp = toHex(raw.subarray(i, i + 32)); i += 32;
  const str = () => { need(1); const n = raw[i++]; need(n); const r = String.fromCharCode(...raw.subarray(i, i + n)); i += n; return r; };
  const ufrag = str(), pwd = str(); need(1); const n = raw[i++], cands = [];
  for (let k = 0; k < n; k++) {
    need(1); const b = raw[i++], type = b >> 4, ak = (b >> 2) & 3; let addr;
    if (type > 3) throw bad('candidato');
    if (ak === 0) { need(4); addr = Array.from(raw.subarray(i, i + 4)).join('.'); i += 4; }
    else if (ak === 1) { need(16); addr = ipv6Str(raw.subarray(i, i + 16)); i += 16; }
    else if (ak === 2) { need(16); const h = toHex(raw.subarray(i, i + 16)).replace(/:/g, '').toLowerCase(); addr = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`; i += 16; }
    else { need(1); const l = raw[i++]; need(l); addr = String.fromCharCode(...raw.subarray(i, i + l)); i += l; }
    if (!/^[A-Za-z0-9.:_-]{1,80}$/.test(addr)) throw bad('endereço');
    need(2); const port = (raw[i] << 8) | raw[i + 1]; i += 2;
    cands.push({ type, addr, port });
  }
  if (!/^[A-Za-z0-9+/]{1,64}$/.test(ufrag) || !/^[A-Za-z0-9+/]{8,128}$/.test(pwd)) throw bad('ICE');
  return { kind, sid, d: { fp, ufrag, pwd, cands } };
}

/** Resolves when ICE gathering is complete or after `ms` (whatever was gathered by then is used). */
function gathered(pc, ms) {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') { res(); return; }
    const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', chk); res(); };
    const chk = () => { if (pc.iceGatheringState === 'complete') done(); };
    const t = setTimeout(done, ms);
    pc.addEventListener('icegatheringstatechange', chk);
  });
}
export const iceFromUrl = () => { try { return new URLSearchParams(location.search).get('netstun') === '0' ? [] : ICE_SERVERS; } catch { return ICE_SERVERS; } };

/**
 * Host side of the manual flow. One offer per guest.
 * @returns {Promise<{code:string, accept:(answerCode:string)=>Promise<RtcTransport>, cancel:()=>void}>}
 */
export async function createManualInvite(opts = {}) {
  const pc = makePeerConnection(opts.ice || iceFromUrl()), tr = new RtcTransport(pc), sid = new Uint8Array(4);
  crypto.getRandomValues(sid);
  await pc.setLocalDescription(await pc.createOffer());
  await gathered(pc, opts.gatherMs || 3000);
  const code = await packSignal('offer', parseSdp(pc.localDescription.sdp), sid);
  return {
    code, transport: tr,
    async accept(answerCode) {
      const a = await unpackSignal(answerCode);
      if (a.kind !== 'answer') throw new Error('Isso é um convite, não uma resposta. Cole aqui o código que o seu amigo gerou.');
      await pc.setRemoteDescription({ type: 'answer', sdp: buildSdp('answer', a.d) });
      return tr;
    },
    cancel() { tr.close('cancelled'); },
  };
}

/** Guest side of the manual flow. @returns {Promise<{answer:string, transport:RtcTransport}>}; the transport opens once the host pastes the answer. */
export async function answerManualInvite(code, opts = {}) {
  const o = await unpackSignal(code);
  if (o.kind !== 'offer') throw new Error('Isso é uma resposta, não um convite.');
  const pc = makePeerConnection(opts.ice || iceFromUrl()), tr = new RtcTransport(pc);
  await pc.setRemoteDescription({ type: 'offer', sdp: buildSdp('offer', o.d) });
  await pc.setLocalDescription(await pc.createAnswer());
  await gathered(pc, opts.gatherMs || 3000);
  return { answer: await packSignal('answer', parseSdp(pc.localDescription.sdp)), transport: tr };
}

// ---------------------------------------------------------------------------------------------------------------------
// Local lobby (BroadcastChannel): tabs of one browser. Host advertises a room code; guests "knock" and get a private pair channel.
// ---------------------------------------------------------------------------------------------------------------------
export const localAvailable = () => typeof BroadcastChannel !== 'undefined';
const lobbyName = (room) => 'hz-lobby-' + room.replace('-', '');

export class LocalLobby {
  /** @param {string} room @param {(tr:LocalTransport)=>void} onPeer */
  constructor(room, onPeer) {
    this.room = room; this.onPeer = onPeer; this.bc = new BroadcastChannel(lobbyName(room));
    this.bc.onmessage = (e) => {
      const m = e.data; if (!m || m.k !== 'knock' || typeof m.g !== 'string' || !/^[a-z0-9]{6,16}$/.test(m.g)) return;
      const chan = 'hz-pair-' + room.replace('-', '') + '-' + m.g;
      this.bc.postMessage({ k: 'accept', g: m.g, chan });
      this.onPeer(new LocalTransport(chan, 'h', 'g'));
    };
  }
  stop() { try { this.bc.close(); } catch { /* closed */ } }
}

/** @returns {Promise<LocalTransport>} rejects after `ms` when nobody answers */
export function localConnect(room, ms = 1800) {
  return new Promise((res, rej) => {
    if (!localAvailable()) { rej(new Error('BroadcastChannel indisponível')); return; }
    const bc = new BroadcastChannel(lobbyName(room)), g = randomString(10, 'abcdefghijklmnopqrstuvwxyz0123456789');
    const t = setTimeout(() => { bc.close(); rej(new Error('Nenhuma aba respondeu')); }, ms);
    bc.onmessage = (e) => {
      const m = e.data; if (!m || m.k !== 'accept' || m.g !== g || typeof m.chan !== 'string') return;
      clearTimeout(t); bc.close(); res(new LocalTransport(m.chan, 'g', 'h'));
    };
    bc.postMessage({ k: 'knock', g });
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Trystero (public relays as rendezvous). The mesh Trystero builds also links guests to each other; we simply ignore those links.
// ---------------------------------------------------------------------------------------------------------------------
const PROBE = '\u0001probe', HOSTHERE = '\u0001host';
class TrysteroTransport extends Transport {
  constructor(drv, peerId, via) { super('trystero'); this.drv = drv; this.peerId = peerId; this.via = via; setTimeout(() => this._open(), 0); }
  send(str) { if (this.state !== 'closed') this.drv.send(str, this.peerId, this.via); }
  close(reason) { this.drv.forget(this.peerId); if (this.drv.mode === 'guest') this.drv.leave(); this._closed(reason); }
}

/** Rendezvous strategies, all joined at once: it is enough that ONE public network (Nostr relays, BitTorrent trackers, MQTT brokers) is reachable by both sides. */
const STRATEGIES = [
  ['nostr', () => import('@trystero-p2p/nostr')],
  ['torrent', () => import('@trystero-p2p/torrent')],
  ['mqtt', () => import('@trystero-p2p/mqtt')],
];

class TrysteroDriver {
  constructor(room, mode, onPeer, joinImpl) { this.roomCode = room; this.mode = mode; this.onPeer = onPeer; this.joinImpl = joinImpl; this.peers = new Map(); this.rooms = []; this.mods = []; this.sends = []; this.names = []; this.hostPeer = null; this.hostVia = -1; this.waiters = []; }
  async start() {
    let impls;
    if (this.joinImpl) impls = [['test', this.joinImpl]];
    else {
      impls = []; const errs = [];
      await Promise.all(STRATEGIES.map(async ([name, load]) => { try { const mod = await load(); impls.push([name, mod.joinRoom]); this.mods.push([name, mod]); } catch (e) { errs.push(name + ': ' + (e && e.message ? e.message : e)); } }));
      if (!impls.length) throw new Error(errs.join('; ') || 'nenhuma rede de sinalização disponível');
    }
    const cfg = { appId: ROOM_APP_ID, password: 'hz-' + this.roomCode, turnConfig: TURN_SERVERS, relayConfig: { warnOnRelayFailure: false } };
    let lastErr = null;
    for (const [name, joinRoom] of impls) {
      try { this._wire(name, joinRoom(cfg, this.roomCode)); } catch (e) { lastErr = e; console.warn('[HZ] rendezvous', name, 'failed:', e); }
    }
    if (!this.rooms.length) throw lastErr || new Error('sem sinalização');
    return this;
  }
  _wire(name, room) {
    const idx = this.rooms.length; this.rooms.push(room); this.names.push(name);
    const act = room.makeAction('hz');
    const quiet = (r) => { if (r && r.catch) r.catch(() => {}); };           // a peer that just left must not surface as an unhandled rejection
    if (Array.isArray(act)) { this.sends[idx] = (d, id) => quiet(act[0](d, id)); act[1]((d, id) => this._recv(d, id, idx)); }          // older tuple-style API
    else { this.sends[idx] = (d, id) => quiet(act.send(d, { target: id })); act.onMessage = (d, ctx) => this._recv(d, ctx && ctx.peerId !== undefined ? ctx.peerId : ctx, idx); }
    room.onPeerJoin = (id) => { if (this.mode === 'guest') this.sends[idx](PROBE, id); };
    room.onPeerLeave = (id) => { const t = this.peers.get(id); if (t && t.via === idx) { this.peers.delete(id); t._closed('peer-left'); } };
  }
  send(str, id, via) { try { const f = this.sends[via >= 0 ? via : 0]; f(str, id); } catch (e) { console.warn('[HZ] trystero send failed', e); } }
  forget(id) { this.peers.delete(id); }
  _recv(d, id, idx) {
    if (typeof d !== 'string') return;
    if (this.mode === 'host') {
      if (d === PROBE) { this.send(HOSTHERE, id, idx); if (!this.peers.has(id)) { const t = new TrysteroTransport(this, id, idx); this.peers.set(id, t); this.onPeer(t); } return; }
      const t = this.peers.get(id); if (t && t.via === idx) t._emit('message', d, true);
    } else {
      if (d === HOSTHERE && !this.hostPeer) { this.hostPeer = id; this.hostVia = idx; const t = new TrysteroTransport(this, id, idx); this.peers.set(id, t); for (const w of this.waiters) w(t); this.waiters = []; return; }
      if (id === this.hostPeer && idx === this.hostVia) { const t = this.peers.get(id); if (t) t._emit('message', d, true); }
    }
  }
  /** how many public relays / trackers / brokers are really connected right now */
  status() {
    let open = 0, total = 0; const parts = [], label = { nostr: 'Nostr', torrent: 'Torrent', mqtt: 'MQTT' };
    for (const [name, mod] of this.mods) {
      let o = 0, t = 0;
      try { const socks = mod.getRelaySockets ? mod.getRelaySockets() : {}; for (const k of Object.keys(socks)) { const x = socks[k]; t++; if (x && (x.readyState === 1 || x.connected === true)) o++; } } catch { /* ignore */ }
      open += o; total += t; parts.push((label[name] || name) + ' ' + o + '/' + t);
    }
    return { open, total, text: parts.join(' · ') };
  }
  leave() { for (const r of this.rooms) { try { r.leave(); } catch { /* ignore */ } } this.rooms = []; for (const t of this.peers.values()) t._closed('left'); this.peers.clear(); }
}

/** Host advertises `room` on the public relays. @returns {Promise<{stop():void}>} */
export async function trysteroHost(room, onPeer, joinImpl) {
  const d = await new TrysteroDriver(room, 'host', onPeer, joinImpl).start();
  return { stop: () => d.leave(), status: () => d.status() };
}
/** Guest looks for the host of `room`. @returns {Promise<Transport>} (rejects with a friendly Error after `ms`) */
export async function trysteroConnect(room, ms = 40000, joinImpl) {
  let d;
  try { d = await new TrysteroDriver(room, 'guest', null, joinImpl).start(); } catch (e) { throw new Error('Não foi possível usar a rede pública de sinalização (' + (e && e.message ? e.message : e) + ').'); }
  return new Promise((res, rej) => {
    const t = setTimeout(() => { d.leave(); rej(new Error('O anfitrião não foi encontrado na rede pública. Confira o código ou use o modo manual.')); }, ms);
    d.waiters.push((tr) => { clearTimeout(t); res(tr); });
  });
}
