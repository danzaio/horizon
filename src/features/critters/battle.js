// Deterministic turn-based battle engine. Both players of a PvP battle run THE SAME resolveTurn() with the same seed and the same two actions, so no
// host is needed and both screens agree. No Math.random here: the rng is derived from (seed, turn).
import { MOVES, effectiveness, speciesById, stats, NEUTRAL } from './data.js';

export function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function makeMon(c) {
  const sp = speciesById(c.s), st = stats(c.s, c.l);
  return { ref: c, s: c.s, l: c.l, name: sp.name, types: sp.types, hp: Math.max(0, Math.min(st.hp, c.h)), max: st.hp, atk: st.atk, def: st.def, spd: st.spd, moves: c.m.slice(0, 4), stg: { atk: 0, def: 0, spd: 0 }, guard: false };
}
export function newBattle(partyA, partyB, seed, opts = {}) {
  const side = (p) => ({ mons: p.map(makeMon), act: Math.max(0, p.findIndex((c) => c.h > 0)) });
  return { a: side(partyA), b: side(partyB), turn: 0, seed: seed >>> 0, over: false, winner: null, wild: !!opts.wild };
}
const mult = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
const active = (b, side) => b[side].mons[b[side].act];
const alive = (b, side) => b[side].mons.some((m) => m.hp > 0);

/** @returns {Array<object>} events for the UI to play: {t:'move'|'dmg'|'miss'|'faint'|'switch'|'heal'|'buff'|'protect'|'text'|'end', ...} */
export function resolveTurn(b, actA, actB) {
  const ev = [], R = rng(b.seed * 2654435761 + b.turn * 977 + 13); b.turn++;
  for (const s of ['a', 'b']) active(b, s).guard = false;
  const acts = [{ side: 'a', act: actA }, { side: 'b', act: actB }];
  // 1) switches go first
  for (const x of acts) if (x.act && x.act.k === 's') {
    const to = b[x.side].mons[x.act.i]; if (to && to.hp > 0 && x.act.i !== b[x.side].act) { b[x.side].act = x.act.i; ev.push({ t: 'switch', side: x.side, mon: to }); }
  }
  // 2) moves ordered by priority (guard first) then speed
  const mv = acts.filter((x) => x.act && x.act.k === 'm').map((x) => { const m = active(b, x.side), id = m.moves[x.act.i] || 'investida'; return { side: x.side, mon: m, move: MOVES[id] || MOVES.investida, pri: id === 'guarda' ? 1 : 0, tie: R() }; });
  mv.sort((p, q) => q.pri - p.pri || q.mon.spd * mult(q.mon.stg.spd) - p.mon.spd * mult(p.mon.stg.spd) || p.tie - q.tie);
  for (const x of mv) {
    const me = active(b, x.side); if (me !== x.mon || me.hp <= 0) continue;                 // fainted or switched out before acting
    const foeSide = x.side === 'a' ? 'b' : 'a', foe = active(b, foeSide), mo = x.move;
    ev.push({ t: 'move', side: x.side, mon: me, move: mo });
    if (mo.k === 'heal') { const h = Math.floor(me.max * 0.5), g = Math.min(h, me.max - me.hp); me.hp += g; ev.push({ t: 'heal', side: x.side, mon: me, amount: g }); continue; }
    if (mo.k === 'protect') { me.guard = true; ev.push({ t: 'protect', side: x.side, mon: me }); continue; }
    if (mo.k === 'buffAtk' || mo.k === 'buffDef' || mo.k === 'buffSpd') { const k = mo.k === 'buffAtk' ? 'atk' : mo.k === 'buffDef' ? 'def' : 'spd'; me.stg[k] = Math.min(3, me.stg[k] + 1); ev.push({ t: 'buff', side: x.side, mon: me, stat: k, stage: me.stg[k] }); continue; }
    if (foe.hp <= 0) continue;
    if (foe.guard) { ev.push({ t: 'text', text: foe.name + ' se protegeu!' }); continue; }
    if (R() * 100 > mo.a) { ev.push({ t: 'miss', side: x.side, mon: me }); continue; }
    const stab = mo.t !== NEUTRAL && me.types.includes(mo.t) ? 1.3 : 1, eff = effectiveness(mo.t, foe.types), crit = R() < 0.0625 ? 1.5 : 1;
    const A = me.atk * mult(me.stg.atk), D = foe.def * mult(foe.stg.def);
    let dmg = Math.floor(((2 * me.l / 5 + 2) * mo.p * A / D / 50 + 2) * stab * eff * crit * (0.85 + R() * 0.15)); if (eff > 0) dmg = Math.max(1, dmg);
    dmg = Math.min(dmg, foe.hp); foe.hp -= dmg; ev.push({ t: 'dmg', side: foeSide, mon: foe, amount: dmg, eff, crit: crit > 1 });
    if (foe.hp <= 0) { ev.push({ t: 'faint', side: foeSide, mon: foe }); foe.ref.h = 0; }
  }
  for (const s of ['a', 'b']) for (const m of b[s].mons) m.ref.h = m.hp;
  // 3) replacements (automatic: next one standing) and the end of the battle
  for (const s of ['a', 'b']) {
    if (active(b, s).hp <= 0 && alive(b, s)) { b[s].act = b[s].mons.findIndex((m) => m.hp > 0); ev.push({ t: 'switch', side: s, mon: active(b, s), auto: true }); }
  }
  if (!alive(b, 'a') || !alive(b, 'b')) { b.over = true; b.winner = alive(b, 'a') ? 'a' : alive(b, 'b') ? 'b' : null; ev.push({ t: 'end', winner: b.winner }); }
  return ev;
}

/** very small AI for wild creatures / offline rivals: prefers super-effective damage, heals when low */
export function aiPick(b, side, R) {
  const me = active(b, side), foe = active(b, side === 'a' ? 'b' : 'a'); let best = 0, bs = -1;
  me.moves.forEach((id, i) => {
    const m = MOVES[id]; let sc = 1 + R() * 2;
    if (m.k === 'dmg') sc += m.p / 20 * effectiveness(m.t, foe.types) * (m.t !== NEUTRAL && me.types.includes(m.t) ? 1.3 : 1) * (m.a / 100);
    else if (m.k === 'heal') sc += me.hp / me.max < 0.35 ? 6 : -2; else if (m.k === 'protect') sc -= 1; else sc += me.stg.atk < 1 ? 0.8 : -2;
    if (sc > bs) { bs = sc; best = i; }
  });
  return { k: 'm', i: best };
}
