// Menu flow: "Entrar em um planeta" (room code / ?join= link / manual invite-answer codes) -> welcome -> api.startGame(guest).
import { Net, rtcAvailable, canHost, NO_HOST_TEXT } from './net.js';
import { parseJoin } from './protocol.js';
import { localConnect, localAvailable, trysteroConnect, answerManualInvite } from './signal.js';
import { h, copyButton, qrCanvas } from './dom.js';

const urlFlag = (k) => { try { return new URLSearchParams(location.search).get(k); } catch { return null; } };

/** Race the local lobby (same browser) and the public rendezvous; first transport wins, the loser is closed. */
export function connectByCode(room, onStatus) {
  if (!canHost()) return Promise.reject(new Error(NO_HOST_TEXT));
  const tries = [];
  tries.push(localAvailable() ? localConnect(room, 1800) : Promise.reject(new Error('local')));
  const useT = rtcAvailable() && urlFlag('nettrystero') !== '0';
  if (useT) { onStatus('Procurando o anfitrião na rede pública…'); tries.push(trysteroConnect(room, 40000)); }
  return new Promise((resolve, reject) => {
    let won = false, left = tries.length, lastErr = null;
    for (const p of tries) p.then((tr) => { if (won) { tr.close('lost-race'); return; } won = true; resolve(tr); }, (e) => {
      if (e && e.message !== 'Nenhuma aba respondeu' && e.message !== 'local') lastErr = e;
      if (--left === 0 && !won) reject(lastErr || new Error(useT ? 'Nenhum anfitrião encontrado com esse código.' : 'Nenhuma aba deste navegador respondeu a esse código. (A rede pública está indisponível aqui: use o modo manual.)'));
    });
  });
}

/** Opens the join panel. `prefill` auto-starts when it came from a ?join= link. */
export function openJoinPanel(api, prefill) {
  const { ui } = api;
  let cur = null, busy = false, panel = null;
  const status = h('div', { class: 'nt-status' });
  const say = (t, cls) => { status.textContent = t; status.className = 'nt-status' + (cls ? ' ' + cls : ''); };
  const code = h('input', { type: 'text', placeholder: 'ABCD-EF12', maxlength: '120', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Código da sala' });
  const go = h('button', { class: 'btn primary', type: 'button', text: 'Entrar', disabled: !canHost() });

  async function finish(net, tr, token, timeoutMs, room) {
    try {
      if (tr.state === 'open') say('Conectado. Recebendo o planeta…'); else tr.on('open', () => say('Conectado. Recebendo o planeta…'));
      const w = await net.join(tr, { token, timeoutMs });
      say('Pronto! Carregando o mundo de ' + w.planet.ownerName + '…', 'ok');
      cur = null; if (panel) panel.close();
      if (room) net.rejoin = { connect: () => connectByCode(room, () => {}) };
      api.startGame({ planet: w.planet, edits: w.edits, net, role: 'guest' });
    } catch (e) { say(e.message || String(e), 'err'); busy = false; go.disabled = false; throw e; }
  }

  async function start() {
    if (busy) return;
    const p = parseJoin(code.value);
    if (p.kind === 'bad') { say('Código inválido. Ele tem 8 letras/números, como ABCD-EF12.', 'err'); return; }
    if (p.kind === 'manual') { manualBox.open = true; manualIn.value = p.code; manualBtn.click(); return; }
    busy = true; go.disabled = true; say('Procurando o anfitrião…');
    const net = new Net(api.events, api.identity);
    try {
      let tr = null, lastErr = null;
      for (let attempt = 1; attempt <= 3 && !tr; attempt++) {     // the host may still be reaching the public relays: keep looking for ~2 min
        try { tr = await connectByCode(p.room, say); } catch (e) { lastErr = e; if (attempt < 3) say('Ainda procurando o anfitrião… (tentativa ' + (attempt + 1) + '/3) — ele precisa estar com o jogo aberto.'); }
      }
      if (!tr) throw lastErr || new Error('Anfitrião não encontrado.');
      cur = tr; await finish(net, tr, p.token, 25000, p.room);
    } catch (e) { say((e.message || String(e)) + ' Dica: peça ao amigo para clicar em 🔗 de novo e mandar o link novo, ou use o modo manual.', 'err'); busy = false; go.disabled = false; }
  }
  go.addEventListener('click', start);
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });

  // ---- manual mode
  const manualIn = h('textarea', { placeholder: 'hz1.…', 'aria-label': 'Código de convite', spellcheck: 'false' });
  const ansOut = h('textarea', { readonly: true, 'aria-label': 'Código de resposta' });
  const ansBox = h('div', { class: 'nt-steps', style: 'display:none' });
  const manualBtn = h('button', { class: 'btn', type: 'button', text: 'Gerar resposta' });
  const manualBox = h('details', { class: 'nt-manual' }, h('summary', { text: 'Modo manual (sem servidor, sem código curto)' }),
    h('div', { class: 'nt-steps' },
      h('p', {}, '1. Peça ao anfitrião o ', h('b', { text: 'código de convite' }), ' (ou o link) e cole abaixo:'), manualIn, manualBtn,
      ansBox));
  manualBtn.addEventListener('click', async () => {
    if (busy) return;
    const parsed = parseJoin(manualIn.value), raw = parsed.kind === 'manual' ? parsed.code : manualIn.value;
    busy = true; manualBtn.disabled = true; say('Gerando a resposta…');
    try {
      const net = new Net(api.events, api.identity);
      const { answer, transport } = await answerManualInvite(raw);
      cur = transport; ansOut.value = answer;
      ansBox.style.display = ''; ansBox.replaceChildren(h('p', {}, '2. Envie este ', h('b', { text: 'código de resposta' }), ' ao anfitrião (ele cola no painel dele):'), ansOut,
        h('div', { class: 'nt-row' }, copyButton('Copiar resposta', () => answer, ui)), h('p', { class: 'nt-warn', text: 'Aguardando o anfitrião colar a resposta… esta janela conecta sozinha.' }));
      qrCanvas(answer).then((c) => { if (c) ansBox.append(c); });
      say('Resposta pronta. Envie ao anfitrião e aguarde.');
      await finish(net, transport, '', 600000);
    } catch (e) { say(e.message || String(e), 'err'); busy = false; manualBtn.disabled = false; }
  });

  const noRtc = !rtcAvailable();
  const body = h('div', { class: 'nt-wrap' },
    h('p', { text: 'Digite o código da sala que o anfitrião mostrou (ou abra o link que ele mandou).' }),
    h('label', { class: 'field' }, h('span', { text: 'Código da sala' }), code), go, status,
    !canHost() ? h('p', { class: 'nt-warn', text: NO_HOST_TEXT }) : noRtc ? h('p', { class: 'nt-warn', text: 'Este navegador/ambiente não permite WebRTC (por exemplo, dentro do Artifact do Claude): só é possível entrar em planetas abertos em outra aba deste mesmo navegador.' }) : manualBox,
    h('p', { class: 'nt-warn', text: 'Conexão direta entre navegadores (WebRTC, só STUN, sem servidor de retransmissão): algumas redes (CGNAT, Wi‑Fi corporativo, 4G) bloqueiam a ligação e não há como contornar sem um servidor.' }));
  panel = ui.panel({ id: 'net-join', title: 'Entrar em um planeta', subtitle: 'multijogador direto, sem servidor', content: body, width: 520, onClose: () => { if (cur) cur.close('cancelled'); } });
  if (prefill) { code.value = prefill; setTimeout(start, 50); }
  return panel;
}
