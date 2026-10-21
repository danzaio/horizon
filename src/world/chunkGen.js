// Voxel chunk generation into a PADDED volume (34 x 194 x 34): 1-block border in x/z (so meshing never needs neighbour
// chunks) and one extra layer below (bedrock) / above (air). index = i + j*34 + (y+1)*1156, i = wx - (cx*32-1), j likewise.
import { SEA_LEVEL, CHUNK_VOLUME } from '../shared/constants.js';
import { B, SOLID, OPAQUE, CUTOUT, LIQUID, RENDER, EMIT } from '../shared/blocks.js';
import { createTerrain, BIOME, TREE_DENSITY } from './terrain.js';
import { hash3 } from './noise.js';

export const PS = 34, PSY = 1156, PH = 194;
export const VOL_SIZE = PS * PH * PS;
const CAVE_N = 10, CAVE_NY = 50;

const smooth = (a, b, x) => { const t = x < a ? 0 : x > b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
// blocks that stop sky light (opaque or leafy)
export const LIGHT_BLOCK = new Uint8Array(256);
for (let i = 0; i < 256; i++) LIGHT_BLOCK[i] = (OPAQUE[i] || (CUTOUT[i] && SOLID[i] && i !== B.GLASS)) ? 1 : 0;
const SPR = [0, 1, 2, 1, 2, 3, 2, 3, 3, 3, 3, 3, 3];
const VCELL = 224;
// village materials per biome: [wall, corner post, roof]
const VSTYLE = {
  [BIOME.PLAINS]: [B.PLANKS, B.LOG_OAK, B.COBBLE], [BIOME.FOREST]: [B.PLANKS, B.LOG_OAK, B.COBBLE], [BIOME.BIRCH]: [B.PLANKS, B.LOG_BIRCH, B.BRICKS],
  [BIOME.CHERRY]: [B.PLANKS, B.CHERRY_LOG, B.BRICKS], [BIOME.SAVANNA]: [B.PLANKS, B.LOG_BIRCH, B.TERRACOTTA], [BIOME.DESERT]: [B.SANDSTONE, B.SANDSTONE, B.SANDSTONE],
  [BIOME.TAIGA]: [B.PLANKS, B.LOG_SPRUCE, B.PLANKS], [BIOME.SNOWY]: [B.PLANKS, B.LOG_SPRUCE, B.COBBLE],
};
// clay strata (period 16) for badlands: orange base with yellow / red / white / brown stripes
const STRATA = [B.TERRACOTTA, B.TERRACOTTA, B.TERRACOTTA_YELLOW, B.TERRACOTTA_RED, B.TERRACOTTA, B.TERRACOTTA_WHITE, B.TERRACOTTA, B.TERRACOTTA_BROWN, B.TERRACOTTA, B.TERRACOTTA_YELLOW, B.TERRACOTTA, B.TERRACOTTA, B.TERRACOTTA_RED, B.TERRACOTTA_WHITE, B.TERRACOTTA, B.TERRACOTTA_BROWN];

export class ChunkGen {
  /** @param {number} seed @param {object|null} [profile] PlanetProfile (null = the legacy world, bit-identical) */
  constructor(seed, profile = null) {
    this.seed = seed | 0;
    this.profile = profile || null;
    this.terrain = createTerrain(seed, profile);
    // --- planet rules (neutral values reproduce the legacy world exactly)
    const pg = profile && profile.ground;
    this.gTop = pg ? B[pg.top] : B.GRASS; this.gFill = pg ? B[pg.fill] : B.DIRT;
    this.sandB = profile && profile.sand === 'red' ? B.RED_SAND : profile && profile.sand === 'gravel' ? B.GRAVEL : B.SAND;
    this.treeMul = profile && profile.terrain ? profile.terrain.treeMul ?? 1 : 1;
    this.caveScale = profile && profile.terrain ? profile.terrain.caveScale ?? 1 : 1;
    this.oakOnly = !!(profile && profile.trees === 'oak');
    this.villageMul = profile && profile.villages != null ? profile.villages : 1;
    this.vol = new Uint8Array(VOL_SIZE);
    this.hf = new Float32Array(PSY);
    this.sy = new Int16Array(PSY);
    this.bio = new Uint8Array(PSY);
    this.snowA = new Float32Array(PSY);
    this.temp = new Float32Array(PSY);
    this.vcache = new Map();           // village site checks per 224-block cell
    this.slope = new Float32Array(PSY);
    this.topO = new Int16Array(PSY);     // highest light-blocking block y per padded column (-1 none)
    this.topW = new Int16Array(PSY);     // highest liquid y per padded column (-1 none)
    this.topS = new Int16Array(PSY);     // highest solid (non-liquid) y
    this.layerCount = new Int32Array(PH);
    this.bl = new Uint8Array(VOL_SIZE);  // block light (only valid when hasBlockLight)
    this.hasBlockLight = false;
    this.queue = new Int32Array(1 << 17);
    this.info = { h: 0, biome: 0, temp: 0, hum: 0, mask: 0, river: 1, snow: 0 };
    this.cv = new Float32Array(CAVE_N * CAVE_N * CAVE_NY);
    this.tv = new Float32Array(CAVE_N * CAVE_N * CAVE_NY);
    this.limit = new Int16Array(PSY);
    this.edge = new Uint8Array(PSY);
    for (let j = 0; j < PS; j++) for (let i = 0; i < PS; i++) this.edge[i + j * PS] = (i === 0 || j === 0 || i === PS - 1 || j === PS - 1) ? 1 : 0;
    this.yMin = 0; this.yMax = 0; this.maxY = 0;
    this.wx0 = 0; this.wz0 = 0;
    this.nC = this.terrain.noise; this.nT = this.terrain.noise2;
  }

  /**
   * Generate the padded volume for chunk (cx,cz).
   * @param {number} cx @param {number} cz
   * @param {Int32Array|null} edits flat [wx,wy,wz,id,...] player edits intersecting the padded region
   */
  generate(cx, cz, edits) {
    const vol = this.vol, info = this.info, T = this.terrain;
    vol.fill(0);
    const wx0 = this.wx0 = cx * 32 - 1, wz0 = this.wz0 = cz * 32 - 1;
    const { hf, sy, bio, snowA, slope } = this;
    let maxSy = 0;
    for (let j = 0, col = 0; j < PS; j++) {
      for (let i = 0; i < PS; i++, col++) {
        T.columnInfo(wx0 + i, wz0 + j, 9, info);
        hf[col] = info.h; const s = Math.floor(info.h); sy[col] = s; bio[col] = info.biome; snowA[col] = info.snow; this.temp[col] = info.temp;
        if (s > maxSy) maxSy = s;
      }
    }
    for (let j = 0, col = 0; j < PS; j++) {
      for (let i = 0; i < PS; i++, col++) {
        const h = hf[col]; let m = 0, d;
        if (i > 0) { d = Math.abs(h - hf[col - 1]); if (d > m) m = d; }
        if (i < PS - 1) { d = Math.abs(h - hf[col + 1]); if (d > m) m = d; }
        if (j > 0) { d = Math.abs(h - hf[col - PS]); if (d > m) m = d; }
        if (j < PS - 1) { d = Math.abs(h - hf[col + PS]); if (d > m) m = d; }
        slope[col] = m;
      }
    }
    this.maxY = Math.max(maxSy, SEA_LEVEL);
    // --- stone + ores (layer-major for cache friendliness)
    for (let y = 0; y <= maxSy; y++) {
      const base = (y + 1) * PSY;
      const oreOk = y > 3 && y < 128;
      for (let j = 0, col = 0; j < PS; j++) {
        for (let i = 0; i < PS; i++, col++) {
          if (sy[col] < y) continue;
          let id = B.STONE;
          if (oreOk && y < sy[col] - 3) {
            const wx = wx0 + i, wz = wz0 + j;
            const hc = hash3(wx >> 1, (y >> 1) + 977, wz >> 1);
            if ((hc & 1023) < 16 || ((hc >>> 10) & 1023) < 9 && y < 68 || ((hc >>> 20) & 1023) < 3 && y < 34 || ((hc >>> 4) & 2047) < 2 && y < 16) {
              if ((hash3(wx, y, wz + 7) & 3) !== 0) {
                if (y < 16 && ((hc >>> 4) & 2047) < 2) id = B.DIAMOND_ORE;
                else if (y < 34 && ((hc >>> 20) & 1023) < 3) id = B.GOLD_ORE;
                else if (y < 68 && ((hc >>> 10) & 1023) < 9) id = B.IRON_ORE;
                else if ((hc & 1023) < 16) id = B.COAL_ORE;
              }
            }
          }
          vol[base + col] = id;
        }
      }
    }
    // --- surface layers + water + bedrock
    for (let j = 0, col = 0; j < PS; j++) {
      for (let i = 0; i < PS; i++, col++) {
        this.surfaceColumn(col, wx0 + i, wz0 + j);
        const wx = wx0 + i, wz = wz0 + j;
        vol[col + PSY] = B.BEDROCK;                                   // y = 0
        const hb = hash3(wx, 1, wz) & 255;
        if (hb < 190) vol[col + 2 * PSY] = B.BEDROCK;
        if (hb < 100) vol[col + 3 * PSY] = B.BEDROCK;
        if (hb < 35) vol[col + 4 * PSY] = B.BEDROCK;
        vol[col] = B.BEDROCK;                                         // y = -1 pad layer
      }
    }
    this.carveCaves(cx, cz);
    this.plants(cx, cz);
    this.trees(cx, cz);
    this.seaLife();
    this.villages();
    if (edits) this.applyEdits(edits);
    this.finalize();
    return this;
  }

  surfaceColumn(col, wx, wz) {
    const vol = this.vol, s = this.sy[col], b = this.bio[col], slope = this.slope[col];
    let top = this.gTop, d1 = 1, fill = this.gFill, d2 = 3 + (hash3(wx, 5, wz) & 1);
    if (s < SEA_LEVEL) {
      d2 = 0;
      if (b === BIOME.RIVER) { top = (hash3(wx >> 2, 3, wz >> 2) % 10) < 6 ? B.SAND : B.GRAVEL; d1 = 3; }
      else if (s >= 46) { top = B.SAND; d1 = 3; }
      else if (s >= 34) { top = (hash3(wx >> 3, 4, wz >> 3) & 1) ? B.SAND : B.GRAVEL; d1 = 3; }
      else { top = B.GRAVEL; d1 = 2; }
      const wy = SEA_LEVEL;
      for (let y = s + 1; y <= wy; y++) vol[col + (y + 1) * PSY] = B.WATER;
      if (b === BIOME.FROZEN) vol[col + (wy + 1) * PSY] = B.ICE;
    } else {
      switch (b) {
        case BIOME.BEACH: top = this.sandB; d1 = 4; d2 = 0; break;
        case BIOME.DESERT: top = this.sandB; d1 = 5; fill = B.SANDSTONE; d2 = 4; break;
        case BIOME.BADLANDS: {
          // sheer mesa walls show coloured clay strata; flat tops are red sand
          const flat = slope < 1.2;
          if (flat) { vol[col + (s + 1) * PSY] = B.RED_SAND; if (s > 4) vol[col + s * PSY] = B.RED_SAND; }
          const from = flat ? s - 2 : s;
          for (let yy = from, n = 0; n < 34 && yy >= 4; n++, yy--) vol[col + (yy + 1) * PSY] = STRATA[(yy + 3 * (hash3(0, yy >> 3, 31) & 3)) & 15];
          return;
        }
        case BIOME.TAIGA: case BIOME.SNOWY: top = slope > 1.5 ? B.STONE : B.SNOW_GRASS; d1 = 1; break;
        case BIOME.PEAKS:
          top = slope > 2.0 ? B.STONE : B.SNOW; d1 = slope > 2.0 ? 0 : 2; d2 = 0;
          if (slope > 2.0 && this.snowA[col] > 0.9 && slope < 2.6) { top = B.SNOW; d1 = 1; }
          break;
        case BIOME.STONY: {
          const r = hash3(wx >> 3, 6, wz >> 3) & 15;
          if (slope < 0.7 && r < 7) { top = this.gTop; d1 = 1; }
          else if (r < 9) { top = B.GRAVEL; d1 = 1; d2 = 0; }
          else { top = B.STONE; d1 = 0; d2 = 0; }
          break;
        }
        default: if (slope > 1.7) { top = B.STONE; d1 = 0; d2 = 0; }
      }
    }
    let y = s;
    for (let n = 0; n < d1 && y >= 4; n++, y--) vol[col + (y + 1) * PSY] = top;
    for (let n = 0; n < d2 && y >= 4; n++, y--) vol[col + (y + 1) * PSY] = fill;
  }

  carveCaves(cx, cz) {
    const { sy, limit, vol, cv, tv, nC } = this;
    if (this.caveScale <= 0) return;
    let limMax = 0;
    for (let col = 0; col < PSY; col++) {
      const l = sy[col] <= SEA_LEVEL + 1 ? sy[col] - 8 : sy[col] - 2;
      limit[col] = l; if (l > limMax) limMax = l;
    }
    if (limMax < 8) return;
    const lx0 = cx * 32 - 4, lz0 = cz * 32 - 4;
    const ny = Math.min(CAVE_NY, (limMax >> 2) + 2);
    for (let m = 0; m < ny; m++) {
      const wy = m * 4;
      const bias = wy > 72 ? -(wy - 72) * 0.012 : (wy < 10 ? -(10 - wy) * 0.03 : 0);
      for (let kz = 0; kz < CAVE_N; kz++) {
        const wz = lz0 + kz * 4;
        for (let kx = 0; kx < CAVE_N; kx++) {
          const wx = lx0 + kx * 4, k = (m * CAVE_N + kz) * CAVE_N + kx;
          cv[k] = nC.n3(wx * 0.02, wy * 0.034, wz * 0.02) + bias;
          const a = Math.abs(nC.n3(wx * 0.012 + 100, wy * 0.018, wz * 0.012));
          const b2 = Math.abs(nC.n3(wx * 0.012, wy * 0.018 + 50, wz * 0.012 + 70));
          tv[k] = a > b2 ? a : b2;
        }
      }
    }
    const CT = 0.56 - (this.caveScale - 1) * 0.1, TT = 0.075 * this.caveScale;
    for (let m = 0; m < ny - 1; m++) {
      for (let kz = 0; kz < CAVE_N - 1; kz++) {
        for (let kx = 0; kx < CAVE_N - 1; kx++) {
          const k0 = (m * CAVE_N + kz) * CAVE_N + kx, k1 = k0 + CAVE_N, k2 = k0 + CAVE_N * CAVE_N, k3 = k2 + CAVE_N;
          const mx = Math.max(cv[k0], cv[k0 + 1], cv[k1], cv[k1 + 1], cv[k2], cv[k2 + 1], cv[k3], cv[k3 + 1]);
          const mn = Math.min(tv[k0], tv[k0 + 1], tv[k1], tv[k1 + 1], tv[k2], tv[k2 + 1], tv[k3], tv[k3 + 1]);
          if (mx < CT && mn > TT) continue;
          for (let c = 0; c < 4; c++) {
            const y = m * 4 + c; if (y < 5) continue;
            const fy = c * 0.25;
            for (let b = 0; b < 4; b++) {
              const j = kz * 4 - 3 + b; if (j < 0 || j > 33) continue;
              const fz = b * 0.25;
              for (let a = 0; a < 4; a++) {
                const i = kx * 4 - 3 + a; if (i < 0 || i > 33) continue;
                const col = i + j * PS;
                if (y > limit[col]) continue;
                const idx = col + (y + 1) * PSY, v = vol[idx];
                if (v === 0 || v === B.BEDROCK || v === B.WATER || v === B.ICE) continue;
                const fx = a * 0.25;
                const c00 = cv[k0] + (cv[k0 + 1] - cv[k0]) * fx, c10 = cv[k1] + (cv[k1 + 1] - cv[k1]) * fx;
                const c01 = cv[k2] + (cv[k2 + 1] - cv[k2]) * fx, c11 = cv[k3] + (cv[k3 + 1] - cv[k3]) * fx;
                const cc = (c00 + (c10 - c00) * fz) * (1 - fy) + (c01 + (c11 - c01) * fz) * fy;
                const dep = sy[col] - y;           // depth below the surface: cheese caves fade out near it, tunnels may open to the sky
                let carve = cc > (dep < 16 ? CT + (16 - dep) * 0.045 : CT);
                if (!carve) {
                  const t00 = tv[k0] + (tv[k0 + 1] - tv[k0]) * fx, t10 = tv[k1] + (tv[k1 + 1] - tv[k1]) * fx;
                  const t01 = tv[k2] + (tv[k2 + 1] - tv[k2]) * fx, t11 = tv[k3] + (tv[k3 + 1] - tv[k3]) * fx;
                  const tt = (t00 + (t10 - t00) * fz) * (1 - fy) + (t01 + (t11 - t01) * fz) * fy;
                  carve = tt < (dep < 9 ? TT * (dep - 1) / 8 : TT);
                }
                if (carve) vol[idx] = y <= 9 ? B.LAVA : B.AIR;
              }
            }
          }
        }
      }
    }
  }

  plants() {
    const { vol, sy, bio } = this;
    const wx0 = this.wx0, wz0 = this.wz0;
    for (let j = 1; j < 33; j++) {
      for (let i = 1; i < 33; i++) {
        const col = i + j * PS, s = sy[col];
        if (s < SEA_LEVEL || s > 180) continue;
        const idx = col + (s + 1) * PSY, top = vol[idx], above = idx + PSY;
        if (vol[above] !== 0) continue;
        const r = (hash3(wx0 + i, 99, wz0 + j) & 1023) / 1024;
        const b = bio[col];
        let id = 0;
        if (top === B.GRASS) {
          let g = 0.1, f = 0.015;
          if (b === BIOME.PLAINS) { g = 0.16; f = 0.03; } else if (b === BIOME.SAVANNA) { g = 0.2; f = 0.004; } else if (b === BIOME.SWAMP) { g = 0.14; f = 0.006; }
          else if (b === BIOME.STONY) { g = 0.05; f = 0.005; }
          else if (b === BIOME.CHERRY) { g = 0.07; f = 0.07; }
          if (r < g) id = B.TALL_GRASS;
          else if (r < g + f) id = b === BIOME.CHERRY ? B.PINK_FLOWER : (r * 1000 | 0) & 1 ? B.FLOWER_RED : B.FLOWER_YELLOW;
        } else if (top === B.SNOW_GRASS) { if (r < 0.03) id = B.TALL_GRASS; }
        else if (top === this.sandB && b === BIOME.DESERT) { if (r < 0.012) id = B.DEAD_BUSH; }
        else if (top === B.RED_SAND) { if (r < 0.02) id = B.DEAD_BUSH; }
        if (id) vol[above] = id;
      }
    }
  }


  /** warm reefs, kelp forests and seagrass meadows on sandy sea floors (all inside water, plants are 'waterlogged') */
  seaLife() {
    const { vol, sy, bio, temp } = this, wx0 = this.wx0, wz0 = this.wz0, nz = this.nT;
    for (let j = 1; j < 33; j++) {
      for (let i = 1; i < 33; i++) {
        const col = i + j * PS, s = sy[col];
        if (s >= SEA_LEVEL - 2 || s < SEA_LEVEL - 26) continue;
        const b = bio[col];
        if (b !== BIOME.OCEAN && b !== BIOME.RIVER) continue;
        const floor = vol[col + (s + 1) * PSY];
        if (floor !== B.SAND && floor !== B.GRAVEL) continue;
        const idx = col + (s + 2) * PSY;
        if (vol[idx] !== B.WATER) continue;
        const wx = wx0 + i, wz = wz0 + j, h = hash3(wx, 7, wz), r = (h & 1023) / 1024, t = temp[col], depth = SEA_LEVEL - s;
        if (b === BIOME.OCEAN && t > 0.38 && nz.n2(wx * 0.05 + 77, wz * 0.05 - 31) > 0.2) {
          if (r < 0.34) {   // reef towers: one colour per ~4-block patch
            const id = B.CORAL_PINK + (hash3(wx >> 2, 9, wz >> 2) & 3), ht = 1 + ((h >>> 12) % 3);
            for (let k = 0; k < ht; k++) if (vol[idx + k * PSY] === B.WATER) vol[idx + k * PSY] = id;
          } else if (r < 0.46) vol[idx] = B.SEAGRASS;
        } else if (b === BIOME.OCEAN && t < 0.5 && depth >= 4 && nz.n2(wx * 0.03 - 9, wz * 0.03 + 40) > 0.05 && r < 0.14) {
          const ht = Math.min(2 + ((h >>> 12) % 8), depth - 2);
          for (let k = 0; k < ht; k++) if (vol[idx + k * PSY] === B.WATER) vol[idx + k * PSY] = B.KELP;
        } else if (r < 0.07) vol[idx] = B.SEAGRASS;
      }
    }
  }

  /** village site for a 224-block cell (cached): flat-ish dry land in a habitable biome, or null */
  villageAt(gx, gz) {
    const key = gx * 4096 + gz;
    if (this.vcache.has(key)) return this.vcache.get(key);
    let site = null;
    const h = hash3(gx, gz, this.seed + 9191);
    if ((h & 0xffff) / 65536 < 0.4 * this.villageMul) {
      const vx = gx * VCELL + 56 + (h >>> 16) % (VCELL - 112), vz = gz * VCELL + 56 + (hash3(gx, gz, this.seed + 9192) >>> 4) % (VCELL - 112);
      const T = this.terrain, info = this.info;
      T.columnInfo(vx, vz, 9, info);
      const b = info.biome, baseH = info.h;
      let ok = VSTYLE[b] !== undefined && baseH > SEA_LEVEL + 1.5 && baseH < 110;
      for (let k = 0; ok && k < 8; k++) {
        T.columnInfo(vx + Math.cos(k * 0.785) * 34, vz + Math.sin(k * 0.785) * 34, 9, info);
        if (info.h < SEA_LEVEL + 1.5 || Math.abs(info.h - baseH) > 7 || info.river < 0.06) ok = false;
      }
      if (ok) site = { vx, vz, style: VSTYLE[b], gy: Math.floor(baseH) };
    }
    this.vcache.set(key, site);
    return site;
  }

  /** world-space block write (clipped to the padded volume) */
  put(wx, y, wz, id) {
    const i = wx - this.wx0, j = wz - this.wz0;
    if (i < 0 || i > 33 || j < 0 || j > 33 || y < 1 || y > 190) return;
    this.vol[i + j * PS + (y + 1) * PSY] = id;
    if (y > this.maxY) this.maxY = y;
  }

  villages() {
    const wx0 = this.wx0, wz0 = this.wz0, R = 60;
    const gx0 = Math.floor((wx0 - R) / VCELL), gx1 = Math.floor((wx0 + 33 + R) / VCELL), gz0 = Math.floor((wz0 - R) / VCELL), gz1 = Math.floor((wz0 + 33 + R) / VCELL);
    for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
      const v = this.villageAt(gx, gz);
      if (v) this.stampVillage(gx, gz, v);
    }
  }

  stampVillage(gx, gz, v) {
    const wx0 = this.wx0, wz0 = this.wz0, T = this.terrain, info = this.info;
    const near = (x, z, r) => x + r >= wx0 && x - r <= wx0 + 33 && z + r >= wz0 && z - r <= wz0 + 33;
    const plots = [];
    for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) {
      if (a === 0 && b === 0) continue;
      const h = hash3(gx * 7 + a, gz * 7 + b, this.seed + 9300);
      if ((h & 1023) / 1024 > 0.58 || Math.hypot(a, b) > 3.3) continue;
      plots.push({ a, b, h, px: v.vx + a * 13 + ((h >>> 10) % 3) - 1, pz: v.vz + b * 13 + ((h >>> 12) % 3) - 1 });
    }
    // dirt paths first (follow the real terrain: each column uses its own surface height); buildings overwrite them
    const P = B.PATH, lay = (x, z) => {
      const i = x - wx0, j = z - wz0;
      if (i < 0 || i > 33 || j < 0 || j > 33) return;
      const col = i + j * PS, s = this.sy[col];
      if (s < SEA_LEVEL || s > 190) return;
      const top = this.vol[col + (s + 1) * PSY];
      if (top === B.GRASS || top === B.DIRT || top === B.SAND || top === B.SNOW_GRASS || top === B.SNOW || top === B.RED_SAND) {
        this.vol[col + (s + 1) * PSY] = P;
        const above = col + (s + 2) * PSY; if (RENDER[this.vol[above]] === 2 || this.vol[above] === B.SNOW) this.vol[above] = 0;
      }
    };
    for (const p of plots) {
      if (!near(v.vx, v.vz, 60)) break;
      let x = p.px, z = p.pz;
      while (x !== v.vx) { lay(x, z); x += Math.sign(v.vx - x); }
      while (z !== v.vz) { lay(x, z); z += Math.sign(v.vz - z); }
    }
    // well
    if (near(v.vx, v.vz, 6)) this.well(v.vx, v.vz, v.gy);
    for (const p of plots) {
      if (!near(p.px, p.pz, 9)) continue;
      T.columnInfo(p.px, p.pz, 9, info);
      const gy = Math.floor(info.h);
      if (gy <= SEA_LEVEL || info.river < 0.05) continue;
      const kind = (p.h >>> 14) % 10;
      if (kind < 7) this.house(p, gy, v);
      else if (kind < 9) this.hayYard(p, gy);
      else this.post(p.px, p.pz, gy);
    }
  }

  well(x, z, gy) {
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) for (let y = gy + 1; y <= gy + 6; y++) this.put(x + dx, y, z + dz, 0);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      for (let y = gy - 5; y <= gy - 1; y++) this.put(x + dx, y, z + dz, B.COBBLE);
      this.put(x + dx, gy, z + dz, B.COBBLE);
      if (dx || dz) this.put(x + dx, gy + 1, z + dz, B.COBBLE); else { this.put(x, gy, z, B.WATER); this.put(x, gy - 1, z, B.WATER); }
      this.put(x + dx, gy + 4, z + dz, B.PLANKS);
    }
    for (const [cx, cz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { this.put(x + cx, gy + 2, z + cz, B.LOG_OAK); this.put(x + cx, gy + 3, z + cz, B.LOG_OAK); }
    this.put(x, gy + 2, z, B.TORCH);
  }

  post(x, z, gy) {
    for (let y = gy + 1; y <= gy + 3; y++) this.put(x, y, z, y === gy + 3 ? B.TORCH : B.LOG_OAK);
  }

  hayYard(p, gy) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -2; dx <= 2; dx++) {
      const n = (hash3(p.px + dx, p.pz + dz, 515) & 3);
      for (let y = gy + 1; y <= gy + 4; y++) this.put(p.px + dx, y, p.pz + dz, 0);
      this.put(p.px + dx, gy, p.pz + dz, B.PATH);
      if (n) this.put(p.px + dx, gy + 1, p.pz + dz, B.HAY);
      if (n === 3) this.put(p.px + dx, gy + 2, p.pz + dz, B.HAY);
    }
  }

  house(p, gy, v) {
    const [wall, corner, roof] = v.style, h = p.h;
    const w = 5 + 2 * (h & 1), d = 5 + 2 * ((h >>> 3) & 1);              // footprint (odd sizes: a door fits in the middle)
    const xs = Math.sign(v.vx - p.px) || 1, zs = Math.sign(v.vz - p.pz) || 1;
    const alongX = Math.abs(p.px - v.vx) >= Math.abs(p.pz - v.vz);         // door faces the village centre
    const x0 = p.px - (w >> 1), z0 = p.pz - (d >> 1);
    // clear + foundation
    for (let dz = -1; dz <= d; dz++) for (let dx = -1; dx <= w; dx++) {
      const X = x0 + dx, Z = z0 + dz;
      for (let y = gy + 1; y <= gy + 9; y++) this.put(X, y, Z, 0);
      if (dx >= 0 && dx < w && dz >= 0 && dz < d) for (let y = gy - 7; y <= gy; y++) this.put(X, y, Z, y === gy ? B.PLANKS : B.COBBLE);
    }
    const doorX = alongX ? (xs > 0 ? x0 + w - 1 : x0) : x0 + (w >> 1), doorZ = alongX ? z0 + (d >> 1) : (zs > 0 ? z0 + d - 1 : z0);
    for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) {
      const X = x0 + dx, Z = z0 + dz, edgeX = dx === 0 || dx === w - 1, edgeZ = dz === 0 || dz === d - 1;
      if (!edgeX && !edgeZ) continue;
      const isCorner = edgeX && edgeZ;
      for (let y = gy + 1; y <= gy + 3; y++) {
        let id = isCorner ? corner : wall;
        if (!isCorner && y === gy + 2 && ((edgeX && (dz === 1 || dz === d - 2)) || (edgeZ && (dx === 1 || dx === w - 2)))) id = B.GLASS;
        if (X === doorX && Z === doorZ && y <= gy + 2) id = 0;
        this.put(X, y, Z, id);
      }
    }
    // pitched roof along the shorter axis, ridge along the longer one
    const ridgeX = w >= d;                                                  // ridge parallel to X when the house is wider
    const span = ridgeX ? d : w, len = ridgeX ? w : d;
    for (let layer = 0; layer * 2 < span + 1; layer++) {
      const y = gy + 4 + layer;
      for (let s = layer; s < span - layer; s++) for (let l = -1; l <= len; l++) {
        const X = ridgeX ? x0 + l : x0 + s, Z = ridgeX ? z0 + s : z0 + l;
        this.put(X, y, Z, roof);
      }
      // gable ends under the roof
      if (layer > 0) for (let s = layer; s < span - layer; s++) for (const l of [0, len - 1]) {
        const X = ridgeX ? x0 + l : x0 + s, Z = ridgeX ? z0 + s : z0 + l;
        this.put(X, y - 1, Z, wall);
      }
    }
    // interior: a torch in the far corner and a hay bale
    this.put(x0 + 1, gy + 1, z0 + 1, B.TORCH);
    if (w > 5) this.put(x0 + w - 2, gy + 1, z0 + d - 2, B.HAY);
    // door step: path in front
    const sx = alongX ? doorX + (xs > 0 ? 1 : -1) : doorX, sz = alongX ? doorZ : doorZ + (zs > 0 ? 1 : -1);
    this.put(sx, gy, sz, B.PATH);
  }

  setB(wx, y, wz, id, mode) {
    const i = wx - this.wx0, j = wz - this.wz0;
    if (i < 0 || i > 33 || j < 0 || j > 33 || y < 0 || y > 191) return;
    const idx = i + j * PS + (y + 1) * PSY, cur = this.vol[idx];
    if (cur !== 0) {
      if (mode === 0) return;
      if (!(RENDER[cur] === 2 || (CUTOUT[cur] && SOLID[cur] && cur !== B.GLASS))) return;
    }
    this.vol[idx] = id;
    if (y > this.maxY) this.maxY = y;
  }

  trees(cx, cz) {
    const wx0 = this.wx0, wz0 = this.wz0, T = this.terrain, info = this.info, nz = this.nT;
    const gx0 = Math.floor((wx0 - 4) / 4), gx1 = Math.floor((wx0 + 33 + 4) / 4);
    const gz0 = Math.floor((wz0 - 4) / 4), gz1 = Math.floor((wz0 + 33 + 4) / 4);
    for (let gz = gz0; gz <= gz1; gz++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const h = hash3(gx, gz, this.seed + 4242);
        const r = (h & 0xffff) / 65536;
        if (r > 0.6) continue;
        const tx = gx * 4 + ((h >>> 16) & 3), tz = gz * 4 + ((h >>> 18) & 3);
        let s, b;
        const i = tx - wx0, j = tz - wz0;
        if (i >= 0 && i < PS && j >= 0 && j < PS) { const col = i + j * PS; s = this.sy[col]; b = this.bio[col]; }
        else { T.columnInfo(tx, tz, 9, info); s = Math.floor(info.h); b = info.biome; }
        if (s < SEA_LEVEL || s > 175) continue;
        { const vs = this.villageAt(Math.floor(tx / VCELL), Math.floor(tz / VCELL)); if (vs && Math.hypot(tx - vs.vx, tz - vs.vz) < 50) continue; }   // keep village grounds clear of trees
        const h2 = hash3(tx, tz, 777);
        let dens = TREE_DENSITY[b];
        if (b === BIOME.DESERT || b === BIOME.BADLANDS) {
          if (r < (b === BIOME.DESERT ? 0.035 : 0.014) * this.treeMul) { const ch = 1 + (h2 & 3) % 3; for (let n = 1; n <= ch; n++) this.setB(tx, s + n, tz, B.CACTUS, 1); }
          continue;
        }
        if (dens === 0) continue;
        dens *= this.treeMul;
        if (b === BIOME.FOREST || b === BIOME.BIRCH || b === BIOME.TAIGA || b === BIOME.SWAMP || b === BIOME.CHERRY) {
          dens *= 0.3 + 1.4 * smooth(-0.4, 0.4, nz.n2(tx * 0.007, tz * 0.007));
        }
        if (r >= dens) continue;
        const base = s + 1;
        if (this.oakOnly) {   // alien / jungle planets: every tree is an oak so the profile's foliage tint colours the whole canopy
          if (((h2 >>> 12) & 7) === 0) this.bigOak(tx, base, tz, 7 + (h2 & 3), h2); else this.round(tx, base, tz, 4 + (h2 & 3), B.LOG_OAK, B.LEAVES_OAK, h2);
          continue;
        }
        switch (b) {
          case BIOME.TAIGA: case BIOME.SNOWY: case BIOME.STONY: this.spruce(tx, base, tz, 6 + (h2 & 7)); break;
          case BIOME.BIRCH: this.round(tx, base, tz, 5 + (h2 & 3), B.LOG_BIRCH, B.LEAVES_BIRCH, h2); break;
          case BIOME.CHERRY: this.cherry(tx, base, tz, 4 + (h2 & 3), h2); break;
          case BIOME.FOREST:
            if (((h2 >>> 8) & 7) === 0) this.round(tx, base, tz, 5 + (h2 & 3), B.LOG_BIRCH, B.LEAVES_BIRCH, h2);
            else if (((h2 >>> 12) & 15) === 0) this.bigOak(tx, base, tz, 7 + (h2 & 3), h2);
            else this.round(tx, base, tz, 4 + (h2 & 3), B.LOG_OAK, B.LEAVES_OAK, h2);
            break;
          default: this.round(tx, base, tz, 4 + (h2 & 1), B.LOG_OAK, B.LEAVES_OAK, h2);
        }
      }
    }
  }

  round(tx, base, tz, ht, log, leaf, h2) {
    const top = base + ht - 1;
    for (let dy = -2; dy <= 1; dy++) {
      const r = dy <= -1 ? 2 : 1;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx === 0 && dz === 0 && dy <= 0) continue;
        if (r === 2 && Math.abs(dx) === 2 && Math.abs(dz) === 2 && ((h2 >>> (dx + dz + 8 + dy)) & 1)) continue;
        if (r === 1 && Math.abs(dx) === 1 && Math.abs(dz) === 1 && dy === 1) continue;
        this.setB(tx + dx, top + dy, tz + dz, leaf, 0);
      }
    }
    for (let n = 0; n < ht; n++) this.setB(tx, base + n, tz, log, 1);
  }

  /** cherry tree: short bent trunk, wide flat pink canopy that droops at the rim */
  cherry(tx, base, tz, ht, h2) {
    const lean = (h2 >>> 3) & 3, ldx = lean === 0 ? 1 : lean === 1 ? -1 : 0, ldz = lean === 2 ? 1 : lean === 3 ? -1 : 0;
    const bend = Math.max(2, ht - 2);
    let cx = tx, cz = tz;
    for (let n = 0; n < ht; n++) { if (n === bend) { cx += ldx; cz += ldz; } this.setB(cx, base + n, cz, B.CHERRY_LOG, 1); }
    const top = base + ht - 1;
    for (let dy = -1; dy <= 2; dy++) {
      const r = dy === -1 ? 3 : dy === 0 ? 3 : dy === 1 ? 2 : 1;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r + 1) continue;
        if (d2 > r * r - 2 && ((h2 >>> ((dx * 5 + dz * 3 + 16 + dy * 2) & 31)) & 1)) continue;
        this.setB(cx + dx, top + dy, cz + dz, B.CHERRY_LEAVES, 0);
      }
    }
    // petals hanging at the rim
    for (let k = 0; k < 4; k++) { const a = (h2 >>> (k * 5)) & 7, dx = [3, -3, 0, 0, 2, -2, 2, -2][a], dz = [0, 0, 3, -3, 2, -2, -2, 2][a]; this.setB(cx + dx, top - 2, cz + dz, B.CHERRY_LEAVES, 0); }
  }

  bigOak(tx, base, tz, ht, h2) {
    const top = base + ht - 1;
    for (let dy = -3; dy <= 1; dy++) {
      const r = dy === -3 ? 2 : dy <= -1 ? 3 : dy === 0 ? 2 : 1;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r + 1) continue;
        if (d2 > r * r - 1 && ((h2 >>> ((dx * 3 + dz + 12 + dy) & 31)) & 1)) continue;
        this.setB(tx + dx, top + dy, tz + dz, B.LEAVES_OAK, 0);
      }
    }
    for (let n = 0; n < ht; n++) this.setB(tx, base + n, tz, B.LOG_OAK, 1);
  }

  spruce(tx, base, tz, ht) {
    const top = base + ht - 1;
    for (let k = 0; k <= ht - 2; k++) {
      const y = top + 1 - k, r = SPR[Math.min(k, SPR.length - 1)];
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dz * dz > r * r + (r > 1 ? 1 : 0)) continue;
        this.setB(tx + dx, y, tz + dz, B.LEAVES_SPRUCE, 0);
      }
    }
    for (let n = 0; n < ht; n++) this.setB(tx, base + n, tz, B.LOG_SPRUCE, 1);
  }

  applyEdits(edits) {
    for (let n = 0; n + 3 < edits.length; n += 4) {
      const i = edits[n] - this.wx0, j = edits[n + 2] - this.wz0, y = edits[n + 1];
      if (i < 0 || i > 33 || j < 0 || j > 33 || y < 0 || y > 191) continue;
      this.vol[i + j * PS + (y + 1) * PSY] = edits[n + 3];
      if (y > this.maxY) this.maxY = y;
    }
  }

  /** column tops, per-layer counts, interior y range, block-light flood fill */
  finalize() {
    const { vol, topO, topW, topS, layerCount } = this;
    topO.fill(-1); topW.fill(-1); topS.fill(-1); layerCount.fill(0);
    let yMin = 999, yMax = -1, nEmit = 0;
    for (let y = Math.min(this.maxY, 191); y >= 0; y--) {
      const base = (y + 1) * PSY;
      let cnt = 0;
      for (let j = 0, col = 0; j < PS; j++) {
        const interiorRow = j > 0 && j < 33;
        for (let i = 0; i < PS; i++, col++) {
          const v = vol[base + col];
          if (v === 0) continue;
          if (topO[col] < 0 && LIGHT_BLOCK[v]) topO[col] = y;
          if (topS[col] < 0 && !LIQUID[v] && RENDER[v] !== 2) topS[col] = y;
          if (LIQUID[v]) { if (topW[col] < 0) topW[col] = y; }
          if (EMIT[v]) nEmit++;
          if (interiorRow && i > 0 && i < 33) cnt++;
        }
      }
      layerCount[y] = cnt;
      if (cnt) { if (y > yMax) yMax = y; if (y < yMin) yMin = y; }
    }
    this.yMin = yMin === 999 ? 0 : yMin; this.yMax = yMax < 0 ? 0 : yMax;
    this.hasBlockLight = false;
    if (nEmit > 0) this.floodBlockLight();
  }

  floodBlockLight() {
    const { vol, bl, edge } = this;
    let q = this.queue, qh = 0, qt = 0;
    bl.fill(0);
    const top = Math.min(this.maxY + 1, 192);
    const nb = [1, -1, PS, -PS, PSY, -PSY];
    let any = false;
    for (let y = 0; y <= top; y++) {
      const base = (y + 1) * PSY;
      for (let col = 0; col < PSY; col++) {
        const e = EMIT[vol[base + col]];
        if (!e) continue;
        for (let d = 0; d < 6; d++) {
          const n = base + col + nb[d];
          if (n < 0 || n >= VOL_SIZE || OPAQUE[vol[n]] || bl[n] >= e - 2) continue;
          bl[n] = e - 2; any = true;
          if (qt >= q.length) { const nq = new Int32Array(q.length * 2); nq.set(q); this.queue = q = nq; }
          q[qt++] = n;
        }
      }
    }
    if (!any) return;
    this.hasBlockLight = true;
    while (qh < qt) {
      const idx = q[qh++], L = bl[idx];
      if (L <= 2) continue;
      const col = idx % PSY, yl = (idx - col) / PSY;
      if (edge[col] || yl === 0 || yl === PH - 1) continue;
      for (let d = 0; d < 6; d++) {
        const n = idx + nb[d];
        if (OPAQUE[vol[n]] || bl[n] >= L - 2) continue;
        bl[n] = L - 2;
        if (qt >= q.length) { if (qt > 600000) return; const nq = new Int32Array(q.length * 2); nq.set(q); this.queue = q = nq; }
        q[qt++] = n;
      }
    }
  }

  /** interior voxels copy (CHUNK_VOLUME, index x + (z<<5) + (y<<10)) */
  copyInterior() {
    const out = new Uint8Array(CHUNK_VOLUME), vol = this.vol;
    for (let y = 0; y < 192; y++) {
      for (let z = 0; z < 32; z++) {
        const s = 1 + (z + 1) * PS + (y + 1) * PSY;
        out.set(vol.subarray(s, s + 32), z * 32 + y * 1024);
      }
    }
    return out;
  }

  /** top solid y per interior column (index x + z*32) */
  heights() {
    const out = new Uint8Array(1024);
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
      const t = this.topS[(x + 1) + (z + 1) * PS]; out[x + z * 32] = t < 0 ? 0 : t;
    }
    return out;
  }
}
