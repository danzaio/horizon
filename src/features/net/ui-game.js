// In-game UI: the "O" panel (host: dome / invite / players / permissions / chat · guest: players / chat / leave), the fading chat overlay and the F3 stats line.
import { h, copyButton, qrCanvas, safeColor } from './dom.js';
import { rtcAvailable, canHost, NO_HOST_TEXT } from './net.js';

const MODES = [
  { m: 'closed', ic: '🔒', name: 'Fechado', d: 'Só você. Ninguém de fora entra.' },
  { m: 'open', ic: '🌐', name: 'Aberto', d: 'Qualquer pessoa com o código ou o link entra.' },
  { m: 'invite', ic: '🎟️', name: 'Por convite', d: 'Só quem tiver um convite de uso único.' },
];
const PERMS = [['build', 'Construir'], ['break', 'Quebrar blocos'], ['pvp', 'Combate entre jogadores'], ['fly', 'Voar']];
const MODE_TXT = { closed: 'Domo fechado: ninguém de fora pode entrar.', open: 'Domo aberto: qualquer pessoa com o código ou o link pode entrar.', invite: 'Domo por convite: só entra quem tiver um convite de uso único.' };

function chatLine(rec) {
  const d = h('div', { class: 'm' + (rec.sys ? ' sys' : '') });
  if (rec.sys) d.textContent = rec.text;
  else { const n = h('b', { text: rec.name + ':' }); n.style.color = safeColor(rec.color); d.append(n, document.createTextNode(rec.text)); }
  return d;
}

/** Chat log + input (used inside the panel). */
function chatBox(net) {
  const log = h('div', { class: 'nt-chatlog' }), inp = h('input', { class: 'nt-chatin', type: 'text', maxlength: '200', placeholder: 'Escreva e pressione Enter…', autocomplete: 'off' });
  const add = (rec) => { const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 30; log.append(chatLine(rec)); if (stick) log.scrollTop = log.scrollHeight; };
  for (const r of net.chatLog) add(r);
  log.scrollTop = log.scrollHeight;
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value.trim()) { net.chat(inp.value); inp.value = ''; } });
  return { el: h('div', { class: 'nt-wrap' }, h('h3', { text: 'Chat' }), log, inp), add };
}

export function openNetPanel(ctx, net) {
  const { ui } = ctx, offs = [], qrCache = new Map();
  const guest = net.role === 'guest';
  const top = h('div', { class: 'nt-wrap' }), players = h('div', { class: 'nt-players' }), permsBox = h('div', { class: 'nt-perms' });
  const chat = chatBox(net);

  // ---- dome / invite (host or solo)
  function renderTop() {
    if (net.role === 'guest') {
      top.replaceChildren(h('p', {}, '🌐 Você está no planeta de ', h('b', { text: net.hostName }), ' · ping ', h('b', { text: net.hostPing + ' ms' })),
        h('div', { class: 'nt-row' }, h('button', { class: 'btn danger', type: 'button', text: 'Sair do planeta', onclick: () => { net.leave(); setTimeout(() => { location.href = location.pathname; }, 150); } })));
      return;
    }
    const mode = net.dome.mode, info = net.hostInfo;
    const can = canHost();
    const seg = h('div', { class: 'nt-dome' }, MODES.map((o) => h('button', { type: 'button', 'data-m': o.m, class: mode === o.m ? 'on' : '', disabled: !can && o.m !== 'closed', style: !can && o.m !== 'closed' ? 'opacity:.4;cursor:not-allowed' : '', onclick: () => net.dome.set(o.m) },
      h('span', { class: 'ic', text: o.ic }), h('b', { text: o.name }), h('span', { class: 'd', text: o.d }))));
    const kids = [seg, h('p', { text: MODE_TXT[mode] })];
    if (!can) kids.push(h('p', { class: 'nt-warn', text: NO_HOST_TEXT }));
    else if (!rtcAvailable()) kids.push(h('p', { class: 'nt-warn', text: 'Este navegador/ambiente não permite WebRTC (ex.: dentro do Artifact do Claude): só abas do mesmo navegador conseguem entrar.' }));
    if (info && mode !== 'closed') {
      const qrSlot = h('div');
      if (!qrCache.has(info.link)) qrCanvas(info.link, 150).then((c) => { if (c) { qrCache.set(info.link, c); qrSlot.append(c); } }); else qrSlot.append(qrCache.get(info.link));
      kids.push(h('h3', { text: 'Convidar' }),
        h('div', { class: 'nt-row' }, h('span', { class: 'nt-code', text: info.code }), copyButton('Copiar código', () => info.code, ui), copyButton('Copiar link', () => info.link, ui)), qrSlot,
        h('p', { class: 'nt-warn', text: 'Código curto: ' + (info.trystero === 'on' ? 'rede pública de sinalização conectada (funciona com qualquer amigo).' : info.trystero === 'connecting' ? 'conectando à rede pública de sinalização…' : info.trystero === 'failed' ? 'rede pública indisponível (' + info.trysteroError + '). Use o modo manual abaixo.' : 'rede pública desligada: só abas do mesmo navegador. Use o modo manual para amigos.') }));
      if (mode === 'invite') kids.push(inviteBox());
      kids.push(manualBox());
    }
    top.replaceChildren(...kids);
  }
  let inviteOut = null, manual = null;
  function inviteBox() {
    const out = inviteOut || (inviteOut = h('div'));
    return h('div', { class: 'nt-steps' }, h('div', { class: 'nt-row' }, h('button', { class: 'btn sm', type: 'button', text: 'Gerar convite de uso único', onclick: () => {
      const inv = net.newInvite(); if (!inv) return;
      out.replaceChildren(h('div', { class: 'nt-row' }, h('span', { class: 'nt-code', style: 'font-size:18px', text: inv.code }), copyButton('Copiar código', () => inv.code, ui), copyButton('Copiar link', () => inv.link, ui)));
      qrCanvas(inv.link, 150).then((c) => { if (c) out.append(c); });
    } })), out);
  }
  function manualBox() {
    const d = h('details', { class: 'nt-manual' }, h('summary', { text: 'Convidar sem servidor (modo manual)' }));
    const body = h('div', { class: 'nt-steps' }); d.append(body);
    if (manual) { body.append(manual); d.open = true; return d; }
    const start = h('button', { class: 'btn sm', type: 'button', text: 'Criar convite para um amigo', onclick: async () => {
      start.disabled = true;
      try {
        const inv = await net.newManualInvite(), ans = h('textarea', { placeholder: 'Cole aqui o código de resposta do seu amigo (hz1.…)', spellcheck: 'false' }), st = h('div', { class: 'nt-status' });
        const code = h('textarea', { readonly: true }); code.value = inv.code;
        const link = (net.hostInfo.link.split('?')[0]) + '?join=' + inv.code;
        manual = h('div', { class: 'nt-steps' }, h('p', {}, '1. Envie este ', h('b', { text: 'convite' }), ' ao seu amigo (ele abre “Entrar em um planeta”, “Modo manual”):'), code,
          h('div', { class: 'nt-row' }, copyButton('Copiar convite', () => inv.code, ui), copyButton('Copiar link', () => link, ui)),
          h('p', {}, '2. Cole abaixo o ', h('b', { text: 'código de resposta' }), ' que ele gerar:'), ans,
          h('div', { class: 'nt-row' }, h('button', { class: 'btn sm primary', type: 'button', text: 'Conectar', onclick: async () => { st.className = 'nt-status'; st.textContent = 'Conectando…'; try { await inv.accept(ans.value); st.className = 'nt-status ok'; st.textContent = 'Conectando com o seu amigo…'; manual = null; setTimeout(renderTop, 1500); } catch (e) { st.className = 'nt-status err'; st.textContent = e.message || String(e); } } }),
            h('button', { class: 'btn sm ghost', type: 'button', text: 'Cancelar', onclick: () => { inv.cancel(); manual = null; renderTop(); } })), st);
        qrCanvas(link, 150).then((c) => { if (c && manual) manual.append(c); });
        body.replaceChildren(manual);
      } catch (e) { start.disabled = false; ui.toast(e.message || String(e)); }
    } });
    body.append(h('p', { text: 'Funciona sem nenhuma rede pública: você troca dois códigos curtos com o amigo (por chat, e-mail…).' }), start);
    return d;
  }

  // ---- players
  function renderPlayers() {
    const rows = [], cap = net.dome.maxPlayers;
    const me = h('div', { class: 'nt-pl' }, h('i', { style: 'background:' + safeColor(ctx.identity.color) }), h('span', { class: 'n', text: ctx.identity.name + ' (você)' }), h('span', { class: 'p', text: net.role === 'guest' ? net.hostPing + ' ms' : '' }));
    rows.push(me);
    for (const p of net.players.values()) {
      const r = h('div', { class: 'nt-pl' }, h('i', { style: 'background:' + safeColor(p.color) }), h('span', { class: 'n', text: p.name + (p.id === net.hostId ? ' · anfitrião' : '') }), h('span', { class: 'p', text: Math.round(p.ping) + ' ms' }));
      if (p.hasPos && net.spectate) r.append(h('button', { class: 'btn sm ghost', type: 'button', title: 'Seguir (câmera)', text: '👁', onclick: () => net.spectate.start(p.id) }));
      if (p.hasPos) r.append(h('button', { class: 'btn sm ghost', type: 'button', title: 'Teleportar até o jogador', text: '➜', onclick: () => { const hz = window.__hz; if (hz && hz.teleport) hz.teleport(p.pos.x + 1.2, p.pos.y + 0.3, p.pos.z); ui.closePanels(); } }));
      if (net.role === 'host') r.append(h('button', { class: 'btn sm danger', type: 'button', text: 'Expulsar', onclick: () => net.kick(p.id) }));
      rows.push(r);
    }
    players.replaceChildren(h('h3', { text: `Jogadores (${net.players.size + 1}/${cap})` }), ...rows);
  }
  function renderPerms() {
    if (net.role === 'guest') {
      permsBox.replaceChildren(...PERMS.map(([k, label]) => h('span', { class: 'p', text: (net.dome.perms[k] ? '✔ ' : '✖ ') + label })));
      return;
    }
    permsBox.replaceChildren(...PERMS.map(([k, label]) => { const cb = h('input', { type: 'checkbox' }); cb.checked = !!net.dome.perms[k]; cb.addEventListener('change', () => net.dome.setPerm(k, cb.checked)); return h('label', {}, h('span', { text: label }), cb); }));
  }

  const body = h('div', { class: 'nt-wrap' }, top, players, h('h3', { text: net.role === 'guest' ? 'Regras do domo' : 'Permissões dos visitantes' }), permsBox, chat.el);
  const refresh = () => { renderTop(); renderPlayers(); renderPerms(); };
  refresh();
  const ev = ctx.events;
  offs.push(ev.on('dome:change', refresh), ev.on('dome:perms', renderPerms), ev.on('net:role', refresh), ev.on('net:peerJoin', renderPlayers), ev.on('net:peerLeave', renderPlayers),
    ev.on('net:hostInfo', renderTop), ev.on('net:chat', chat.add), ev.on('net:stats', () => { renderPlayers(); if (guest) renderTop(); }));
  const panel = ui.panel({ id: 'net', title: guest ? 'Online · visitante' : 'Online · domo', subtitle: guest ? 'planeta de ' + net.hostName : ctx.planet.name, content: body, width: 560, onClose: () => { for (const o of offs) o(); } });
  if (panel) {
    const onKey = (e) => { if (e.code === 'KeyO' && !(e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) { e.preventDefault(); panel.close(); document.removeEventListener('keydown', onKey, true); } };
    document.addEventListener('keydown', onKey, true);
    const oc = panel.close; panel.close = () => { document.removeEventListener('keydown', onKey, true); oc(); };
  }
  return panel;
}

/** Fading chat overlay in the HUD + Enter-to-type. Returns { dispose }. */
export function createChatHud(ctx, net) {
  const box = h('div', { class: 'nt-hud' }); ctx.ui.hudLayer.append(box);
  let input = null;
  const show = (rec) => {
    const el = chatLine(rec); box.insertBefore(el, input);
    while (box.querySelectorAll('.m').length > 7) box.querySelector('.m').remove();
    setTimeout(() => el.classList.add('old'), 9000); setTimeout(() => el.remove(), 10000);
  };
  const close = () => {
    if (!input) return;
    input.remove(); input = null; const c = ctx.controls; if (c) { c.active = ctx.state === 'playing'; c.reset(); }
  };
  const open = () => {
    if (input || ctx.state !== 'playing') return;
    const c = ctx.controls; c.reset(); c.active = false;
    input = h('input', { class: 'nt-chatin', type: 'text', maxlength: '200', placeholder: net.role === 'solo' ? 'Anotação (só você vê)…' : 'Mensagem para todos…', autocomplete: 'off' });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = input.value.trim(); close(); if (t) net.chat(t); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('blur', () => setTimeout(close, 60));
    box.append(input); input.focus();
  };
  const off = ctx.events.on('net:chat', show);
  ctx.addHotkey('Enter', open);
  return { open, dispose() { off(); close(); box.remove(); ctx.removeHotkey('Enter'); } };
}

/** One-line bandwidth/ping readout shown under the F3 block. */
export function createStatsLine(ctx, net) {
  const el = h('pre', { id: 'net-debug', class: 'hidden' }); document.body.append(el);
  const kb = (n) => (n >= 1024 ? (n / 1024).toFixed(1) + ' KB/s' : n + ' B/s');
  const off = ctx.events.on('net:stats', (s) => { el.textContent = `NET ${s.role === 'host' ? 'anfitrião' : 'visitante'} · ${s.peers} jogador(es) · ping ${Math.round(s.ping)} ms\n↓ ${kb(s.inBps)} (${s.msgIn} msg/s)  ↑ ${kb(s.outBps)} (${s.msgOut} msg/s)`; });
  let shown = false;
  return { update() { const want = net.role !== 'solo' && ctx.ui.debugOn; if (want !== shown) { shown = want; el.classList.toggle('hidden', !want); } }, dispose() { off(); el.remove(); } };
}

/** Modal shown when the host closes the dome / leaves / kicks us: the engine cannot hot-swap worlds, so we go back to the menu. */
export function showClosed(ctx, text) {
  const back = () => { location.href = location.pathname; };
  const body = h('div', { class: 'nt-wrap' }, h('p', { text }), h('p', { class: 'dim', text: 'Você será levado de volta ao menu principal.' }), h('button', { class: 'btn primary', type: 'button', text: 'Voltar ao menu', onclick: back }));
  ctx.ui.closePanels(); ctx.ui.panel({ id: 'net-closed', title: 'Conexão encerrada', content: body, width: 440, onClose: back });
}
