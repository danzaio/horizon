// Block icons drawn on 2D canvases from the procedural tiles (render/textures.js -> generateTilePixels); flat-colour fallback.
import { BLOCKS, TILE_FACE, TILE_NAMES, RENDER_CROSS, TINT_GRASS } from '../shared/blocks.js';
import { tileGenerator, tintOf, blockColor } from '../game/blockColors.js';

const tiles = new Map();

/** 16x16 canvas for (block, face) with biome tint approximated; null if tiles aren't available yet. */
function tileCanvas(id, face) {
  const gen = tileGenerator(); if (!gen) return null;
  const def = BLOCKS[id], name = TILE_NAMES[TILE_FACE[id * 6 + face]], key = name + ':' + id + ':' + face;
  let cv = tiles.get(key); if (cv) return cv;
  let px; try { px = gen(name); } catch { return null; }
  const tint = tintOf(id), applyTint = tint && !(def.tint === TINT_GRASS && face === 3);
  cv = document.createElement('canvas'); cv.width = cv.height = 16;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(16, 16), d = img.data;
  for (let i = 0; i < 1024; i += 4) {
    let a = px[i + 3], m = 0;
    if (applyTint) m = def.cutout ? 1 : a / 255;
    if (m) { d[i] = px[i] * (1 - m + m * tint[0]); d[i + 1] = px[i + 1] * (1 - m + m * tint[1]); d[i + 2] = px[i + 2] * (1 - m + m * tint[2]); }
    else { d[i] = px[i]; d[i + 1] = px[i + 1]; d[i + 2] = px[i + 2]; }
    d[i + 3] = def.cutout ? a : 255;
  }
  ctx.putImageData(img, 0, 0); tiles.set(key, cv); return cv;
}

const hex = (c) => `rgb(${(c[0] * 255) | 0},${(c[1] * 255) | 0},${(c[2] * 255) | 0})`;

/** Draw an isometric block icon (or a flat sprite for plants) into `canvas` (resized to 32x32). */
export function drawBlockIcon(canvas, id) {
  const S = 32; canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; ctx.clearRect(0, 0, S, S);
  const def = BLOCKS[id]; if (!def) return;
  const top = tileCanvas(id, 2), left = tileCanvas(id, 4), right = tileCanvas(id, 0);
  if (def.render === RENDER_CROSS) {
    if (top) ctx.drawImage(top, 0, 0, S, S); else { ctx.fillStyle = hex(blockColor(id)); ctx.fillRect(10, 8, 12, 20); }
    return;
  }
  const faces = [[1, .5, -1, .5, 16, 0, top, 0], [1, .5, 0, 1, 0, 8, left, 0.2], [1, -.5, 0, 1, 16, 16, right, 0.4]];
  const c = blockColor(id);
  for (const [a, b, cc, d, e, f, img, dark] of faces) {
    ctx.setTransform(a, b, cc, d, e, f);
    if (img) ctx.drawImage(img, 0, 0, 16, 16);
    else { ctx.fillStyle = hex(c); ctx.fillRect(0, 0, 16, 16); }
    if (dark) { ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, 16, 16); ctx.globalCompositeOperation = 'source-over'; }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
