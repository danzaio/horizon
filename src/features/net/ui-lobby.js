// Menu: "Salas públicas" — worlds that hosts chose to list. Opens a short-lived connection to the public lobby, shows adverts as they arrive.
import { lobbyJoin } from './signal.js';
import { canHost, NO_HOST_TEXT } from './net.js';
import { openJoinPanel } from './ui-join.js';
import { h } from './dom.js';

const TYPE = { verdant: 'Verdejante', lush: 'Exuberante', desert: 'Deserto', frozen: 'Gelado', volcanic: 'Vulcânico', ocean: 'Oceano', alien: 'Alienígena', barren: 'Árido' };
const TTL = 20000;

export function openLobbyPanel(api) {
  const { ui } = api;
  const ads = new Map(), body = h('div', { class: 'nt-wrap' }), status = h('div', { class: 'nt-status' }), list = h('div', { class: 'nt-lobby' });
  body.append(status, list);
  let handle = null, timer = 0, closed = false, panel = null;
  const render = () => {
    const now = performance.now(), rows = [];
    for (const [k, e] of ads) { if (now - e.seen > TTL) { ads.delete(k); continue; } rows.push(e); }
    rows.sort((a, b) => b.ad.p - a.ad.p);
    if (handle) { const st = handle.status(); status.className = 'nt-status' + (st.open ? ' ok' : ''); status.textContent = st.open ? 'Conectado às redes públicas (' + st.text + ')' : 'Conectando às redes públicas… ' + st.text + ' — se ficar em 0, sua rede bloqueia; use um link de convite.'; }
    if (!rows.length) { list.replaceChildren(h('p', { class: 'dim', text: 'Nenhuma sala pública agora. Para criar a sua: entre no seu planeta, abra o painel Online (O), escolha “Aberto” e marque “Listar na lista pública”.' })); return; }
    list.replaceChildren(...rows.map(({ ad }) => h('div', { class: 'nt-room' },
      h('div', { class: 'nt-rinfo' }, h('b', { text: ad.n }), h('span', { class: 'dim', text: ' · ' + ad.o + (ad.t ? ' · ' + (TYPE[ad.t] || ad.t) : '') })),
      h('span', { class: 'nt-rcount', text: ad.p + '/' + ad.m }),
      h('button', { class: 'btn primary sm', type: 'button', disabled: ad.p >= ad.m, text: ad.p >= ad.m ? 'Cheia' : 'Entrar', onclick: () => { stop(); if (panel) panel.close(); openJoinPanel(api, ad.c); } }))));
  };
  const stop = () => { closed = true; clearInterval(timer); if (handle) { handle.stop(); handle = null; } };
  if (!canHost()) { body.replaceChildren(h('p', { class: 'nt-warn', text: NO_HOST_TEXT })); }
  else {
    status.textContent = 'Procurando salas…';
    lobbyJoin({ onAd: (ad, peer) => ads.set(ad.c, { ad, seen: performance.now(), peer }) }).then((hd) => { if (closed) hd.stop(); else handle = hd; }).catch((e) => { status.className = 'nt-status err'; status.textContent = 'Não foi possível acessar as redes públicas: ' + (e && e.message ? e.message : e); });
    timer = setInterval(render, 1000); render();
  }
  panel = ui.panel({ id: 'lobby', title: 'Salas públicas', subtitle: 'mundos abertos agora', content: body, width: 560, onClose: stop });
  return panel;
}
