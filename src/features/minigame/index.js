// Minigame toolkit (feature "minigame", key Y): GameDef schema, authority-side rule runtime, HUD, in-world editor, templates, browser, share codes.
// Public API: ctx.mg (docs/CONTRACT2.md §3 "M"). Format and rule engine: docs/MINIGAMES.md. Idle cost: no per-frame work unless a game or the editor is on.
import { defineFeature } from '../registry.js';
import { validateGameDef, emptyGameDef } from './schema.js';
import { exportCode, importCode, importAny } from './codec.js';
import { makeTemplates } from './templates.js';
import { Session } from './session.js';
import { Editor } from './editor.js';
import { openBrowser } from './browser.js';
import { saveGame } from './store.js';
import { h } from './dom.js';

/** relative bounding box of arena ops + entities */
function bounds(def) {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  const add = (x, z, w, d) => { x0 = Math.min(x0, x); z0 = Math.min(z0, z); x1 = Math.max(x1, x + w); z1 = Math.max(z1, z + d); };
  for (const o of def.arena) add(o.x, o.z, o.w, o.d);
  for (const e of def.entities) if (e.type !== 'killzone') add(e.x, e.z, e.w, e.d);
  return x0 > x1 ? { x0: 0, z0: 0, x1: 0, z1: 0 } : { x0, z0, x1, z1 };
}

export default defineFeature({
  id: 'minigame', order: 60,

  init(ctx) {
    let tpl = null;                                   // templates are generated on first use (zero work for players who never open the minigames)
    const session = new Session(ctx);
    const api = {
      get templates() { return tpl || (tpl = makeTemplates()); },
      /** Moves a game so that its footprint is centred on the player, `lift` blocks above the player's feet. */
      placeHere(def, lift = 0) {
        const p = ctx.player, b = bounds(def);
        def.anchor = { x: Math.floor(p.x - (b.x0 + b.x1) / 2), y: Math.max(2, Math.min(150, Math.floor(p.y) + lift)), z: Math.floor(p.z - (b.z0 + b.z1) / 2) };
      },
      browse: () => openBrowser(ctx, api),
      play(def, lift) { const d = structuredClone(def); if (lift !== null && lift !== undefined) api.placeHere(d, lift); if (editor.on) editor.close(); session.start(d, { lobby: hasPeers() }); },
      edit(def, id) { editor.open(def ? structuredClone(def) : emptyGameDef(), id); },
      importDialog() { editor.tab = 'file'; editor.open(); },
    };
    const editor = new Editor(ctx, session, api);
    const hasPeers = () => !!(ctx.net && ctx.net.role === 'host' && ctx.net.players && ctx.net.players.size > 0);   // hosting with company => waiting room first

    const gameMenu = () => {
      const body = h('div', { class: 'mg-ed' }, h('div', { class: 'mg-hint' }, `Jogo em andamento: ${session.def ? session.def.meta.name : ''} (${session.state})`));
      const row = h('div', { class: 'btn-row' });
      let p = null;
      if (session.isAuthority && session.state === 'lobby') row.append(h('button', { class: 'btn primary', onclick: () => { p.close(); session.begin(); } }, '▶ Começar agora'));
      else if (session.isAuthority) row.append(h('button', { class: 'btn primary', onclick: () => { p.close(); session.restart(); } }, '↻ Reiniciar'));
      row.append(h('button', { class: 'btn danger', onclick: () => { p.close(); session.stop(); } }, session.isAuthority ? 'Encerrar jogo' : 'Sair do jogo'));
      body.append(row);
      p = ctx.ui.panel({ id: 'mg-game', title: '🎮 Minigame', content: body, width: 360 });
    };
    const onY = () => {
      if (session.active) return gameMenu();
      if (editor.on) return editor.togglePanel();
      if (editor.def) return editor.open();
      api.browse();
    };

    ctx.mg = {
      openEditor: () => (editor.on ? editor.openPanel() : editor.open()),
      openBrowser: () => api.browse(),
      get current() { return session.def; },
      get state() { return session.state; },
      /** Start a game (validated GameDef, or the one being edited). Authority only; guests get a toast. */
      start(def) { const d = def ? validateGameDef(def).def : editor.def || null; if (!d) { api.browse(); return false; } if (editor.on) editor.close(); return session.start(structuredClone(d), { lobby: hasPeers() }); },
      stop: () => session.stop(),
      get localTeam() { return ctx.localState.team || null; },
      teamOf: (id) => session.teamOf(id),
      exportCode: (def) => exportCode(def),
      importCode: async (str) => (await importCode(str)).def,
      get templates() { return api.templates.map((t) => t.def); },
      /** internals (tests / other features) */
      _session: session, _editor: editor, _api: api,
    };

    ctx.ui.addToolbarButton({ id: 'mg', icon: '🎮', title: 'Minigames', key: 'Y', onClick: onY });
    ctx.addHotkey('KeyY', onY);
    this._ctx = ctx;
  },

  async ready(ctx) {
    const code = new URLSearchParams(location.search).get('game');
    if (!code || !ctx.mg) return;
    try {
      const { def, warnings } = await importAny(code); saveGame(def);
      ctx.ui.toast(`Jogo recebido: ${def.meta.name}${warnings.length ? ' (com ajustes)' : ''} — abra com Y`); ctx.mg.openBrowser();
    } catch (e) { ctx.ui.toast('Link de jogo inválido: ' + e.message); }
  },

  update(dt, ctx) {
    const mg = ctx.mg; if (!mg) return;
    mg._session.update(dt); mg._editor.update(dt);
  },

  dispose(ctx) { if (ctx.mg) { ctx.mg._session.stop(true); ctx.mg._editor.close(); } },
});
