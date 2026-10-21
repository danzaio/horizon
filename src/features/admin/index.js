// Admin panel (F4 / 🛠): world controls for the planet owner (solo or host): time, weather, rules, players, spawning, teleports, items.
// Guests only see a notice. Player actions (bring / heal / kill) travel as `adm:*` messages that guests accept ONLY from the host.
import './admin.css';
import { defineFeature } from '../registry.js';

const num = (v, d = 0, lo = -1e7, hi = 1e7) => (typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const WEAPONS = ['sword', 'bow', 'arrow', 'rifle', 'shotgun', 'rocket_launcher', 'railgun', 'grenade', 'mine', 'hammer', 'harpoon', 'glider', 'grapple', 'jetpack', 'tnt', 'gravity_gun', 'boots', 'feather', 'shield', 'apple', 'pickaxe', 'axe'];
let open = null;

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const k in props) { if (k === 'class') e.className = props[k]; else if (k === 'text') e.textContent = props[k]; else if (k.startsWith('on')) e.addEventListener(k.slice(2), props[k]); else e.setAttribute(k, props[k]); }
  for (const c of kids) if (c != null) e.append(c);
  return e;
}

function build(ctx) {
  const net = ctx.net, isGuest = net && net.role === 'guest', hz = window.__hz, root = el('div', { class: 'adm' });
  if (isGuest) { root.append(el('p', { class: 'adm-warn', text: 'Só o dono do planeta (anfitrião) usa o painel de admin. Você pode ver o que ele muda: hora e clima seguem o anfitrião.' })); return root; }
  const t = ctx.gr.time, ir = ctx.itemsRuntime, p = ctx.player;
  const sec = (title, ...kids) => { const s = el('section', { class: 'adm-sec' }, el('h3', { text: title })); const row = el('div', { class: 'adm-row' }); for (const k of kids) row.append(k); s.append(row); root.append(s); return row; };
  const btn = (label, fn, cls = '') => el('button', { class: 'btn sm ' + cls, type: 'button', text: label, onclick: fn });
  const slider = (label, min, max, step, get, set, fmt = (v) => v) => {
    const out = el('b', { text: fmt(get()) }), inp = el('input', { type: 'range', min, max, step, value: get() });
    inp.addEventListener('input', () => { set(+inp.value); out.textContent = fmt(+inp.value); });
    return el('label', { class: 'adm-sl' }, el('span', { text: label }), inp, out);
  };
  const toast = (m) => ctx.ui.toast(m);

  // ---- time
  const hh = (v) => { const h = Math.floor(v), m = Math.floor((v - h) * 60); return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'); };
  const timeSl = slider('Hora', 0, 24, 0.05, () => t.hours, (v) => { t.hours = v >= 24 ? 0 : v; }, hh);
  const speedSl = slider('Velocidade do tempo', 0, 20, 0.5, () => t.speed / 0.02, (v) => { t.speed = 0.02 * v; ctx.settings.timeSpeed = v; }, (v) => v + '×');
  sec('Tempo', timeSl, speedSl, btn('🌅 Amanhecer', () => { t.hours = 6.2; }), btn('☀️ Meio-dia', () => { t.hours = 12; }), btn('🌇 Pôr do sol', () => { t.hours = 18.3; }), btn('🌙 Meia-noite', () => { t.hours = 0.5; }), btn('⏸ Congelar', () => { t.speed = 0; ctx.settings.timeSpeed = 0; speedSl.querySelector('input').value = 0; speedSl.querySelector('b').textContent = '0×'; }));
  const tick = setInterval(() => { if (!document.body.contains(root)) { clearInterval(tick); return; } const i = timeSl.querySelector('input'); if (document.activeElement !== i) { i.value = t.hours; timeSl.querySelector('b').textContent = hh(t.hours); } }, 500);

  // ---- weather
  sec('Clima', ...[['☀️ Limpo', 'clear'], ['🌧 Chuva', 'rain'], ['⛈ Tempestade', 'storm'], ['❄️ Neve', 'snow']].map(([l, k]) => btn(l, () => hz.setWeather(k, false))), btn('🔄 Automático', () => { if (hz.autoWeather) hz.autoWeather(); toast('Clima automático'); }));

  // ---- rules
  const rules = [];
  if (net && net.dome) { for (const [k, l] of [['build', 'Construir'], ['break', 'Quebrar'], ['pvp', 'PvP'], ['fly', 'Voar']]) { const cb = el('input', { type: 'checkbox' }); cb.checked = !!net.dome.perms[k]; cb.addEventListener('change', () => net.dome.setPerm(k, cb.checked)); rules.push(el('label', { class: 'adm-ck' }, cb, el('span', { text: 'Visitantes: ' + l }))); } }
  const god = el('input', { type: 'checkbox' }); god.addEventListener('change', () => { if (!ir) return; ir.health.invulnerable = god.checked; ir.health._inv = god.checked ? 1e9 : 0; toast(god.checked ? 'Modo deus ligado' : 'Modo deus desligado'); });
  const creative = el('input', { type: 'checkbox' }); creative.checked = ir ? ir.inventory.creative : true; creative.addEventListener('change', () => { if (ir) ir.inventory.creative = creative.checked; toast(creative.checked ? 'Criativo: itens ilimitados' : 'Sobrevivência: itens consomem'); });
  sec('Regras', el('label', { class: 'adm-ck' }, god, el('span', { text: 'Modo deus (sem dano)' })), el('label', { class: 'adm-ck' }, creative, el('span', { text: 'Criativo (itens ilimitados)' })), ...rules);
  sec('Física', slider('Gravidade', 0.1, 3, 0.05, () => p.gravityScale, (v) => { p.gravityScale = v; }, (v) => (+v).toFixed(2) + 'g'), slider('Velocidade', 0.5, 4, 0.1, () => p.speedMul, (v) => { p.speedMul = v; }, (v) => (+v).toFixed(1) + '×'), slider('Voo', 5, 80, 1, () => p.flySpeed, (v) => { p.flySpeed = v; }, (v) => v + ' b/s'), btn('Restaurar', () => { p.gravityScale = (ctx.planet.profile && ctx.planet.profile.gravity) || 1; p.speedMul = 1; p.flySpeed = 14; toast('Física restaurada'); }));

  // ---- teleport
  const mk = (ph, v) => el('input', { type: 'number', placeholder: ph, value: v, style: 'width:78px' }), ix = mk('x', Math.round(p.x)), iy = mk('y', Math.round(p.y)), iz = mk('z', Math.round(p.z));
  sec('Teleporte', ix, iy, iz, btn('Ir', () => { p.teleport(+ix.value || 0, +iy.value || 80, +iz.value || 0); toast('Teleportado'); }), btn('Spawn', () => { const h = ir && ir.health.home; if (h) p.teleport(h.x, h.y, h.z); }), btn('Céu (y=120)', () => { p.teleport(p.x, 120, p.z); p.flying = true; ctx.ui.setFly(true); }), btn('Aqui → copiar', () => { navigator.clipboard && navigator.clipboard.writeText(`${Math.round(p.x)} ${Math.round(p.y)} ${Math.round(p.z)}`); toast('Coordenadas copiadas'); }));

  // ---- players
  const pl = el('div', { class: 'adm-players' });
  const renderPl = () => {
    pl.replaceChildren();
    const list = net ? [...net.players.values()] : [];
    if (!list.length) { pl.append(el('p', { class: 'dim', text: 'Ninguém online. Use 🔗 para convidar amigos.' })); return; }
    for (const q of list) pl.append(el('div', { class: 'adm-pl' }, el('b', { text: q.name }),
      btn('Ir até', () => { if (q.pos) p.teleport(q.pos.x + 1.4, q.pos.y + 0.3, q.pos.z); }), btn('Trazer', () => net.broadcast('adm:tp', { to: q.id, x: p.x + 1.4, y: p.y + 0.3, z: p.z })),
      btn('Curar', () => net.broadcast('adm:heal', { to: q.id })), btn('Matar', () => net.broadcast('adm:kill', { to: q.id }), 'danger'), btn('Expulsar', () => { net.kick(q.id); setTimeout(renderPl, 300); }, 'danger')));
  };
  renderPl(); const off = ctx.events.on('net:peerJoin', renderPl), off2 = ctx.events.on('net:peerLeave', renderPl); root.addEventListener('adm-close', () => { off(); off2(); clearInterval(tick); });
  const ps = el('section', { class: 'adm-sec' }, el('h3', { text: 'Jogadores' }), pl); root.append(ps);

  // ---- spawn / world
  const hordeD = el('select', {}, el('option', { value: 0, text: 'Fácil' }), el('option', { value: 1, text: 'Normal', selected: 'selected' }), el('option', { value: 2, text: 'Difícil' }));
  sec('Mundo', btn('🐄 +6 animais', () => { if (ctx.mobs) for (let i = 0; i < 40; i++) ctx.mobs._trySpawn(p); }), btn('Remover animais', () => { if (ctx.mobs) ctx.mobs.list.length = 0; }), hordeD, btn('👾 Iniciar horda', () => ctx.horde && ctx.horde.start(+hordeD.value)), btn('Parar horda', () => ctx.horde && ctx.horde.stop()),
    btn('💥 Explosão à frente', () => { if (!ir) return; const d = ir.dir; ir.combat.explode(p.x + d.x * 14, p.y + 1.6 + d.y * 14, p.z + d.z * 14, 6, { by: ctx.identity.id }); }), btn('🚀 Chamar nave', () => ctx.ship && ctx.ship.call()), btn('🌐 Online', () => { ctx.ui.closePanels(); setTimeout(() => net && net.inviteLink && net.inviteLink(), 100); }));
  // ---- items
  sec('Itens', btn('Dar todas as armas', () => { if (!ir) return; for (const id of WEAPONS) ir.inventory.give(id); toast('Armas entregues (E abre o inventário)'); }), btn('Curar', () => { if (ir) ir.health.heal(20); }), btn('Limpar inventário', () => ir && ir.inventory.clear(), 'danger'));
  return root;
}

export default defineFeature({
  id: 'admin', order: 50,
  init(ctx) {
    const toggle = () => {
      if (open) { open.close(); open = null; return; }
      const body = build(ctx);
      open = ctx.ui.panel({ id: 'admin', title: 'Painel de admin', subtitle: ctx.net && ctx.net.role === 'guest' ? 'visitante' : ctx.planet.name, content: body, width: 680, onClose: () => { body.dispatchEvent(new Event('adm-close')); open = null; } });
    };
    ctx.addHotkey('F4', toggle);
    ctx.ui.addToolbarButton({ id: 'admin', icon: '🛠', title: 'Painel de admin', key: 'F4', onClick: toggle });
    ctx.admin = { open: toggle };
  },
  ready(ctx) {
    const net = ctx.net; if (!net || !net.on) return;
    const mine = (d) => d && d.to === net.localId;
    const fromHost = (from) => !net.hostId || from === net.hostId || net.role === 'host';
    const ir = () => ctx.itemsRuntime;
    net.on('adm:tp', (d, from) => { if (mine(d) && fromHost(from)) { ctx.player.teleport(num(d.x), num(d.y, 80, -64, 600), num(d.z)); ctx.ui.toast('O anfitrião te teleportou'); } });
    net.on('adm:heal', (d, from) => { if (mine(d) && fromHost(from) && ir()) { ir().health.heal(20); ctx.ui.toast('O anfitrião te curou'); } });
    net.on('adm:kill', (d, from) => { if (mine(d) && fromHost(from) && ir()) ir().health.kill({ kind: 'admin', by: 'Anfitrião' }); });
  },
});
