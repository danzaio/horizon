// Procedural 16x16 pixel-art block tiles (no assets, synchronous, dependency-free except THREE for the array texture).
// Pixel data is sRGB bytes. Row 0 of the pixel array is the TOP of the image (canvas order); the texture array
// uploader flips rows so that v=0 is the BOTTOM of a side face (GL convention, v grows upward).
import * as THREE from 'three';
import { TILE_NAMES } from '../shared/blocks.js';

const S = 16;

/** @param {number} x @param {number} y @param {number} s @returns {number} 0..1 */
function h2(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const wrap = (v) => ((v % S) + S) % S;
/** value noise, tile-wrapped, `cells` lattice cells over the tile. */
function vn(x, y, s, cells) {
  const f = cells / S, fx = x * f, fy = y * f, ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
  const g = (a, b) => h2(((a % cells) + cells) % cells, ((b % cells) + cells) % cells, s);
  const a = g(ix, iy), b = g(ix + 1, iy), c = g(ix, iy + 1), d = g(ix + 1, iy + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const clamp = (v, a = 0, b = 255) => (v < a ? a : v > b ? b : v);
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

/** voronoi cell id/distances on a wrapped 16x16 grid. returns [f1, f2, id] */
function vor(x, y, s, n) {
  const cs = S / n; let f1 = 1e9, f2 = 1e9, id = 0;
  const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const gx = cx + i, gy = cy + j, wx = ((gx % n) + n) % n, wy = ((gy % n) + n) % n;
    const px = (gx + h2(wx, wy, s)) * cs, py = (gy + h2(wx, wy, s + 7)) * cs;
    const d = Math.hypot(x - px, y - py);
    if (d < f1) { f2 = f1; f1 = d; id = h2(wx, wy, s + 13); } else if (d < f2) f2 = d;
  }
  return [f1, f2, id];
}

const stoneAt = (x, y, s, base = 128) => {
  const n = h2(x, y, s) * 0.5 + vn(x, y, s + 1, 4) * 0.7 + vn(x, y, s + 2, 8) * 0.3;
  const v = base + (n - 0.75) * 46;
  return [v, v, v * 1.02];
};
const dirtAt = (x, y, s) => {
  const n = h2(x, y, s) * 0.55 + vn(x, y, s + 3, 4) * 0.6;
  const v = 0.78 + (n - 0.6) * 0.7;
  const sp = h2(x, y, s + 9) > 0.93 ? 0.8 : 1;
  return [134 * v * sp, 96 * v * sp, 67 * v * sp];
};
const sandAt = (x, y, s, c = [222, 208, 160]) => { const n = 0.9 + h2(x, y, s) * 0.12 + (vn(x, y, s + 1, 8) - 0.5) * 0.12; return mul(c, n); };

function logSide(x, y, s, base, dark, streak) {
  const col = Math.floor(x), n = h2(col, 0, s) * 0.5 + h2(x, Math.floor(y / 3), s + 1) * 0.5;
  const c = mixc(base, dark, clamp(n * streak + (h2(x, y, s + 2) - 0.5) * 0.25, 0, 1));
  return c;
}
function logTop(x, y, s, wood, bark) {
  const dx = x - 7.5, dy = y - 7.5, d = Math.max(Math.abs(dx), Math.abs(dy));
  if (d > 6.6) return mul(bark, 0.85 + h2(x, y, s) * 0.25);
  const r = Math.hypot(dx, dy), ring = Math.sin(r * 2.1 + h2(0, 0, s) * 3) * 0.5 + 0.5;
  return mul(wood, 0.82 + ring * 0.2 + (h2(x, y, s + 1) - 0.5) * 0.08);
}
function leaves(x, y, s, a, b, hole) {
  const n = h2(x, y, s), n2 = vn(x, y, s + 4, 6);
  const alpha = (n2 * 0.6 + n * 0.5) < hole ? 0 : 255;
  const c = mixc(a, b, clamp(n * 0.7 + n2 * 0.5 - 0.25, 0, 1));
  return [c[0], c[1], c[2], alpha];
}
function ore(x, y, s, spot, spot2) {
  const b = stoneAt(x, y, 1);
  const v = vor(x, y, s, 4);
  const inClump = v[0] < 1.55 && v[2] > 0.35;
  if (inClump && h2(x, y, s + 5) > 0.2) return mul(h2(x, y, s + 6) > 0.5 ? spot : spot2, 0.85 + h2(x, y, s + 7) * 0.3);
  return b;
}

const GENS = {
  water: (x, y) => { const n = vn(x, y, 5, 4) * 0.5 + h2(x, y, 6) * 0.15; return [40 + n * 40, 90 + n * 60, 190 + n * 40, 255]; },
  stone: (x, y) => stoneAt(x, y, 11),
  dirt: (x, y) => dirtAt(x, y, 21),
  grass_top: (x, y) => {
    const n = h2(x, y, 31) * 0.45 + vn(x, y, 32, 4) * 0.55;
    const v = 164 + n * 62 + (h2(x, y, 33) > 0.9 ? 16 : 0);
    return [v, v, v, 255];
  },
  grass_side: (x, y) => {
    const fr = 2 + Math.floor(h2(x, 0, 41) * 3) + (h2(x, 1, 42) > 0.7 ? 1 : 0);
    if (y < fr) {
      const v = 178 + h2(x, y, 43) * 66;
      return [v, v, v, 255];
    }
    const d = dirtAt(x, y, 21); d[3] = 0; return d;
  },
  sand: (x, y) => sandAt(x, y, 51),
  gravel: (x, y) => {
    const v = vor(x, y, 61, 5), n = 0.72 + v[2] * 0.4 - v[0] * 0.025 + (h2(x, y, 62) - 0.5) * 0.1;
    const tone = v[2] > 0.66 ? [150, 140, 128] : v[2] > 0.33 ? [130, 128, 126] : [110, 106, 104];
    return mul(tone, n * (v[1] - v[0] < 0.5 ? 0.78 : 1));
  },
  snow: (x, y) => { const n = 0.96 + h2(x, y, 71) * 0.05 + (vn(x, y, 72, 4) - 0.5) * 0.06; return [240 * n, 247 * n, 255 * n]; },
  grass_side_snow: (x, y) => {
    const fr = 3 + Math.floor(h2(x, 0, 41) * 3);
    if (y < fr) { const n = 0.96 + h2(x, y, 71) * 0.05; return [240 * n, 247 * n, 255 * n, 0]; }
    const d = dirtAt(x, y, 21); d[3] = 0; return d;
  },
  ice: (x, y) => {
    const n = vn(x, y, 81, 4) * 0.4 + h2(x, y, 82) * 0.1;
    const streak = Math.abs(Math.sin((x + y) * 0.9 + vn(x, y, 83, 4) * 4)) > 0.93 ? 12 : 0;
    return [150 + n * 50 + streak, 195 + n * 40 + streak, 245 + n * 8 + streak * 0.5, 255];
  },
  log_oak_side: (x, y) => logSide(x, y, 91, [112, 86, 52], [70, 52, 30], 1.1),
  log_oak_top: (x, y) => logTop(x, y, 92, [172, 138, 84], [100, 76, 44]),
  leaves_oak: (x, y) => leaves(x, y, 101, [165, 165, 165], [245, 245, 245], 0.36),
  log_birch_side: (x, y) => {
    const base = mul([226, 222, 210], 0.9 + h2(x, Math.floor(y / 2), 111) * 0.1);
    const mark = h2(Math.floor(x / 2), y, 112) > 0.86 && h2(x, y, 113) > 0.35;
    return mark ? [44, 42, 40] : base;
  },
  log_birch_top: (x, y) => logTop(x, y, 114, [196, 176, 120], [214, 210, 198]),
  leaves_birch: (x, y) => leaves(x, y, 121, [92, 134, 52], [130, 170, 76], 0.36),
  log_spruce_side: (x, y) => logSide(x, y, 131, [72, 52, 32], [42, 30, 18], 1.2),
  log_spruce_top: (x, y) => logTop(x, y, 132, [128, 96, 56], [60, 44, 26]),
  leaves_spruce: (x, y) => leaves(x, y, 141, [34, 76, 46], [56, 104, 62], 0.3),
  sandstone_side: (x, y) => {
    const band = Math.sin(y * 1.3 + vn(x, y, 151, 4) * 2) * 0.04, c = sandAt(x, y, 152, [214, 198, 148]);
    const ed = y === 0 || y === 15 ? 0.92 : 1;
    return mul(c, (1 + band) * ed);
  },
  sandstone_top: (x, y) => sandAt(x, y, 153, [218, 203, 154]),
  cactus_side: (x, y) => {
    const edge = x === 0 || x === 15 ? 0.7 : 1, rib = x % 5 === 2 ? 0.88 : 1;
    const spine = (x % 4 === 1 && y % 4 === 2) ? 1.9 : 1;
    const n = 0.88 + h2(x, y, 161) * 0.18;
    return mul([52, 124, 40], edge * rib * n * spine);
  },
  cactus_top: (x, y) => {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    return mul(d > 6.2 ? [40, 98, 32] : [70, 148, 52], 0.9 + h2(x, y, 171) * 0.18);
  },
  bedrock: (x, y) => {
    const v = vor(x, y, 181, 4), n = 0.4 + h2(x, y, 182) * 0.4 + v[2] * 0.3;
    const c = 32 + n * 60; return [c, c, c * 1.03];
  },
  coal_ore: (x, y) => ore(x, y, 191, [28, 28, 30], [48, 46, 46]),
  iron_ore: (x, y) => ore(x, y, 192, [214, 168, 138], [188, 140, 108]),
  gold_ore: (x, y) => ore(x, y, 193, [252, 220, 60], [230, 180, 40]),
  diamond_ore: (x, y) => ore(x, y, 194, [96, 232, 224], [60, 190, 200]),
  planks: (x, y) => {
    const row = Math.floor(y / 4), off = h2(row, 0, 201), g = 0.9 + h2(Math.floor(x / 5) + row * 9, 0, 202) * 0.18;
    const grain = Math.sin((x + off * 16) * 0.8 + h2(x, row, 203) * 2) * 0.03;
    const seam = y % 4 === 3 ? 0.72 : 1, nail = ((x === 1 || x === 14) && y % 4 === 1) ? 0.7 : 1;
    return mul([176, 138, 84], (g + grain + (h2(x, y, 204) - 0.5) * 0.06) * seam * nail);
  },
  cobble: (x, y) => {
    const v = vor(x, y, 211, 4), edge = v[1] - v[0] < 0.9 ? 0.6 : 1;
    const t = 0.78 + v[2] * 0.4 + (h2(x, y, 212) - 0.5) * 0.12;
    return mul([128, 128, 128], t * edge);
  },
  glass: (x, y) => {
    const frame = x === 0 || y === 0 || x === 15 || y === 15;
    if (frame) return [208, 232, 240, 255];
    const gl = (x === 2 && y > 1 && y < 6) || (y === 2 && x > 1 && x < 6) || (x === 4 && y === 4);
    return gl ? [255, 255, 255, 255] : [200, 230, 240, 0];
  },
  glowstone: (x, y) => {
    const v = vor(x, y, 221, 4), n = 0.7 + (1 - v[0] / 5) * 0.35 + h2(x, y, 222) * 0.2;
    const edge = v[1] - v[0] < 0.7 ? 0.72 : 1;
    return mul([255, 206, 110], n * edge);
  },
  lava: (x, y) => {
    const n = vn(x, y, 231, 4) * 0.6 + vn(x, y, 232, 8) * 0.3 + h2(x, y, 233) * 0.15;
    const t = clamp((n - 0.35) * 2.2, 0, 1);
    return mixc([150, 28, 4], [255, 226, 90], t);
  },
  tall_grass: (x, y) => {
    // blades: columns with varying heights; near-gray so grass tint multiplies cleanly
    const blades = [[2, 11], [4, 14], [6, 9], [8, 15], [10, 12], [12, 8], [13, 13]];
    for (const [bx, bh] of blades) {
      const sway = Math.round(Math.sin(y * 0.4 + bx) * 0.6);
      if (Math.abs(x - (bx + sway)) < 0.5 && y >= 16 - bh) {
        const t = (y - (16 - bh)) / bh, v = 130 + t * 100 + h2(x, y, 241) * 25;
        return [v, v, v, 255];
      }
    }
    return [150, 150, 150, 0];
  },
  flower_red: (x, y) => flower(x, y, [220, 30, 38], [255, 90, 90], 251),
  flower_yellow: (x, y) => flower(x, y, [255, 214, 30], [255, 244, 110], 252),
  dead_bush: (x, y) => {
    const branches = [[8, 15, 8, 8], [8, 11, 4, 5], [8, 10, 12, 4], [8, 8, 6, 2], [8, 12, 11, 8], [5, 6, 3, 3]];
    for (const [x0, y0, x1, y1] of branches) {
      const t = (y0 - y) / (y0 - y1 || 1);
      if (t >= 0 && t <= 1 && Math.abs(x - (x0 + (x1 - x0) * t)) < 0.6) return mul([122, 88, 46], 0.8 + h2(x, y, 261) * 0.4).concat(255);
    }
    return [100, 80, 40, 0];
  },
  log_cherry_side: (x, y) => logSide(x, y, 291, [104, 62, 66], [66, 38, 44], 1.1),
  log_cherry_top: (x, y) => logTop(x, y, 292, [196, 126, 132], [100, 60, 66]),
  leaves_cherry: (x, y) => {
    const c = leaves(x, y, 293, [236, 142, 182], [255, 196, 224], 0.34);
    if (h2(x, y, 294) > 0.88) { c[0] = 214; c[1] = 112; c[2] = 156; }
    return c;
  },
  red_sand: (x, y) => sandAt(x, y, 295, [190, 104, 48]),
  terracotta_orange: (x, y) => terra(x, y, 296, [182, 98, 56]),
  terracotta_yellow: (x, y) => terra(x, y, 297, [206, 160, 78]),
  terracotta_red: (x, y) => terra(x, y, 298, [152, 64, 48]),
  terracotta_white: (x, y) => terra(x, y, 299, [210, 186, 168]),
  terracotta_brown: (x, y) => terra(x, y, 300, [112, 74, 56]),
  flower_pink: (x, y) => flower(x, y, [236, 112, 172], [255, 186, 216], 301),
  seagrass: (x, y) => {
    const blades = [[3, 10], [5, 13], [7, 8], [9, 14], [11, 11], [13, 9]];
    for (const [bx, bh] of blades) {
      const sway = Math.round(Math.sin(y * 0.55 + bx * 1.7) * 0.9);
      if (Math.abs(x - (bx + sway)) < 0.7 && y >= 16 - bh) { const t = (y - (16 - bh)) / bh; return mul([38, 128, 78], 0.7 + t * 0.55 + h2(x, y, 311) * 0.12).concat(255); }
    }
    return [40, 120, 70, 0];
  },
  kelp: (x, y) => {
    const cx = 7.5 + Math.sin(y * 0.6 + 1.2) * 1.4;
    if (Math.abs(x - cx) < 0.9) return mul([86, 128, 36], 0.78 + h2(x, y, 321) * 0.3).concat(255);
    const leaf = (y % 5 === 2 || y % 5 === 3) && Math.abs(x - cx) < 4.2 && h2(Math.floor(y / 5), x < cx ? 0 : 1, 322) > 0.35;
    if (leaf) return mul([62, 108, 34], 0.8 + h2(x, y, 323) * 0.35).concat(255);
    return [60, 100, 40, 0];
  },
  coral_pink: (x, y) => coral(x, y, 331, [226, 96, 154], [255, 154, 196]),
  coral_purple: (x, y) => coral(x, y, 332, [150, 70, 200], [206, 130, 246]),
  coral_red: (x, y) => coral(x, y, 333, [206, 52, 60], [248, 110, 104]),
  coral_yellow: (x, y) => coral(x, y, 334, [230, 190, 40], [255, 236, 110]),
  torch: (x, y) => {
    if (x >= 7 && x <= 8 && y >= 7) return mul([128, 92, 50], 0.8 + h2(x, y, 341) * 0.3).concat(255);
    const dx = x - 7.5, dy = y - 5.2;
    if (Math.abs(dx) < 1.7 && dy > -3.2 && dy < 2.6 && Math.abs(dx) < 1.9 - Math.abs(dy) * 0.28) return (Math.abs(dx) < 0.8 && dy > -1.4 ? [255, 244, 170, 255] : mixc([255, 190, 60], [255, 120, 30], clamp(dy / 3 + h2(x, y, 342) * 0.3, 0, 1)).concat(255));
    return [90, 60, 30, 0];
  },
  hay_side: (x, y) => {
    const band = (y === 3 || y === 4 || y === 11 || y === 12) ? [140, 96, 52] : null;
    if (band) return mul(band, 0.85 + h2(x, y, 351) * 0.25);
    const streak = Math.sin(x * 2.1 + h2(x, 0, 352) * 4) * 0.06;
    return mul([214, 178, 66], 0.88 + h2(x, y, 353) * 0.22 + streak);
  },
  hay_top: (x, y) => {
    const r = Math.hypot(x - 7.5, y - 7.5), ring = Math.sin(r * 2.4) * 0.07;
    return mul(r > 7 ? [150, 104, 56] : [222, 188, 76], 0.9 + h2(x, y, 361) * 0.2 + ring);
  },
  path_top: (x, y) => {
    const n = h2(x, y, 371) * 0.5 + vn(x, y, 372, 4) * 0.6, p = h2(x, y, 373) > 0.9;
    return mul([170, 132, 84], (0.78 + (n - 0.6) * 0.6) * (p ? 0.82 : 1));
  },
  path_side: (x, y) => (y < 2 ? mul([160, 124, 78], 0.85 + h2(x, y, 381) * 0.2) : dirtAt(x, y, 21)),
  bricks: (x, y) => {
    const row = Math.floor(y / 4), xo = row % 2 ? 4 : 0, bx = (x + xo) % 8;
    const mortar = y % 4 === 3 || bx === 7;
    if (mortar) return mul([186, 182, 172], 0.9 + h2(x, y, 271) * 0.1);
    const t = 0.82 + h2(Math.floor((x + xo) / 8), row, 272) * 0.3 + (h2(x, y, 273) - 0.5) * 0.12;
    return mul([160, 66, 50], t);
  },
  // --- items (G) ---
  tnt_top: (x, y) => {
    const r = Math.hypot(x - 7.5, y - 7.5), plate = r < 3.2 || (x === 7 || x === 8) && (y < 3 || y > 12);
    return plate ? mul([110, 100, 92], 0.85 + h2(x, y, 391) * 0.2) : mul([196, 56, 46], 0.85 + h2(x, y, 392) * 0.22);
  },
  tnt_side: (x, y) => {
    if (y >= 4 && y <= 11) { // white label band with a dark "TNT" in a 3x5 pixel font
      const ROWS = { T: ['111', '010', '010', '010', '010'], N: ['101', '111', '111', '101', '101'] }, word = ['T', 'N', 'T'];
      const li = Math.floor((x - 2) / 4), cx = (x - 2) % 4, ry = y - 5;
      const ink = li >= 0 && li < 3 && cx >= 0 && cx < 3 && ry >= 0 && ry < 5 && ROWS[word[li]][ry][cx] === '1';
      return ink ? [40, 36, 36, 255] : mul([232, 226, 214], 0.92 + h2(x, y, 393) * 0.1);
    }
    const stripe = x % 4 === 3 ? 0.82 : 1;
    return mul([196, 56, 46], (0.84 + h2(x, y, 394) * 0.22) * stripe);
  },
};

// brain-coral look: bumpy cells with dark grooves
function coral(x, y, s, c1, c2) {
  const v = vor(x, y, s, 4), groove = v[1] - v[0] < 0.75 ? 0.62 : 1;
  return mul(mixc(c1, c2, clamp(1 - v[0] / 3.2 + (h2(x, y, s + 1) - 0.5) * 0.25, 0, 1)), groove * (0.9 + h2(x, y, s + 2) * 0.2));
}

// fired-clay look: smooth with faint horizontal banding and a few darker flecks
function terra(x, y, s, c) {
  const n = 0.93 + h2(x, y, s) * 0.1 + (vn(x, y, s + 1, 4) - 0.5) * 0.1 + Math.sin(y * 1.1 + vn(x, y, s + 2, 4) * 3) * 0.015;
  return mul(c, n * (h2(x, y, s + 3) > 0.96 ? 0.88 : 1));
}

function flower(x, y, c1, c2, s) {
  // stem + head
  if (x >= 7 && x <= 8 && y >= 8) return mul([60, 130, 40], 0.85 + h2(x, y, s) * 0.3).concat(255);
  if (x === 5 && y === 12 || x === 10 && y === 11) return [64, 140, 44, 255];
  const dx = x - 7.5, dy = y - 5.5, r = Math.hypot(dx, dy);
  if (r < 1.3) return [250, 200, 40, 255];
  if (r < 3.4 && !(Math.abs(dx) < 0.8 && Math.abs(dy) < 0.8)) {
    const a = Math.atan2(dy, dx);
    if (Math.cos(a * 2.5) > -0.55) return mixc(c1, c2, h2(x, y, s + 1)).concat(255);
  }
  return [90, 90, 90, 0];
}

const CUTOUT_NAMES = new Set(['leaves_oak', 'leaves_birch', 'leaves_spruce', 'glass', 'tall_grass', 'flower_red', 'flower_yellow', 'dead_bush', 'leaves_cherry', 'flower_pink', 'seagrass', 'kelp', 'torch']);

/**
 * Pixel data (sRGB bytes, canvas row order, row 0 = top) for one tile.
 * @param {string} name tile name from TILE_NAMES
 * @returns {Uint8ClampedArray} 16*16*4
 */
export function generateTilePixels(name) {
  const gen = GENS[name] || ((x, y) => [255 * ((x + y) & 1), 0, 255 * ((x + y) & 1), 255]); // magenta checker = missing
  const out = new Uint8ClampedArray(S * S * 4);
  let sr = 0, sg = 0, sb = 0, sn = 0;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const c = gen(x, y), i = (y * S + x) * 4, a = c.length > 3 ? c[3] : 255;
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = a;
    if (a > 0) { sr += c[0]; sg += c[1]; sb += c[2]; sn++; }
  }
  if (CUTOUT_NAMES.has(name) && sn > 0 && sn < S * S) { // colour-bleed into transparent texels so mips never darken
    sr /= sn; sg /= sn; sb /= sn;
    for (let i = 0; i < S * S * 4; i += 4) if (out[i + 3] === 0) { out[i] = sr; out[i + 1] = sg; out[i + 2] = sb; }
  }
  return out;
}

/**
 * Texture array with one 16x16 layer per TILE_NAMES entry. Stores sRGB bytes (NoColorSpace): shaders decode to linear.
 * v=0 is the bottom of the tile (rows are flipped on upload).
 * @returns {THREE.DataArrayTexture}
 */
export function createBlockTextureArray() {
  const n = TILE_NAMES.length, data = new Uint8Array(S * S * 4 * n);
  for (let l = 0; l < n; l++) {
    const px = generateTilePixels(TILE_NAMES[l]), base = l * S * S * 4;
    for (let y = 0; y < S; y++) data.set(px.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), base + y * S * 4);
  }
  const tex = new THREE.DataArrayTexture(data, S, S, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}
