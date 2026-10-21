// Session: glues the pure GameRuntime to the live game (ctx). One Session exists per feature instance; it is idle (and free) until a game starts.
//  * authority (solo/host): owns the GameRuntime, applies effects locally, sends effects + compact state to guests (<= 5 Hz).
//  * guest: receives the game code, state and effects over ctx.net; runs no game logic; enforces the same block permissions locally.
import { GameRuntime } from './runtime.js';
import { exportCode, importCode } from './codec.js';
import { MgHud } from './hud.js';
import { getBest, recordBest } from './store.js';
import { EntityView, lowEnd } from './view3d.js';

const SND = { ding: [[880, 0.07], [1320, 0.12]], win: [[523, 0.1], [659, 0.1], [784, 0.1], [1047, 0.28]], lose: [[392, 0.16], [330, 0.16], [262, 0.34]], tick: [[660, 0.06]], boom: [[110, 0.3, 'sawtooth']], jump: [[440, 0.06], [700, 0.09]] };
const REMOTE_FX = new Set(['tp', 'vel', 'msg', 'title', 'sound', 'give', 'loadout', 'clear', 'spec', 'team', 'respawn', 'damage', 'heal', 'kill', 'spawnpoint', 'end']);
const nullHost = { fx() {}, listPlayers: () => [], getBlock: () => 0, setBlock() {} };

export class Session {
  constructor(ctx) {
    this.ctx = ctx; this.rt = null; this.def = null; this.guest = false; this.hud = null; this.view = new EntityView(ctx); this.offs = []; this.code = ''; this.rv = null;
    this.localId = (ctx.net && ctx.net.localId) || ctx.identity.id; this._rec = new Map(); this._list = []; this._repAt = 0; this._repRev = -1; this._hudRev = -1; this._hudAt = 0;
    this.onChange = null; this.resultsPanel = null; this.warned = new Set(); this._reverting = false;
    const net = ctx.net;
    if (net && net.on) {
      // only guests listen: the authority never obeys incoming mg:* messages (a guest could otherwise push a hostile game or effects onto the host)
      net.on('mg:start', (d) => { if (!this.isAuthority) this._guestStart(d); }); net.on('mg:state', (d) => { if (!this.isAuthority) this._guestState(d); });
      net.on('mg:fx', (d) => { if (!this.isAuthority && d && typeof d.t === 'string' && d.d && typeof d.d === 'object') { try { this.applyFx(d.t, d.d); } catch (e) { console.warn('[mg] bad fx', e); } } });
      net.on('mg:stop', () => { if (!this.isAuthority) this._guestStop(); });
      if (net.registerSnapshot) net.registerSnapshot('mg', { get: () => (this.rt && !this.guest && this.code ? { code: this.code, view: this.rt.view() } : null), set: (d) => { if (d && d.code) this._guestStart(d); } });
    }
    ctx.events.on('net:peerJoin', (e) => { if (this.rt && !this.guest && this.code) this._sendStartTo(e && e.peer && e.peer.id ? e.peer.id : null); });
  }

  get isAuthority() { return !this.ctx.net || this.ctx.net.isAuthority !== false; }
  get active() { return !!this.rt; }
  /** 'idle'|'lobby'|'countdown'|'running'|'ended' */
  get state() { return this.rt ? (this.guest ? (this.rv ? this.rv.ph : 'lobby') : this.rt.phase) : 'idle'; }
  teamOf(id) { if (!this.rt) return null; if (this.guest) { const r = this.rv && this.rv.p.find((x) => x[0] === id); return r ? r[2] || null : null; } const p = this.rt.players.get(id); return p ? p.team || null : null; }

  // ------------------------------------------------------------------ authority
  /** Starts `def` (already validated) for everybody in the world. */
  start(def, opts = {}) {
    if (!this.isAuthority) { this.ctx.ui.toast('Só o anfitrião pode iniciar minigames'); return false; }
    this.stop(true);
    this.def = def; this.guest = false;
    this.rt = new GameRuntime(def, this._host(), { blocksPerTick: lowEnd(this.ctx) ? 500 : 1200, rebuild: opts.rebuild !== false });
    this._attach(def);
    this.rt.open(); if (!opts.lobby) this.rt.start(); else this.ctx.ui.toast('Sala aberta — aguarde os jogadores e aperte Y para começar');
    this._pushView(true);
    exportCode(def).then((c) => { this.code = c; this._sendStartTo(null); }).catch(() => {});
    if (def.meta.minPlayers > this.rt.players.size) this.ctx.ui.toast(`Este jogo é melhor com ${def.meta.minPlayers}+ jogadores`);
    if (this.onChange) this.onChange(); this.ctx.events.emit('mg:start', { name: def.meta.name });
    return true;
  }

  /** lobby -> countdown (host/solo) */
  begin() { if (this.rt && !this.guest && this.rt.phase === 'lobby') { this.rt.start(); this._pushView(); } }

  restart() { if (this.rt && !this.guest) { if (this.resultsPanel) { this.resultsPanel.close(); this.resultsPanel = null; } this.rt.stop(); this.rt.start(); this._pushView(true); } }

  stop(silent) {
    const had = !!this.rt;
    if (this.rt && !this.guest) { this.rt.stop(); const n = this.ctx.net; if (n && n.broadcast && n.role !== 'solo') n.broadcast('mg:stop', {}); }
    this._detach(); this.rt = null; this.def = null; this.code = ''; this.rv = null;
    if (had && !silent) { this.ctx.events.emit('mg:stop', {}); }
    if (had && this.onChange) this.onChange();
  }

  _sendStartTo(to) {
    const n = this.ctx.net; if (!n || n.role === 'solo' || !n.isAuthority || !this.code) return;
    const msg = { code: this.code, view: this.rt.view() };
    if (to) n.send('mg:start', msg, { to }); else n.broadcast('mg:start', msg);
  }

  _host() {
    const S = this, ctx = this.ctx;
    return {
      localId: this.localId,
      listPlayers() {
        const out = S._list; out.length = 0; const pl = ctx.player, hp = ctx.health;
        let r = S._rec.get(S.localId); if (!r) S._rec.set(S.localId, r = { id: S.localId, name: ctx.identity.name, x: 0, y: 0, z: 0, alive: true, has: (item) => !!(ctx.inventory && ctx.inventory.has && ctx.inventory.has(S._resolveItem(item) || item)) });
        r.x = pl.x; r.y = pl.y; r.z = pl.z; r.alive = hp ? hp.alive !== false : true; r.name = ctx.identity.name; out.push(r);
        if (ctx.net && ctx.net.players) for (const p of ctx.net.players.values()) {
          let q = S._rec.get(p.id); if (!q) S._rec.set(p.id, q = { id: p.id, name: p.name, x: 0, y: 0, z: 0, alive: true, has: null });
          q.x = p.pos.x; q.y = p.pos.y; q.z = p.pos.z; q.alive = p.alive !== false; q.name = p.name || p.id; out.push(q);
        }
        return out;
      },
      getBlock: (x, y, z) => ctx.world.getBlock(x, y, z),
      setBlock: (x, y, z, id) => { if (ctx.world.getBlock(x, y, z) !== id) ctx.world.applyEdit(x, y, z, id, 'game'); },
      fx(ids, type, data) {
        const lid = S.localId;
        if (ids === null || ids.includes(lid)) { try { S.applyFx(type, data); } catch (e) { console.error('[mg] fx failed', type, e); } }
        const n = ctx.net; if (!n || n.role === 'solo' || !n.isAuthority || !REMOTE_FX.has(type)) return;
        if (ids === null) n.broadcast('mg:fx', { t: type, d: data }); else for (const id of ids) if (id !== lid) n.send('mg:fx', { t: type, d: data }, { to: id });
      },
    };
  }

  // ------------------------------------------------------------------ guest
  async _guestStart(d) {
    if (!d || typeof d.code !== 'string' || this.isAuthority && this.rt) return;
    if (this.guest && this.rt && this.code === d.code) { if (d.view) this._guestState(d.view); return; }
    try {
      const { def } = await importCode(d.code);
      if (this.rt) this.stop(true);
      this.def = def; this.guest = true; this.code = d.code; this.rt = new GameRuntime(def, nullHost); this.rv = d.view || null;
      if (this.rv) this.rt.phase = this.rv.ph;
      this._attach(def); if (this.rv) this._guestState(this.rv);
      if (this.onChange) this.onChange(); this.ctx.events.emit('mg:start', { name: def.meta.name });
    } catch (e) { console.warn('[mg] bad game from host:', e.message); }
  }
  _guestState(v) {
    if (!this.guest || !this.rt || !v || !Array.isArray(v.p) || !Array.isArray(v.ts)) return;
    v.p = v.p.slice(0, 64).filter((r) => Array.isArray(r) && r.length >= 9); v.ts = v.ts.slice(0, 8);
    if (v.v && typeof v.v === 'object') { const o = {}; for (const k of Object.keys(v.v).slice(0, 16)) o[k] = +v.v[k] || 0; v.v = o; } else v.v = {};
    if (!['lobby', 'countdown', 'running', 'ended', 'idle'].includes(v.ph)) return;
    this.rv = v; this.rt.phase = v.ph; this.hud.setView(v, this.def);
    if (v.ph === 'countdown' && this.resultsPanel) { this.resultsPanel.close(); this.resultsPanel = null; }
    if (v.ph !== this._mph) { this._mph = v.ph; this._markers(); }
    if (this.onChange) this.onChange();
  }
  _guestStop() { if (this.guest) { this.stop(true); this.ctx.events.emit('mg:stop', {}); } }

  // ------------------------------------------------------------------ shared plumbing
  _attach(def) {
    const ctx = this.ctx, judge = () => this.rt;
    this._gen = (this._gen || 0) + 1;
    this.hud = new MgHud(ctx.ui, this.localId);
    if (!this._ret) this._ret = { x: ctx.player.x, y: ctx.player.y, z: ctx.player.z };       // where to put the player when the game is over
    for (const a of ['break', 'place', 'pvp', 'explode']) this.offs.push(ctx.permissions.add(a, (info) => (judge() && judge().allows(a, info || {}) && !(this._spec && (a === 'break' || a === 'place')) ? undefined : false)));
    this.offs.push(ctx.events.on('world:blockSet', (e) => this._onBlock(e)));
    this.offs.push(ctx.events.on('player:die', (e) => { if (this.rt && !this.guest) this.rt.playerDied(this.localId, this._srcId(e && e.src)); }));
    this.offs.push(ctx.events.on('item:use', (e) => { if (this.rt && !this.guest && e && typeof e.id === 'string') this.rt.itemUsed(this.localId, e.id); }));
    this._markers(); this._hudRev = -1;
  }
  _detach() {
    this._gen = (this._gen || 0) + 1;
    for (const o of this.offs) try { o(); } catch { /* ignore */ }
    this.offs.length = 0;
    if (this.hud) { this.hud.dispose(); this.hud = null; }
    this.view.hide(); if (this.resultsPanel) { this.resultsPanel.close(); this.resultsPanel = null; }
    const c = this.ctx; if (c.localState) c.localState.team = null;
    if (this._ret && c.player) { const r = this._ret; if (Math.hypot(c.player.x - r.x, c.player.z - r.z) > 3) c.player.teleport(r.x, r.y + 0.5, r.z); }
    this._ret = null; this._restoreHotbar();
    if (c.player && this._spec) { this._spec = false; c.player.flying = false; c.ui.setFly(false); }
  }
  _markers() {
    if (!this.def) return;
    const tc = (id) => { const t = this.def.meta.teams.find((x) => x.id === id); return t && t.color; };
    this.view.show('play', this.def, { teamColor: tc });
  }
  /** killer id from a damage source ({kind:'player', by:name|id}); names are resolved against the players of this round */
  _srcId(src) {
    const c = src && typeof src === 'object' ? src.id || src.by : src; if (typeof c !== 'string' || !this.rt) return null;
    if (this.rt.players.has(c)) return c;
    for (const p of this.rt.players.values()) if (p.name === c) return p.id;
    return null;
  }

  _onBlock(e) {
    if (!this.rt || this._reverting || e.source === 'game') return;
    const ph = this.state; if (ph !== 'running' && ph !== 'countdown') return;
    const ctx = this.ctx;
    if (e.source === 'local') {                                           // fallback guard even if the items layer did not consult permissions
      const act = e.id === 0 ? 'break' : 'place';
      if (!ctx.permissions.can(act, { x: e.x, y: e.y, z: e.z, id: e.id, by: this.localId })) { this._reverting = true; try { ctx.world.applyEdit(e.x, e.y, e.z, e.prev, 'game'); } finally { this._reverting = false; } return; }
    }
    if (e.id === 0 && !this.guest) this.rt.blockBroken(e.x, e.y, e.z, e.source === 'local' ? this.localId : e.by || null);
  }

  // ------------------------------------------------------------------ per-frame (cheap; nothing when idle)
  update(dt) {
    if (!this.rt) return;
    const now = performance.now();
    if (!this.guest) {
      try { this.rt.update(dt); } catch (e) { console.error('[mg] runtime error, game stopped:', e); this.ctx.ui.toast('Erro no minigame — jogo encerrado'); this.stop(); return; }
      if (this.rt.phase === 'lobby' && this.def && this.rt.players.size >= this.def.meta.maxPlayers && this.rt.players.size > 1) this.begin();
      if (this.rt.rev !== this._hudRev || now - this._hudAt > 400) { this._hudRev = this.rt.rev; this._hudAt = now; this._pushView(false); }
      const n = this.ctx.net;
      if (n && n.role !== 'solo' && n.isAuthority && (now - this._repAt > 200)) {
        if (this.rt.rev !== this._repRev || now - this._repAt > 1000) { this._repRev = this.rt.rev; this._repAt = now; n.broadcast('mg:state', this.rt.view()); }
      }
    }
    this.view.update(dt);
    if (this.hud) this.hud.tick(now);
  }

  _pushView() { const v = this.rt.view(); this.rv = v; if (this.hud) this.hud.setView(v, this.def); if (this.onChange) this.onChange(); }

  // ------------------------------------------------------------------ local effects (also used for effects sent by the authority)
  applyFx(type, d) {
    const ctx = this.ctx, pl = ctx.player, N = (v, lim = 3e7) => (Number.isFinite(+v) ? Math.max(-lim, Math.min(lim, +v)) : 0);
    if (type === 'tp' || type === 'spec') { d = Object.assign({}, d, { x: N(d.x), y: Math.max(-64, N(d.y, 400)), z: N(d.z) }); }
    if (type === 'vel') d = { boost: N(d.boost, 60), y: N(d.y, 60) };
    if (type === 'damage' || type === 'heal') d = { amount: Math.max(0, N(d.amount, 100)) };
    if (type === 'msg' || type === 'title') d = { text: String(d.text || '').slice(0, 120), sub: String(d.sub || '').slice(0, 120), kind: ['count', 'go', 'info', 'end'].includes(d.kind) ? d.kind : 'info' };
    switch (type) {
      case 'tp': if (!this._ret) this._ret = { x: pl.x, y: pl.y, z: pl.z }; if (pl.flying && !this._spec) { pl.flying = false; ctx.ui.setFly(false); } pl.teleport(d.x, d.y, d.z); pl.vy = 0; break;
      case 'vel':
        if (d.boost) { const s = Math.sin(pl.yaw), c = Math.cos(pl.yaw); pl.vx = -s * d.boost; pl.vz = -c * d.boost; pl.vy = d.y || 0; pl.onGround = false; }
        else { pl.vy = d.y; pl.onGround = false; } break;
      case 'msg': ctx.ui.toast(String(d.text || '')); break;
      case 'title': if (this.hud) this.hud.title(String(d.text || ''), String(d.sub || ''), d.kind); break;
      case 'sound': this._beep(d.name); break;
      case 'give': this._give(d.item, d.count); break;
      case 'loadout': this._loadout(d.items); break;
      case 'clear': this._restoreHotbar(); break;
      case 'spec':
        this._spec = !!d.on;
        if (d.on) { pl.flying = true; ctx.ui.setFly(true); pl.teleport(d.x, d.y, d.z); if (this.hud) this.hud.setSpectator(true); } else { if (this.hud) this.hud.setSpectator(false); if (pl.flying) { pl.flying = false; ctx.ui.setFly(false); } }
        break;
      case 'team': ctx.localState.team = d.team || null; break;
      case 'respawn': if (ctx.health && ctx.health.alive === false && ctx.health.respawn) ctx.health.respawn(); break;
      case 'damage': if (ctx.health && ctx.health.damage) ctx.health.damage(d.amount, 'minigame'); break;
      case 'heal': if (ctx.health && ctx.health.heal) ctx.health.heal(d.amount); break;
      case 'kill': if (ctx.health && ctx.health.kill) ctx.health.kill(); break;
      case 'spawnpoint': if (ctx.health) ctx.health.spawnPoint = new ctx.THREE.Vector3(d.x, d.y, d.z); break;
      case 'end': if (this.hud && d.results) this._showResults(d.results); break;
      default: break;
    }
  }

  _showResults(res) {
    const canRestart = !this.guest, gen = this._gen, me = res.rows.find((r) => r.id === this.localId);
    let note = '';
    if (me && me.time != null && this.def) { const best = getBest(this.def.meta.name); note = recordBest(this.def.meta.name, me.time) ? '🏅 Novo recorde pessoal!' : `Seu recorde: ${best.toFixed(1)}s`; }
    setTimeout(() => {
      if (!this.hud || !this.def || gen !== this._gen || this.state !== 'ended') return;
      this.resultsPanel = this.hud.showResults(res, this.def, canRestart, { again: () => this.restart(), close: () => this.stop() }, note);
    }, 1800);
  }

  _resolveItem(id) {
    const it = this.ctx.items; if (!it || !id) return null;
    if (it.get(id)) return id;
    const low = id.toLowerCase(); for (const d of it.all()) if (d.id.toLowerCase().includes(low) || (d.name && d.name.toLowerCase().includes(low))) return d.id;
    if (!this.warned.has(id)) { this.warned.add(id); console.warn('[mg] item desconhecido, ignorado:', id); }
    return null;
  }
  _give(item, count) { const inv = this.ctx.inventory, id = this._resolveItem(item); if (inv && id) inv.give(id, count || 1); }
  _loadout(list) {
    const inv = this.ctx.inventory; if (!inv || !Array.isArray(list)) return;
    const entries = [];
    for (const l of list) { const id = this._resolveItem(l.item); if (id) entries.push({ id, n: l.count || 1 }); }
    if (!entries.length) return;
    try {
      if (!this._hb) this._hb = { slots: inv.slots ? inv.slots.slice() : null, counts: inv.counts ? inv.counts.slice() : null, sel: inv.sel | 0 };   // restored when the game ends
      if (inv.setLoadout) inv.setLoadout(entries); else entries.forEach((e) => inv.give(e.id, e.n));
      if (inv.lock) inv.lock(true);
    } catch (e) { console.warn('[mg] loadout failed', e); }
  }
  /** Puts the player's own hotbar back after a loadout round. */
  _restoreHotbar() {
    const inv = this.ctx.inventory, b = this._hb; this._hb = null;
    if (!inv) return;
    try {
      if (inv.lock) inv.lock(false);
      if (b && b.slots && inv.setLoadout) { inv.setLoadout(b.slots.map((id, i) => (id === null || id === undefined ? null : { id, n: b.counts ? b.counts[i] || 1 : 1 }))); this.ctx.hotbar.sel = b.sel; this.ctx.ui.setHotbar(this.ctx.hotbar.slots, b.sel, false); }
    } catch (e) { console.warn('[mg] hotbar restore failed', e); }
  }

  _beep(name) {
    const a = this.ctx.audio, ac = a && a.ctx; if (!ac || a.muted || !a.master || !SND[name]) return;
    try {
      let t = ac.currentTime;
      for (const [f, dur, type] of SND[name]) {
        const o = ac.createOscillator(), g = ac.createGain(); o.type = type || 'square'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(a.master); o.start(t); o.stop(t + dur + 0.02); t += dur * 0.9;
      }
    } catch { /* audio is optional */ }
  }
}
