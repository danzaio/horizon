// Game browser: templates + the player's saved games, as cards. Play / Edit / Duplicate / Share code / Delete.
import { h } from './dom.js';
import { listGames, saveGame, deleteGame } from './store.js';
import { exportCode } from './codec.js';
import { MODES } from './schema.js';
import { copyText } from './editor.js';

const modeLabel = (m) => (MODES.find((x) => x[0] === m) || [0, m])[1];

/** @param {object} ctx @param {{templates:{id:string,lift:number,def:object}[], play:(def:object,lift:number|null)=>void, edit:(def:object,id:string)=>void}} api */
export function openBrowser(ctx, api) {
  const body = h('div', { class: 'mg-ed' });
  const panel = ctx.ui.panel({ id: 'mg-browser', title: '🕹️ Minigames', subtitle: 'Jogue, edite e compartilhe', content: body, width: 760 });
  if (!panel) return null;
  const card = (def, actions, note) => {
    const M = def.meta, c = h('div', { class: 'mg-card' }), cover = h('div', { class: 'mg-cover' }, M.icon || '🎮'); cover.style.setProperty('--c', M.color);
    const players = M.minPlayers === M.maxPlayers ? `${M.minPlayers}` : `${M.minPlayers}–${M.maxPlayers}`;
    c.append(cover, h('div', { class: 'in' }, h('h4', null, M.name), h('div', { class: 'meta' }, `${modeLabel(M.mode)} · ${players} jogador(es)${M.author ? ' · ' + M.author : ''}${note ? ' · ' + note : ''}`), h('p', null, M.description || 'Sem descrição.'), h('div', { class: 'btns' }, ...actions)));
    return c;
  };
  const render = () => {
    body.replaceChildren();
    const mine = listGames(), sec1 = h('div', { class: 'mg-sec' }, h('h3', null, `Seus jogos (${mine.length})`)), g1 = h('div', { class: 'mg-cards' });
    for (const g of mine) g1.appendChild(card(g.def, [
      h('button', { class: 'btn primary', onclick: () => { panel.close(); api.play(g.def, g.def.arena.length ? 26 : null); } }, g.def.arena.length ? '▶ Jogar aqui' : '▶ Jogar'),
      g.def.arena.length ? h('button', { class: 'btn', onclick: () => { panel.close(); api.play(g.def, null); } }, 'No local salvo') : '',
      h('button', { class: 'btn', onclick: () => { panel.close(); api.edit(g.def, g.id); } }, 'Editar'),
      h('button', { class: 'btn', onclick: () => { const d = structuredClone(g.def); d.meta.name = (d.meta.name + ' (cópia)').slice(0, 40); saveGame(d); render(); } }, 'Duplicar'),
      h('button', { class: 'btn', onclick: async () => copyText(await exportCode(g.def), ctx) }, 'Código'),
      h('button', { class: 'btn danger', onclick: (e) => { if (e.target.dataset.armed) { deleteGame(g.id); render(); } else { e.target.dataset.armed = '1'; e.target.textContent = 'Certeza?'; } } }, 'Excluir')]));
    if (!mine.length) g1.appendChild(h('div', { class: 'note' }, 'Você ainda não salvou nenhum jogo. Crie um no editor (tecla Y) ou comece por um modelo abaixo.'));
    sec1.appendChild(g1);
    body.appendChild(h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => { panel.close(); api.edit(null, ''); } }, '＋ Criar novo jogo'), h('button', { class: 'btn', onclick: () => { panel.close(); api.importDialog(); } }, 'Importar código')));
    body.appendChild(sec1);
    const sec2 = h('div', { class: 'mg-sec' }, h('h3', null, 'Modelos prontos (jogue aqui ou edite uma cópia)')), g2 = h('div', { class: 'mg-cards' });
    for (const t of api.templates) g2.appendChild(card(t.def, [
      h('button', { class: 'btn primary', onclick: () => { panel.close(); api.play(t.def, t.lift); } }, '▶ Jogar aqui'),
      h('button', { class: 'btn', onclick: () => { panel.close(); api.edit(t.def, ''); } }, 'Editar cópia'),
      h('button', { class: 'btn', onclick: async () => copyText(await exportCode(t.def), ctx) }, 'Código')], 'modelo'));
    sec2.appendChild(g2); body.appendChild(sec2);
  };
  render(); return panel;
}
