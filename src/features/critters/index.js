// Critters ("bichinhos"): wild creatures roam the world, capture them with capsules, build a party, fight wild ones or your friends (turn-based, deterministic).
// Hotkey N / 🐾. Items: capsule · super capsule · master capsule (left = throw & capture · right = challenge / battle). PvP over `pk:*` net messages.
import './critters.css';
import { defineFeature } from '../registry.js';
import { SPECIES, speciesById, makeCreature, sanitizeCreature, maxHp, xpNeed, xpYield, moveset, MAX_LEVEL, stats, TYPES } from './data.js';
import { CritterRender } from './models.js';
import { Wild } from './wild.js';
import { openPartyPanel, openStarterPanel, runBattle } from './ui.js';

const KEY = 'horizon.critters.v1.';
const num = (v, d = 0, lo = -1e9, hi = 1e9) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
let G = null;

function load(id) {
  let d = null; try { d = JSON.parse(localStorage.getItem(KEY + id) || 'null'); } catch { /* storage unavailable */ }
  d = d && typeof d === 'object' ? d : {};
  const clean = (a) => (Array.isArray(a) ? a.slice(0, 120).map(sanitizeCreature).filter(Boolean) : []);
  const save = { party: clean(d.party).slice(0, 6), box: clean(d.box), dex: d.dex && typeof d.dex === 'object' ? d.dex : {}, wins: num(d.wins, 0), caught: num(d.caught, 0) };
  return save;
}

class Critters {
  constructor(ctx) {
    this.ctx = ctx; this.save = load(ctx.identity.id); this.wild = new Wild(ctx); this.render = new CritterRender(ctx.gr.shared, ctx.gr.scene);
    this.spawnX = 0; this.spawnZ = 0; this.regenT = 0; this.activeBattle = null; this.pending = null; this.cd = 0;
  }
  persist() { try { localStorage.setItem(KEY + this.ctx.identity.id, JSON.stringify(this.save)); } catch { /* ignore */ } }
  see(spId, caught) { const d = this.save.dex[spId] || 0; if ((caught ? 2 : 1) > d) { this.save.dex[spId] = caught ? 2 : 1; } }

  pickStarter(spId) { const c = makeCreature(spId, 5); this.save.party.push(c); this.see(spId, true); this.persist(); this.ctx.inventory && this.ctx.inventory.give('capsule'); this.ctx.ui.toast('🐾 ' + speciesById(spId).name + ' entrou no seu grupo! Pegue cápsulas no inventário (E → Especiais)'); }
  healAll() { for (const c of [...this.save.party, ...this.save.box]) c.h = maxHp(c); this.persist(); this.ctx.ui.toast('Todos curados 💊'); }
  takeCapsule(kind) { const id = ['capsule', 'capsule_super', 'capsule_master'][kind], inv = this.ctx.inventory; return !inv || inv.creative || inv.take(id); }

  /** XP + level ups + evolutions. `idx` = party indices that fought. returns text lines */
  award(idx, xp) {
    const out = [];
    for (const i of idx) {
      const c = this.save.party[i]; if (!c || c.h <= 0) continue; c.x += i === [...idx][0] ? xp : Math.floor(xp * 0.6);
      while (c.l < MAX_LEVEL && c.x >= xpNeed(c.l)) {
        c.x -= xpNeed(c.l); const before = stats(c.s, c.l).hp; c.l++; const after = stats(c.s, c.l).hp; c.h += after - before; const sp = speciesById(c.s); out.push(sp.name + ' subiu para o nível ' + c.l + '!');
        const mv = moveset(c.s, c.l); for (const m of mv) if (!c.m.includes(m)) out.push(sp.name + ' aprendeu ' + (m) + '!'); c.m = mv;
        if (sp.next >= 0 && sp.evoAt && c.l >= sp.evoAt) { const n = speciesById(sp.next); out.push('✨ ' + sp.name + ' evoluiu para ' + n.name + '!'); const hpFrac = c.h / before; c.s = n.id; c.m = moveset(c.s, c.l); c.h = Math.min(maxHp(c), Math.round(maxHp(c) * Math.min(1, hpFrac + 0.2))); this.see(n.id, true); }
      }
    }
    this.persist(); return out;
  }

  // ---- wild battle / capture --------------------------------------------------------------------------------------
  async battleWild(w) {
    if (this.activeBattle || w.busy) return; const party = this.save.party; if (!party.some((c) => c.h > 0)) { this.ctx.ui.toast('Seus bichinhos estão desmaiados — cure-os em 🐾 (N)'); return; }
    w.busy = true; const rec = makeCreature(w.sp, w.lvl), ir = this.ctx.itemsRuntime; if (ir) ir.suspend && 0; this.see(w.sp, false); this.persist();
    const r = await runBattle(this, { mode: 'wild', side: 'a', mine: party, theirs: [rec], seed: (Math.random() * 4294967296) >>> 0, oppName: 'Selvagem' });
    w.busy = false; const lines = [];
    if (r.captured) { rec.h = Math.max(1, rec.h); (this.save.party.length < 6 ? this.save.party : this.save.box).push(rec); this.save.caught++; this.see(w.sp, true); this.wild.remove(w); lines.push('🎉 ' + speciesById(w.sp).name + ' capturado!' + (this.save.party.includes(rec) ? '' : ' (enviado para a Caixa)')); }
    else if (r.winner === 'a' && !r.fled) { this.wild.remove(w); const xp = xpYield(w.sp, w.lvl), who = [...r.used].filter((i) => party[i] && party[i].h > 0); lines.push('Você venceu! +' + xp + ' XP', ...this.award(who.length ? who : [0], xp)); this.save.wins++; }
    else if (r.winner === 'b') { lines.push('Todos os seus bichinhos desmaiaram… eles se recuperam aos poucos.'); for (const c of party) c.h = Math.max(1, Math.floor(maxHp(c) * 0.3)); }
    this.persist(); lines.forEach((t, i) => setTimeout(() => this.ctx.ui.toast(t), i * 1600));
  }
  throwCapsule(kind) {
    const ctx = this.ctx, ir = ctx.itemsRuntime, p = ctx.player; if (this.cd > 0) return; this.cd = 0.5;
    if (!this.save.party.length) { openStarterPanel(this); return; }
    const o = ir.eye, d = ir.dir, hit = this.wild.aim(o, d, 28); const m = ir.combat.beam; void m;
    ir.combat.beam(o.x + d.x * 0.6, o.y - 0.25 + d.y * 0.6, o.z + d.z * 0.6, o.x + d.x * (hit ? hit.t : 14), o.y + d.y * (hit ? hit.t : 14), o.z + d.z * (hit ? hit.t : 14), kind === 0 ? [1, 0.3, 0.3] : kind === 1 ? [0.3, 0.6, 1] : [0.8, 0.4, 1], 0.06, true);
    if (hit) { hit.c.flash = 1; ctx.audio.snowThrow && ctx.audio.snowThrow(); this.battleWild(hit.c); void p; return; }
    ctx.ui.toast('Mire em um bichinho selvagem (ou jogador, com o botão direito)');
  }
  secondary() { // right click: challenge the aimed player, else start a battle with the aimed wild creature
    const ctx = this.ctx, ir = ctx.itemsRuntime, net = ctx.net, o = ir.eye, d = ir.dir; if (this.cd > 0) return; this.cd = 0.5;
    if (!this.save.party.length) { openStarterPanel(this); return; }
    const t = ir.combat.sweep(o.x, o.y, o.z, d.x, d.y, d.z, 30, 0.3, { noMobs: true });
    if (t && t.kind === 'player') { this.challenge(t.ref.id, t.ref.name); return; }
    const hit = this.wild.aim(o, d, 28); if (hit) { this.battleWild(hit.c); return; }
    void net; ctx.ui.toast('Mire em um bichinho ou jogador para desafiar');
  }

  // ---- PvP ---------------------------------------------------------------------------------------------------------
  summary() { return this.save.party.filter((c) => c.h > 0 || true).slice(0, 6).map((c) => ({ s: c.s, l: c.l })); }
  challenge(id, name) {
    const net = this.ctx.net; if (!net || !net.broadcast) { this.ctx.ui.toast('Entre em um planeta online para batalhar'); return; }
    if (this.activeBattle || this.pending) { this.ctx.ui.toast('Você já está em uma batalha'); return; }
    if (!this.save.party.length) { openStarterPanel(this); return; }
    const seed = (Math.random() * 4294967296) >>> 0; this.pending = { id, name, seed };
    net.broadcast('pk:ch', { to: id, name: this.ctx.identity.name, party: this.summary(), seed }); this.ctx.ui.toast('⚔️ Desafio enviado para ' + name + '…');
    setTimeout(() => { if (this.pending && this.pending.id === id && !this.activeBattle) { this.pending = null; this.ctx.ui.toast(name + ' não respondeu'); } }, 30000);
  }
  _clones(sum, full = true) { return (Array.isArray(sum) ? sum.slice(0, 6) : []).map((s) => { const c = sanitizeCreature({ s: num(s && s.s, 0, 0, SPECIES.length - 1) | 0, l: num(s && s.l, 1, 1, MAX_LEVEL) | 0, h: 1e9, id: Math.random().toString(36).slice(2, 7) }); if (c && full) c.h = maxHp(c); return c; }).filter(Boolean); }
  onChallenge(d, from) {
    const net = this.ctx.net; if (!d || d.to !== net.localId || !from) return; if (this.activeBattle || !this.save.party.length) { net.broadcast('pk:ac', { to: from, ok: 0 }); return; }
    const theirs = this._clones(d.party); if (!theirs.length) return; const name = String(d.name || 'Jogador').slice(0, 20), seed = num(d.seed, 1, 0, 4294967295) >>> 0;
    const el = document.createElement('div'); el.className = 'ck'; el.innerHTML = '<p></p><div class="ck-btns"></div>'; el.firstChild.textContent = name + ' desafiou você para uma batalha de bichinhos! (' + theirs.length + ' no grupo dele)';
    const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.onclick = fn; el.lastChild.append(b); };
    const panel = this.ctx.ui.panel({ id: 'critter-ch', title: '⚔️ Desafio', subtitle: name, content: el, width: 440 });
    mk('Aceitar', 'primary', () => { panel && panel.close(); net.broadcast('pk:ac', { to: from, ok: 1, party: this.summary() }); this._startPvp({ id: from, name }, 'b', theirs, seed); });
    mk('Recusar', '', () => { panel && panel.close(); net.broadcast('pk:ac', { to: from, ok: 0 }); });
  }
  onAccept(d, from) {
    const net = this.ctx.net; if (!d || d.to !== net.localId || !this.pending || this.pending.id !== from) return; const p = this.pending; this.pending = null;
    if (!d.ok) { this.ctx.ui.toast(p.name + ' recusou o desafio'); return; }
    this._startPvp({ id: from, name: p.name }, 'a', this._clones(d.party), p.seed);
  }
  async _startPvp(opp, side, theirs, seed) {
    const mine = this._clones(this.summary()); this.ctx.ui.closePanels();
    const r = await runBattle(this, { mode: 'pvp', side, mine, theirs, seed, oppName: opp.name, opp });
    const me = side; this.ctx.ui.toast(r.winner === me ? '🏆 Você venceu ' + opp.name + '!' : r.winner ? 'Você perdeu para ' + opp.name : 'Batalha encerrada'); if (r.winner === me) { this.save.wins++; this.persist(); }
    const net = this.ctx.net; if (net && net.broadcast && r.fled) net.broadcast('pk:end', { to: opp.id });
  }
  sendTurn(opp, n, act) { const net = this.ctx.net; if (net && net.broadcast) net.broadcast('pk:t', { to: opp.id, n, a: act }); }
  onTurn(d, from) { const net = this.ctx.net; if (!d || d.to !== net.localId || !this.activeBattle) return; const a = d.a; if (!a || (a.k !== 'm' && a.k !== 's')) return; this.activeBattle.onRemote(num(d.n, 0, 0, 999) | 0, { k: a.k, i: num(a.i, 0, 0, 5) | 0 }); }
  onEnd(d) { const net = this.ctx.net; if (d && d.to === net.localId && this.activeBattle) this.activeBattle.forfeit(); }

  update(dt) {
    const ctx = this.ctx, p = ctx.player; if (this.cd > 0) this.cd -= dt;
    if (ctx.state === 'playing' || ctx.state === 'panel') {
      if (!this.spawnX && !this.spawnZ) { this.spawnX = p.x; this.spawnZ = p.z; }
      this.wild.update(dt, p, this.spawnX, this.spawnZ);
    }
    this.render.update(this.wild.list, ctx.camera.position, !!ctx.gr.post);
    this.regenT -= dt; if (this.regenT <= 0) { this.regenT = 4; let ch = false; for (const c of this.save.party) { const mx = maxHp(c); if (c.h > 0 && c.h < mx) { c.h = Math.min(mx, c.h + 1); ch = true; } } if (ch && !this.activeBattle) this.persist(); }
  }
  dispose() { this.render.dispose(); }
}

export default defineFeature({
  id: 'critters', order: 45,
  init(ctx) {
    G = new Critters(ctx);
    const ball = (kind) => (cv) => { const g = cv.getContext('2d'); g.clearRect(0, 0, 32, 32); const top = ['#e53935', '#3b82f6', '#a855f7'][kind]; g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 12, 0, 7); g.fill(); g.fillStyle = top; g.beginPath(); g.arc(16, 16, 12, Math.PI, 0); g.fill(); g.fillStyle = '#222'; g.fillRect(4, 15, 24, 2.5); g.fillStyle = '#fff'; g.strokeStyle = '#222'; g.lineWidth = 2; g.beginPath(); g.arc(16, 16, 4, 0, 7); g.fill(); g.stroke(); };
    const model = (kind) => { const T = [[225, 60, 55], [60, 120, 235], [170, 80, 220]][kind]; return { swing: 'throw', scale: 0.022, pos: [0.2, -0.17, -0.45], rot: [0.2, -0.4, 0], boxes: [[-3, 0, -3, 3, 3.4, 3, T], [-3, -3.2, -3, 3, 0, 3, [240, 240, 240]], [-3.2, -0.5, -3.2, 3.2, 0.5, 3.2, [30, 30, 30]], [-1, -0.8, -3.4, 1, 0.8, -3, [255, 255, 255, ], 3]] }; };
    [['capsule', 'Cápsula', 0], ['capsule_super', 'Super Cápsula', 1], ['capsule_master', 'Cápsula Mestra', 2]].forEach(([id, name, kind]) => ctx.items.register({ id, name, category: 'special', stack: 16, cooldown: 0.4, icon: ball(kind), model: model(kind), desc: 'Esquerdo: lança e tenta capturar o bichinho mirado (abre a batalha) · Direito: desafia o bichinho ou o jogador mirado' + (kind === 2 ? ' · captura garantida' : kind === 1 ? ' · +90% de chance' : ''),
      use: () => G.throwCapsule(kind), useSecondary: () => G.secondary() }));
    const open = () => { if (!G.save.party.length) openStarterPanel(G); else openPartyPanel(G); };
    ctx.addHotkey('KeyN', open);
    ctx.ui.addToolbarButton({ id: 'critters', icon: '🐾', title: 'Bichinhos (grupo, caixa, dex, batalhas)', key: 'N', onClick: open });
    ctx.critters = { open, get party() { return G.save.party.slice(); }, get wild() { return G.wild.list; }, _g: G };
  },
  ready(ctx) {
    if (!G) return; const net = ctx.net;
    if (net && net.on) { net.on('pk:ch', (d, f) => G.onChallenge(d, f)); net.on('pk:ac', (d, f) => G.onAccept(d, f)); net.on('pk:t', (d, f) => G.onTurn(d, f)); net.on('pk:end', (d) => G.onEnd(d)); }
    try { if (!localStorage.getItem('horizon.critters.hint')) { localStorage.setItem('horizon.critters.hint', '1'); setTimeout(() => ctx.ui.toast('Dica: N abre seus bichinhos 🐾 — escolha um parceiro e capture os selvagens'), 9000); } } catch { /* ignore */ }
  },
  update(dt) { if (G) G.update(dt); },
  dispose() { if (G) { G.dispose(); G = null; } },
});
