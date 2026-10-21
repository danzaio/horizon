// Minimap: round top-down map of the terrain around you (analytic terrain, so it also shows land that is not loaded yet), heading-up or north-up,
// with friends, monsters and your ship. Cells are cached and filled a few hundred per frame; the map redraws at ~10 Hz. Cost when hidden: nothing.
import './minimap.css';
import { defineFeature } from '../registry.js';
import { BIOME } from '../../world/terrain.js';
import { SEA_LEVEL } from '../../shared/constants.js';

const N = 60, ZOOMS = [1, 2, 3, 5, 8], SIZE = 176;
let M = null;

class Minimap {
  constructor(ctx) {
    this.ctx = ctx; this.world = ctx.world; this.terrain = ctx.world.terrain; this.step = 1; this.zi = 1; this.heading = true; this.hudT = 0; this.visible = true;
    this.caches = ZOOMS.map(() => new Map()); this.scratch = {};
    this.order = []; for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) this.order.push([i, j, (i - N / 2) ** 2 + (j - N / 2) ** 2]); this.order.sort((a, b) => a[2] - b[2]);
    this.off = document.createElement('canvas'); this.off.width = this.off.height = N; this.octx = this.off.getContext('2d'); this.img = this.octx.createImageData(N, N);
    const r = this.root = document.createElement('div'); r.id = 'hz-minimap';
    r.innerHTML = `<canvas width="${SIZE}" height="${SIZE}"></canvas><div class="mm-info"></div><div class="mm-btns"><button data-z="1" title="Aproximar">+</button><button data-z="-1" title="Afastar">−</button><button data-h="1" title="Norte fixo / direção">⌖</button></div>`;
    (document.getElementById('hud') || document.body).appendChild(r);
    this.cv = r.querySelector('canvas'); this.g = this.cv.getContext('2d'); this.info = r.querySelector('.mm-info');
    r.querySelector('.mm-btns').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); if (b.dataset.z) this.zoom(+b.dataset.z); else this.heading = !this.heading; });
    this.grass = this._palette();
  }

  _palette() { // per-biome ground colour from this planet's tint table (+ rock / snow / sand overrides)
    const tint = this.terrain.tint, out = [];
    for (let b = 0; b < 16; b++) { const o = (b * 4 + 1) * 3, w = (b * 4 + 3) * 3; out.push({ g: [tint[o], tint[o + 1], tint[o + 2]], w: [tint[w], tint[w + 1], tint[w + 2]] }); }
    const over = { [BIOME.SNOWY]: [236, 242, 248], [BIOME.FROZEN]: [226, 236, 246], [BIOME.PEAKS]: [150, 150, 156], [BIOME.STONY]: [128, 128, 132], [BIOME.DESERT]: [222, 200, 140], [BIOME.BEACH]: [226, 212, 156], [BIOME.BADLANDS]: [190, 110, 70] };
    for (const k in over) out[k].g = over[k];
    const pf = this.ctx.planet && this.ctx.planet.profile; if (pf && pf.ground && pf.ground.lod) for (const k of [BIOME.PLAINS, BIOME.FOREST, BIOME.BIRCH, BIOME.TAIGA, BIOME.SAVANNA, BIOME.CHERRY, BIOME.SWAMP]) out[k].g = pf.ground.lod;
    return out;
  }

  zoom(d) { this.zi = Math.max(0, Math.min(ZOOMS.length - 1, this.zi + (d > 0 ? 1 : -1))); this.step = ZOOMS[this.zi]; }

  _cell(cache, cx, cz) {
    const key = (cx + 32768) * 65536 + (cz + 32768); let v = cache.get(key); if (v !== undefined) return v;
    const s = this.step, ci = this.terrain.columnInfo(cx * s + (s >> 1), cz * s + (s >> 1), 4, this.scratch), h = Math.floor(ci.h), P = this.grass[ci.biome] || this.grass[2];
    let c;
    if (h <= SEA_LEVEL) { const d = Math.min(1, (SEA_LEVEL - h) / 28), w = P.w; c = ((w[0] * (1 - 0.55 * d)) << 16) | ((w[1] * (1 - 0.4 * d)) << 8) | (w[2] * (1 - 0.2 * d)); }
    else { const g = P.g, hl = 0.82 + Math.min(0.3, Math.max(0, (h - SEA_LEVEL) / 160)); c = (Math.min(255, g[0] * hl) << 16) | (Math.min(255, g[1] * hl) << 8) | Math.min(255, g[2] * hl); }
    v = (Math.max(0, h) * 16777216) + (c & 0xffffff); if (cache.size > 60000) cache.clear(); cache.set(key, v); return v;
  }

  update(dt) {
    const ctx = this.ctx, p = ctx.player, st = ctx.state;
    const show = this.visible && (st === 'playing' || st === 'panel' || st === 'palette');
    if (show !== this._shown) { this._shown = show; this.root.style.display = show ? '' : 'none'; }
    if (!show) return;
    const s = this.step, cache = this.caches[this.zi], cx0 = Math.floor(p.x / s) - N / 2, cz0 = Math.floor(p.z / s) - N / 2;
    // fill missing cells nearest-first (bounded work per frame)
    const q = ctx.settings && ctx.settings.quality; let budget = q === 'potato' ? 90 : q === 'low' ? 160 : 280;
    for (let k = 0; k < this.order.length && budget > 0; k++) { const o = this.order[k], key = (cx0 + o[0] + 32768) * 65536 + (cz0 + o[1] + 32768); if (!cache.has(key)) { this._cell(cache, cx0 + o[0], cz0 + o[1]); budget--; } }
    this.hudT -= dt; if (this.hudT > 0) return; this.hudT = 0.1;
    this._draw(p, cache, cx0, cz0, s);
  }

  _draw(p, cache, cx0, cz0, s) {
    const d = this.img.data, off = (cx, cz) => { const v = cache.get((cx + 32768) * 65536 + (cz + 32768)); return v; };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const v = off(cx0 + i, cz0 + j), o = (j * N + i) * 4;
      if (v === undefined) { d[o] = 20; d[o + 1] = 24; d[o + 2] = 34; d[o + 3] = 255; continue; }
      const h = Math.floor(v / 16777216), c = v % 16777216; let sh = 1;
      if (h > SEA_LEVEL) { const n = off(cx0 + i - 1, cz0 + j - 1); if (n !== undefined) sh = 1 + Math.max(-0.3, Math.min(0.3, (h - Math.floor(n / 16777216)) * (0.09 / Math.sqrt(s)))); }
      d[o] = Math.min(255, ((c >> 16) & 255) * sh); d[o + 1] = Math.min(255, ((c >> 8) & 255) * sh); d[o + 2] = Math.min(255, (c & 255) * sh); d[o + 3] = 255;
    }
    this.octx.putImageData(this.img, 0, 0);
    const g = this.g, R = SIZE / 2, cell = SIZE / N * 1.0, ox = (p.x - cx0 * s) / s, oz = (p.z - cz0 * s) / s, yaw = this.heading ? p.yaw : 0;
    g.clearRect(0, 0, SIZE, SIZE); g.save(); g.beginPath(); g.arc(R, R, R - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#0a0f18'; g.fillRect(0, 0, SIZE, SIZE);
    g.translate(R, R); g.rotate(yaw); g.imageSmoothingEnabled = false;
    g.drawImage(this.off, -ox * cell, -oz * cell, N * cell, N * cell);
    // markers (map space: 1 cell = `cell` px)
    const mark = (x, z, col, r, shape) => {
      let dx = (x - p.x) / s * cell, dz = (z - p.z) / s * cell; const dist = Math.hypot(dx, dz), lim = R - 8;
      if (dist > lim) { dx *= lim / dist; dz *= lim / dist; r *= 0.75; }
      g.fillStyle = col; g.beginPath();
      if (shape === 'dia') { g.moveTo(dx, dz - r); g.lineTo(dx + r, dz); g.lineTo(dx, dz + r); g.lineTo(dx - r, dz); g.closePath(); } else g.arc(dx, dz, r, 0, Math.PI * 2);
      g.fill(); g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke();
    };
    const ctx = this.ctx, hz = ctx.horde; if (hz && hz.running) for (const m of hz.list) if (!m.dead) mark(m.x, m.z, m.t === 3 ? '#ff2a2a' : m.t === 2 ? '#ff8ad0' : '#ff5a4a', m.t === 3 ? 4 : 2.4);
    const sh = ctx.ship && ctx.ship.state; if (sh && sh.alive) mark(sh.x, sh.z, '#6be3ff', 4.5, 'dia');
    const net = ctx.net; if (net && net.players) for (const q of net.players.values()) if (q.pos && q.hasPos !== false) mark(q.pos.x, q.pos.z, /^#[0-9a-f]{6}$/i.test(q.color) ? q.color : '#fff', 4);
    // compass N
    g.save(); g.rotate(0); g.fillStyle = 'rgba(255,255,255,.85)'; g.font = 'bold 11px ui-monospace,monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('N', 0, -R + 11); g.restore();
    g.restore();
    // you
    g.save(); g.translate(R, R); g.rotate(this.heading ? 0 : -p.yaw); g.fillStyle = '#fff'; g.strokeStyle = '#000'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath(); g.fill(); g.stroke(); g.restore();
    g.strokeStyle = 'rgba(160,200,255,.55)'; g.lineWidth = 2; g.beginPath(); g.arc(R, R, R - 1.5, 0, Math.PI * 2); g.stroke();
    this.info.textContent = Math.round(p.x) + ' · ' + Math.round(p.z) + '  ↑' + Math.round(p.y);
  }

  dispose() { this.root.remove(); }
}

export default defineFeature({
  id: 'minimap', order: 40,
  init(ctx) {
    M = new Minimap(ctx);
    ctx.addHotkey('Minus', () => M.zoom(1)); ctx.addHotkey('Equal', () => M.zoom(-1)); ctx.addHotkey('Backslash', () => { M.visible = !M.visible; });
    ctx.minimap = { zoom: (d) => M.zoom(d), toggle: () => { M.visible = !M.visible; } };
  },
  update(dt) { if (M) M.update(dt); },
  dispose() { if (M) { M.dispose(); M = null; } },
});
