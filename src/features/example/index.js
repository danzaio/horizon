// TEMPLATE FEATURE — copy this folder to start a new one. Only active with ?example=1 so it never ships in the menu.
import { defineFeature } from '../registry.js';

const on = new URLSearchParams(location.search).get('example') === '1';

export default defineFeature({
  id: 'example', order: 999,

  // main-menu phase: no game yet. Add buttons, prepare connections, ...
  menu({ ui }) { if (on) ui.addMenuButton({ label: 'Exemplo (plugin)', onClick: () => ui.panel({ title: 'Plugin de exemplo', content: '<p>Funciona no menu.</p>' }) }); },

  // a game exists: build UI, hotkeys, listeners. `ctx` is documented in docs/CONTRACT2.md
  init(ctx) {
    if (!on) return;
    const open = () => {
      const el = document.createElement('div');
      el.innerHTML = `<p>Planeta: <b>${ctx.planet.name}</b> · papel: ${ctx.role} · jogador: ${ctx.identity.name}</p><button class="btn primary" id="ex-set">Colocar bloco à frente</button>`;
      el.querySelector('#ex-set').onclick = () => {
        const p = ctx.camera.position, d = ctx.camera.getWorldDirection(new ctx.THREE.Vector3());
        ctx.world.applyEdit(Math.floor(p.x + d.x * 3), Math.floor(p.y + d.y * 3), Math.floor(p.z + d.z * 3), 26, 'game');
      };
      ctx.ui.panel({ id: 'example', title: 'Plugin de exemplo', content: el, width: 460 });
    };
    ctx.ui.addToolbarButton({ id: 'example', icon: '🧩', title: 'Exemplo', key: 'H', onClick: open });
    ctx.addHotkey('KeyH', open);
    this.log = [];
    this.off = ctx.events.on('world:blockSet', (e) => { this.log.push(e); window.__exampleLog = this.log; });
  },
  ready(ctx) { if (on) ctx.ui.toast('Plugin de exemplo pronto'); },
  update(dt, ctx) { /* per-frame work goes here (keep it allocation-free) */ },
  dispose() { if (this.off) this.off(); },
});
