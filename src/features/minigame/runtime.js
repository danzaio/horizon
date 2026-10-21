// GameRuntime: the minigame simulation. Runs ONLY on the authority (solo or host). Pure logic: no DOM, no THREE, everything that touches the
// world or the players goes through the `host` adapter (see index.js; node tests use a fake host). Idle cost: zero (nothing ticks until start()).
//
// host = {
//   localId, listPlayers() -> [{id,name,x,y,z,alive,has?(itemId)}],  // feet position; cached records are fine
//   fx(ids|null, type, data),                                   // tp vel msg title sound give loadout clear spec team respawn damage heal kill spawnpoint  (null = everybody)
//   getBlock(x,y,z), setBlock(x,y,z,blockId),
// }
import { LIMITS, entityBox, materialId } from './schema.js';

const TICK = 1 / 15;
const EVENT_QUEUE_MAX = 600, BLOCK_QUEUE_MAX = 500000, ROUND_BLOCKS_MAX = 600000;   // pending queue cap / total blocks one round may place (a hostile game cannot bloat the world save)
const cmp = (op, a, b) => (op === '>=' ? a >= b : op === '>' ? a > b : op === '==' ? a === b : op === '!=' ? a !== b : op === '<=' ? a <= b : a < b);

export class GameRuntime {
  /** @param {object} def validated GameDef @param {object} host adapter @param {{blocksPerTick?:number, rebuild?:boolean}} [opts] */
  constructor(def, host, opts = {}) {
    this.def = def; this.host = host; this.opts = Object.assign({ blocksPerTick: LIMITS.blocksPerTick, rebuild: true }, opts);
    this.phase = 'idle'; this.players = new Map(); this.elapsed = 0; this.cd = 0; this.acc = 0; this.rev = 0;
    this.teamScore = {}; this.vars = {}; this.results = null; this.winner = null; this.ending = null;
    this.timers = []; this.queue = []; this.blockQ = []; this.blockQN = 0; this.roundBlocks = 0; this.crumbles = []; this.crumbleSet = new Set();
    this.flags = new Map(); this.zones = new Map(); this.finishers = 0; this.fired = new Set(); this.acts = 0; this._tmp = [];
    this._build();
  }

  _build() {
    const d = this.def, ents = d.entities;
    this.ent = new Map(); this.box = new Map(); this.byType = {};
    for (const e of ents) { this.ent.set(e.id, e); this.box.set(e.id, entityBox(d, e, [])); (this.byType[e.type] ||= []).push(e); }
    this.rulesBy = new Map();
    for (const r of d.rules) { let a = this.rulesBy.get(r.when.ev); if (!a) this.rulesBy.set(r.when.ev, a = []); a.push(r); }
    this.checkpoints = (this.byType.checkpoint || []).slice().sort((a, b) => a.p.order - b.p.order);
    this.crumbleAreas = (this.byType.area || []).filter((a) => a.p.crumble > 0);
    this.active = ents.filter((e) => ['goal', 'checkpoint', 'killzone', 'trigger', 'pad', 'itemGiver', 'button', 'sign', 'flag', 'zone'].includes(e.type) || this.rulesBy.has('playerEnter') || this.rulesBy.has('playerExit'));
    this.tickRules = (this.rulesBy.get('tick') || []).map((r) => ({ r, next: r.when.every }));
    this.useTouch = this.rulesBy.has('playersTouch');
    this.teams = d.meta.teams;
  }

  // ------------------------------------------------------------------ lifecycle
  /** lobby: players can join; nothing is simulated. */
  open() { this.phase = 'lobby'; this.rev++; }

  addPlayer(id, name) {
    if (this.players.has(id)) return this.players.get(id);
    const p = { id, name: name || id, team: '', score: 0, lives: this.def.meta.lives, alive: true, spectator: false, dead: false, respawnAt: 0, cpOrder: 0, cpDone: 0, spOrder: 0, sp: null, lap: 1, finished: false, finishT: 0,
      carrying: '', inside: new Set(), cool: new Map(), deaths: 0, kills: 0, x: 0, y: 0, z: 0, reached: new Set(), rec: null };
    this.players.set(id, p); this.rev++;
    if (this.phase === 'running' || this.phase === 'countdown') { this._assignTeam(p); this._spawn(p, true); this._equip(p); }
    return p;
  }
  removePlayer(id) { const p = this.players.get(id); if (!p) return; this._dropFlag(p); this.players.delete(id); this.rev++; }

  /** lobby -> countdown. Rebuilds arena/areas/doors first (the countdown waits for the block queue). */
  start() {
    if (this.phase === 'countdown' || this.phase === 'running') return;
    const d = this.def, M = d.meta;
    this._sync();
    this.elapsed = 0; this.results = null; this.winner = null; this.ending = null; this.finishers = 0; this.teamScore = {}; this.vars = Object.assign({}, d.vars);
    this.roundBlocks = 0; this.timers.length = 0; this.queue.length = 0; this.fired.clear(); this.crumbles.length = 0; this.crumbleSet.clear(); this.blockQ.length = 0; this.blockQN = 0;
    for (const t of this.teams) this.teamScore[t.id] = 0;
    this.flags.clear(); for (const f of this.byType.flag || []) this.flags.set(f.id, { carrier: '' });
    this.zones.clear(); for (const z of this.byType.zone || []) this.zones.set(z.id, { acc: 0, owner: '' });
    for (const t of this.tickRules) t.next = t.r.when.every;
    if (this.opts.rebuild) this._rebuildWorld();
    let i = 0;
    for (const p of this.players.values()) { Object.assign(p, { score: 0, lives: M.lives, alive: true, spectator: false, dead: false, respawnAt: 0, cpOrder: 0, cpDone: 0, spOrder: 0, sp: null, lap: 1, finished: false, finishT: 0, carrying: '', deaths: 0, kills: 0, rec: null }); p.inside.clear(); p.cool.clear(); p.reached.clear(); p.order = i++; }
    if (M.mode === 'teams') { if (M.teamStart === 'first') for (const p of this.players.values()) { p.team = this.teams[0].id; this.host.fx([p.id], 'team', { team: p.team }); } else this._balanceTeams(); } else for (const p of this.players.values()) { p.team = ''; this.host.fx([p.id], 'team', { team: '' }); }
    for (const p of this.players.values()) { this._spawn(p, true); this._equip(p); }
    this.host.fx(null, 'spec', { on: false });
    this.phase = 'countdown'; this.cd = M.countdown; this._lastCd = -1; this.acc = 0; this.rev++;
    this.host.fx(null, 'phase', { phase: 'countdown' });
  }

  stop() {
    if (this.phase === 'idle') return;
    this.phase = 'idle'; this.queue.length = 0; this.rev++;
    this.host.fx(null, 'phase', { phase: 'idle' }); this.host.fx(null, 'spec', { on: false }); this.host.fx(null, 'clear', { loadout: true });
  }

  /** Called every frame by the feature (dt in seconds). Does nothing when idle/lobby. */
  update(dt) {
    if (this.phase === 'idle') return;
    this.acc += Math.min(dt, 0.25);
    let n = 0;
    while (this.acc >= TICK && n++ < 4) { this.acc -= TICK; if (this.phase === 'lobby') this._sync(); else this._tick(TICK); }
  }

  _tick(dt) {
    this._sync();
    if (this.phase === 'countdown') return this._tickCountdown(dt);
    if (this.phase === 'ended') { this.pumpBlocks(); return; }
    this.acts = 0; this.elapsed += dt;
    this._pollDeaths();
    this._players();
    this._world(dt);
    this._timers();
    this.pumpBlocks();
    this._flush();
    this._checkEnd();
  }

  _tickCountdown(dt) {
    this.pumpBlocks();
    if (this.blockQ.length) return;                                    // arena is still being rebuilt
    const M = this.def.meta;
    for (const p of this.players.values()) if (p.sp && !p.spectator && this._dist2(p, p.sp) > 9 && (p.holdT = (p.holdT || 0) - dt) <= 0) { p.holdT = 0.6; this._teleportTo(p, p.sp); }   // hold at the start line
    const before = Math.ceil(this.cd); this.cd -= dt; const now = Math.ceil(this.cd);
    if (now !== before && now > 0 && now !== this._lastCd) { this._lastCd = now; this.host.fx(null, 'title', { text: String(now), sub: '', kind: 'count' }); this.host.fx(null, 'sound', { name: 'tick' }); }
    if (this.cd <= 0) {
      this.phase = 'running'; this.elapsed = 0; this.rev++;
      this.host.fx(null, 'title', { text: 'VAI!', sub: M.name, kind: 'go' }); this.host.fx(null, 'sound', { name: 'ding' });
      this.host.fx(null, 'phase', { phase: 'running' });
      this._fire('gameStart', {}); this._flush();
    }
  }

  // ------------------------------------------------------------------ players
  _sync() {
    const live = this.host.listPlayers(), seen = this._tmp; seen.length = 0;
    for (const r of live) {
      seen.push(r.id); let p = this.players.get(r.id);
      if (!p) p = this.addPlayer(r.id, r.name);
      p.x = r.x; p.y = r.y; p.z = r.z; p.rec = r;
    }
    for (const id of [...this.players.keys()]) if (!seen.includes(id)) this.removePlayer(id);
  }

  _pollDeaths() {
    for (const p of this.players.values()) {
      if (p.spectator) continue;
      if (p.dead) { if (p.respawnAt && this.elapsed >= p.respawnAt) { p.respawnAt = 0; this._respawn(p); } continue; }
      if (p.rec && p.rec.alive === false) this.playerDied(p.id, null);
    }
  }

  /** Feed a death (from the health system or from the `kill` action). killerId may be null. */
  playerDied(id, killerId) {
    const p = this.players.get(id); if (!p || p.dead || p.spectator || this.phase !== 'running') return;
    p.dead = true; p.deaths++; this._dropFlag(p);
    const k = killerId && killerId !== id ? this.players.get(killerId) : null; if (k) { k.kills++; }
    this._fire('playerDied', { actor: p }); if (k) this._fire('playerKilled', { actor: k, victim: p });
    const M = this.def.meta;
    if (M.lives > 0) { p.lives--; if (p.lives <= 0) { this._eliminate(p); return; } this.host.fx([p.id], 'msg', { text: `Vidas restantes: ${p.lives}` }); }
    else if (M.onDeath === 'eliminate') { this._eliminate(p); return; }
    p.respawnAt = this.elapsed + 1.2;
  }

  _eliminate(p) {
    if (p.spectator) return;
    p.alive = false; p.spectator = true; p.dead = false; p.respawnAt = 0; this._dropFlag(p); this.rev++;
    this.host.fx([p.id], 'spec', { on: true, ...this._center(12) });
    this.host.fx(null, 'msg', { text: `${p.name} foi eliminado` });
  }

  _respawn(p) {
    p.dead = false;
    this.host.fx([p.id], 'respawn', {}); this._teleportTo(p, p.sp || this._spawnPoint(p));
    this.host.fx([p.id], 'sound', { name: 'jump' });
  }

  _assignTeam(p) {
    if (this.def.meta.mode !== 'teams' || !this.teams.length) return;
    const counts = new Map(this.teams.map((t) => [t.id, 0])); for (const q of this.players.values()) if (q !== p && counts.has(q.team)) counts.set(q.team, counts.get(q.team) + 1);
    let best = this.teams[0].id; for (const [id, n] of counts) if (n < counts.get(best)) best = id;
    p.team = best; this.host.fx([p.id], 'team', { team: best });
  }
  _balanceTeams() {
    const list = [...this.players.values()]; for (let i = list.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [list[i], list[j]] = [list[j], list[i]]; }
    list.forEach((p, i) => { p.team = this.teams[i % this.teams.length].id; this.host.fx([p.id], 'team', { team: p.team }); });
  }

  _spawnPoint(p) {
    const sp = this.byType.spawn || [];
    let pool = sp.filter((s) => s.p.team && s.p.team === p.team); if (!pool.length) pool = sp.filter((s) => !s.p.team); if (!pool.length) pool = sp;
    if (!pool.length) { const a = this.def.anchor; return { x: a.x + 0.5, y: a.y + 1, z: a.z + 0.5 }; }
    const b = this.box.get(pool[(p.order || 0) % pool.length].id);
    return { x: (b[0] + b[3]) / 2, y: b[1] + 0.05, z: (b[2] + b[5]) / 2 };
  }
  _spawn(p, first) { p.sp = this._spawnPoint(p); p.spOrder = 0; if (first) this._teleportTo(p, p.sp); }
  _teleportTo(p, pt) { if (!pt) return; p.x = pt.x; p.y = pt.y; p.z = pt.z; this.host.fx([p.id], 'tp', { x: pt.x, y: pt.y, z: pt.z }); }
  _center(lift) {
    const sp = this.byType.spawn || []; let x = 0, y = 0, z = 0;
    if (!sp.length) { const a = this.def.anchor; return { x: a.x, y: a.y + lift, z: a.z }; }
    for (const s of sp) { const b = this.box.get(s.id); x += (b[0] + b[3]) / 2; y = Math.max(y, b[4]); z += (b[2] + b[5]) / 2; }
    return { x: x / sp.length, y: y + lift, z: z / sp.length };
  }
  _equip(p) { const L = this.def.loadout; if (L.length) this.host.fx([p.id], 'loadout', { items: L }); }
  _dist2(p, q) { if (!q) return 0; const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z; return dx * dx + dy * dy + dz * dz; }

  _players() {
    const ents = this.active, P = this.players;
    for (const p of P.values()) {
      if (p.spectator || p.dead) continue;
      const x0 = p.x - 0.3, x1 = p.x + 0.3, y0 = p.y, y1 = p.y + 1.8, z0 = p.z - 0.3, z1 = p.z + 0.3;
      for (let i = 0; i < ents.length; i++) {
        const e = ents[i], b = this.box.get(e.id);
        const inside = x1 > b[0] && x0 < b[3] && y1 > b[1] && y0 < b[4] && z1 > b[2] && z0 < b[5];
        const was = p.inside.has(e.id);
        if (inside && !was) { p.inside.add(e.id); this._enter(p, e); }
        else if (!inside && was) { p.inside.delete(e.id); this._fire('playerExit', { actor: p, entity: e.id }); }
        else if (inside && e.type === 'killzone' && !p.dead) this.playerDied(p.id, null);
        if (p.dead) break;
      }
      if (this.crumbleAreas.length && !p.dead) this._crumbleUnder(p);
    }
    if (this.useTouch) this._touch();
  }

  _enter(p, e) {
    this._fire('playerEnter', { actor: p, entity: e.id });
    const t = e.type, now = this.elapsed;
    if (t === 'goal') this._goal(p, e);
    else if (t === 'checkpoint') this._checkpoint(p, e);
    else if (t === 'killzone') this.playerDied(p.id, null);
    else if (t === 'pad') this._pad(p, e);
    else if (t === 'itemGiver') { if ((p.cool.get(e.id) || 0) <= now) { p.cool.set(e.id, now + e.p.cooldown); if (e.p.item) this.host.fx([p.id], 'give', { item: e.p.item, count: e.p.count }); this.host.fx([p.id], 'sound', { name: 'ding' }); } }
    else if (t === 'button') { if ((p.cool.get(e.id) || 0) <= now) { p.cool.set(e.id, now + e.p.cooldown); this.host.fx([p.id], 'sound', { name: 'tick' }); this._fire('buttonPressed', { actor: p, entity: e.id }); } }
    else if (t === 'sign') { if ((p.cool.get(e.id) || 0) <= now) { p.cool.set(e.id, now + 6); this.host.fx([p.id], 'msg', { text: e.p.text }); } }
    else if (t === 'flag') this._flag(p, e);
  }

  _goal(p, e) {
    const M = this.def.meta;
    if (p.finished) return;
    if (e.p.needCp && p.cpDone < this.checkpoints.length) { if ((p.cool.get(e.id) || 0) <= this.elapsed) { p.cool.set(e.id, this.elapsed + 3); this.host.fx([p.id], 'msg', { text: 'Passe por todos os checkpoints antes!' }); } return; }
    if (p.lap < M.laps) { p.lap++; p.cpOrder = 0; p.cpDone = 0; p.spOrder = 0; this.host.fx([p.id], 'title', { text: `Volta ${p.lap}/${M.laps}`, sub: '', kind: 'info' }); this.host.fx([p.id], 'sound', { name: 'ding' }); this.rev++; return; }
    p.finished = true; p.finishT = this.elapsed; this.finishers++; this.rev++;
    this.host.fx([p.id], 'sound', { name: 'win' });
    this.host.fx(null, 'msg', { text: `${p.name} chegou em ${this.elapsed.toFixed(1)}s!` });
  }

  _checkpoint(p, e) {
    const o = e.p.order;
    if (o === p.cpOrder + 1) { p.cpOrder = o; p.cpDone++; }
    if (o > p.spOrder) {
      p.spOrder = o; const b = this.box.get(e.id); p.sp = { x: (b[0] + b[3]) / 2, y: b[1] + 0.05, z: (b[2] + b[5]) / 2 };
      this.host.fx([p.id], 'msg', { text: `Checkpoint ${o}/${this.checkpoints.length}` }); this.host.fx([p.id], 'sound', { name: 'ding' }); this.host.fx([p.id], 'spawnpoint', p.sp); this.rev++;
    }
  }

  _pad(p, e) {
    if ((p.cool.get(e.id) || 0) > this.elapsed) return; p.cool.set(e.id, this.elapsed + 0.5);
    const k = e.p.kind, pw = e.p.power;
    if (k === 'jump') this.host.fx([p.id], 'vel', { x: 0, y: pw, z: 0, set: 'y' });
    else if (k === 'boost') this.host.fx([p.id], 'vel', { boost: pw, y: Math.min(6, pw * 0.25) });
    else if (k === 'teleport') { const t = this.box.get(e.p.target); if (t) this._teleportTo(p, { x: (t[0] + t[3]) / 2, y: t[1] + 0.05, z: (t[2] + t[5]) / 2 }); }
    this.host.fx([p.id], 'sound', { name: 'jump' });
  }

  _flag(p, e) {
    const st = this.flags.get(e.id); if (!st) return;
    if (!p.team) return;
    if (e.p.team !== p.team) {                                             // enemy flag: pick it up
      if (!st.carrier && !p.carrying) { st.carrier = p.id; p.carrying = e.id; this.host.fx(null, 'msg', { text: `${p.name} pegou a bandeira!` }); this.host.fx(null, 'sound', { name: 'ding' }); this.rev++; }
    } else if (p.carrying) {                                               // own base: capture
      const f = this.flags.get(p.carrying); if (f) f.carrier = ''; p.carrying = '';
      this._addScore(p, 1, 'player'); this.host.fx(null, 'title', { text: 'CAPTURA!', sub: `${p.name} marcou para o time`, kind: 'info' }); this.host.fx(null, 'sound', { name: 'win' }); this.rev++;
    }
  }
  _dropFlag(p) { if (!p.carrying) return; const f = this.flags.get(p.carrying); if (f) f.carrier = ''; p.carrying = ''; this.host.fx(null, 'msg', { text: 'A bandeira voltou para a base' }); this.rev++; }

  _crumbleUnder(p) {
    const y = Math.floor(p.y - 0.08);                                        // the block under the feet
    for (let k = 0; k < 4; k++) {
      const x = Math.floor(p.x + (k & 1 ? 0.28 : -0.28)), z = Math.floor(p.z + (k & 2 ? 0.28 : -0.28));
      const key = x + ',' + y + ',' + z; if (this.crumbleSet.has(key)) continue;
      for (const a of this.crumbleAreas) {
        const b = this.box.get(a.id);
        if (x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]) {
          const id = this.host.getBlock(x, y, z); if (id === 0 || id === 255) break;
          this.crumbleSet.add(key); this.crumbles.push({ t: this.elapsed + a.p.crumble, x, y, z, key }); break;
        }
      }
    }
  }

  _touch() {
    const list = [...this.players.values()].filter((p) => !p.spectator && !p.dead);
    for (let i = 0; i < list.length; i++) for (let j = 0; j < list.length; j++) {
      if (i === j) continue; const a = list[i], b = list[j];
      if (!a.team || !b.team || a.team === b.team) continue;
      const dx = a.x - b.x, dz = a.z - b.z, dy = a.y - b.y; if (dx * dx + dz * dz > 1.44 || Math.abs(dy) > 1.5) continue;
      this._fire('playersTouch', { actor: a, victim: b });
    }
  }

  _world(dt) {
    if (this.crumbles.length) {                                            // TNT Run style floors
      for (let i = this.crumbles.length - 1; i >= 0; i--) {
        const c = this.crumbles[i]; if (c.t > this.elapsed) continue;
        this._queueBlock(c.x, c.y, c.z, c.x, c.y, c.z, 0); this.crumbles.splice(i, 1); this.crumbleSet.delete(c.key);
      }
    }
    for (const [id, st] of this.zones) {                                   // king of the hill
      const z = this.ent.get(id), occ = new Set(); let who = null;
      for (const p of this.players.values()) if (p.inside.has(id) && !p.spectator && !p.dead) { occ.add(p.team || p.id); who = p; }
      if (occ.size !== 1) { st.acc = 0; st.owner = ''; continue; }
      st.owner = who.team || who.id; st.acc += dt;
      if (st.acc >= z.p.hold) { st.acc -= z.p.hold; if (who.team) this._addScore(who, z.p.rate, 'team'); else this._addScore(who, z.p.rate, 'player'); }
    }
    for (const t of this.tickRules) if (this.elapsed >= t.next) { t.next += t.r.when.every; this._fire('tick', { every: t.r.when.every }); }
  }

  _timers() {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i]; if (this.elapsed < t.at) continue;
      if (t.repeat) t.at += t.seconds; else this.timers.splice(i, 1);
      this._fire('timer', { id: t.id });
    }
  }

  // ------------------------------------------------------------------ scoring / end
  _addScore(p, amount, to) {
    if (to !== 'team') p.score += amount;
    if (p.team && this.teamScore[p.team] !== undefined) this.teamScore[p.team] += amount;
    this.rev++;
    const total = to === 'team' && p.team ? this.teamScore[p.team] : p.score;
    this._fire('scoreReached', { actor: p, score: total, key: to === 'team' ? p.team : p.id });
  }

  _alivePlayers() { const out = []; for (const p of this.players.values()) if (p.alive && !p.spectator) out.push(p); return out; }

  _checkEnd() {
    if (this.phase !== 'running') return;
    const M = this.def.meta, W = this.def.win, total = this.players.size;
    if (this.ending) return this._finish(this.ending);
    if (M.timeLimit > 0 && this.elapsed >= M.timeLimit) return this._finish({ reason: 'time' });
    if (total === 0) return;
    switch (W.type) {
      case 'goal': if (this.finishers >= Math.min(W.target, total) || (this.finishers > 0 && this._alivePlayers().every((p) => p.finished))) this._finish({ reason: 'goal' }); break;
      case 'lastAlive': {
        const alive = this._alivePlayers();
        if (M.mode === 'teams') { const ts = new Set(alive.map((p) => p.team)); if (ts.size <= 1 && total > 1) this._finish({ reason: 'lastAlive' }); else if (!alive.length) this._finish({ reason: 'lastAlive' }); }
        else if (total > 1 ? alive.length <= 1 : alive.length === 0) this._finish({ reason: 'lastAlive' });
        break;
      }
      case 'score': for (const p of this.players.values()) if (p.score >= W.target) return this._finish({ reason: 'score' }); break;
      case 'teamScore': for (const t of this.teams) if (this.teamScore[t.id] >= W.target) return this._finish({ reason: 'score' }); break;
      default: break;
    }
  }

  /** endGame action / internal. `how` = { reason, winner?: 'actor'|'team'|'top'|'topTeam'|'none', actor? } */
  _finish(how) {
    if (this.phase !== 'running') return;
    this.phase = 'ended'; this.rev++;
    const list = [...this.players.values()];
    const key = (p) => [p.finished ? 0 : 1, p.finished ? p.finishT : 0, -p.score, p.alive ? 0 : 1, -p.kills];
    const sorted = list.slice().sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
    const teams = this.teams.map((t) => ({ id: t.id, name: t.name, color: t.color, score: this.teamScore[t.id] || 0, alive: list.filter((p) => p.team === t.id && p.alive).length }));
    const byAlive = ['lastAlive', 'time'].includes(this.def.win.type);
    teams.sort((a, b) => (byAlive ? b.alive - a.alive || b.score - a.score : b.score - a.score || b.alive - a.alive));
    let winner = null; const w = how.winner;
    const pick = (p) => (p ? { kind: 'player', id: p.id, name: p.name } : null);
    const teamWin = (t) => (t ? { kind: 'team', id: t.id, name: t.name } : null);
    if (w === 'none') winner = null;
    else if (w === 'teamId') winner = teamWin(teams.find((t) => t.id === how.team));
    else if (w === 'actor') winner = pick(how.actor);
    else if (w === 'team') winner = how.actor && how.actor.team ? teamWin(teams.find((t) => t.id === how.actor.team)) : pick(how.actor);
    else if (w === 'topTeam') winner = teamWin(teams[0] && (teams.length < 2 || teams[0].score !== teams[1].score) ? teams[0] : null);
    else {
      const W = this.def.win.type, M = this.def.meta;
      if (M.mode === 'teams' && teams.length) {
        if (byAlive) winner = teamWin(teams[0] && (teams.length < 2 || teams[0].alive !== teams[1].alive) ? teams[0] : null);
        else winner = teamWin(teams[0] && (teams.length < 2 || teams[0].score !== teams[1].score) ? teams[0] : null);
      } else if (W === 'goal') winner = pick(sorted[0] && sorted[0].finished ? sorted[0] : null);
      else if (W === 'lastAlive' || W === 'time') winner = pick(sorted.find((p) => p.alive));
      else winner = sorted[0] && (sorted.length < 2 || sorted[0].score > sorted[1].score) ? pick(sorted[0]) : null;
      if (W === 'score' && sorted[0] && sorted[0].score <= 0 && how.reason === 'time') winner = null;
    }
    this.winner = winner;
    this.results = {
      reason: how.reason, time: this.elapsed, winner, name: this.def.meta.name,
      rows: sorted.map((p, i) => ({ id: p.id, name: p.name, team: p.team, score: p.score, time: p.finished ? p.finishT : null, alive: p.alive, kills: p.kills, rank: i + 1 })),
      teams: this.teams.length ? teams : [],
    };
    this.host.fx(null, 'sound', { name: winner ? 'win' : 'lose' });
    this.host.fx(null, 'title', { text: winner ? (winner.kind === 'team' ? `Time ${winner.name} venceu!` : `${winner.name} venceu!`) : 'Fim de jogo', sub: '', kind: 'end' });
    this.host.fx(null, 'spec', { on: false }); this.host.fx(null, 'end', { results: this.results });
  }

  // ------------------------------------------------------------------ rule engine
  _fire(ev, c) {
    if (this.queue.length >= EVENT_QUEUE_MAX) return;
    if (this.rulesBy.has(ev)) this.queue.push({ ev, c });
    if (ev === 'playerDied' || ev === 'playerKilled') this.rev++;
  }

  _flush() {
    let guard = 0;
    while (this.queue.length && this.acts < LIMITS.actionsPerTick && guard++ < EVENT_QUEUE_MAX) {
      const { ev, c } = this.queue.shift(), rules = this.rulesBy.get(ev); if (!rules) continue;
      for (const r of rules) {
        if (this.phase === 'ended') return;
        if (r.once && this.fired.has(r.id)) continue;
        if (!this._matches(r.when, ev, c) || !this._conds(r.if, c)) continue;
        if (r.once) this.fired.add(r.id);
        for (const a of r.then) { if (this.acts++ >= LIMITS.actionsPerTick) break; this._act(a, c); }
      }
    }
  }

  _matches(w, ev, c) {
    switch (ev) {
      case 'playerEnter': case 'playerExit': case 'blockBroken': case 'buttonPressed': return !w.entity || w.entity === c.entity;
      case 'timer': return w.id === c.id;
      case 'itemUsed': return !w.item || w.item === c.item;
      case 'scoreReached': return c.score >= w.value && !c.actor.reached.has(w.value + ':' + c.key) && !!c.actor.reached.add(w.value + ':' + c.key);
      case 'tick': return w.every === c.every;
      case 'playersTouch': return (!w.team || c.actor.team === w.team) && (!w.other || c.victim.team === w.other);
      default: return true;
    }
  }

  _conds(list, c) {
    const a = c.actor;
    for (const k of list) {
      switch (k.c) {
        case 'team': if (!a || a.team !== k.team) return false; break;
        case 'score': if (!a || !cmp(k.op, a.score, k.value)) return false; break;
        case 'teamScore': if (!cmp(k.op, this.teamScore[k.team] || 0, k.value)) return false; break;
        case 'teamCount': { let n = 0; for (const p of this.players.values()) if (p.team === k.team && p.alive && !p.spectator) n++; if (!cmp(k.op, n, k.value)) return false; break; }
        case 'aliveCount': if (!cmp(k.op, this._alivePlayers().length, k.value)) return false; break;
        case 'hasItem': if (!a || !(a.rec && a.rec.has && a.rec.has(k.item))) return false; break;      // host record supplies has(itemId); unknown for remote players
        case 'time': if (!cmp(k.op, this.elapsed, k.value)) return false; break;
        case 'random': if (Math.random() * 100 >= k.percent) return false; break;
        case 'variable': if (!cmp(k.op, this.vars[k.name] || 0, k.value)) return false; break;
        default: break;
      }
    }
    return true;
  }

  /** Resolves a `who` selector to player states. An actor-less event (start, tick, timer) treats "actor" as everybody. */
  _who(who, c) {
    const out = []; const a = c.actor;
    const all = (f) => { for (const p of this.players.values()) if (f(p)) out.push(p); };
    switch (who) {
      case 'victim': if (c.victim) out.push(c.victim); break;
      case 'actor': if (a) out.push(a); else all((p) => !p.spectator); break;
      case 'all': all(() => true); break;
      case 'team': if (a && a.team) all((p) => p.team === a.team); else if (a) out.push(a); break;
      case 'others': all((p) => p !== a); break;
      case 'enemies': all((p) => p.team && (!a || p.team !== a.team)); break;
      case 'alive': all((p) => p.alive && !p.spectator); break;
      case 'random': { const l = [...this.players.values()].filter((p) => p.alive && !p.spectator); if (l.length) out.push(l[(Math.random() * l.length) | 0]); break; }
      default: break;
    }
    return out;
  }

  _act(a, c) {
    const H = this.host, ids = (ps) => ps.map((p) => p.id);
    switch (a.a) {
      case 'teleport': { const b = this.box.get(a.entity); if (!b) return; const pt = { x: (b[0] + b[3]) / 2, y: b[1] + 0.05, z: (b[2] + b[5]) / 2 }; for (const p of this._who(a.who, c)) this._teleportTo(p, pt); break; }
      case 'giveItem': if (a.item) H.fx(ids(this._who(a.who, c)), 'give', { item: a.item, count: a.count }); break;
      case 'setLoadout': for (const p of this._who(a.who, c)) this._equip(p); break;
      case 'damage': H.fx(ids(this._who(a.who, c)), 'damage', { amount: a.amount }); break;
      case 'heal': H.fx(ids(this._who(a.who, c)), 'heal', { amount: a.amount }); break;
      case 'kill': for (const p of this._who(a.who, c)) { H.fx([p.id], 'kill', {}); this.playerDied(p.id, null); } break;
      case 'respawn': for (const p of this._who(a.who, c)) { p.dead = true; this._respawn(p); } break;
      case 'setBlock': { const b = this.box.get(a.entity); if (b) this._queueBlock(b[0], b[1], b[2], b[0], b[1], b[2], materialId(a.material)); break; }
      case 'fillArea': { const b = this.box.get(a.entity); if (b) this._queueBlock(b[0], b[1], b[2], b[3] - 1, b[4] - 1, b[5] - 1, materialId(a.material)); break; }
      case 'removeBlocks': { const b = this.box.get(a.entity); if (b) this._queueBlock(b[0], b[1], b[2], b[3] - 1, b[4] - 1, b[5] - 1, 0); break; }
      case 'addScore': {
        if (a.to === 'team') { const p = c.actor || this._who('alive', c)[0]; if (p) this._addScore(p, a.amount, 'team'); }
        else for (const p of this._who(a.who, c)) this._addScore(p, a.amount, 'player');
        break;
      }
      case 'setVar': this.vars[a.name] = Math.max(-9999, Math.min(9999, a.mode === 'add' ? (this.vars[a.name] || 0) + a.value : a.value)); this.rev++; break;
      case 'setTeam': for (const p of this._who(a.who, c)) { p.team = a.team; H.fx([p.id], 'team', { team: a.team }); } this.rev++; break;
      case 'message': H.fx(ids(this._who(a.who, c)), 'msg', { text: a.text }); break;
      case 'title': H.fx(ids(this._who(a.who, c)), 'title', { text: a.text, sub: a.sub, kind: 'info' }); break;
      case 'sound': H.fx(ids(this._who(a.who, c)), 'sound', { name: a.name }); break;
      case 'startTimer': { this.timers = this.timers.filter((t) => t.id !== a.id); if (this.timers.length < 32) this.timers.push({ id: a.id, seconds: a.seconds, at: this.elapsed + a.seconds, repeat: a.repeat }); break; }
      case 'stopTimer': this.timers = this.timers.filter((t) => t.id !== a.id); break;
      case 'openDoor': case 'closeDoor': { const e = this.ent.get(a.entity), b = this.box.get(a.entity); if (e && b && e.type === 'door') this._queueBlock(b[0], b[1], b[2], b[3] - 1, b[4] - 1, b[5] - 1, a.a === 'openDoor' ? 0 : materialId(e.p.material)); break; }
      case 'eliminate': for (const p of this._who(a.who, c)) this._eliminate(p); break;
      case 'endGame': this.ending = { reason: 'rule', winner: a.team ? 'teamId' : a.winner, team: a.team, actor: c.actor }; break;
      default: break;
    }
  }

  /** Called by the feature when a player (or the host on behalf of a guest) broke a block: fires blockBroken for the area containing it. */
  blockBroken(x, y, z, byId) {
    if (this.phase !== 'running' || !this.rulesBy.has('blockBroken')) return;
    const by = byId ? this.players.get(byId) : this._nearest(x, y, z);
    for (const a of this.byType.area || []) {
      const b = this.box.get(a.id);
      if (x >= b[0] && x < b[3] && y >= b[1] && y < b[4] && z >= b[2] && z < b[5]) this._fire('blockBroken', { actor: by || null, entity: a.id });
    }
    this.acts = 0; this._flush();
  }
  /** An item was used by a player (from the item system). */
  itemUsed(id, item) { const p = this.players.get(id); if (this.phase === 'running' && p) { this._fire('itemUsed', { actor: p, item }); this.acts = 0; this._flush(); } }

  _nearest(x, y, z) {
    let best = null, bd = 1e9; for (const p of this.players.values()) { const d = (p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } } return best;
  }

  // ------------------------------------------------------------------ blocks (capped per tick)
  _queueBlock(x0, y0, z0, x1, y1, z1, id) {
    const n = (x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1); if (n <= 0 || n > LIMITS.area || this.blockQN + n > BLOCK_QUEUE_MAX || this.roundBlocks + n > ROUND_BLOCKS_MAX) return;
    this.roundBlocks += n;
    this.blockQ.push({ x0: Math.floor(x0), y0: Math.floor(y0), z0: Math.floor(z0), x1: Math.floor(x1), y1: Math.floor(y1), z1: Math.floor(z1), id, x: Math.floor(x0), y: Math.floor(y0), z: Math.floor(z0) }); this.blockQN += n;
  }
  pumpBlocks() {
    let budget = this.opts.blocksPerTick, H = this.host;
    while (budget > 0 && this.blockQ.length) {
      const o = this.blockQ[0];
      for (; o.y <= o.y1 && budget > 0; o.y++, o.x = o.x0) {
        for (; o.z <= o.z1 && budget > 0; o.z++, o.x = o.x0) {
          for (; o.x <= o.x1 && budget > 0; o.x++) { H.setBlock(o.x, o.y, o.z, o.id); budget--; this.blockQN--; }
          if (o.x <= o.x1) break;
        }
        if (o.z <= o.z1) break;
        o.z = o.z0;
      }
      if (o.y > o.y1) this.blockQ.shift();
    }
    if (!this.blockQ.length) this.blockQN = 0;
  }

  /** Arena ops + floor/wall areas + closed doors are (re)built at the start of every round, so "play again" always begins from a clean map. */
  _rebuildWorld() {
    const d = this.def, a = d.anchor;
    for (const o of d.arena) {
      const id = materialId(o.material), x0 = a.x + o.x, y0 = a.y + o.y, z0 = a.z + o.z, x1 = x0 + o.w - 1, y1 = y0 + o.h - 1, z1 = z0 + o.d - 1;
      if (o.shape === 'hollow') { this._queueBlock(x0, y0, z0, x1, y1, z1, id); if (o.w > 2 && o.h > 2 && o.d > 2) this._queueBlock(x0 + 1, y0 + 1, z0 + 1, x1 - 1, y1 - 1, z1 - 1, 0); }
      else this._queueBlock(x0, y0, z0, x1, y1, z1, id);
    }
    for (const e of this.byType.area || []) if (e.p.restore) { const b = this.box.get(e.id); this._queueBlock(b[0], b[1], b[2], b[3] - 1, b[4] - 1, b[5] - 1, materialId(e.p.material)); }
    for (const e of this.byType.door || []) { const b = this.box.get(e.id); this._queueBlock(b[0], b[1], b[2], b[3] - 1, b[4] - 1, b[5] - 1, e.p.open ? 0 : materialId(e.p.material)); }
  }

  /** Editor helpers: queue the arena/areas/doors (or one box) as capped block jobs without starting a game. */
  queueRebuild() { this._rebuildWorld(); }
  queueFill(x0, y0, z0, x1, y1, z1, id) { this._queueBlock(x0, y0, z0, x1, y1, z1, id); }
  get building() { return this.blockQ.length > 0; }

  // ------------------------------------------------------------------ permissions + replication
  /** May `action` ('break'|'place'|'pvp'|'explode') happen at this block right now? Used by the permission rules while a game is on. */
  allows(action, info) {
    if (this.phase !== 'countdown' && this.phase !== 'running') return true;
    const M = this.def.meta;
    if (action === 'pvp') return M.pvp;
    if (action === 'place') return M.allowBuild;
    if (action === 'break' || action === 'explode') {
      if (M.allowBuild) return true;
      if (action === 'explode') return false;
      for (const a of this.byType.area || []) if (a.p.breakable) { const b = this.box.get(a.id); if (info.x >= b[0] && info.x < b[3] && info.y >= b[1] && info.y < b[4] && info.z >= b[2] && info.z < b[5]) return true; }
      return false;
    }
    return true;
  }

  /** Compact state for the HUD and for guests (sent at <= 5 Hz, only when `rev` changed or each second). */
  view() {
    const M = this.def.meta, rows = [];
    for (const p of this.players.values()) rows.push([p.id, p.name, p.team, p.score, (p.alive ? 1 : 0) | (p.spectator ? 2 : 0) | (p.finished ? 4 : 0) | (p.carrying ? 8 : 0), p.lives, p.lap, p.cpDone, p.finished ? Math.round(p.finishT * 10) / 10 : 0]);
    const teams = this.teams.map((t) => [t.id, this.teamScore[t.id] || 0]);
    return { ph: this.phase, t: Math.round(this.elapsed * 10) / 10, cd: Math.max(0, Math.ceil(this.cd)), tl: M.timeLimit, p: rows, ts: teams, v: this.vars, cp: this.checkpoints.length, laps: M.laps, win: this.def.win.type, tg: this.def.win.target, res: this.phase === 'ended' ? this.results : null };
  }
}

