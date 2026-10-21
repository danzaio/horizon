// Net: the object published as ctx.net. Star topology, host-authoritative: the planet owner is the host, guests talk to the host only.
// Solo is the same object in its idle state (role 'solo', isAuthority true) so features never null-check it.
import { PROTO, MAX_PLAYERS, KIND_RE, Bucket, makeRoomCode, makeToken, makeId, cleanName, cleanColor, cleanText, cleanItem, cleanTeam, cleanExtra, cleanEdits, sanitizePlanet, clampNum, clampInt, r2, r3 } from './protocol.js';
import { Link } from './transport.js';
import { RemotePlayer } from './remote.js';
import { LocalLobby, localAvailable, trysteroHost, createManualInvite, lobbyJoin } from './signal.js';
import { Sync } from './sync.js';

const POS_MS = 1000 / 15, PING_MS = 2000, ROSTER_MS = 3000, TIME_MS = 4000, TIMEOUT_MS = 14000, EDIT_FLUSH_MS = 50;
const REASONS = { closed: 'O domo deste planeta está fechado.', full: 'Este planeta está cheio.', invite: 'Este planeta só aceita quem tem um convite válido (ou o convite já foi usado).', version: 'Versão do jogo incompatível com a do anfitrião.',
  kick: 'Você foi expulso pelo anfitrião.', 'dome-closed': 'O anfitrião fechou o domo.', 'host-left': 'O anfitrião saiu do planeta.', timeout: 'O anfitrião não respondeu a tempo.', spam: 'Desconectado por excesso de mensagens.', bad: 'Mensagem inválida.' };
export const reasonText = (r) => REASONS[r] || 'Conexão encerrada (' + r + ').';
const urlFlag = (k) => { try { return new URLSearchParams(location.search).get(k); } catch { return null; } };
export const rtcAvailable = () => typeof RTCPeerConnection !== 'undefined';
/** hosting needs WebRTC (friends) or BroadcastChannel (tabs of this browser); inside sandboxed frames such as the Claude Artifact neither exists */
export const canHost = () => rtcAvailable() || localAvailable();
export const NO_HOST_TEXT = 'Multijogador indisponível neste ambiente: o navegador não oferece WebRTC (acontece dentro do Artifact do Claude). Abra o jogo pelo link público (GitHub Pages) para convidar amigos.';

export class Net {
  /** @param {{emit:Function,on:Function}} events  @param {{id:string,name:string,color:string}} identity */
  constructor(events, identity) {
    this.events = events; this.identity = identity;
    this.role = 'solo'; this.isAuthority = true; this.localId = identity.id; this.hostId = null; this.hostName = '';
    /** @type {Map<string, RemotePlayer>} REMOTE players only */
    this.players = new Map();
    this.peers = new Map();                  // host side: id -> peer record
    this.link = null;                        // guest side: link to the host
    this.hostPing = 0;
    this.chatLog = [];
    this.hostInfo = null;
    this.welcome = null;
    this.sync = null; this.ctx = null;
    this._h = new Map(); this._snaps = new Map(); this._early = []; this._pre = []; this._pending = new Set(); this._invites = new Map();
    this._lobby = null; this._tryst = null; this._manual = new Set(); this._recent = new Map(); this._left = false; this.rejoin = null;
    this._acc = { pos: 0, ping: 0, roster: 0, time: 0, edit: 0, ls: 0, stats: 0, wx: 0 }; this._lastExtra = '{}';
    this.stats = { role: 'solo', peers: 0, inBps: 0, outBps: 0, msgIn: 0, msgOut: 0, ping: 0 }; this._sb = { in: 0, out: 0, mi: 0, mo: 0 };
    this.dome = { mode: 'closed', perms: { build: true, break: true, pvp: true, fly: true }, maxPlayers: MAX_PLAYERS,
      set: (m) => this._domeSet(m), setPerm: (k, v) => this._setPerm(k, v) };
  }

  // ------------------------------------------------------------------------------------------------ contract API
  /** Custom message handler. @returns {() => void} off */
  on(type, fn) { let s = this._h.get(type); if (!s) this._h.set(type, s = new Set()); s.add(fn); return () => s.delete(fn); }

  /** guest -> host (`to` ignored) · host -> `to` (everyone when omitted) */
  send(type, data, o = {}) {
    if (!KIND_RE.test(type)) return;
    if (this.role === 'guest') this._gSend({ t: 'x', k: type, d: data }, o.reliable !== false);
    else if (this.role === 'host') { const p = o.to ? this.peers.get(o.to) : null; const m = { t: 'x', k: type, d: data, f: this.localId }; if (p) this._pSend(p, m, o.reliable !== false); else if (!o.to) this._toAll(m, o.reliable !== false); }
  }
  /** everybody else; a guest's broadcast is relayed by the host */
  broadcast(type, data, o = {}) {
    if (!KIND_RE.test(type)) return;
    if (this.role === 'guest') this._gSend({ t: 'x', k: type, d: data, b: 1, ex: o.except }, o.reliable !== false);
    else if (this.role === 'host') this._toAll({ t: 'x', k: type, d: data, f: this.localId }, o.reliable !== false, o.except);
  }
  /** Included in the welcome snapshot a joining guest receives. h = { get():any, set(data):void } */
  registerSnapshot(key, h) {
    this._snaps.set(key, h);
    const w = this.welcome && this.welcome.snapshots;
    if (w && key in w) { try { h.set(w[key]); } catch (e) { console.error('[HZ] snapshot set failed:', key, e); } }
  }
  /** ping in ms: of player `id`, or to the host when omitted (host: worst guest) */
  latency(id) {
    if (id) { const p = this.players.get(id); return p ? p.ping : 0; }
    if (this.role === 'guest') return this.hostPing;
    let m = 0; for (const p of this.peers.values()) m = Math.max(m, p.rp.ping); return m;
  }
  kick(id, reason = 'kick') {
    const p = this.peers.get(id); if (!p) return;
    this._pSend(p, { t: 'kick', reason }); setTimeout(() => p.link.close('kicked'), 150);
    this._dropPeer(p, 'kicked');
  }

  /**
   * Start accepting guests. Needs a running game (world). @param {{mode?:'open'|'invite', trystero?:boolean}} [o]
   * @returns {Promise<{code:string, link:string, mode:string, trystero:string, local:boolean, rtc:boolean}>}
   */
  async startHosting(o = {}) {
    if (this.role === 'guest') throw new Error('Visitantes não podem abrir o domo.');
    if (!this.ctx) throw new Error('Entre em um planeta antes de abrir o domo.');
    if (!canHost()) throw new Error(NO_HOST_TEXT);
    if (this.role === 'host') return this.hostInfo;
    const mode = o.mode === 'invite' ? 'invite' : 'open', code = typeof o.code === 'string' && /^[2-9A-Z]{4}-[2-9A-Z]{4}$/.test(o.code) ? o.code : makeRoomCode();
    this.role = 'host'; this.isAuthority = true; this.hostId = this.localId; this.hostName = this.identity.name;
    this.dome.mode = mode; this.ctx.planet.domeMode = mode;
    const info = this.hostInfo = { code, mode, link: this._link(code), trystero: 'off', trysteroError: '', local: false, rtc: rtcAvailable() };
    if (localAvailable()) { this._lobby = new LocalLobby(code, (tr) => this.accept(tr, 'local')); info.local = true; }
    this.events.emit('net:role', { role: 'host' }); this.events.emit('dome:change', { mode });
    const useT = o.trystero !== false && urlFlag('nettrystero') !== '0' && rtcAvailable();
    if (useT) {
      info.trystero = 'connecting';
      trysteroHost(code, (tr) => this.accept(tr, 'trystero')).then((h) => {
        if (this.role === 'host' && this.hostInfo === info) {
          this._tryst = h; info.trystero = 'connecting';
          const poll = () => {   // report REAL connectivity of the public rendezvous networks, not just "we asked"
            if (this._tryst !== h || this.hostInfo !== info) { clearInterval(iv); return; }
            const st = h.status(), state = st.open > 0 ? 'on' : 'connecting', txt = st.text;
            if (state !== info.trystero || txt !== info.relays) { info.trystero = state; info.relays = txt; this.events.emit('net:hostInfo', info); }
          };
          const iv = setInterval(poll, 1500); poll();
        } else h.stop();
      })
        .catch((e) => { info.trystero = 'failed'; info.trysteroError = e && e.message ? e.message : String(e); console.warn('[HZ] trystero host failed:', e); })
        .finally(() => this.events.emit('net:hostInfo', info));
    }
    return info;
  }

  /** List (or unlist) this open room in the public room list. */
  async setPublic(on, name) {
    this._pubStop(); this.pubName = name ? String(name).slice(0, 32) : this.pubName;
    if (!on) { this.events.emit('net:hostInfo', this.hostInfo); return false; }
    if (this.role !== 'host' || !this.hostInfo || this.dome.mode !== 'open') throw new Error('Abra o domo (modo Aberto) para listar a sala.');
    this._pub = await lobbyJoin({ getAd: () => this._ad() });
    this.events.emit('net:hostInfo', this.hostInfo); return true;
  }
  get isPublic() { return !!this._pub; }
  _ad() {
    if (this.role !== 'host' || !this.hostInfo || this.dome.mode !== 'open') return null;
    const pf = this.ctx && this.ctx.planet, max = this.dome.maxPlayers || 8;
    return JSON.stringify({ c: this.hostInfo.code, n: this.pubName || (pf && pf.name) || 'Planeta', o: this.identity.name, t: (pf && pf.profile && pf.profile.type) || '', p: this.players.size + 1, m: max, v: PROTO });
  }
  _pubStop() { if (this._pub) { try { this._pub.stop(); } catch { /* ignore */ } this._pub = null; } }

  stopHosting() {
    if (this.role !== 'host') return;
    this._pubStop();
    for (const p of [...this.peers.values()]) { this._pSend(p, { t: 'kick', reason: 'dome-closed' }); setTimeout(() => p.link.close('dome-closed'), 150); this._dropPeer(p, 'dome-closed', true); }
    for (const p of [...this._pending]) p.link.close('dome-closed');
    for (const m of this._manual) m.cancel(); this._manual.clear();
    if (this._lobby) { this._lobby.stop(); this._lobby = null; }
    if (this._tryst) { this._tryst.stop(); this._tryst = null; }
    this.peers.clear(); this.players.clear(); this._invites.clear();
    this.role = 'solo'; this.hostId = null; this.hostInfo = null; this.dome.mode = 'closed';
    if (this.ctx) this.ctx.planet.domeMode = 'closed';
    this.events.emit('net:role', { role: 'solo' }); this.events.emit('dome:change', { mode: 'closed' });
  }

  // ------------------------------------------------------------------------------------------------ extras used by the UI
  /** Shareable link for a room code (optionally with a one-time token). */
  _link(code, token) { let base = ''; try { base = location.origin + location.pathname; } catch { /* no location */ } return base + '?join=' + code + (token ? '~' + token : ''); }
  /** One-time invite for invite-mode domes: { code:'ABCD-EF12~TOKEN', link } */
  newInvite() {
    if (this.role !== 'host') return null;
    const tok = makeToken(); this._invites.set(tok, performance.now() + 20 * 60000);
    const code = this.hostInfo.code + '~' + tok; return { code, link: this._link(this.hostInfo.code, tok), token: tok };
  }
  /** Serverless invite for one friend. @returns {Promise<{code:string, accept(answer:string):Promise<void>, cancel():void}>} */
  async newManualInvite() {
    if (this.role !== 'host') throw new Error('Abra o domo primeiro.');
    if (!rtcAvailable()) throw new Error('Este navegador não suporta WebRTC.');
    const inv = await createManualInvite();
    this._manual.add(inv);
    return { code: inv.code, cancel: () => { this._manual.delete(inv); inv.cancel(); },
      accept: async (answer) => { const tr = await inv.accept(answer); this._manual.delete(inv); this.accept(tr, 'manual'); } };
  }
  chat(text) {
    text = cleanText(text, 200); if (!text) return;
    if (this.role === 'guest') this._gSend({ t: 'chat', text });
    else { const rec = { id: this.localId, name: this.identity.name, color: this.identity.color, text }; this._chatIn(rec); if (this.role === 'host') this._toAll({ t: 'chat', ...rec }); }
  }
  /** Guest: say goodbye and drop the link. */
  leave() { this._left = true; if (this.role === 'guest' && this.link) { this._gSend({ t: 'bye' }); const l = this.link; this.link = null; setTimeout(() => l.close('left'), 80); } }

  // ------------------------------------------------------------------------------------------------ guest: join
  /**
   * Run the hello/welcome handshake over an open (or opening) transport.
   * @returns {Promise<object>} the welcome: { planet, edits, time, weather, snapshots, you, players, hostId, hostName }
   */
  join(tr, o = {}) {
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (why) => { if (done) return; done = true; clearTimeout(timer); try { link.close(why); } catch { /* closed */ } reject(Object.assign(new Error(reasonText(why)), { reason: why })); };
      const link = new Link(tr, (m, rel) => {
        if (!done) {
          if (m.t === 'welcome') { try { this._onWelcome(link, m); } catch (e) { fail('bad'); return; } done = true; clearTimeout(timer); resolve(this.welcome); }
          else if (m.t === 'reject') fail(typeof m.reason === 'string' ? m.reason : 'closed');
          return;
        }
        this._guestMsg(m, rel);
      });
      const timer = setTimeout(() => fail('timeout'), o.timeoutMs || 25000);
      tr.on('close', (why) => { if (!done) fail(why || 'closed'); else this._guestClosed(why); });
      const hello = () => link.send({ t: 'hello', ver: PROTO, id: o.id || this.identity.id, name: this.identity.name, color: this.identity.color, tok: o.token || '' });
      if (tr.state === 'open') hello(); else tr.on('open', hello);
    });
  }

  _onWelcome(link, m) {
    const planet = sanitizePlanet(m.planet);
    if (!planet) { link.close('bad'); throw new Error(reasonText('bad')); }
    this.link = link; this.role = 'guest'; this.isAuthority = false;
    this.localId = cleanText(m.you && m.you.id, 16) || this.identity.id; this.hostId = cleanText(m.hostId, 16); this.hostName = cleanName(m.hostName, 'Anfitrião');
    const d = m.dome || {}; this.dome.mode = d.mode === 'invite' ? 'invite' : 'open'; this._applyPerms(d.perms); this.dome.maxPlayers = clampInt(d.max, 2, 16, MAX_PLAYERS); planet.domeMode = this.dome.mode;
    this.welcome = { planet, edits: cleanEdits(m.edits), time: clampNum(m.time, 0, 24, 9), speed: clampNum(m.speed, 0, 5, 0.02), weather: typeof m.weather === 'string' ? m.weather : 'clear',
      snapshots: m.snapshots && typeof m.snapshots === 'object' ? m.snapshots : {}, pos: Array.isArray(m.pos) ? m.pos.slice(0, 3).map((v) => clampNum(v, -3e7, 3e7)) : null };
    this._applyRoster(m.players);
    this.events.emit('net:role', { role: 'guest' });
  }

  // ------------------------------------------------------------------------------------------------ host: accept
  /** A transport produced by a signaler (local / trystero / manual). */
  accept(tr, via) {
    if (this.role !== 'host') { tr.close('closed'); return; }
    const peer = { id: '', via, link: null, rp: null, state: 'new', strikes: 0, raw: new Float64Array(6), pingAt: 0, joined: 0,
      bk: { pos: new Bucket(40, 60), eb: new Bucket(30, 60), chat: new Bucket(1.2, 4), x: new Bucket(150, 300), any: new Bucket(400, 800) } };
    peer.link = new Link(tr, (m, rel) => this._hostMsg(peer, m, rel));
    this._pending.add(peer);
    peer.timer = setTimeout(() => { if (peer.state === 'new') peer.link.close('hello-timeout'); }, 15000);
    tr.on('close', () => { this._pending.delete(peer); clearTimeout(peer.timer); if (peer.state === 'ready') this._dropPeer(peer, 'left'); });
  }

  _hostMsg(peer, m, rel) {
    if (!peer.bk.any.take()) { if (++peer.strikes > 300) this.kick(peer.id, 'spam'); return; }
    if (peer.state === 'new') { if (m.t === 'hello') this._onHello(peer, m); else peer.link.close('bad'); return; }
    switch (m.t) {
      case 'pos': if (peer.bk.pos.take()) this._onPos(peer, m); break;
      case 'eb': if (peer.bk.eb.take()) this.sync.hostEdits(peer, m.e); break;
      case 'chat': if (peer.bk.chat.take()) { const text = cleanText(m.text, 200); if (text) { const rec = { id: peer.id, name: peer.rp.name, color: peer.rp.color, text }; this._chatIn(rec); this._toAll({ t: 'chat', ...rec }); } } break;
      case 'ls': peer.rp.extra = cleanExtra(m.x); this._toAll({ t: 'ls', id: peer.id, x: peer.rp.extra }, true, peer.id); break;
      case 'x': if (peer.bk.x.take()) this._onCustom(peer, m); break;
      case 'ping': this._pSend(peer, { t: 'pong', n: m.n }); break;
      case 'pong': if (typeof m.n === 'number') { const rtt = performance.now() - m.n; if (rtt >= 0 && rtt < 60000) peer.rp.ping = Math.round(peer.rp.ping ? peer.rp.ping * 0.6 + rtt * 0.4 : rtt); } break;
      case 'bye': peer.link.close('left'); break;
      default: break;
    }
  }

  _onHello(peer, m) {
    clearTimeout(peer.timer);
    const rej = (reason) => { peer.link.send({ t: 'reject', reason }); setTimeout(() => peer.link.close(reason), 200); };
    if (m.ver !== PROTO) return rej('version');
    if (this.dome.mode === 'closed') return rej('closed');
    if (this.peers.size + 1 >= this.dome.maxPlayers) return rej('full');
    const back = this._recent.get(typeof m.id === 'string' ? m.id : '') > performance.now();      // a guest that dropped a moment ago may come back without a new invite
    if (this.dome.mode === 'invite' && peer.via !== 'manual' && !back) {
      const tok = typeof m.tok === 'string' ? m.tok.toUpperCase() : '', exp = this._invites.get(tok);
      if (!exp || exp < performance.now()) return rej('invite');
      this._invites.delete(tok);
    }
    let id = cleanText(m.id, 16).replace(/[^a-z0-9]/gi, '');
    if (!id || id === this.localId || this.peers.has(id)) id = makeId();
    peer.id = id; peer.state = 'ready'; peer.joined = performance.now(); this._pending.delete(peer);
    peer.rp = new RemotePlayer(id, cleanName(m.name), cleanColor(m.color));
    this.peers.set(id, peer); this.players.set(id, peer.rp);
    peer.link.send(this._buildWelcome(peer));
    this._toAll({ t: 'join', p: this._info(peer.rp) }, true, id);
    this._chatSys(peer.rp.name + ' entrou no planeta');
    this.events.emit('net:peerJoin', { peer: peer.rp });
  }

  _buildWelcome(peer) {
    const s = this.sync, players = [{ id: this.localId, name: this.identity.name, color: this.identity.color, hp: this.ctx.localState.hp, ping: 0, team: this.ctx.localState.team, item: this.ctx.localState.item }];
    for (const p of this.peers.values()) if (p !== peer) players.push(this._info(p.rp));
    const snapshots = {};
    for (const [k, h] of this._snaps) { try { const v = h.get(); const j = JSON.stringify(v); if (j !== undefined && j.length < 400000) snapshots[k] = v; else console.warn('[HZ] snapshot too big, skipped:', k); } catch (e) { console.error('[HZ] snapshot get failed:', k, e); } }
    return { t: 'welcome', ver: PROTO, planet: this.ctx.planet, you: { id: peer.id }, hostId: this.localId, hostName: this.identity.name, dome: { mode: this.dome.mode, perms: this.dome.perms, max: this.dome.maxPlayers },
      time: s.hours(), speed: s.timeSpeed(), weather: s.weatherKind(), pos: s.hostPos(), players, snapshots, edits: this.ctx.world.exportEdits() };
  }
  _info(rp) { return { id: rp.id, name: rp.name, color: rp.color, ping: rp.ping, hp: rp.hp, team: rp.team, item: rp.item }; }

  _onPos(peer, m) {
    const p = m.p; if (!Array.isArray(p) || p.length < 6) return;
    const rp = peer.rp, x = clampNum(p[0], -3e7, 3e7), y = clampNum(p[1], -64, 4096), z = clampNum(p[2], -3e7, 3e7), yaw = clampNum(p[3], -1e4, 1e4), pitch = clampNum(p[4], -4, 4), fl = clampInt(p[5], 0, 255);
    rp.push(performance.now(), x, y, z, yaw, pitch, fl);
    rp.hp = clampNum(p[6], -1000, 1e5, 20); rp.alive = rp.hp > 0; rp.team = cleanTeam(p[7]); rp.item = cleanItem(p[8]);
    const r = peer.raw; r[0] = x; r[1] = y; r[2] = z; r[3] = yaw; r[4] = pitch; r[5] = fl;
  }

  _onCustom(peer, m) {
    if (typeof m.k !== 'string' || !KIND_RE.test(m.k)) return;
    this._dispatch(m.k, m.d, peer.id);
    if (m.b) this._toAll({ t: 'x', k: m.k, d: m.d, f: peer.id }, true, [peer.id, typeof m.ex === 'string' ? m.ex : '']);
  }

  _dropPeer(peer, why, silent) {
    if (!this.peers.delete(peer.id)) return;
    if (why !== 'kicked' && why !== 'dome-closed') this._recent.set(peer.id, performance.now() + 90000);
    this.players.delete(peer.id);
    if (!silent) { this._toAll({ t: 'leave', id: peer.id }); this._chatSys(peer.rp.name + (why === 'kicked' ? ' foi expulso' : ' saiu do planeta')); }
    this.events.emit('net:peerLeave', { id: peer.id, name: peer.rp.name, reason: why });
  }

  // ------------------------------------------------------------------------------------------------ guest: incoming
  _guestMsg(m) {
    if (!this.sync && (m.t === 'eb' || m.t === 'efix' || m.t === 'time' || m.t === 'weather')) { if (this._pre.length < 5000) this._pre.push(m); return; }   // world not built yet: replay in attach()
    switch (m.t) {
      case 'snap': this._onSnap(m.s); break;
      case 'eb': this.sync.guestEdits(m.e); break;
      case 'efix': this.sync.guestEdits(m.e); break;
      case 'roster': this._applyRoster(m.players); break;
      case 'join': { const i = m.p; if (i && i.id !== this.localId) { const rp = this._upsert(i); this._chatSys(rp.name + ' entrou no planeta'); this.events.emit('net:peerJoin', { peer: rp }); } break; }
      case 'leave': { const rp = this.players.get(m.id); if (rp) { this.players.delete(m.id); this._chatSys(rp.name + ' saiu do planeta'); this.events.emit('net:peerLeave', { id: m.id, name: rp.name, reason: 'left' }); } break; }
      case 'chat': { const text = cleanText(m.text, 200); if (text) this._chatIn({ id: cleanText(m.id, 16), name: cleanName(m.name), color: cleanColor(m.color), text }); break; }
      case 'ls': { const rp = this.players.get(m.id); if (rp) rp.extra = cleanExtra(m.x); break; }
      case 'x': if (typeof m.k === 'string' && KIND_RE.test(m.k)) this._dispatch(m.k, m.d, cleanText(m.f, 16)); break;
      case 'time': this.sync.onTime(m); break;
      case 'weather': this.sync.onWeather(m.kind); break;
      case 'dome': { const mode = m.mode === 'invite' ? 'invite' : 'open'; this.dome.mode = mode; this.ctx && (this.ctx.planet.domeMode = mode); this._applyPerms(m.perms); this.events.emit('dome:change', { mode }); break; }
      case 'kick': this._guestClosed(typeof m.reason === 'string' ? m.reason : 'kick', true); break;
      case 'ping': this._gSend({ t: 'pong', n: m.n }); break;
      case 'pong': if (typeof m.n === 'number') { const rtt = performance.now() - m.n; if (rtt >= 0 && rtt < 60000) this.hostPing = Math.round(this.hostPing ? this.hostPing * 0.6 + rtt * 0.4 : rtt); } break;
      case 'bye': this._guestClosed('host-left', true); break;
      default: break;
    }
  }

  _upsert(i) {
    if (!i || typeof i.id !== 'string') return null;
    const id = cleanText(i.id, 16); if (!id || id === this.localId) return null;
    let rp = this.players.get(id);
    if (!rp) { rp = new RemotePlayer(id, cleanName(i.name), cleanColor(i.color)); this.players.set(id, rp); }
    rp.name = cleanName(i.name, rp.name); rp.color = cleanColor(i.color, rp.color); rp.ping = clampInt(i.ping, 0, 60000, 0);
    rp.hp = clampNum(i.hp, -1000, 1e5, rp.hp); rp.alive = rp.hp > 0; if (i.team !== undefined) rp.team = cleanTeam(i.team); if (i.item !== undefined) rp.item = cleanItem(i.item);
    return rp;
  }
  _applyRoster(list) {
    if (!Array.isArray(list)) return;
    const seen = new Set();
    for (const i of list.slice(0, 32)) { const known = i && this.players.has(i.id); const rp = this._upsert(i); if (rp) { seen.add(rp.id); if (!known && this.ctx) this.events.emit('net:peerJoin', { peer: rp }); } }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) { this.players.delete(id); this.events.emit('net:peerLeave', { id, reason: 'left' }); }
  }
  _onSnap(list) {
    if (!Array.isArray(list)) return;
    const now = performance.now();
    for (const e of list.slice(0, 32)) {
      if (!Array.isArray(e) || e.length < 7) continue;
      const rp = this.players.get(e[0]); if (!rp) continue;
      rp.push(now, clampNum(e[1], -3e7, 3e7), clampNum(e[2], -64, 4096), clampNum(e[3], -3e7, 3e7), clampNum(e[4], -1e4, 1e4), clampNum(e[5], -4, 4), clampInt(e[6], 0, 255));
      rp.hp = clampNum(e[7], -1000, 1e5, 20); rp.alive = rp.hp > 0; rp.team = cleanTeam(e[8]); rp.item = cleanItem(e[9]);
    }
  }
  _guestClosed(why, byHost) {
    if (this.role !== 'guest' || this._closedFlag || this._rejoining) return;
    if (!byHost && !this._left && this.rejoin && !this._rejoining) { this._reconnect(why); return; }
    this._closedFlag = true;
    const link = this.link; this.link = null;
    if (link && !byHost) link.close(why); else if (link) setTimeout(() => link.close(why), 100);
    this.events.emit('net:closed', { reason: why, text: reasonText(why === 'channel-closed' || why === 'connection-lost' || why === 'peer-closed' ? 'host-left' : why) });
  }

  /** The link dropped (not kicked, not a host goodbye): try the room code again a few times and resume in place. Only for room-code joins. */
  async _reconnect(why) {
    this._rejoining = true;
    const old = this.link; this.link = null; if (old) { try { old.close(why); } catch { /* closed */ } }
    this._chatSys('Conexão perdida. Tentando reconectar…'); this.events.emit('net:reconnecting', { reason: why });
    for (let attempt = 1; attempt <= 3 && !this._left; attempt++) {
      await new Promise((r) => setTimeout(r, 900 * attempt));
      try {
        const tr = await this.rejoin.connect();
        const prevId = this.localId; this._closedFlag = false;
        const w = await this.join(tr, { id: prevId, timeoutMs: 20000, rejoin: true });
        this.sync.resume(w); this._rejoining = false;
        this._chatSys('Reconectado!'); this.events.emit('net:reconnected', { attempt }); return;
      } catch (e) { console.warn('[HZ] reconnect attempt ' + attempt + ' failed:', e && e.message); }
    }
    this._rejoining = false; this._closedFlag = false; this._guestClosed(why, true);
  }

  // ------------------------------------------------------------------------------------------------ dome
  _domeSet(mode) {
    if (mode !== 'closed' && mode !== 'open' && mode !== 'invite') return;
    if (this.role === 'guest') return;
    if (mode === 'closed') { this.stopHosting(); return; }
    if (this.role === 'solo') { this.startHosting({ mode }).catch((e) => { console.warn('[HZ] startHosting failed:', e); if (this.ctx) this.ctx.ui.toast(e.message); }); return; }
    this.dome.mode = mode; this.hostInfo.mode = mode; this.ctx.planet.domeMode = mode;
    this._toAll({ t: 'dome', mode, perms: this.dome.perms }); this.events.emit('dome:change', { mode });
  }
  _setPerm(k, v) {
    if (this.role === 'guest' || !(k in this.dome.perms)) return;
    this.dome.perms[k] = !!v;
    if (this.role === 'host') this._toAll({ t: 'dome', mode: this.dome.mode, perms: this.dome.perms });
    this.events.emit('dome:perms', { perms: { ...this.dome.perms } });
  }
  _applyPerms(p) { if (!p || typeof p !== 'object') return; for (const k of Object.keys(this.dome.perms)) if (k in p) this.dome.perms[k] = !!p[k]; this.events.emit('dome:perms', { perms: { ...this.dome.perms } }); }

  // ------------------------------------------------------------------------------------------------ plumbing
  _gSend(obj, reliable = true) { if (this.link) this.link.send(obj, reliable); }
  _pSend(p, obj, reliable = true) { p.link.send(obj, reliable); }
  /** @param {string|string[]} except  peer id(s) to skip */
  _toAll(obj, reliable = true, except) {
    if (!this.peers.size) return;
    const s = JSON.stringify(obj), ex = Array.isArray(except) ? except : [except];
    for (const p of this.peers.values()) if (!ex.includes(p.id)) p.link.send(s, reliable);
  }
  _dispatch(type, data, from) {
    if (!this.ctx || !this.ctx.ready) { if (this._early.length < 300) this._early.push([type, data, from]); return; }
    const s = this._h.get(type); if (!s) return;
    for (const fn of [...s]) { try { fn(data, from); } catch (e) { console.error('[HZ] net handler "' + type + '" failed:', e); } }
  }
  /** called once every feature finished init: replay what arrived while the world was loading */
  flushEarly() { const q = this._early; this._early = []; for (const [t, d, f] of q) this._dispatch(t, d, f); }
  _chatIn(rec) { rec.ts = Date.now(); this.chatLog.push(rec); if (this.chatLog.length > 120) this.chatLog.shift(); this.events.emit('net:chat', rec); }
  _chatSys(text) { this._chatIn({ id: '', name: '', color: '#9db0d9', text, sys: true }); }

  // ------------------------------------------------------------------------------------------------ per-frame
  attach(ctx) {
    this.ctx = ctx; this.sync = new Sync(this, ctx);
    this._bye = () => { if (this.role === 'host') for (const p of this.peers.values()) this._pSend(p, { t: 'kick', reason: 'host-left' }); else if (this.role === 'guest') this._gSend({ t: 'bye' }); };
    addEventListener('pagehide', this._bye); const q = this._pre; this._pre = []; for (const m of q) this._guestMsg(m); }

  /** idle (returns immediately) while solo */
  tick(dt) {
    if (this.role === 'solo') return;
    const now = performance.now(), a = this._acc, host = this.role === 'host', ms = dt * 1000;
    for (const k in a) a[k] += ms;
    for (const rp of this.players.values()) rp.update(now, dt);
    this.sync.frame(dt);
    if (a.edit >= EDIT_FLUSH_MS) { a.edit = 0; this.sync.flushEdits(); }
    if (a.pos >= POS_MS) { a.pos = 0; host ? this._hostSnap() : this._guestPos(); }
    if (a.ls >= 250) { a.ls = 0; this._sendExtra(); }
    if (a.ping >= PING_MS) { a.ping = 0; this._pings(now); }
    if (host) {
      if (a.roster >= ROSTER_MS) { a.roster = 0; this._toAll({ t: 'roster', players: [...this.peers.values()].map((p) => this._info(p.rp)).concat([{ ...this._hostEntry() }]) }); }
      if (a.time >= TIME_MS) { a.time = 0; this._toAll({ t: 'time', h: r3(this.sync.hours()), s: this.sync.timeSpeed() }); }
      if (a.wx >= 1000) { a.wx = 0; this.sync.pollWeather(); }
    }
    if (a.stats >= 1000) { a.stats = 0; this._publishStats(); }
  }

  _hostEntry() { const l = this.ctx.localState; return { id: this.localId, name: this.identity.name, color: this.identity.color, ping: 0, hp: l.hp, team: l.team, item: l.item }; }

  _guestPos() { if (this.link) this.link.send({ t: 'pos', p: this.sync.pose() }, false); }

  _hostSnap() {
    if (!this.peers.size) return;
    const ents = [], me = this.sync.pose(); me.unshift(this.localId); ents.push([JSON.stringify(me), this.localId]);
    for (const p of this.peers.values()) {
      const rp = p.rp, r = p.raw; if (!rp.hasPos) continue;
      ents.push([JSON.stringify([p.id, r2(r[0]), r2(r[1]), r2(r[2]), r3(r[3]), r3(r[4]), r[5], rp.hp, rp.team, rp.item]), p.id]);
    }
    for (const p of this.peers.values()) {
      let s = '{"t":"snap","s":['; let first = true;
      for (const [j, id] of ents) if (id !== p.id) { s += (first ? '' : ',') + j; first = false; }
      p.link.send(s + ']}', false);
    }
  }

  _sendExtra() {
    const x = this.ctx.localState.extra; let j; try { j = JSON.stringify(x === undefined ? {} : x); } catch { return; }
    if (j === this._lastExtra || j.length > 600) return;
    this._lastExtra = j;
    if (this.role === 'guest') this._gSend({ t: 'ls', x: JSON.parse(j) }); else this._toAll({ t: 'ls', id: this.localId, x: JSON.parse(j) });
  }

  _pings(now) {
    if (this.role === 'guest') { this._gSend({ t: 'ping', n: now }); if (this.link && now - this.link.lastSeen > TIMEOUT_MS) this._guestClosed('connection-lost'); return; }
    for (const p of [...this.peers.values()]) {
      this._pSend(p, { t: 'ping', n: now });
      if (now - p.link.lastSeen > TIMEOUT_MS) { p.link.close('timeout'); this._dropPeer(p, 'timeout'); }
    }
  }

  _publishStats() {
    let bi = 0, bo = 0, mi = 0, mo = 0;
    const L = this.role === 'guest' ? [this.link] : [...this.peers.values()].map((p) => p.link);
    for (const l of L) if (l) { bi += l.bytesIn; bo += l.bytesOut; mi += l.msgIn; mo += l.msgOut; }
    const sb = this._sb, st = this.stats;
    st.role = this.role; st.peers = this.players.size; st.inBps = Math.max(0, bi - sb.in); st.outBps = Math.max(0, bo - sb.out); st.msgIn = Math.max(0, mi - sb.mi); st.msgOut = Math.max(0, mo - sb.mo); st.ping = this.latency();
    sb.in = bi; sb.out = bo; sb.mi = mi; sb.mo = mo;
    this.events.emit('net:stats', st);
  }

  dispose() { if (this._bye) removeEventListener('pagehide', this._bye); if (this.role === 'host') this.stopHosting(); else this.leave(); if (this.sync) this.sync.dispose(); }
}
