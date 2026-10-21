// Shared constants — imported by main thread AND workers. Do not import THREE here.
export const CHUNK_SIZE = 32;          // blocks per chunk edge (X and Z)
export const CHUNK_SHIFT = 5;          // log2(CHUNK_SIZE)
export const WORLD_HEIGHT = 192;       // Y in [0, 192)
export const SEA_LEVEL = 62;           // water fills y <= SEA_LEVEL (top surface at SEA_LEVEL + WATER_TOP)
export const WATER_TOP = 0.875;        // water surface height inside its block (fraction)
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT; // 196608
export const POS_UNIT = 16;            // packed chunk vertex positions are in 1/16 block
export const LOD_CELLS = 32;           // LOD tile = 32x32 cells; level L cell = 2^L blocks, tile edge = 32 * 2^L blocks
export const MAX_LOD = 9;              // levels 1..9 (tile edge 64 .. 16384 blocks); level 0 == real voxel chunks
// voxel index inside a chunk (x fastest, y slowest). Interior only, x,z in [0,32), y in [0,192)
export const vIndex = (x, y, z) => x + (z << 5) + (y << 10);
// face ids used everywhere (aMeta.x low 3 bits)
export const FACE = { PX: 0, NX: 1, PY: 2, NY: 3, PZ: 4, NZ: 5, CROSS: 6 };
export const FACE_NORMAL = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
// aMeta.x flag bits (chunk meshes)
export const META_AO_SHIFT = 3;        // bits 3-4 : AO 0 (dark) .. 3 (bright)
export const META_SWAY = 1 << 5;       // wind sway (leaves, grass, flowers)
export const META_CUTOUT = 1 << 6;     // alpha-tested tile (alpha = coverage); otherwise tile alpha = biome-tint mask
export const META_EMISSIVE = 1 << 7;   // unlit / full bright (glowstone, lava)
// LOD aMeta.y flag bits
export const LODF_CANOPY = 1, LODF_SNOW = 2, LODF_CLIFF = 4, LODF_SAND = 8, LODF_WATER = 16;
