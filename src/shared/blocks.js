// Block registry — single source of truth for ids / tiles / flags. Safe in workers (no THREE).
export const RENDER_NONE = 0, RENDER_CUBE = 1, RENDER_CROSS = 2, RENDER_LIQUID = 3;
export const TINT_NONE = 0, TINT_GRASS = 1, TINT_FOLIAGE = 2, TINT_WATER = 3;

export const B = {
  AIR: 0, STONE: 1, DIRT: 2, GRASS: 3, SAND: 4, GRAVEL: 5, SNOW: 6, SNOW_GRASS: 7, WATER: 8, ICE: 9,
  LOG_OAK: 10, LEAVES_OAK: 11, LOG_BIRCH: 12, LEAVES_BIRCH: 13, LOG_SPRUCE: 14, LEAVES_SPRUCE: 15,
  SANDSTONE: 16, CACTUS: 17, BEDROCK: 18, COAL_ORE: 19, IRON_ORE: 20, GOLD_ORE: 21, DIAMOND_ORE: 22,
  PLANKS: 23, COBBLE: 24, GLASS: 25, GLOWSTONE: 26, LAVA: 27,
  TALL_GRASS: 28, FLOWER_RED: 29, FLOWER_YELLOW: 30, DEAD_BUSH: 31, BRICKS: 32,
  CHERRY_LOG: 33, CHERRY_LEAVES: 34, RED_SAND: 35, TERRACOTTA: 36, TERRACOTTA_YELLOW: 37, TERRACOTTA_RED: 38, TERRACOTTA_WHITE: 39, TERRACOTTA_BROWN: 40, PINK_FLOWER: 41,
  SEAGRASS: 42, KELP: 43, CORAL_PINK: 44, CORAL_PURPLE: 45, CORAL_RED: 46, CORAL_YELLOW: 47, TORCH: 48, HAY: 49, PATH: 50,
  UNLOADED: 255, // returned by World.getBlock for not-yet-loaded columns; treated as solid+opaque
};

// opts: render, solid, opaque, cutout, tint, emit(0-15), sway, tiles:{all}|{top,bottom,side}
const defs = [];
function def(id, name, o) {
  defs[id] = Object.assign({ id, name, render: RENDER_CUBE, solid: true, opaque: true, cutout: false, tint: TINT_NONE, emit: 0, sway: false, placeable: true }, o);
}
def(0, 'air', { render: RENDER_NONE, solid: false, opaque: false, placeable: false, tiles: {} });
def(1, 'stone', { tiles: { all: 'stone' } });
def(2, 'dirt', { tiles: { all: 'dirt' } });
def(3, 'grass', { tint: TINT_GRASS, tiles: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' } }); // grass_side alpha = tint mask (green fringe only)
def(4, 'sand', { tiles: { all: 'sand' } });
def(5, 'gravel', { tiles: { all: 'gravel' } });
def(6, 'snow', { tiles: { all: 'snow' } });
def(7, 'snowy_grass', { tiles: { top: 'snow', bottom: 'dirt', side: 'grass_side_snow' } });
def(8, 'water', { render: RENDER_LIQUID, solid: false, opaque: false, tint: TINT_WATER, placeable: false, tiles: { all: 'water' } });
def(9, 'ice', { opaque: false, tiles: { all: 'ice' } }); // translucent-looking but rendered in solid pass (texture is opaque-ish); faces vs ice culled
def(10, 'oak_log', { tiles: { top: 'log_oak_top', bottom: 'log_oak_top', side: 'log_oak_side' } });
def(11, 'oak_leaves', { opaque: false, cutout: true, tint: TINT_FOLIAGE, sway: true, tiles: { all: 'leaves_oak' } });
def(12, 'birch_log', { tiles: { top: 'log_birch_top', bottom: 'log_birch_top', side: 'log_birch_side' } });
def(13, 'birch_leaves', { opaque: false, cutout: true, sway: true, tiles: { all: 'leaves_birch' } });
def(14, 'spruce_log', { tiles: { top: 'log_spruce_top', bottom: 'log_spruce_top', side: 'log_spruce_side' } });
def(15, 'spruce_leaves', { opaque: false, cutout: true, sway: true, tiles: { all: 'leaves_spruce' } });
def(16, 'sandstone', { tiles: { top: 'sandstone_top', bottom: 'sandstone_top', side: 'sandstone_side' } });
def(17, 'cactus', { opaque: false, tiles: { top: 'cactus_top', bottom: 'cactus_top', side: 'cactus_side' } });
def(18, 'bedrock', { placeable: false, tiles: { all: 'bedrock' } });
def(19, 'coal_ore', { tiles: { all: 'coal_ore' } });
def(20, 'iron_ore', { tiles: { all: 'iron_ore' } });
def(21, 'gold_ore', { tiles: { all: 'gold_ore' } });
def(22, 'diamond_ore', { tiles: { all: 'diamond_ore' } });
def(23, 'planks', { tiles: { all: 'planks' } });
def(24, 'cobblestone', { tiles: { all: 'cobble' } });
def(25, 'glass', { opaque: false, cutout: true, tiles: { all: 'glass' } });
def(26, 'glowstone', { emit: 15, tiles: { all: 'glowstone' } });
def(27, 'lava', { emit: 15, placeable: false, tiles: { all: 'lava' } }); // cube, emissive, solid-pass (not a liquid mesh)
def(28, 'tall_grass', { render: RENDER_CROSS, solid: false, opaque: false, cutout: true, tint: TINT_GRASS, sway: true, tiles: { all: 'tall_grass' } });
def(29, 'red_flower', { render: RENDER_CROSS, solid: false, opaque: false, cutout: true, sway: true, tiles: { all: 'flower_red' } });
def(30, 'yellow_flower', { render: RENDER_CROSS, solid: false, opaque: false, cutout: true, sway: true, tiles: { all: 'flower_yellow' } });
def(31, 'dead_bush', { render: RENDER_CROSS, solid: false, opaque: false, cutout: true, sway: true, placeable: false, tiles: { all: 'dead_bush' } });
def(32, 'bricks', { tiles: { all: 'bricks' } });
def(33, 'cherry_log', { tiles: { top: 'log_cherry_top', bottom: 'log_cherry_top', side: 'log_cherry_side' } });
def(34, 'cherry_leaves', { opaque: false, cutout: true, sway: true, tiles: { all: 'leaves_cherry' } });
def(35, 'red_sand', { tiles: { all: 'red_sand' } });
def(36, 'terracotta', { tiles: { all: 'terracotta_orange' } });
def(37, 'yellow_terracotta', { tiles: { all: 'terracotta_yellow' } });
def(38, 'red_terracotta', { tiles: { all: 'terracotta_red' } });
def(39, 'white_terracotta', { tiles: { all: 'terracotta_white' } });
def(40, 'brown_terracotta', { tiles: { all: 'terracotta_brown' } });
def(42, 'seagrass', { render: RENDER_CROSS, solid: false, opaque: false, cutout: true, sway: true, placeable: false, tiles: { all: 'seagrass' } });
def(43, 'kelp', { render: RENDER_CROSS, solid: false, opaque: false, cutout: true, sway: true, placeable: false, tiles: { all: 'kelp' } });
def(44, 'pink_coral', { tiles: { all: 'coral_pink' } });
def(45, 'purple_coral', { tiles: { all: 'coral_purple' } });
def(46, 'red_coral', { tiles: { all: 'coral_red' } });
def(47, 'yellow_coral', { tiles: { all: 'coral_yellow' } });
def(48, 'torch', { render: RENDER_CROSS, solid: false, opaque: false, cutout: true, emit: 14, tiles: { all: 'torch' } });
def(49, 'hay', { tiles: { top: 'hay_top', bottom: 'hay_top', side: 'hay_side' } });
def(50, 'dirt_path', { tiles: { top: 'path_top', bottom: 'dirt', side: 'path_side' } });
def(41, 'pink_flower', { render: RENDER_CROSS, solid: false, opaque: false, cutout: true, sway: true, tiles: { all: 'flower_pink' } });
// --- items (G): ids 51-69 ---
def(51, 'tnt', { tiles: { top: 'tnt_top', bottom: 'tnt_top', side: 'tnt_side' } });
B.TNT = 51;

export const BLOCKS = defs;               // sparse array indexed by id
export const N_BLOCKS = 256;

// Unique tile names in a stable order => index == texture-array layer. textures.js MUST generate every name.
export const TILE_NAMES = [];
const tileIdx = new Map();
function tileId(name) { if (!tileIdx.has(name)) { tileIdx.set(name, TILE_NAMES.length); TILE_NAMES.push(name); } return tileIdx.get(name); }
tileId('water'); // layer 0 reserved for water
export const TILE_FACE = new Uint16Array(N_BLOCKS * 6); // [id*6+face] -> layer (face: 0 +X,1 -X,2 +Y,3 -Y,4 +Z,5 -Z)
export const RENDER = new Uint8Array(N_BLOCKS), SOLID = new Uint8Array(N_BLOCKS), OPAQUE = new Uint8Array(N_BLOCKS),
  CUTOUT = new Uint8Array(N_BLOCKS), LIQUID = new Uint8Array(N_BLOCKS), TINT = new Uint8Array(N_BLOCKS),
  EMIT = new Uint8Array(N_BLOCKS), SWAY = new Uint8Array(N_BLOCKS);
for (const b of defs) {
  if (!b) continue;
  const id = b.id, t = b.tiles;
  for (let f = 0; f < 6; f++) {
    const name = t.all || (f === 2 ? t.top : f === 3 ? t.bottom : t.side);
    TILE_FACE[id * 6 + f] = name ? tileId(name) : 0;
  }
  RENDER[id] = b.render; SOLID[id] = b.solid ? 1 : 0; OPAQUE[id] = b.opaque ? 1 : 0; CUTOUT[id] = b.cutout ? 1 : 0;
  LIQUID[id] = b.render === RENDER_LIQUID ? 1 : 0; TINT[id] = b.tint; EMIT[id] = b.emit; SWAY[id] = b.sway ? 1 : 0;
}
SOLID[255] = 1; OPAQUE[255] = 1; RENDER[255] = RENDER_CUBE;
/** plants that live inside water: treated as water by the water mesher and by physics (swimming) */
export const WATERLOGGED = new Uint8Array(N_BLOCKS); WATERLOGGED[42] = 1; WATERLOGGED[43] = 1;
/** water or a plant standing in water */
export const isWatery = (id) => LIQUID[id] === 1 || WATERLOGGED[id] === 1;
export const PLACEABLE = defs.filter(b => b && b.placeable).map(b => b.id);
export const HOTBAR_DEFAULT = [B.GRASS, B.DIRT, B.STONE, B.COBBLE, B.PLANKS, B.GLASS, B.GLOWSTONE, B.TORCH, B.BRICKS];
export const blockName = id => (defs[id] ? defs[id].name : 'unknown');
export const tileLayer = name => tileIdx.get(name);
export const NUM_TILES = TILE_NAMES.length;
