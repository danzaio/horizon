// Inventory / creative panel (key E): tabs Blocos · Ferramentas · Armas · Especiais · Minigame, search, click-to-equip, drag onto slots.
// It re-uses the existing #palette overlay (ui.showPalette / E / Esc / 1-9 handling stay in ui.js + main.js).
import { PLACEABLE } from '../../shared/blocks.js';
import { drawBlockIcon } from '../../ui/icons.js';
import { blockLabel } from '../../ui/ui.js';

const TABS = [['block', 'Blocos'], ['tool', 'Ferramentas'], ['weapon', 'Armas'], ['special', 'Especiais'], ['minigame', 'Minigame']];

/** @param {import('./index.js').Runtime} S */
export function installPalette(S) {
  const root = document.getElementById('palette'), panel = root && root.querySelector('.panel');
  if (!panel) return () => {};
  panel.classList.add('inv-panel');
  panel.innerHTML = '<div class="panel-head"><h2>Inventário</h2><span class="dim">Clique para equipar · arraste para um slot · 1–9 muda de slot · E ou Esc fecha</span></div>' +
    '<div class="inv-bar"><div class="inv-tabs"></div><input class="inv-search" type="text" placeholder="Buscar…" maxlength="30" spellcheck="false" autocomplete="off"></div>' +
    '<div id="palette-grid"></div><div class="inv-desc"></div><div class="inv-slots"></div>';
  const tabsEl = panel.querySelector('.inv-tabs'), search = panel.querySelector('.inv-search'), grid = panel.querySelector('#palette-grid'), desc = panel.querySelector('.inv-desc'), slotsEl = panel.querySelector('.inv-slots');
  let tab = 'block';
  try { tab = sessionStorage.getItem('hz.invTab') || 'block'; } catch { /* storage unavailable */ }

  const valueLabel = (v) => (typeof v === 'string' ? (S.items.get(v) ? S.items.get(v).name : v) : v ? blockLabel(v) : '');
  const drawValue = (canvas, v) => {
    if (typeof v === 'string') S.drawItemIcon(canvas, v); else if (v) drawBlockIcon(canvas, v); else canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
  };
  const equip = (v) => {
    if (S.inventory.locked) { S.toast('O inventário está bloqueado pelo minigame'); return; }
    S.inventory.setSlot(S.hotbar.sel, v); renderSlots();
  };

  TABS.forEach(([id, label]) => {
    const b = document.createElement('button'); b.className = 'inv-tab'; b.textContent = label; b.dataset.tab = id; b.type = 'button';
    b.addEventListener('click', () => { tab = id; search.value = ''; try { sessionStorage.setItem('hz.invTab', tab); } catch { /* ignore */ } renderGrid(); });
    tabsEl.appendChild(b);
  });

  const cell = (v, label, d) => {
    const el = document.createElement('div'); el.className = 'pal'; el.draggable = true;
    if (typeof v === 'string') el.dataset.item = v; else el.dataset.id = v;
    el.innerHTML = '<canvas width="32" height="32"></canvas><span></span>'; el.lastChild.textContent = label;
    drawValue(el.firstChild, v);
    el.addEventListener('click', () => equip(v));
    el.addEventListener('mouseenter', () => { desc.textContent = d || label; });
    el.addEventListener('dragstart', (e) => { try { e.dataTransfer.setData('text/plain', typeof v === 'string' ? 'i:' + v : 'b:' + v); e.dataTransfer.effectAllowed = 'copy'; } catch { /* ignore */ } });
    return el;
  };

  function renderGrid() {
    const q = search.value.trim().toLowerCase();
    for (const t of tabsEl.children) t.classList.toggle('on', t.dataset.tab === tab && !q);
    grid.textContent = '';
    const frag = document.createDocumentFragment();
    const matches = (name) => !q || name.toLowerCase().includes(q);
    if (q || tab === 'block') for (const id of PLACEABLE) { const n = blockLabel(id); if (matches(n)) frag.appendChild(cell(id, n, n)); }
    for (const d of S.items.all()) {
      if (q ? !matches(d.name) : d.category !== tab) continue;
      frag.appendChild(cell(d.id, d.name, d.desc ? `${d.name} — ${d.desc}` : d.name));
    }
    if (!frag.childNodes.length) { const p = document.createElement('div'); p.className = 'dim inv-empty'; p.textContent = tab === 'minigame' && !q ? 'Itens de minigame aparecem aqui quando um jogo os registra.' : 'Nada encontrado.'; frag.appendChild(p); }
    grid.appendChild(frag);
    desc.textContent = '';
  }

  // the 9 hotbar slots, mirrored inside the panel (drop targets)
  const slotEls = [];
  for (let i = 0; i < 9; i++) {
    const d = document.createElement('div'); d.className = 'inv-slot'; d.innerHTML = `<em>${i + 1}</em><canvas width="32" height="32"></canvas>`;
    d.addEventListener('click', () => S.ui.cb.selectSlot(i));
    d.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!S.inventory.locked) S.inventory.setSlot(i, null); renderSlots(); });
    d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('drop'); });
    d.addEventListener('dragleave', () => d.classList.remove('drop'));
    d.addEventListener('drop', (e) => {
      e.preventDefault(); d.classList.remove('drop');
      let t = ''; try { t = e.dataTransfer.getData('text/plain'); } catch { /* ignore */ }
      if (t.startsWith('i:')) S.inventory.setSlot(i, t.slice(2)); else if (t.startsWith('b:')) S.inventory.setSlot(i, +t.slice(2) | 0);
      renderSlots();
    });
    slotsEl.appendChild(d); slotEls.push(d);
  }
  function renderSlots() {
    const s = S.hotbar.slots;
    slotEls.forEach((d, i) => { d.classList.toggle('sel', i === S.hotbar.sel); d.title = valueLabel(s[i]); drawValue(d.querySelector('canvas'), s[i]); });
  }

  search.addEventListener('input', renderGrid);
  search.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.code === 'Escape') { search.blur(); S.ui.cb.palette(); } });

  S.ui.onPalette = (on) => { if (on) { renderGrid(); renderSlots(); } };
  S.ui.onIcons = () => { if (S.ui.paletteOpen) { renderGrid(); renderSlots(); } };
  const off = S.inventory.onChange(() => { if (S.ui.paletteOpen) renderSlots(); });
  return () => { off(); S.ui.onPalette = null; S.ui.onIcons = null; };
}
