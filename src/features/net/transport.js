// Transport = one point-to-point link: reliable ordered channel + unreliable channel. Events: open, close(reason), message(str, reliable).
// Link = framing on top of a Transport: JSON objects, fragmentation of big messages, size caps and byte counters.
import { MAX_FRAME, MAX_BIG } from './protocol.js';

export const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }];   // STUN only: no TURN, so some NATs will not connect

export class Transport {
  constructor(kind) { this.kind = kind; this.state = 'connecting'; this._l = { open: new Set(), close: new Set(), message: new Set() }; }
  /** @returns {() => void} unsubscribe */
  on(type, fn) { this._l[type].add(fn); return () => this._l[type].delete(fn); }
  _emit(type, a, b) { for (const fn of [...this._l[type]]) { try { fn(a, b); } catch (e) { console.error('[HZ] transport handler failed:', e); } } }
  _open() { if (this.state !== 'connecting') return; this.state = 'open'; this._emit('open'); }
  _closed(reason) { if (this.state === 'closed') return; this.state = 'closed'; this._emit('close', reason || 'closed'); }
  /** @param {string} str @param {boolean} [reliable] */
  send(str, reliable = true) { void str; void reliable; }
  close(reason) { this._closed(reason); }
  /** bytes waiting in the send queue */
  get buffered() { return 0; }
}

// ---------------------------------------------------------------------------------------------------------------------
// Local (same-origin tabs) over BroadcastChannel. A pair channel has exactly two ends, so it behaves as a point-to-point link.
// ---------------------------------------------------------------------------------------------------------------------
export class LocalTransport extends Transport {
  /** @param {string} channel pair channel name  @param {string} me my tag  @param {string} peer the other end's tag */
  constructor(channel, me, peer) {
    super('local');
    this.me = me; this.peer = peer; this._seen = false; this._q = [];
    this.bc = new BroadcastChannel(channel);
    this.bc.onmessage = (e) => this._recv(e.data);
    this._post({ k: 'hi' });
    this._pageHide = () => { if (this.state === 'open') this._post({ k: 'bye' }); };
    addEventListener('pagehide', this._pageHide);
  }
  _post(m) { m.f = this.me; m.to = this.peer; try { this.bc.postMessage(m); } catch { /* channel closed */ } }
  _recv(m) {
    if (!m || m.to !== this.me || m.f !== this.peer || this.state === 'closed') return;
    if (m.k === 'hi') { if (!this._seen) { this._seen = true; this._post({ k: 'hi' }); this._open(); const q = this._q; this._q = []; for (const x of q) this._post(x); } }
    else if (m.k === 'm' && typeof m.d === 'string') this._emit('message', m.d, m.r !== false);
    else if (m.k === 'bye') this.close('peer-closed');
  }
  send(str, reliable = true) {
    if (this.state === 'closed') return;
    const m = { k: 'm', d: str, r: reliable };
    if (this.state !== 'open') { this._q.push(m); return; }
    this._post(m);
  }
  close(reason) {
    if (this.state === 'closed') return;
    if (this.state === 'open') this._post({ k: 'bye' });
    removeEventListener('pagehide', this._pageHide);
    try { this.bc.close(); } catch { /* already closed */ }
    this._closed(reason);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// WebRTC DataChannel. Two pre-negotiated channels (id 0 reliable+ordered, id 1 unordered with no retransmits), so no ondatachannel dance
// is needed and the SDP stays tiny.
// ---------------------------------------------------------------------------------------------------------------------
const HIGH_WATER = 1 << 20, LOW_WATER = 1 << 18, DISCONNECT_GRACE = 9000;
export function makePeerConnection(iceServers = ICE_SERVERS) {
  if (typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC indisponível neste navegador');
  return new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 0 });
}

export class RtcTransport extends Transport {
  /** @param {RTCPeerConnection} pc  (channels are created here, before any offer/answer exists) */
  constructor(pc) {
    super('webrtc');
    this.pc = pc; this._q = []; this._qBytes = 0; this._graceT = 0;
    const rc = this.rc = pc.createDataChannel('r', { negotiated: true, id: 0, ordered: true });
    const uc = this.uc = pc.createDataChannel('u', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    rc.bufferedAmountLowThreshold = LOW_WATER;
    rc.onopen = () => { this._open(); this._flush(); };
    rc.onclose = () => this._closed('channel-closed');
    rc.onmessage = (e) => { if (typeof e.data === 'string') this._emit('message', e.data, true); };
    rc.onbufferedamountlow = () => this._flush();
    uc.onmessage = (e) => { if (typeof e.data === 'string') this._emit('message', e.data, false); };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed') this._closed('connection-' + s);
      else if (s === 'disconnected') { clearTimeout(this._graceT); this._graceT = setTimeout(() => { if (pc.connectionState !== 'connected') this._closed('connection-lost'); }, DISCONNECT_GRACE); }   // short network blips recover on their own
      else if (s === 'connected') clearTimeout(this._graceT);
    };
  }
  _flush() {
    const rc = this.rc;
    while (this._q.length && rc.readyState === 'open' && rc.bufferedAmount < HIGH_WATER) { const s = this._q.shift(); this._qBytes -= s.length; rc.send(s); }
  }
  send(str, reliable = true) {
    if (this.state === 'closed') return;
    const rc = this.rc, uc = this.uc;
    if (!reliable && uc.readyState === 'open') { if (uc.bufferedAmount < 65536) uc.send(str); return; }   // late unreliable packets are worthless: drop under pressure
    if (this._q.length || rc.readyState !== 'open' || rc.bufferedAmount > HIGH_WATER) { this._q.push(str); this._qBytes += str.length; if (this._qBytes > 64e6) this.close('send-queue-overflow'); return; }
    rc.send(str);
  }
  get buffered() { return this._qBytes + (this.rc ? this.rc.bufferedAmount : 0); }
  close(reason) {
    clearTimeout(this._graceT);
    try { this.rc.close(); this.uc.close(); this.pc.close(); } catch { /* already closed */ }
    this._closed(reason);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Link: JSON framing + fragmentation. Messages above MAX_FRAME chars travel as {t:'big'} fragments on the reliable channel.
// ---------------------------------------------------------------------------------------------------------------------
export class Link {
  /** @param {Transport} tr  @param {(msg:object, reliable:boolean)=>void} onMessage */
  constructor(tr, onMessage) {
    this.tr = tr; this.onMessage = onMessage;
    this.bytesIn = 0; this.bytesOut = 0; this.msgIn = 0; this.msgOut = 0; this.bad = 0; this.lastSeen = performance.now();
    this._big = null; this._bigId = 0;
    this.off = tr.on('message', (s, rel) => this._recv(s, rel));
  }
  _recv(s, rel) {
    this.lastSeen = performance.now(); this.bytesIn += s.length; this.msgIn++;
    if (s.length > MAX_FRAME * 3) { this.bad++; return; }
    let m; try { m = JSON.parse(s); } catch { this.bad++; return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') { this.bad++; return; }
    if (m.t === 'big') { this._frag(m); return; }
    this.onMessage(m, rel);
  }
  _frag(m) {
    if (typeof m.s !== 'string' || !Number.isInteger(m.i) || !Number.isInteger(m.n) || m.n < 1 || m.n * MAX_FRAME > MAX_BIG) { this.bad++; return; }
    if (m.i === 0) this._big = { id: m.id, n: m.n, parts: [], len: 0 };
    const b = this._big;
    if (!b || b.id !== m.id || b.parts.length !== m.i) { this._big = null; this.bad++; return; }
    b.parts.push(m.s); b.len += m.s.length;
    if (b.len > MAX_BIG) { this._big = null; this.bad++; return; }
    if (b.parts.length === b.n) {
      this._big = null;
      let o; try { o = JSON.parse(b.parts.join('')); } catch { this.bad++; return; }
      if (o && typeof o === 'object' && typeof o.t === 'string') this.onMessage(o, true);
    }
  }
  /** @param {object|string} obj  (a pre-serialised string is allowed so broadcasts stringify once) */
  send(obj, reliable = true) {
    const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
    if (s.length <= MAX_FRAME) { this.bytesOut += s.length; this.msgOut++; this.tr.send(s, reliable); return; }
    const id = ++this._bigId, n = Math.ceil(s.length / MAX_FRAME);
    for (let i = 0; i < n; i++) { const f = JSON.stringify({ t: 'big', id, i, n, s: s.slice(i * MAX_FRAME, (i + 1) * MAX_FRAME) }); this.bytesOut += f.length; this.msgOut++; this.tr.send(f, true); }
  }
  close(reason) { this.off(); this.tr.close(reason); }
}
