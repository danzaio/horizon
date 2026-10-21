// Feature "net": peer-to-peer multiplayer without servers (see docs/NET.md). Publishes ctx.net and ctx.dome (never null after init).
import { defineFeature } from '../registry.js';
import { Net, canHost, NO_HOST_TEXT } from './net.js';
import { Avatars } from './avatars.js';
import { openJoinPanel } from './ui-join.js';
import { openLobbyPanel, enterPublicRoom } from './ui-lobby.js';
import { PUBLIC_ROOMS, roomById } from './publicRooms.js';
import { createFollow } from './follow.js';
import { openNetPanel, createChatHud, createStatsLine, showClosed } from './ui-game.js';
import { parseJoin } from './protocol.js';
import './net.css';

const S = { net: null, avatars: null, chat: null, stats: null, follow: null, offs: [], bg: 0, last: 0 };

export default defineFeature({
  id: 'net', order: 5,

  menu(api) {
    api.ui.addMenuButton({ label: 'Entrar em um planeta', hint: 'Jogar no planeta de um amigo (código ou link)', onClick: () => openJoinPanel(api) });
    api.ui.addMenuButton({ label: '🌍 Salas públicas', hint: 'Ver e entrar em mundos abertos agora', onClick: () => openLobbyPanel(api) });
    let j = null; try { j = new URLSearchParams(location.search).get('join'); } catch { /* no location */ }
    if (j && parseJoin(j).kind !== 'bad') setTimeout(() => openJoinPanel(api, j), 0);       // shareable link: ?join=ABCD-EF12
    let pub = null; try { pub = new URLSearchParams(location.search).get('pub'); } catch { /* no location */ }
    if (pub && roomById(pub)) setTimeout(() => enterPublicRoom(api, pub), 0);                 // way back into an official room: ?pub=praca
  },

  init(ctx) {
    const net = S.net = ctx.net instanceof Net ? ctx.net : new Net(ctx.events, ctx.identity);
    net.attach(ctx);
    ctx.net = net; ctx.dome = net.dome;
    const open = () => openNetPanel(ctx, net);
    ctx.ui.addToolbarButton({ id: 'net', icon: '🌐', title: 'Online / domo', key: 'O', onClick: open });
    ctx.addHotkey('KeyO', open);
    // one-click social buttons: 🔗 opens the dome and copies a link (the friend just opens it) · 🧭 teleports to a friend
    const invite = async () => {
      if (net.role === 'guest') { ctx.ui.toast('Só o dono do planeta gera convites'); return; }
      if (!canHost()) { ctx.ui.toast(NO_HOST_TEXT); return; }
      if (net.dome.mode === 'closed') net.dome.set('open');
      for (let i = 0; i < 20 && !(net.hostInfo && net.hostInfo.link); i++) await new Promise((r) => setTimeout(r, 100));
      const l = net.hostInfo && net.hostInfo.link; if (!l) { ctx.ui.toast('Não consegui abrir o domo agora'); return; }
      try { await navigator.clipboard.writeText(l); ctx.ui.toast('🔗 Link copiado! Mande para o seu amigo: ele só precisa abrir. (Deixe esta aba aberta.)'); } catch { ctx.ui.toast('Link: ' + l, 9000); }
    };
    const gotoFriend = () => {
      const list = [...net.players.values()].filter((p) => p.hasPos);
      if (!list.length) { ctx.ui.toast(net.players.size ? 'Aguardando a posição do amigo…' : 'Ninguém online ainda — use 🔗 para convidar'); return; }
      const pl = ctx.player; list.sort((a, b) => Math.hypot(a.pos.x - pl.x, a.pos.z - pl.z) - Math.hypot(b.pos.x - pl.x, b.pos.z - pl.z));
      const t = list[0]; ctx.player.teleport(t.pos.x + 1.4, t.pos.y + 0.3, t.pos.z); ctx.ui.toast('Teleportado até ' + t.name);
    };
    net.inviteLink = invite; net.gotoFriend = gotoFriend;
    ctx.ui.addToolbarButton({ id: 'invite', icon: '🔗', title: 'Convidar amigo (copia o link)', onClick: invite });
    ctx.ui.addToolbarButton({ id: 'goto', icon: '🧭', title: 'Ir até o amigo', onClick: gotoFriend });
    S.chat = createChatHud(ctx, net); S.stats = createStatsLine(ctx, net); S.follow = net.spectate = createFollow(ctx, net);
    S.offs.push(
      ctx.events.on('net:role', (e) => { ctx.role = e.role; ctx.ui.setPlanetBadge(badge(ctx, net)); }),
      ctx.events.on('dome:change', () => ctx.ui.setPlanetBadge(badge(ctx, net))),
      ctx.events.on('net:closed', (e) => showClosed(ctx, e.text)),
    );
    if (net.role === 'guest') ctx.ui.setPlanetBadge(badge(ctx, net));
    // a hidden tab gets no animation frames: keep the connection alive (pings, edits, snapshots) from a timer instead
    S.bg = setInterval(() => { if (!document.hidden || net.role === 'solo' || !ctx.ready) return; const now = performance.now(); net.tick(Math.min(0.5, (now - S.last) / 1000)); S.last = now; }, 250);
  },

  ready(ctx) {
    const net = S.net; if (!net) return;
    net.flushEarly();
    const pr = ctx.planet && ctx.planet.publicRoom;
    if (pr && net.role === 'solo') hostPublicRoom(ctx, net, pr);                 // first arrival: take the host seat of this official room
    if (pr && net.role === 'guest') ctx.events.on('net:closed', () => { ctx.ui.toast('O anfitrião da sala saiu — reentrando…'); setTimeout(() => { try { location.href = location.origin + location.pathname + '?pub=' + pr.id; } catch { /* ignore */ } }, 2500); });
    if (net.role === 'guest') {
      const w = net.welcome, hz = window.__hz;
      if (w && w.pos && hz && hz.teleport) hz.teleport(w.pos[0] + 1.5, w.pos[1] + 0.5, w.pos[2]);       // spawn next to the host
      ctx.ui.toast('Você está no planeta de ' + net.hostName + ' · O: jogadores e chat · Enter: falar');
    }
  },

  update(dt, ctx) {
    const net = S.net; if (!net) return;
    S.last = performance.now();
    net.tick(dt);
    if (net.players.size && !S.avatars && ctx.gr && ctx.gr.shared) { try { S.avatars = new Avatars(ctx.gr); } catch (e) { console.error('[HZ] avatars unavailable:', e); net.players.clear(); } }
    if (S.follow) S.follow.update(dt);
    if (S.avatars) S.avatars.update(dt, ctx.camera.position, net.players);
    if (S.stats) S.stats.update();
  },

  dispose() {
    clearInterval(S.bg); for (const o of S.offs) o(); S.offs.length = 0;
    if (S.follow) S.follow.stop(); if (S.avatars) S.avatars.dispose(); if (S.chat) S.chat.dispose(); if (S.stats) S.stats.dispose();
    if (S.net) S.net.dispose();
    S.net = S.avatars = S.chat = S.stats = S.follow = null;
  },
});

function badge(ctx, net) {
  const p = ctx.planet, esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tag = net.role === 'guest' ? ' · visitante' : net.role === 'host' ? ' · domo ' + (net.dome.mode === 'invite' ? 'por convite' : 'aberto') : '';
  return p.name ? `<b>${esc(p.name)}</b>${p.address ? ' · ' + esc(p.address) : ''}${tag}` : '';
}

/** become the host of an official public room: fixed code, open dome, listed; PvP / horde per the room's rules */
async function hostPublicRoom(ctx, net, pr) {
  const def = roomById(pr.id); if (!def) return;
  try {
    await net.startHosting({ mode: 'open', code: pr.code });
    net.dome.setPerm('pvp', !!def.pvp);
    await net.setPublic(true, def.icon + ' ' + def.name);
    ctx.ui.toast(def.icon + ' Você abriu a sala “' + def.name + '” — quem entrar vai cair aqui com você');
    if (def.horde && ctx.horde) setTimeout(() => ctx.horde.start(1), 4000);
  } catch (e) { console.warn('[HZ] public room host failed:', e); ctx.ui.toast('Não consegui abrir a sala pública: ' + (e && e.message ? e.message : e)); }
}
