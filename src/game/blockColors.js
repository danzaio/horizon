// Average colour per block (for particles / flat icon fallbacks). Uses the procedural tiles when render/textures.js is available.
import { BLOCKS, TILE_FACE, TILE_NAMES, TINT_GRASS, TINT_FOLIAGE } from '../shared/blocks.js';

const FALLBACK = {
  stone: 0x7d7d7d, dirt: 0x866043, grass: 0x5e9d34, sand: 0xdbd29a, gravel: 0x857f7c, snow: 0xf4fbff, snowy_grass: 0xe8f2f5, water: 0x3a6fd8, ice: 0xa5d0f2,
  oak_log: 0x6b5330, oak_leaves: 0x3f8a2a, birch_log: 0xd7d3c4, birch_leaves: 0x6a9a3c, spruce_log: 0x3c2a18, spruce_leaves: 0x2b5a35,
  sandstone: 0xd8c98a, cactus: 0x2f7a31, bedrock: 0x3a3a3a, coal_ore: 0x5c5c5c, iron_ore: 0x9a8472, gold_ore: 0xb9a24a, diamond_ore: 0x6fb6c0,
  planks: 0xa8814a, cobblestone: 0x6f6f6f, glass: 0xcfe9f2, glowstone: 0xf1c75b, lava: 0xe5611a, tall_grass: 0x5fa23a, red_flower: 0xd3322a,
  yellow_flower: 0xe8c933, dead_bush: 0x7b5b2e, bricks: 0x9b4b3a,
};
const cache = new Map();
let gen = null;

/** Give the module the procedural tile generator once it is loaded (name -> Uint8ClampedArray 16x16 RGBA). */
export function setTileGenerator(fn) { gen = fn; cache.clear(); }
export function tileGenerator() { return gen; }

/** Tint multiplier (0..1 rgb) applied to biome-tinted blocks when drawing icons / particles. */
export function tintOf(id) {
  const t = BLOCKS[id] ? BLOCKS[id].tint : 0;
  if (t === TINT_GRASS) return [0.56, 0.78, 0.36];
  if (t === TINT_FOLIAGE) return [0.5, 0.75, 0.3];
  return null;
}

/** @returns {number[]} [r,g,b] in 0..1 */
export function blockColor(id) {
  let c = cache.get(id);
  if (c) return c;
  const def = BLOCKS[id];
  const flat = (FALLBACK[def ? def.name : ''] ?? 0x888888);
  c = [((flat >> 16) & 255) / 255, ((flat >> 8) & 255) / 255, (flat & 255) / 255];
  if (gen && def) {
    try {
      const px = gen(TILE_NAMES[TILE_FACE[id * 6 + 4]]);
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 40) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; }
      if (n) {
        const t = tintOf(id) || [1, 1, 1];
        c = [r / n / 255 * t[0], g / n / 255 * t[1], b / n / 255 * t[2]];
        if (def.tint) c = [c[0] * 0.5 + (flat >> 16 & 255) / 510, c[1] * 0.5 + (flat >> 8 & 255) / 510, c[2] * 0.5 + (flat & 255) / 510];
      }
    } catch { /* keep fallback */ }
    cache.set(id, c);
  }
  return c;
}
