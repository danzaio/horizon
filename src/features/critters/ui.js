// Critters UI: party / box / dex panel, starter picker and the battle screen (wild + PvP). DOM only; all game rules live in data.js / battle.js.
import { h } from '../net/dom.js';
import { TYPES, MOVES, SPECIES, speciesById, stats, maxHp, xpNeed, captureChance, NEUTRAL } from './data.js';
import { newBattle, resolveTurn, aiPick, rng } from './battle.js';
import { drawSprite } from './models.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const typeChips = (sp) => h('span', { class: 'ck-types' }, ...sp.types.map((t) => h('i', { style: 'background:' + TYPES[t].c, title: TYPES[t].n, text: TYPES[t].i })));
const sprite = (spId, size = 72, yaw = -0.7) => { const c = document.createElement('canvas'); c.className = 'ck-sprite'; drawSprite(c, spId, yaw, size); return c; };
const hpBar = (frac) => { const b = h('div', { class: 'ck-hp' }, h('i')); setBar(b, frac); return b; };
function setBar(b, frac) { const i = b.firstChild; i.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%'; i.style.background = frac > 0.5 ? '#4ade80' : frac > 0.2 ? '#facc15' : '#ef4444'; }
const moveLabel = (id) => { const m = MOVES[id], t = m.t === NEUTRAL ? '⚪' : TYPES[m.t].i; return t + ' ' + m.n + (m.k === 'dmg' ? ' · ' + m.p : ''); };

// ======================================================================= party / box / dex
export function openPartyPanel(G) {
  const { ctx, save } = G, root = h('div', { class: 'ck' });
  let tab = 'party';
  const row = (c, inBox, i) => {
    const sp = speciesById(c.s), mx = maxHp(c);
    return h('div', { class: 'ck-row' }, sprite(c.s, 56), h('div', { class: 'ck-info' }, h('b', { text: sp.name + '  Nv ' + c.l }), typeChips(sp), hpBar(c.h / mx), h('small', { class: 'dim', text: c.h + '/' + mx + ' PS · XP ' + c.x + '/' + xpNeed(c.l) + ' · ' + c.m.map((m) => MOVES[m].n).join(', ') })),
      h('div', { class: 'ck-acts' }, ...(inBox ? [h('button', { class: 'btn sm', type: 'button', text: '→ Grupo', disabled: save.party.length >= 6, onclick: () => { save.box.splice(i, 1); save.party.push(c); G.persist(); render(); } })]
        : [h('button', { class: 'btn sm', type: 'button', text: '↑', disabled: i === 0, onclick: () => { [save.party[i - 1], save.party[i]] = [save.party[i], save.party[i - 1]]; G.persist(); render(); } }), h('button', { class: 'btn sm', type: 'button', text: '→ Caixa', disabled: save.party.length <= 1, onclick: () => { save.party.splice(i, 1); save.box.push(c); G.persist(); render(); } })]),
      h('button', { class: 'btn sm danger', type: 'button', text: 'Soltar', disabled: !inBox && save.party.length <= 1, onclick: () => { if (confirm('Soltar ' + sp.name + '?')) { (inBox ? save.box : save.party).splice(i, 1); G.persist(); render(); } } })));
  };
  function render() {
    const tabs = h('div', { class: 'ck-tabs' }, ...[['party', '🐾 Grupo (' + save.party.length + '/6)'], ['box', '📦 Caixa (' + save.box.length + ')'], ['dex', '📖 Dex (' + Object.keys(save.dex).length + '/' + SPECIES.length + ')'], ['pvp', '⚔️ Batalhar']].map(([id, label]) => h('button', { class: 'btn sm' + (tab === id ? ' primary' : ''), type: 'button', text: label, onclick: () => { tab = id; render(); } })));
    let body;
    if (tab === 'party') body = h('div', { class: 'ck-list' }, ...save.party.map((c, i) => row(c, false, i)), h('div', { class: 'ck-btns' }, h('button', { class: 'btn primary sm', type: 'button', text: '💊 Curar todos', onclick: () => { G.healAll(); render(); } })));
    else if (tab === 'box') body = h('div', { class: 'ck-list' }, ...(save.box.length ? save.box.map((c, i) => row(c, true, i)) : [h('p', { class: 'dim', text: 'A caixa está vazia. O que passar de 6 criaturas vem para cá.' })]));
    else if (tab === 'dex') body = h('div', { class: 'ck-dex' }, ...SPECIES.map((s) => { const d = save.dex[s.id], card = h('div', { class: 'ck-dcard' + (d ? '' : ' unk') }, d ? sprite(s.id, 56) : h('div', { class: 'ck-sprite unk', text: '?' }), h('small', { text: (d ? s.name : '???') + (d === 2 ? ' ✔' : '') })); return card; }));
    else {
      const net = ctx.net, list = net ? [...net.players.values()] : [];
      body = h('div', { class: 'ck-list' }, h('p', { class: 'dim', text: 'Desafie um amigo para uma batalha por turnos: cada um usa o próprio grupo (amistoso — ninguém perde nada). Dica: a Cápsula, botão direito, também desafia o jogador que você estiver mirando.' }),
        ...(list.length ? list.map((q) => h('div', { class: 'ck-row' }, h('b', { text: q.name }), h('button', { class: 'btn primary sm', type: 'button', text: '⚔️ Desafiar', onclick: () => { ctx.ui.closePanels(); G.challenge(q.id, q.name); } })) ) : [h('p', { class: 'nt-warn', text: 'Ninguém online. Use o botão 🔗 para convidar um amigo.' })]));
    }
    root.replaceChildren(tabs, body);
  }
  render();
  return ctx.ui.panel({ id: 'critters', title: 'Bichinhos', subtitle: save.party.length + ' no grupo', content: root, width: 620 });
}

export function openStarterPanel(G) {
  const { ctx } = G, starters = [0, 3, 6], root = h('div', { class: 'ck' }, h('p', { text: 'Bem-vindo! Escolha o seu primeiro companheiro. Depois, use a Cápsula (botão esquerdo) para capturar criaturas selvagens e o botão direito para desafiá-las.' }),
    h('div', { class: 'ck-starters' }, ...starters.map((s) => { const sp = speciesById(s); return h('button', { class: 'ck-start', type: 'button', onclick: () => { G.pickStarter(s); ctx.ui.closePanels(); } }, sprite(s, 96, -0.55), h('b', { text: sp.name }), typeChips(sp)); })));
  return ctx.ui.panel({ id: 'critters-start', title: 'Seu primeiro bichinho', subtitle: 'escolha um', content: root, width: 560 });
}

// ======================================================================= battle
/**
 * @param {object} G game api  @param {{mode:'wild'|'pvp', side:'a'|'b', mine:object[], theirs:object[], seed:number, oppName:string, wildRec?:object}} cfg
 * @returns {Promise<{winner:'a'|'b'|null, captured?:boolean, fled?:boolean, b:object}>}
 */
export function runBattle(G, cfg) {
  const { ctx } = G, wild = cfg.mode === 'wild', me = cfg.side, foe = me === 'a' ? 'b' : 'a';
  const b = newBattle(me === 'a' ? cfg.mine : cfg.theirs, me === 'a' ? cfg.theirs : cfg.mine, cfg.seed, { wild }), Rl = rng((cfg.seed ^ 0x9e3779b9) >>> 0);
  const shown = new Map(); for (const s of ['a', 'b']) for (const m of b[s].mons) shown.set(m, m.hp);
  const used = new Set([b[me].act]);
  let resolve; const done = new Promise((r) => { resolve = r; });
  const eName = h('b'), eLv = h('span'), eBar = hpBar(1), eSpr = h('div', { class: 'ck-bsp' }), mName = h('b'), mLv = h('span'), mBar = hpBar(1), mHpT = h('small'), mSpr = h('div', { class: 'ck-bsp' }), log = h('div', { class: 'ck-log' }), acts = h('div', { class: 'ck-bacts' });
  const root = h('div', { class: 'ck ck-battle' }, h('div', { class: 'ck-foe' }, h('div', { class: 'ck-card' }, h('div', {}, eName, eLv), eBar), eSpr), h('div', { class: 'ck-me' }, mSpr, h('div', { class: 'ck-card' }, h('div', {}, mName, mLv), mBar, mHpT)), log, acts);
  let ended = false, turnNo = 0, pend = null, inbox = new Map();
  const say = (t) => { log.append(h('div', { text: t })); log.scrollTop = log.scrollHeight; while (log.children.length > 40) log.firstChild.remove(); };
  const fx = (el) => { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); };
  let eSp = -1, mSp = -1;
  function paint() {
    const em = b[foe].mons[b[foe].act], mm = b[me].mons[b[me].act];
    eName.textContent = em.name + ' ' + (wild ? '(selvagem) ' : ''); eLv.textContent = 'Nv ' + em.l; setBar(eBar, shown.get(em) / em.max);
    mName.textContent = mm.name + ' '; mLv.textContent = 'Nv ' + mm.l; setBar(mBar, shown.get(mm) / mm.max); mHpT.textContent = Math.max(0, shown.get(mm)) + '/' + mm.max + ' PS';
    if (eSp !== em.s) { eSp = em.s; eSpr.replaceChildren(sprite(em.s, 112, -0.6)); } if (mSp !== mm.s) { mSp = mm.s; mSpr.replaceChildren(sprite(mm.s, 128, 2.5)); }
  }
  async function play(ev) {
    for (const e of ev) {
      if (ended) return;
      switch (e.t) {
        case 'switch': say((e.auto ? '' : '') + (e.side === me ? 'Vai, ' : (wild ? 'O selvagem trouxe ' : cfg.oppName + ' trouxe ')) + e.mon.name + '!'); if (e.side === me) used.add(b[me].act); shown.set(e.mon, e.mon.hp > 0 ? Math.max(shown.get(e.mon), 0) : 0); break;
        case 'move': say((e.side === me ? '' : (wild ? 'O selvagem ' : '')) + e.mon.name + ' usou ' + e.move.n + '!'); break;
        case 'miss': say('Errou!'); break;
        case 'dmg': shown.set(e.mon, Math.max(0, shown.get(e.mon) - e.amount)); fx(e.side === me ? mSpr : eSpr); if (e.crit) say('Golpe crítico!'); if (e.eff > 1) say('Foi super efetivo!'); else if (e.eff < 1) say('Não foi muito efetivo…'); ctx.audio.hit(e.amount > 10); break;
        case 'heal': shown.set(e.mon, Math.min(e.mon.max, shown.get(e.mon) + e.amount)); say(e.mon.name + ' recuperou ' + e.amount + ' PS.'); break;
        case 'buff': say(e.mon.name + ' ficou mais forte!'); break;
        case 'protect': say(e.mon.name + ' se protege!'); break;
        case 'faint': say(e.mon.name + ' desmaiou!'); shown.set(e.mon, 0); break;
        case 'text': say(e.text); break;
        default: break;
      }
      paint(); await sleep(e.t === 'move' ? 650 : 520);
    }
  }
  function lock(on) { for (const bt of acts.querySelectorAll('button')) bt.disabled = on; }
  function menu() {
    const mm = b[me].mons[b[me].act]; acts.replaceChildren();
    const moves = h('div', { class: 'ck-moves' }, ...mm.moves.map((id, i) => h('button', { class: 'btn', type: 'button', text: moveLabel(id), onclick: () => choose({ k: 'm', i }) })));
    const side = h('div', { class: 'ck-side' }, h('button', { class: 'btn sm', type: 'button', text: '🔁 Trocar', onclick: swapMenu }),
      ...(wild ? [h('button', { class: 'btn sm primary', type: 'button', text: '⚪ Cápsula', onclick: () => capture(0) }), h('button', { class: 'btn sm primary', type: 'button', text: '🔵 Super', onclick: () => capture(1) }), h('button', { class: 'btn sm primary', type: 'button', text: '🟣 Mestra', onclick: () => capture(2) })] : []),
      h('button', { class: 'btn sm danger', type: 'button', text: wild ? '🏃 Fugir' : '🏳 Desistir', onclick: () => finish({ fled: true, winner: wild ? null : foe }) }));
    acts.append(moves, side);
  }
  function swapMenu() {
    acts.replaceChildren(h('div', { class: 'ck-moves' }, ...b[me].mons.map((m, i) => h('button', { class: 'btn', type: 'button', disabled: m.hp <= 0 || i === b[me].act, text: m.name + ' Nv' + m.l + ' (' + m.hp + '/' + m.max + ')', onclick: () => choose({ k: 's', i }) }))), h('button', { class: 'btn sm', type: 'button', text: '← Voltar', onclick: menu }));
  }
  async function choose(act) {
    if (ended || pend) return; lock(true); pend = act; const n = turnNo;
    let theirs;
    if (wild) theirs = aiPick(b, foe, Rl);
    else { say('Aguardando ' + cfg.oppName + '…'); G.sendTurn(cfg.opp, n, act); theirs = await waitInbox(n); if (!theirs || ended) return; }
    const ev = resolveTurn(b, me === 'a' ? act : theirs, me === 'a' ? theirs : act); turnNo++; pend = null;
    await play(ev); if (ended) return;
    if (b.over) return finish({ winner: b.winner });
    menu();
  }
  function waitInbox(n) {
    return new Promise((res) => { const t0 = performance.now(), iv = setInterval(() => { if (ended) { clearInterval(iv); res(null); } else if (inbox.has(n)) { clearInterval(iv); res(inbox.get(n)); } else if (performance.now() - t0 > 120000) { clearInterval(iv); say('O oponente não respondeu.'); finish({ winner: me, fled: true }); res(null); } }, 120); });
  }
  async function capture(kind) {
    if (ended || pend) return; lock(true); pend = { k: 'n' };
    const em = b[foe].mons[b[foe].act], sp = speciesById(em.s), chance = captureChance(sp, em.hp / em.max, em.l, [1, 1.9, 99][kind]);
    if (!G.takeCapsule(kind)) { say('Você não tem essa cápsula.'); pend = null; menu(); return; }
    say('Você lançou a cápsula!'); await sleep(500); const ok = Math.random() < chance;
    for (let i = 1; i <= (ok ? 3 : 1 + ((Math.random() * 2) | 0)); i++) { say('…' + i); await sleep(650); }
    if (ok) { say(em.name + ' foi capturado!'); await sleep(500); return finish({ winner: me, captured: true }); }
    say(em.name + ' escapou!'); const ev = resolveTurn(b, { k: 'n' }, aiPick(b, foe, Rl)); turnNo++; pend = null; await play(ev); if (b.over) return finish({ winner: b.winner }); menu();
  }
  function finish(r) {
    if (ended) return; ended = true; if (panel) { const p = panel; panel = null; p.close(); }
    G.activeBattle = null; resolve(Object.assign({ b, used, winner: null }, r));
  }
  let panel = null; paint(); menu();
  say(wild ? 'Um ' + b[foe].mons[0].name + ' selvagem apareceu!' : cfg.oppName + ' desafia você para uma batalha!');
  panel = ctx.ui.panel({ id: 'critter-battle', title: wild ? 'Batalha selvagem' : 'Batalha contra ' + cfg.oppName, subtitle: 'por turnos', content: root, width: 640, onClose: () => { if (!ended) finish({ fled: true, winner: wild ? null : foe }); } });
  G.activeBattle = { onRemote: (n, a) => inbox.set(n, a), forfeit: () => { if (!ended) { say('O oponente desistiu!'); finish({ winner: me, fled: true }); } }, get turn() { return turnNo; } };
  return done;
}
