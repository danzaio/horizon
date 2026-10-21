// Galaxy map (key J): pannable/zoomable canvas-2D star chart + system/planet inspector + hyperspace jump.
import { decodeAddress, normalizeAddress, encodeAddress, SYS_SIZE } from './address.js';
import { generateSystem, generatePlanet, systemsInRegion, homeAddress, rng32, ROMAN, galaxyDensity, GALAXY_CENTER } from './generator.js';
import { TYPES } from './profiles.js';
import { drawPlanetIcon } from './planetIcon.js';
import { copyText } from './util.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const sprites = new Map();
/** soft glow sprite for a star colour (cached) */
function glowSprite(col) {
  const k = col.join(','); let s = sprites.get(k);
  if (s) return s;
  s = document.createElement('canvas'); s.width = s.height = 64;
  const c = s.getContext('2d'), g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.12, css(col, 0.95)); g.addColorStop(0.4, css(col, 0.28)); g.addColorStop(1, css(col, 0));
  c.fillStyle = g; c.fillRect(0, 0, 64, 64); sprites.set(k, s); return s;
}
const cellNames = new Map();
function nameOf(galaxy, sx, sy) { const k = `${galaxy}|${sx}|${sy}`; let n = cellNames.get(k); if (!n) { n = generateSystem(galaxy, sx, sy).name; if (cellNames.size > 400) cellNames.clear(); cellNames.set(k, n); } return n; }
const hash2 = (x, y, s) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s, 2246822519); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/**
 * Open the galaxy map panel (toggles when already open).
 * @param {object} ctx feature ctx @param {object} api ctx.universe
 */
export function openMap(ctx, api) {
  const here = decodeAddress(api.planet.address) || decodeAddress(homeAddress(ctx.identity.id));
  const galaxy0 = here.galaxy;
  const S = { g: galaxy0, cx: here.sx + 0.5, cy: here.sy + 0.5, zoom: 20, sel: null, hover: null, planetIdx: -1, list: [], rect: null, t0: performance.now(), raf: 0, dirty: true, drag: null };
  const root = document.createElement('div'); root.className = 'uv-map';
  root.innerHTML = `
    <div class="uv-main"><canvas class="uv-canvas"></canvas><canvas class="uv-mini" width="132" height="132" title="Galáxia inteira: clique para ir"></canvas><div class="uv-hint">arraste para mover · roda para zoom · clique em uma estrela</div><div class="uv-tip"></div>
      <div class="uv-ctl"><button class="btn" data-a="zin" title="Aproximar">＋</button><button class="btn" data-a="zout" title="Afastar">−</button><button class="btn" data-a="here" title="Centralizar no seu sistema">◎</button><button class="btn" data-a="gprev" title="Galáxia anterior">◀</button><span class="uv-gal"></span><button class="btn" data-a="gnext" title="Próxima galáxia">▶</button></div></div>
    <div class="uv-side"><div class="uv-go"><input type="text" class="uv-in" placeholder="Endereço  XXXX-XXXX-XXXX" maxlength="19" spellcheck="false" autocomplete="off"><button class="btn" data-a="go">Ir</button></div><div class="uv-info"></div></div>`;
  const cv = root.querySelector('.uv-canvas'), tip = root.querySelector('.uv-tip'), info = root.querySelector('.uv-info'), galLbl = root.querySelector('.uv-gal'), input = root.querySelector('.uv-in');
  const panel = ctx.ui.panel({ id: 'galaxy', title: 'Mapa galáctico', subtitle: `Você está em ${api.planet.name}`, content: root, width: 1040, onClose: () => { cancelAnimationFrame(S.raf); S.raf = 0; window.removeEventListener('resize', fit); } });
  if (!panel) return;   // toggled closed
  setTimeout(() => input.blur(), 60);   // ui.panel focuses the first input; keep J usable as a toggle
  const c2 = cv.getContext('2d'), mini = root.querySelector('.uv-mini'), m2 = mini.getContext('2d'), MR = 26000;   // minimap radius in cells
  let miniImg = null, miniG = -1;
  function drawMini() {   // whole-galaxy density image (cached per galaxy) + where you are + the current view
    if (miniG !== S.g) {
      miniG = S.g; const o = document.createElement('canvas'); o.width = o.height = 66; const oc = o.getContext('2d'), im = oc.createImageData(66, 66);
      for (let j = 0; j < 66; j++) for (let i = 0; i < 66; i++) {
        const sx = GALAXY_CENTER + (i / 65 * 2 - 1) * MR, sy = GALAXY_CENTER + (j / 65 * 2 - 1) * MR, d = Math.min(1, galaxyDensity(S.g, sx, sy) * 3.2), k = (j * 66 + i) * 4;
        const rr = Math.hypot(i - 32.5, j - 32.5) / 33, f = Math.max(0, 1 - rr * rr);
        im.data[k] = 120 + 135 * d; im.data[k + 1] = 140 + 90 * d; im.data[k + 2] = 255; im.data[k + 3] = 255 * d * f;
      }
      oc.putImageData(im, 0, 0); miniImg = o;
    }
    m2.clearRect(0, 0, 132, 132); m2.fillStyle = 'rgba(3,5,16,0.8)'; m2.fillRect(0, 0, 132, 132);
    m2.imageSmoothingEnabled = true; m2.drawImage(miniImg, 0, 0, 132, 132);
    const px = (v) => (v - GALAXY_CENTER) / MR * 66 + 66;
    if (S.g === here.galaxy) { m2.fillStyle = '#ffd36e'; m2.beginPath(); m2.arc(px(here.sx), px(here.sy), 3, 0, 6.283); m2.fill(); }
    m2.strokeStyle = 'rgba(255,255,255,0.8)'; m2.lineWidth = 1; m2.strokeRect(px(S.cx) - 4, px(S.cy) - 3, 8, 6);
  }
  mini.addEventListener('pointerdown', (e) => { const r = mini.getBoundingClientRect(); S.cx = GALAXY_CENTER + ((e.clientX - r.left) / r.width * 2 - 1) * MR; S.cy = GALAXY_CENTER + ((e.clientY - r.top) / r.height * 2 - 1) * MR; S.rect = null; });
  let W = 0, H = 0, dpr = 1;
  const fit = () => { const r = cv.parentElement.getBoundingClientRect(); dpr = Math.min(2, window.devicePixelRatio || 1); W = Math.max(200, r.width); H = Math.max(240, r.height); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; S.dirty = true; };
  window.addEventListener('resize', fit); requestAnimationFrame(fit); fit();
  panel.el.addEventListener('keydown', (e) => { if (e.code === 'KeyJ' && e.target.tagName !== 'INPUT') panel.close(); });
  const toX = (sx) => (sx - S.cx) * S.zoom + W / 2, toY = (sy) => (sy - S.cy) * S.zoom + H / 2;
  const fromX = (px) => (px - W / 2) / S.zoom + S.cx, fromY = (py) => (py - H / 2) / S.zoom + S.cy;
  const homeA = decodeAddress(homeAddress(ctx.identity.id)), visitedSys = new Set(api.visited.map((a) => { const d = decodeAddress(a); return d ? `${d.galaxy}|${d.sx}|${d.sy}` : ''; }));

  function systems() {   // lazily generated, cached for a rect 60% larger than the view
    const x0 = fromX(0), x1 = fromX(W), y0 = fromY(0), y1 = fromY(H), r = S.rect;
    if (!r || r.g !== S.g || x0 < r.x0 || x1 > r.x1 || y0 < r.y0 || y1 > r.y1) {
      const mx = (x1 - x0) * 0.3, my = (y1 - y0) * 0.3;
      S.rect = { g: S.g, x0: x0 - mx, x1: x1 + mx, y0: y0 - my, y1: y1 + my };
      S.list = systemsInRegion(S.g, S.rect.x0, S.rect.y0, S.rect.x1, S.rect.y1);
    }
    return S.list;
  }

  function draw(now) {
    S.raf = requestAnimationFrame(draw);
    const anim = now - S.t0, pulse = 0.5 + 0.5 * Math.sin(anim * 0.004);
    c2.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = c2.createRadialGradient(W / 2, H / 2, 20, W / 2, H / 2, Math.max(W, H) * 0.75);
    bg.addColorStop(0, '#0d1230'); bg.addColorStop(0.6, '#070a1c'); bg.addColorStop(1, '#03040c');
    c2.fillStyle = bg; c2.fillRect(0, 0, W, H);
    // parallax starfield (3 layers) so panning feels deep
    for (let layer = 0; layer < 3; layer++) {
      const par = 0.12 + layer * 0.14, cell = 70 - layer * 14, ox = -(S.cx * S.zoom * par), oy = -(S.cy * S.zoom * par);
      const i0 = Math.floor(-ox / cell) - 1, j0 = Math.floor(-oy / cell) - 1;
      for (let j = j0; j <= j0 + H / cell + 2; j++) for (let i = i0; i <= i0 + W / cell + 2; i++) {
        const h = hash2(i, j, layer + 7), px = ox + (i + hash2(i, j, 1)) * cell, py = oy + (j + hash2(i, j, 2)) * cell;
        if (h > 0.55) continue;
        c2.fillStyle = `rgba(${200 + h * 100 | 0},${210 + h * 60 | 0},255,${0.15 + h * 0.5 + 0.1 * Math.sin(anim * 0.002 + h * 40)})`;
        c2.fillRect(px + (W / 2) % 1, py, 1 + (layer === 2 && h < 0.08 ? 1 : 0), 1 + (layer === 2 && h < 0.08 ? 1 : 0));
      }
    }
    // chart grid every 10 cells
    const gs = S.zoom >= 8 ? 10 : 50;
    c2.strokeStyle = 'rgba(120,150,255,0.07)'; c2.lineWidth = 1; c2.beginPath();
    for (let gx = Math.floor(fromX(0) / gs) * gs; gx <= fromX(W); gx += gs) { const x = Math.round(toX(gx)) + 0.5; c2.moveTo(x, 0); c2.lineTo(x, H); }
    for (let gy = Math.floor(fromY(0) / gs) * gs; gy <= fromY(H); gy += gs) { const y = Math.round(toY(gy)) + 0.5; c2.moveTo(0, y); c2.lineTo(W, y); }
    c2.stroke();
    c2.font = '10px ui-monospace, monospace'; c2.fillStyle = 'rgba(150,170,230,0.45)';
    for (let gx = Math.ceil(fromX(0) / gs) * gs; gx <= fromX(W); gx += gs) c2.fillText(String(gx), toX(gx) + 3, H - 5);
    for (let gy = Math.ceil(fromY(0) / gs) * gs; gy <= fromY(H); gy += gs) c2.fillText(String(gy), 4, toY(gy) - 3);
    // systems
    const list = systems(), z = Math.min(2, Math.max(0.55, S.zoom / 14));
    c2.globalCompositeOperation = 'lighter';
    for (const s of list) {
      const x = toX(s.x), y = toY(s.y);
      if (x < -30 || y < -30 || x > W + 30 || y > H + 30) continue;
      const r = (1.8 + Math.log2(s.lum * 6 + 1) * 0.9) * z;
      c2.globalAlpha = 0.85; const sp = glowSprite(s.color), sz = r * 3.4; c2.drawImage(sp, x - sz / 2, y - sz / 2, sz, sz);
    }
    c2.globalAlpha = 1; c2.globalCompositeOperation = 'source-over';
    for (const s of list) {
      const x = toX(s.x), y = toY(s.y);
      if (x < -30 || y < -30 || x > W + 30 || y > H + 30) continue;
      const key = `${S.g}|${s.sx}|${s.sy}`, isHere = S.g === here.galaxy && s.sx === here.sx && s.sy === here.sy, isHome = S.g === homeA.galaxy && s.sx === homeA.sx && s.sy === homeA.sy;
      if (isHere || isHome) {
        c2.strokeStyle = isHere ? `rgba(255,214,120,${0.55 + 0.4 * pulse})` : 'rgba(120,230,255,0.75)'; c2.lineWidth = 1.5;
        c2.beginPath(); c2.arc(x, y, 9 + (isHere ? 3 * pulse : 0), 0, 6.283); c2.stroke();
        c2.fillStyle = isHere ? 'rgba(255,224,150,0.95)' : 'rgba(150,235,255,0.9)'; c2.font = '11px system-ui, sans-serif'; c2.fillText(isHere ? 'Você está aqui' : 'Seu lar', x + 13, y + 4);
      } else if (visitedSys.has(key)) { c2.strokeStyle = 'rgba(190,255,200,0.55)'; c2.lineWidth = 1; c2.strokeRect(x - 5, y - 5, 10, 10); }
      if (S.sel && S.sel.sx === s.sx && S.sel.sy === s.sy && S.sel.g === S.g) {
        c2.strokeStyle = '#ffb454'; c2.lineWidth = 2; const b = 12, k = 5;
        for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { c2.beginPath(); c2.moveTo(x + dx * b, y + dy * (b - k)); c2.lineTo(x + dx * b, y + dy * b); c2.lineTo(x + dx * (b - k), y + dy * b); c2.stroke(); }
      }
      if (S.zoom >= 26 && !isHere && !isHome) { c2.fillStyle = 'rgba(210,225,255,0.7)'; c2.font = '11px system-ui, sans-serif'; c2.fillText(nameOf(S.g, s.sx, s.sy), x + 9, y - 8); }
    }
    if (S.hover) { const x = toX(S.hover.x), y = toY(S.hover.y); c2.strokeStyle = 'rgba(255,255,255,0.7)'; c2.lineWidth = 1; c2.beginPath(); c2.arc(x, y, 8, 0, 6.283); c2.stroke(); }
    // vignette
    const vg = c2.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.max(W, H) * 0.75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,6,0.55)');
    c2.fillStyle = vg; c2.fillRect(0, 0, W, H);
    drawMini(); drawOrbits(anim);
    galLbl.textContent = `Galáxia ${S.g + 1} · (${Math.round(S.cx)}, ${Math.round(S.cy)})`;
  }
  S.raf = requestAnimationFrame(draw);

  /** animated top-down-ish orbit view of the selected system (planets orbit at Kepler-like speeds; near side drawn larger and on top) */
  function drawOrbits(now) {
    const cvs = S.orb, sys = S.sys;
    if (!cvs || !sys || !cvs.isConnected) return;
    const c = cvs.getContext('2d'), w = 330, h = 84, n = sys.planets.length, cx = w / 2, cy = h / 2 + 4;
    c.setTransform(2, 0, 0, 2, 0, 0); c.clearRect(0, 0, w, h);
    S.orbPos = [];
    const items = [];
    for (let i = 0; i < n; i++) {
      const rx = 30 + (i + 0.5) * ((w / 2 - 44) / n), ry = rx * 0.24, a = i * 2.1 + now * 0.00022 / Math.sqrt(0.4 + i * 0.5), sn = Math.sin(a);
      c.strokeStyle = i === S.planetIdx ? 'rgba(255,180,84,0.55)' : 'rgba(150,170,255,0.16)'; c.lineWidth = i === S.planetIdx ? 1.4 : 1;
      c.beginPath(); c.ellipse(cx, cy, rx, ry, 0, 0, 6.283); c.stroke();
      const x = cx + Math.cos(a) * rx, y = cy + sn * ry; S.orbPos[i] = { x, y }; items.push({ i, x, y, sn });
    }
    const star = glowSprite(sys.star.color), sd = 34 + (sys.star.lum > 3 ? 14 : 0);
    const drawPl = (it) => { const ic = S.icons[it.i], sz = (it.i === S.planetIdx ? 30 : 24) * (0.8 + 0.2 * (it.sn + 1) / 2); if (ic) c.drawImage(ic, it.x - sz / 2, it.y - sz / 2, sz, sz); };
    items.filter((q) => q.sn < 0).forEach(drawPl);
    c.globalCompositeOperation = 'lighter'; c.drawImage(star, cx - sd / 2, cy - sd / 2, sd, sd); c.globalCompositeOperation = 'source-over';
    items.filter((q) => q.sn >= 0).forEach(drawPl);
  }
  const nearest = (px, py, maxd) => { let best = null, bd = maxd * maxd; for (const s of S.list) { const d = (toX(s.x) - px) ** 2 + (toY(s.y) - py) ** 2; if (d < bd) { bd = d; best = s; } } return best; };
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); S.drag = { x: e.clientX, y: e.clientY, cx: S.cx, cy: S.cy, moved: false }; });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (S.drag) { const dx = e.clientX - S.drag.x, dy = e.clientY - S.drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) S.drag.moved = true; if (S.drag.moved) { S.cx = S.drag.cx - dx / S.zoom; S.cy = S.drag.cy - dy / S.zoom; } return; }
    const h = nearest(px, py, 14); S.hover = h;
    if (h) { tip.textContent = nameOf(S.g, h.sx, h.sy); tip.style.cssText = `display:block;left:${px + 14}px;top:${py + 10}px`; } else tip.style.display = 'none';
  });
  cv.addEventListener('pointerup', (e) => {
    const d = S.drag; S.drag = null;
    if (d && !d.moved) { const r = cv.getBoundingClientRect(), s = nearest(e.clientX - r.left, e.clientY - r.top, 16); if (s) selectSystem(s.sx, s.sy); }
  });
  cv.addEventListener('pointerleave', () => { S.hover = null; tip.style.display = 'none'; });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, bx = fromX(px), by = fromY(py);
    S.zoom = Math.min(90, Math.max(5, S.zoom * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
    S.cx = bx - (px - W / 2) / S.zoom; S.cy = by - (py - H / 2) / S.zoom;
  }, { passive: false });
  const zoomBy = (k) => { S.zoom = Math.min(90, Math.max(5, S.zoom * k)); };
  const center = (sx, sy) => { S.cx = sx + 0.5; S.cy = sy + 0.5; };

  function selectSystem(sx, sy, pi = -1) {
    S.sel = { g: S.g, sx, sy }; S.sys = generateSystem(S.g, sx, sy); S.planetIdx = pi >= 0 ? pi : (S.sys.hab); renderInfo();
  }
  function renderInfo() {
    if (!S.sys) { info.innerHTML = `<div class="uv-empty"><div class="uv-big">🪐</div><p>Selecione uma estrela para ver seus planetas.</p><p class="dim">Seu planeta natal: <b>${esc(homeAddress(ctx.identity.id))}</b></p></div>`; return; }
    const sys = S.sys, st = sys.star;
    info.innerHTML = `<div class="uv-sys"><span class="uv-dot" style="background:${css(st.color)};box-shadow:0 0 12px ${css(st.color, 0.9)}"></span><div><div class="uv-sysname">Sistema ${esc(sys.name)}</div><div class="dim">${esc(st.label)}${st.binary ? ' binária' : ''} · ${sys.planets.length} planetas</div></div></div><canvas class="uv-orbits" width="660" height="168"></canvas><div class="uv-plist"></div><div class="uv-detail"></div>`;
    const pl = info.querySelector('.uv-plist');
    S.orb = info.querySelector('.uv-orbits'); S.icons = [];
    S.orb.onpointerdown = (e) => {   // click a planet in the system view
      const r = S.orb.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * 330, py = (e.clientY - r.top) / r.height * 84;
      let best = -1, bd = 22 * 22;
      (S.orbPos || []).forEach((q, i) => { const d = (q.x - px) ** 2 + (q.y - py) ** 2; if (d < bd) { bd = d; best = i; } });
      if (best >= 0) { S.planetIdx = best; renderInfo(); }
    };
    sys.planets.forEach((p, i) => {
      const addr = encodeAddress({ galaxy: sys.galaxy, sx: sys.sx, sy: sys.sy, planet: i }), g = generatePlanet(addr), row = document.createElement('button');
      row.className = 'uv-prow' + (i === S.planetIdx ? ' on' : ''); const ic = document.createElement('canvas'); ic.width = ic.height = 96; ic.className = 'uv-ico'; drawPlanetIcon(ic, g);
      const lbl = document.createElement('div'); lbl.innerHTML = `<b>${esc(p.name)}</b> <span class="dim">${ROMAN[i]}</span><br><span class="dim">${TYPES[p.type].label}${addr === api.planet.address ? ' · você está aqui' : ''}${addr === homeAddress(ctx.identity.id) ? ' · seu lar' : ''}${api.visited.includes(addr) ? ' · visitado' : ''}</span>`;
      S.icons[i] = ic; row.append(ic, lbl); row.onclick = () => { S.planetIdx = i; renderInfo(); }; pl.appendChild(row);
    });
    const p = sys.planets[S.planetIdx]; if (!p) return;
    const addr = encodeAddress({ galaxy: sys.galaxy, sx: sys.sx, sy: sys.sy, planet: S.planetIdx }), g = generatePlanet(addr), pr = g.profile, T = TYPES[g.type];
    const det = info.querySelector('.uv-detail');
    const heatTxt = p.heat > 4 ? 'infernal' : p.heat > 1.8 ? 'quente' : p.heat > 0.7 ? 'temperado' : p.heat > 0.3 ? 'frio' : 'congelante';
    det.innerHTML = `<canvas class="uv-big-ico" width="220" height="220"></canvas><div class="uv-dtxt"><h3>${esc(g.name)}</h3><p class="dim">${esc(T.blurb)}</p>
      <ul><li>Tipo: <b>${T.label}</b></li><li>Clima: <b>${heatTxt}</b></li><li>Gravidade: <b>${pr.gravity.toFixed(2)} g</b></li><li>Dia: <b>${pr.dayLength} min</b></li><li>Céu: <b>${pr.sky.sunCount > 1 ? '2 sóis' : '1 sol'}${pr.sky.moons.length ? ', ' + pr.sky.moons.length + (pr.sky.moons.length > 1 ? ' luas' : ' lua') : ''}${pr.sky.aurora > 1.3 ? ', auroras' : ''}</b></li></ul></div>
      <div class="uv-addr">${esc(addr)}</div><div class="uv-btns"><button class="btn primary" data-a="travel">Viajar</button><button class="btn" data-a="copy">Copiar endereço</button></div>`;
    const big = det.querySelector('.uv-big-ico'); drawPlanetIcon(big, g);
    const go = det.querySelector('[data-a=travel]'), solo = ctx.role === 'solo', same = addr === api.planet.address;
    if (!solo) go.title = 'Viagem indisponível durante uma partida online';
    if (same) go.textContent = 'Você está aqui';
    go.classList.toggle('disabled', !solo || same);
    go.onclick = () => { if (!solo) { ctx.ui.toast('Viagem indisponível durante uma partida online'); return; } if (same) return; panel.close(); api.travel(addr); };
    det.querySelector('[data-a=copy]').onclick = () => copyText(addr).then(() => ctx.ui.toast('Endereço copiado: ' + addr));
  }
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    switch (a.dataset.a) {
      case 'zin': zoomBy(1.4); break; case 'zout': zoomBy(1 / 1.4); break;
      case 'here': S.g = here.galaxy; center(here.sx, here.sy); break;
      case 'gprev': S.g = (S.g + 63) % 64; S.sel = null; S.sys = null; center(SYS_SIZE / 2, SYS_SIZE / 2); renderInfo(); break;
      case 'gnext': S.g = (S.g + 1) % 64; S.sel = null; S.sys = null; center(SYS_SIZE / 2, SYS_SIZE / 2); renderInfo(); break;
      case 'go': gotoAddr(); break;
      default: break;
    }
  });
  const gotoAddr = () => {
    const a = normalizeAddress(input.value), d = a && decodeAddress(a);
    if (!d) { ctx.ui.toast('Endereço inválido'); return; }
    S.g = d.galaxy; center(d.sx, d.sy); S.zoom = Math.max(S.zoom, 22); S.rect = null; selectSystem(d.sx, d.sy, d.planet);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') gotoAddr(); });
  selectSystem(here.sx, here.sy, here.planet);
}

/**
 * Full-screen hyperspace jump (~1.2 s): star streaks from the centre, flash, then `done()` (the caller reloads into the new planet).
 * @param {object} to generatePlanet() result (destination) @param {() => void} done
 */
export function hyperspace(to, done) {
  const el = document.createElement('div'); el.className = 'uv-warp';
  el.innerHTML = '<canvas></canvas><div class="uv-warp-txt"><div class="uv-warp-small">Salto hiperespacial</div><div class="uv-warp-name"></div></div>';
  el.querySelector('.uv-warp-name').textContent = to ? to.name : '';
  document.body.appendChild(el);
  const cv = el.querySelector('canvas'), c = cv.getContext('2d'), W = cv.width = innerWidth, H = cv.height = innerHeight;
  const rng = rng32(7), N = 320, stars = Array.from({ length: N }, () => ({ a: rng() * 6.283, d: 0.02 + rng() * 0.9, s: 0.4 + rng() * 1.4, c: rng() }));
  const tint = to ? to.system.star.color : [200, 220, 255];
  const T0 = performance.now(), DUR = 1200; let finished = false;
  const finish = () => { if (finished) return; finished = true; done(); };
  const step = (now) => {
    const t = Math.min(1, (now - T0) / DUR), k = t * t * (3 - 2 * t), speed = 0.002 + k * 0.22;
    c.fillStyle = `rgba(2,3,12,${0.25 + 0.5 * (1 - k)})`; c.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2, R = Math.hypot(cx, cy);
    for (const s of stars) {
      const d0 = s.d; s.d += speed * s.s * (0.3 + s.d); if (s.d > 1.05) { s.d = 0.02; s.a = rng() * 6.283; }
      const x0 = cx + Math.cos(s.a) * d0 * R, y0 = cy + Math.sin(s.a) * d0 * R, x1 = cx + Math.cos(s.a) * s.d * R, y1 = cy + Math.sin(s.a) * s.d * R;
      c.strokeStyle = s.c < 0.5 ? `rgba(255,255,255,${0.35 + 0.65 * k})` : `rgba(${tint[0]},${tint[1]},${tint[2]},${0.4 + 0.6 * k})`; c.lineWidth = 0.6 + s.d * 2.2 * (0.5 + k);
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke();
    }
    const gl = c.createRadialGradient(cx, cy, 0, cx, cy, R * (0.25 + 0.7 * k)); gl.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},${0.55 * k})`); gl.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gl; c.fillRect(0, 0, W, H);
    if (t > 0.78) { c.fillStyle = `rgba(255,255,255,${(t - 0.78) / 0.22})`; c.fillRect(0, 0, W, H); }
    el.querySelector('.uv-warp-txt').style.opacity = String(Math.min(1, t * 3) * (1 - Math.max(0, (t - 0.7) / 0.3)));
    if (t < 1) requestAnimationFrame(step); else finish();
  };
  requestAnimationFrame(step);
  setTimeout(finish, DUR + 600);   // background tabs throttle rAF: never get stuck
}
