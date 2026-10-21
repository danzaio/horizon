// UI: menu, loading, pause/settings, HUD (hotbar, toasts, palette), F3 debug overlay. Pure DOM; talks to the game through callbacks.
import { PRESETS, QUALITY_ORDER } from '../shared/quality.js';
import { PLACEABLE, blockName } from '../shared/blocks.js';
import { drawBlockIcon } from './icons.js';
import { drawTitle, drawBackdrop } from './title.js';

const $ = (id) => document.getElementById(id);
const BLOCK_PT = { stone: 'Pedra', dirt: 'Terra', grass: 'Grama', sand: 'Areia', gravel: 'Cascalho', snow: 'Neve', snowy_grass: 'Grama nevada', ice: 'Gelo', oak_log: 'Tronco de carvalho',
  oak_leaves: 'Folhas de carvalho', birch_log: 'Tronco de bétula', birch_leaves: 'Folhas de bétula', spruce_log: 'Tronco de pinheiro', spruce_leaves: 'Folhas de pinheiro', sandstone: 'Arenito',
  cactus: 'Cacto', coal_ore: 'Carvão', iron_ore: 'Minério de ferro', gold_ore: 'Minério de ouro', diamond_ore: 'Diamante', planks: 'Tábuas', cobblestone: 'Pedregulho', glass: 'Vidro',
  glowstone: 'Pedra luminosa', tall_grass: 'Grama alta', red_flower: 'Flor vermelha', yellow_flower: 'Flor amarela', bricks: 'Tijolos', cherry_log: 'Tronco de cerejeira', cherry_leaves: 'Folhas de cerejeira', red_sand: 'Areia vermelha', terracotta: 'Terracota', yellow_terracotta: 'Terracota amarela', red_terracotta: 'Terracota vermelha', white_terracotta: 'Terracota branca', brown_terracotta: 'Terracota marrom', pink_flower: 'Flor rosa', seagrass: 'Capim-marinho', kelp: 'Alga kelp', pink_coral: 'Coral rosa', purple_coral: 'Coral roxo', red_coral: 'Coral vermelho', yellow_coral: 'Coral amarelo', torch: 'Tocha', hay: 'Fardo de feno', dirt_path: 'Caminho de terra', water: 'Água', lava: 'Lava', bedrock: 'Rocha base', air: 'Ar' };
export const blockLabel = (id) => BLOCK_PT[blockName(id)] || blockName(id);
const TIPS = ['Dica: toque duas vezes em Espaço para voar; Shift acelera o voo.', 'Dica: o botão do meio do mouse copia o bloco que você está mirando.',
  'Dica: a qualidade Automática ajusta a resolução para manter a fluidez.', 'Dica: use a roda do mouse com Shift para mudar a velocidade do voo.',
  'Dica: pressione T para avançar o tempo — veja o pôr do sol de longe.', 'Dica: F3 mostra desempenho, chunks, LOD e coordenadas.'];
const CARDINAL = ['N', 'NO', 'O', 'SO', 'S', 'SE', 'L', 'NE'];

export class UI {
  /**
   * @param {object} settings  persisted settings object (mutated by the settings panel)
   * @param {object} cb  { play(seed, quality), resume(), quit(), setting(key, value), selectSlot(i), pickBlock(id), screenshot(), viewLabel(pct) }
   */
  constructor(settings, cb) {
    this.s = settings; this.cb = cb;
    this.frames = new Float32Array(120); this.fi = 0;
    this._dbgT = 0; this._toastCount = 0;
    this.hotbarSlots = []; this.paletteOpen = false;
    drawTitle($('title')); drawBackdrop($('backdrop'));
    this._buildQualityOptions($('menu-quality'), true); this._buildQualityOptions($('set-quality'), true);
    $('menu-quality').value = settings.quality; $('seed').value = settings.seed || '';
    this.panels = [];
    $('play').addEventListener('click', () => this.cb.play($('seed').value.trim(), $('menu-quality').value));
    $('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('play').click(); });
    $('resume').addEventListener('click', () => this.cb.resume());
    $('quit').addEventListener('click', () => this.cb.quit());
    $('wipe').addEventListener('click', (e) => {   // two-step confirmation inside the page (alert/confirm are unavailable in sandboxed frames)
      const b = e.currentTarget;
      if (b.dataset.armed === '1') { this.cb.wipe(); return; }
      b.dataset.armed = '1'; b.textContent = 'Clique de novo para confirmar';
      setTimeout(() => { b.dataset.armed = ''; b.textContent = 'Apagar mundo salvo'; }, 4000);
    });
    $('shot').addEventListener('click', () => this.cb.screenshot());
    this._bindSettings();
    this._buildHotbar();
    this._buildPalette();
    document.addEventListener('keydown', (e) => {   // Esc closes the top feature panel before anything else sees it
      if (e.code === 'Escape' && this.panels.length) { e.preventDefault(); e.stopImmediatePropagation(); this.panels[this.panels.length - 1].close(); }
    }, true);
    document.addEventListener('keydown', (e) => {
      if (!this.paletteOpen) return;
      if (e.code === 'KeyE' || e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.cb.palette(); }
      else if (e.code.startsWith('Digit') && e.code.length === 6 && +e.code[5] >= 1) this.cb.selectSlot(+e.code[5] - 1);
    });
    this.dbg = $('debug'); this.spark = $('spark'); this.sctx = this.spark.getContext('2d');
  }

  // ---------------------------------------------------------------------------------------------------------------------
  // feature API (see docs/CONTRACT2.md): panels, menu buttons, toolbar buttons, planet badge, HUD layer
  // ---------------------------------------------------------------------------------------------------------------------
  /**
   * Modal panel. Gameplay input is suspended while any panel is open (pointer released); Esc or the X closes the top one.
   * @param {{id?:string, title:string, content:HTMLElement|string, width?:number, subtitle?:string, onClose?:()=>void}} o
   * @returns {{el:HTMLElement, body:HTMLElement, close():void, setTitle(t:string):void}}
   */
  panel(o) {
    const existing = o.id && this.panels.find((p) => p.id === o.id);
    if (existing) { existing.close(); return null; }          // same id twice => toggle
    const wrap = document.createElement('div'); wrap.className = 'fpanel';
    wrap.innerHTML = `<div class="panel" style="--pw:${o.width || 640}px"><div class="panel-head"><h2></h2><span class="dim"></span><button class="xbtn" title="Fechar (Esc)">✕</button></div><div class="fbody"></div></div>`;
    wrap.querySelector('h2').textContent = o.title || ''; wrap.querySelector('.dim').textContent = o.subtitle || '';
    const body = wrap.querySelector('.fbody');
    if (typeof o.content === 'string') body.innerHTML = o.content; else if (o.content) body.appendChild(o.content);
    const h = { id: o.id || null, el: wrap, body, setTitle: (t) => { wrap.querySelector('h2').textContent = t; }, close: () => {
      const i = this.panels.indexOf(h); if (i < 0) return; this.panels.splice(i, 1); wrap.remove();
      if (o.onClose) { try { o.onClose(); } catch (e) { console.error(e); } }
      if (!this.panels.length && this.cb.panelClose) this.cb.panelClose();
    } };
    wrap.querySelector('.xbtn').addEventListener('click', h.close);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) h.close(); });
    wrap.addEventListener('keydown', (e) => e.stopPropagation());   // typing in inputs must not trigger hotkeys
    $('panels').appendChild(wrap);
    const wasEmpty = !this.panels.length; this.panels.push(h);
    if (wasEmpty && this.cb.panelOpen) this.cb.panelOpen();
    const first = wrap.querySelector('input,select,textarea'); if (first) setTimeout(() => first.focus(), 30);
    return h;
  }
  closePanels() { for (const p of [...this.panels]) p.close(); }
  get panelOpen() { return this.panels.length > 0; }

  /** Button under "Jogar" in the main menu. @param {{label:string, onClick:()=>void, hint?:string, kind?:'primary'|'ghost'}} o */
  addMenuButton(o) {
    const b = document.createElement('button'); b.className = 'btn ' + (o.kind || 'ghost'); b.textContent = o.label; if (o.hint) b.title = o.hint;
    b.addEventListener('click', o.onClick); $('menu-actions').appendChild(b); return b;
  }
  /** Round button on the right edge of the HUD. @param {{id:string, icon:string, title:string, key?:string, onClick:()=>void}} o */
  addToolbarButton(o) {
    const old = document.getElementById('tb-' + o.id); if (old) old.remove();
    const b = document.createElement('button'); b.className = 'tb'; b.id = 'tb-' + o.id; b.title = o.title + (o.key ? ` (${o.key})` : '');
    b.innerHTML = `<span>${o.icon}</span>${o.key ? `<kbd>${o.key}</kbd>` : ''}`;
    b.addEventListener('click', (e) => { e.stopPropagation(); o.onClick(); }); $('toolbar').appendChild(b); return b;
  }
  /** Small label top-left of the HUD (planet name / address / role). html is trusted markup built by the caller. */
  setPlanetBadge(html) { const el = $('planet-badge'); el.innerHTML = html; el.classList.toggle('hidden', !html); }
  /** Absolute-positioned overlay container inside the HUD for custom widgets (scoreboard, timers...). Children get pointer events. */
  get hudLayer() { return $('hud-layer'); }

  _buildQualityOptions(sel, withAuto) {
    sel.innerHTML = '';
    if (withAuto) sel.add(new Option('Automático (recomendado)', 'auto'));
    for (const k of QUALITY_ORDER) sel.add(new Option(PRESETS[k].label, k));
  }

  _bindSettings() {
    const s = this.s, cb = this.cb;
    // per-effect switches (can only turn OFF what the current preset would enable)
    const FX = [['ssr', 'Reflexos na água (SSR)'], ['ssao', 'Oclusão ambiente (SSAO)'], ['taa', 'Anti-aliasing temporal (TAA)'], ['vol', 'Feixes de luz volumétricos'], ['bloom', 'Bloom'],
      ['exp', 'Exposição automática'], ['cine', 'Cinema: aberração + grão'], ['flare', 'Lens flare'], ['mb', 'Motion blur'], ['vclouds', 'Nuvens volumétricas'], ['shadows', 'Sombras'],
      ['weather', 'Clima e partículas'], ['mobs', 'Animais']];
    const list = $('fx-list');
    this._fxBoxes = {};
    for (const [k, label] of FX) {
      const l = document.createElement('label'); l.className = 'row check'; l.innerHTML = `<span>${label}</span><input type="checkbox" id="fx-${k}">`;
      list.appendChild(l); const el = l.querySelector('input'); this._fxBoxes[k] = el;
      el.addEventListener('change', () => { s.fx = s.fx || {}; s.fx[k] = el.checked; cb.setting('fx', s.fx); });
    }
    const bind = (id, vid, key, from, to, fmt) => {
      const el = $(id), out = $(vid);
      const show = () => { if (out) out.textContent = fmt(from(el.value)); };
      el.addEventListener('input', () => { show(); s[key] = from(el.value); cb.setting(key, s[key]); });
      this[`_sync_${key}`] = () => { el.value = to(s[key]); show(); };
    };
    bind('set-view', 'v-view', 'viewScale', Number, (v) => v, (v) => cb.viewLabel(v));
    bind('set-fov', 'v-fov', 'fov', Number, (v) => v, (v) => v + '°');
    bind('set-sens', 'v-sens', 'sens', (v) => v / 100, (v) => Math.round(v * 100), (v) => v.toFixed(2) + '×');
    bind('set-vol', 'v-vol', 'volume', (v) => v / 100, (v) => Math.round(v * 100), (v) => Math.round(v * 100) + '%');
    bind('set-time', 'v-time', 'timeSpeed', (v) => v / 20, (v) => Math.round(v * 20), (v) => (v === 0 ? 'parado' : v.toFixed(2) + '×'));
    $('set-quality').addEventListener('change', (e) => { s.quality = e.target.value; cb.setting('quality', s.quality); });
    $('set-fps').addEventListener('change', (e) => { s.showFps = e.target.checked; cb.setting('showFps', s.showFps); });
  }

  /** Refresh settings widgets from the settings object. */
  syncSettings() {
    for (const k of ['viewScale', 'fov', 'sens', 'volume', 'timeSpeed']) this[`_sync_${k}`]();
    $('set-quality').value = this.s.quality; $('set-fps').checked = !!this.s.showFps; $('menu-quality').value = this.s.quality;
    $('mini-fps').classList.toggle('hidden', !this.s.showFps);
    for (const k in this._fxBoxes) this._fxBoxes[k].checked = !(this.s.fx && this.s.fx[k] === false);
  }

  // ---- screens ----
  showMenu(note) { $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); $('menu-note').textContent = note || ''; }
  hideMenu() { $('menu').classList.add('hidden'); }
  showLoading() { $('loading').classList.remove('hidden'); $('load-tip').textContent = TIPS[(Math.random() * TIPS.length) | 0]; this.setProgress(0, 'Preparando…'); }
  setProgress(p, text) { $('load-bar').style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%'; if (text) $('load-text').textContent = text; }
  hideLoading() { $('loading').classList.add('hidden'); }
  showHUD(on) { $('hud').classList.toggle('hidden', !on); }
  showPause(note) { this.syncSettings(); $('pause').classList.remove('hidden'); if (note) $('pause-note').textContent = note; }
  hidePause() { $('pause').classList.add('hidden'); }
  get pauseOpen() { return !$('pause').classList.contains('hidden'); }
  fatal(msg) { $('fatal-text').textContent = msg; $('fatal').classList.remove('hidden'); }
  setFly(on) { $('fly-badge').classList.toggle('hidden', !on); }
  setUnderwater(on) { $('water-vignette').classList.toggle('hidden', !on); }
  setTouch(on) { document.body.classList.toggle('touch', on); $('touch').classList.toggle('hidden', !on); }

  toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    const box = $('toasts'); box.appendChild(t);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => t.remove(), 2450);
  }

  // ---- hotbar / palette ----
  _buildHotbar() {
    const hb = $('hotbar'); hb.innerHTML = '';
    for (let i = 0; i < 9; i++) {
      const d = document.createElement('div'); d.className = 'slot'; d.innerHTML = `<em>${i + 1}</em><canvas width="32" height="32"></canvas>`;
      d.addEventListener('mousedown', (e) => { e.stopPropagation(); this.cb.selectSlot(i); });
      d.addEventListener('touchstart', (e) => { e.stopPropagation(); this.cb.selectSlot(i); }, { passive: true });
      hb.appendChild(d); this.hotbarSlots.push(d);
    }
  }

  /** @param {number[]} slots block ids @param {number} sel selected index */
  setHotbar(slots, sel, showName = true) {
    this._slots = slots; this._sel = sel;
    this.hotbarSlots.forEach((d, i) => { d.classList.toggle('sel', i === sel); const id = slots[i]; if (d.dataset.id !== String(id)) { d.dataset.id = id; drawBlockIcon(d.querySelector('canvas'), id); } });
    if (showName) { const n = $('hotbar-name'); n.textContent = blockLabel(slots[sel]); n.classList.add('show'); clearTimeout(this._nameT); this._nameT = setTimeout(() => n.classList.remove('show'), 1400); }
  }

  /** Redraw all icons (tiles became available). */
  refreshIcons() {
    this.hotbarSlots.forEach((d) => { d.dataset.id = ''; });
    if (this._slots) this.setHotbar(this._slots, this._sel, false);
    document.querySelectorAll('#palette-grid .pal').forEach((p) => drawBlockIcon(p.querySelector('canvas'), +p.dataset.id));
  }

  _buildPalette() {
    const g = $('palette-grid'); g.innerHTML = '';
    for (const id of PLACEABLE) {
      const d = document.createElement('div'); d.className = 'pal'; d.dataset.id = id; d.innerHTML = `<canvas width="32" height="32"></canvas><span>${blockLabel(id)}</span>`;
      drawBlockIcon(d.querySelector('canvas'), id);
      d.addEventListener('click', () => this.cb.pickBlock(id));
      g.appendChild(d);
    }
  }
  showPalette(on) { this.paletteOpen = on; $('palette').classList.toggle('hidden', !on); }

  // ---- debug / fps ----
  get debugOn() { return !this.dbg.classList.contains('hidden'); }
  toggleDebug() { const on = !this.debugOn; this.dbg.classList.toggle('hidden', !on); this.spark.classList.toggle('hidden', !on); return on; }
  pushFrame(ms) { this.frames[this.fi] = ms; this.fi = (this.fi + 1) % this.frames.length; }

  /** Called every frame with a lazy info getter; throttles itself (4 Hz text, 10 Hz graph). */
  updateDebug(now, fps, getInfo) {
    if (this.s.showFps && now - (this._fpsT || 0) > 500) { this._fpsT = now; $('mini-fps').textContent = Math.round(fps) + ' FPS'; }
    if (!this.debugOn || now - this._dbgT < 250) return;
    this._dbgT = now;
    const i = getInfo(), r = i.render || {}, w = i.world || {}, a = i.auto || {};
    const yaw = ((-i.yaw * 180 / Math.PI) % 360 + 360) % 360, card = CARDINAL[Math.round(yaw / 45) % 8];
    const hh = Math.floor(i.hours), mm = Math.floor((i.hours - hh) * 60);
    const f = (v, d = 1) => (v === undefined || v === null ? '–' : (+v).toFixed(d));
    this.dbg.textContent =
      `HORIZON · ${Math.round(fps)} fps · ${f(1000 / Math.max(fps, 1))} ms · CPU ${f(i.cpuMs)} ms\n` +
      `GPU ${i.gpu || '?'}\n` +
      `Qualidade ${a.mode === 'fixed' ? 'fixa' : 'auto'} · ${a.tierName || '?'} · escala ${f(r.renderScale ?? a.renderScale, 2)} · p95 ${f(a.p95)} ms · ajustes ${a.changes ?? 0}\n` +
      `Draw calls ${r.calls ?? '–'} · tris ${fmt(r.triangles)} · geom ${r.geometries ?? '–'} · tex ${r.textures ?? '–'}\n` +
      `Chunks ${w.chunks ?? '–'} (fila ${w.chunkQueue ?? '–'}) · LOD ${w.lodTiles ?? '–'} (fila ${w.lodQueue ?? '–'}) · workers ${w.workersBusy ?? '–'} · dados ${w.dataChunks ?? '–'}\n` +
      `Mundo tris ${fmt(w.tris)} · gen ${f(w.genMsAvg)} ms · malha ${f(w.meshMsAvg)} ms · upload/frame ${f(w.uploadsPerFrame, 2)}\n` +
      `XYZ ${f(i.x, 2)} / ${f(i.y, 2)} / ${f(i.z, 2)}  ·  bloco ${Math.floor(i.x)} ${Math.floor(i.y)} ${Math.floor(i.z)}\n` +
      `Olhando ${card} (${f(yaw, 0)}°, ${f(i.pitch * 180 / Math.PI, 0)}°) · ${i.state}\n` +
      `Hora ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} ${i.night ? '(noite)' : '(dia)'} · velocidade ${f(i.timeSpeed, 2)}×\n` +
      `Alvo ${i.target || '—'}`;
    this._drawSpark();
  }

  _drawSpark() {
    const c = this.sctx, W = this.spark.width, H = this.spark.height, n = this.frames.length;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(111,216,255,.35)'; c.fillRect(0, H - (16.7 / 50) * H, W, 1); // 60 fps line
    c.fillStyle = 'rgba(255,180,84,.3)'; c.fillRect(0, H - (33.3 / 50) * H, W, 1);   // 30 fps line
    for (let k = 0; k < n; k++) {
      const v = this.frames[(this.fi + k) % n], h = Math.min(1, v / 50) * H;
      c.fillStyle = v < 18 ? '#6fd8ff' : v < 34 ? '#ffb454' : '#ff6b9a';
      c.fillRect(k * (W / n), H - h, Math.max(1, W / n - 0.5), h);
    }
  }
}

const fmt = (n) => (n === undefined ? '–' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
