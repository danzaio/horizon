// Pure deterministic terrain: heights + biomes as functions of (seed, x, z). Drives voxel chunks AND LOD tiles.
// `octaves` clamps the detail of every fBm, so coarse LOD levels are cheap and alias-free.
import { SEA_LEVEL } from '../shared/constants.js';
import { Noise } from './noise.js';

export const BIOME = {
  OCEAN: 0, BEACH: 1, PLAINS: 2, FOREST: 3, BIRCH: 4, DESERT: 5, SAVANNA: 6, TAIGA: 7,
  SNOWY: 8, PEAKS: 9, SWAMP: 10, FROZEN: 11, RIVER: 12, STONY: 13, CHERRY: 14, BADLANDS: 15,
};
export const BIOME_COUNT = 16;
// RGB tables (0..255): [grass, foliage, water] per biome
const T = [
  /* OCEAN  */ [110, 170, 80, 80, 140, 60, 45, 100, 205],
  /* BEACH  */ [150, 185, 90, 110, 150, 60, 55, 120, 210],
  /* PLAINS */ [128, 188, 78, 92, 156, 52, 60, 120, 215],
  /* FOREST */ [96, 164, 62, 66, 128, 44, 56, 112, 205],
  /* BIRCH  */ [122, 176, 82, 100, 150, 60, 60, 118, 210],
  /* DESERT */ [192, 180, 92, 170, 160, 70, 66, 140, 200],
  /* SAVANNA*/ [176, 178, 86, 150, 150, 60, 62, 128, 205],
  /* TAIGA  */ [92, 152, 104, 70, 118, 84, 50, 100, 190],
  /* SNOWY  */ [140, 176, 150, 100, 140, 110, 58, 96, 190],
  /* PEAKS  */ [120, 150, 120, 90, 120, 90, 56, 100, 200],
  /* SWAMP  */ [90, 118, 62, 70, 100, 50, 70, 100, 80],
  /* FROZEN */ [140, 176, 150, 100, 140, 110, 90, 120, 200],
  /* RIVER  */ [120, 180, 80, 90, 150, 60, 56, 130, 215],
  /* STONY  */ [112, 142, 92, 80, 112, 70, 56, 110, 205],
  /* CHERRY */ [146, 196, 104, 150, 190, 96, 64, 122, 218],
  /* BADLANDS*/ [196, 150, 86, 170, 140, 66, 62, 112, 200],
];
/** tint rgb: index (biome*4 + tintType)*3, tintType per blocks.js TINT_* (0 none, 1 grass, 2 foliage, 3 water) */
export const TINT_TABLE = new Uint8Array(BIOME_COUNT * 4 * 3);
for (let b = 0; b < BIOME_COUNT; b++) {
  TINT_TABLE.set([255, 255, 255], (b * 4) * 3);
  TINT_TABLE.set(T[b].slice(0, 3), (b * 4 + 1) * 3);
  TINT_TABLE.set(T[b].slice(3, 6), (b * 4 + 2) * 3);
  TINT_TABLE.set(T[b].slice(6, 9), (b * 4 + 3) * 3);
}
// --- planets: per-profile tint table (never mutates TINT_TABLE). Palette colours are the PLAINS tint; the other biomes keep their relative variation.
const BASE = { grass: [128, 188, 78], foliage: [92, 156, 52], water: [60, 120, 215] };
/**
 * @param {{palette?:{grass:number[],foliage:number[],water:number[]}}|null} profile
 * @returns {Uint8Array} same layout as TINT_TABLE (the global table itself when there is no profile)
 */
export function makeTintTable(profile) {
  if (!profile || !profile.palette) return TINT_TABLE;
  const out = new Uint8Array(TINT_TABLE), pal = profile.palette, keys = ['grass', 'foliage', 'water'];
  for (let b = 0; b < BIOME_COUNT; b++) {
    for (let k = 0; k < 3; k++) {
      const o = (b * 4 + 1 + k) * 3, key = keys[k];
      for (let c = 0; c < 3; c++) { const v = TINT_TABLE[o + c] * (pal[key][c] / BASE[key][c]); out[o + c] = v > 255 ? 255 : v < 0 ? 0 : v; }
    }
  }
  return out;
}
/** Per-biome tree density (probability per 4x4 cell) */
export const TREE_DENSITY = new Float32Array(BIOME_COUNT);
TREE_DENSITY[BIOME.FOREST] = 0.5; TREE_DENSITY[BIOME.BIRCH] = 0.42; TREE_DENSITY[BIOME.TAIGA] = 0.38;
TREE_DENSITY[BIOME.PLAINS] = 0.03; TREE_DENSITY[BIOME.SAVANNA] = 0.06; TREE_DENSITY[BIOME.SNOWY] = 0.02;
TREE_DENSITY[BIOME.SWAMP] = 0.22; TREE_DENSITY[BIOME.STONY] = 0.05; TREE_DENSITY[BIOME.CHERRY] = 0.3;

const smooth = (a, b, x) => { const t = x < a ? 0 : x > b ? 1 : (x - a) / (b - a); return t * t * (3 - 2 * t); };
// continentalness spline: cs in [-1,1] -> base height
const SP_X = [-1, -0.7, -0.4, -0.2, -0.08, 0.0, 0.03, 0.08, 0.3, 0.6, 1.0];
const SP_Y = [14, 26, 42, 54, 60.4, 63.0, 65.0, 67.5, 72, 80, 92];
function spline(x) {
  if (x <= SP_X[0]) return SP_Y[0];
  for (let i = 1; i < SP_X.length; i++) {
    if (x <= SP_X[i]) { const t = (x - SP_X[i - 1]) / (SP_X[i] - SP_X[i - 1]); return SP_Y[i - 1] + (SP_Y[i] - SP_Y[i - 1]) * t; }
  }
  return SP_Y[SP_Y.length - 1];
}

// The planet the main thread is playing on: World registers it so main.js's own createTerrain(seed) (weather / mob biome lookups) matches the world.
// Workers pass the profile explicitly (null = legacy world) and never read this.
let defaultProfile = null;
/** @param {object|null} p validated PlanetProfile of the running world */
export function setDefaultProfile(p) { defaultProfile = p || null; }

/**
 * Create the terrain function set for a seed.
 * @param {number} seed
 */
export function createTerrain(seed, profile = defaultProfile) {
  seed = seed | 0;
  // planet parameters; the neutral values (0 / 1) leave every expression below bit-identical to the legacy world
  const PT = (profile && profile.terrain) || {}, PC = (profile && profile.climate) || {};
  const cBias = PT.heightBias || 0, mScale = PT.mountainScale ?? 1, hScale = PT.hillScale ?? 1, rScale = PT.riverScale ?? 1, lScale = PT.lakeScale ?? 1;
  const tBias = PC.tempBias || 0, hBias = PC.humBias || 0, cSpread = PC.spread ?? 1, snowOff = PC.snowLine || 0;
  const tint = makeTintTable(profile);
  const nWarpA = new Noise(seed + 11), nWarpB = new Noise(seed + 12), nCont = new Noise(seed + 13), nMask = new Noise(seed + 14);
  const nRidge = new Noise(seed + 15), nHill = new Noise(seed + 16), nHillAmp = new Noise(seed + 17), nDet = new Noise(seed + 18);
  const nRiver = new Noise(seed + 19), nRivMask = new Noise(seed + 20), nLake = new Noise(seed + 21);
  const nTemp = new Noise(seed + 22), nHum = new Noise(seed + 23), nBirch = new Noise(seed + 24), nSnow = new Noise(seed + 25);
  const nBad = new Noise(seed + 26), nCherry = new Noise(seed + 27);
  const scratch = { h: 0, biome: 0, temp: 0, hum: 0, mask: 0, river: 1, snow: 0 };

  /**
   * Full column sample. Fills `out`: h (float height of top solid surface), biome, temp, hum (-1..1), mask (mountainness 0..1),
   * river (|river noise|, small = river), snow (0..1 snow cover amount).
   * @param {number} x @param {number} z @param {number} oct octave cap (>=6 = full detail)
   * @param {object} out
   */
  function columnInfo(x, z, oct, out) {
    const wx = x + 90 * nWarpA.n2(x * 0.0016, z * 0.0016);
    const wz = z + 90 * nWarpB.n2(x * 0.0016 + 31.7, z * 0.0016 - 17.3);
    const cs0 = nCont.fbm2(wx * 0.0002, wz * 0.0002, Math.min(4, oct), 2.1, 0.5) * 1.8 + 0.14 + cBias;
    const cs = cs0 < -1 ? -1 : cs0 > 1 ? 1 : cs0;
    let h = spline(cs);
    // mountains
    const mm = nMask.fbm2(wx * 0.00055 + 200, wz * 0.00055 - 90, Math.min(3, oct));
    const mask = smooth(0.0, 0.4, mm) * smooth(-0.05, 0.28, cs);
    if (mask > 0.001) {
      const rid = nRidge.ridged2(wx * 0.0013, wz * 0.0013, Math.min(6, oct));
      h += mask * (26 + 175 * Math.pow(rid, 1.2)) * mScale;
    }
    // climate (needed early: badlands reshape the terrain itself)
    const temp0 = nTemp.fbm2(x * 0.00045 + 500, z * 0.00045 + 40, Math.min(2, oct)) * 1.9 * cSpread + tBias;
    const hum = nHum.fbm2(x * 0.00055 - 800, z * 0.00055 + 700, Math.min(2, oct)) * 1.9 * cSpread + hBias;
    // hills + detail
    const hillAmp = 3 + 13 * smooth(-0.2, 0.6, nHillAmp.n2(wx * 0.0011, wz * 0.0011));
    const landF = 0.35 + 0.65 * smooth(-0.12, 0.04, cs);
    h += nHill.fbm2(wx * 0.0058, wz * 0.0058, Math.min(4, oct)) * hillAmp * landF * 1.5 * hScale;
    if (oct >= 3) h += nDet.fbm2(x * 0.026, z * 0.026, Math.min(2, oct - 1)) * 2.0 * landF * (1 - mask * 0.4);
    // badlands: hot + dry patches become stepped mesas (9-block tiers with sheer cliffs)
    const bm = smooth(0.16, 0.4, nBad.fbm2(x * 0.0007 + 900, z * 0.0007 - 300, Math.min(3, oct))) * smooth(0.2, 0.5, temp0) * (1 - smooth(-0.1, 0.3, hum));
    out.bad = bm;
    if (bm > 0.02 && h > SEA_LEVEL - 3) {
      const base = SEA_LEVEL + 3, t = base + Math.max(0, h - base) * (1 + 0.9 * bm);
      const q = base + Math.round((t - base) / 9) * 9, sm = smooth(0.3, 0.62, bm);
      h += (q + (oct >= 3 ? nDet.fbm2(x * 0.05, z * 0.05, 1) * 1.5 : 0) - h) * sm;
    }
    // lakes
    const lk = smooth(0.34, 0.54, nLake.fbm2(wx * 0.0024, wz * 0.0024, Math.min(2, oct)));
    if (lk > 0) {
      const lf = Math.min(1, lk * smooth(-0.06, 0.1, cs) * (1 - smooth(70, 100, h)) * lScale);
      h += (56.5 - 5 * lk - h) * lf;
    }
    // rivers
    const rn = Math.abs(nRiver.fbm2(wx * 0.0012 + 55, wz * 0.0012 + 12, Math.min(2, oct)));
    if (rn < 0.2) {
      const rw = smooth(-0.15, 0.0, cs) * smooth(-0.35, 0.15, nRivMask.n2(wx * 0.0004, wz * 0.0004)) * (1 - 0.7 * mask) * rScale;
      if (rw > 0) {
        const f = smooth(0.012, 0.17, rn);
        const bed = SEA_LEVEL - 3.5;
        if (h > bed) h += (bed - h) * (1 - f) * rw;
      }
    }
    out.river = rn;
    const bad = bm > 0.5 && h >= SEA_LEVEL + 2;
    if (h > 128) h = 128 + (h - 128) * 0.5;
    h = h < 1 ? 1 : h > 184 ? 184 : h;
    out.h = h; out.mask = mask;
    const temp = temp0 - (h > 85 ? (h - 85) * 0.008 : 0);
    out.temp = temp; out.hum = hum;
    // snow cover
    const snowLine = 118 + temp0 * 22 + (oct >= 3 ? nSnow.n2(x * 0.02, z * 0.02) * 6 : 0) + snowOff;
    out.snow = smooth(snowLine - 4, snowLine + 10, h);
    // biome
    let b;
    if (h < SEA_LEVEL) {
      if (temp < -0.66) b = BIOME.FROZEN;
      else if (cs > -0.12 && rn < 0.05) b = BIOME.RIVER;
      else b = BIOME.OCEAN;
    } else if (h < SEA_LEVEL + 2.4 && cs < 0.16 && mask < 0.3) {
      b = BIOME.BEACH;
    } else if (out.snow > 0.55) {
      b = BIOME.PEAKS;
    } else if (bad) {
      b = BIOME.BADLANDS;
    } else if (h > 98 && mask > 0.35) {
      b = BIOME.STONY;
    } else if (temp < -0.38) {
      b = hum > -0.1 ? BIOME.TAIGA : BIOME.SNOWY;
    } else if (temp > 0.5 && hum < 0.05) {
      b = BIOME.DESERT;
    } else if (temp > 0.3 && hum < 0.3) {
      b = hum < -0.3 ? BIOME.DESERT : BIOME.SAVANNA;
    } else if (hum > -0.08 && temp > -0.18 && temp < 0.44 && h > 66 && nCherry.n2(x * 0.0013 + 400, z * 0.0013 - 120) > 0.3) {
      b = BIOME.CHERRY;
    } else if (hum > 0.55 && h < 70 && temp > -0.1) {
      b = BIOME.SWAMP;
    } else if (hum > 0.2) {
      b = nBirch.n2(x * 0.0009, z * 0.0009) > 0.15 ? BIOME.BIRCH : BIOME.FOREST;
    } else {
      b = BIOME.PLAINS;
    }
    out.biome = b;
    return out;
  }

  return {
    seed,
    profile: profile || null,
    /** biome tint table for this planet (the global TINT_TABLE when profile is null) */
    tint,
    columnInfo,
    /** float surface height (top of terrain, before water) */
    heightAt(x, z, octaves = 8) { return columnInfo(x, z, octaves, scratch).h; },
    biomeAt(x, z) { return columnInfo(x, z, 8, scratch).biome; },
    /** y of the highest solid terrain block (ignores trees, water) */
    surfaceY(x, z) { return Math.floor(columnInfo(x, z, 8, scratch).h); },
    /** extra noise shared with chunkGen (tree density noise etc.) */
    noise: new Noise(seed + 31),
    noise2: new Noise(seed + 32),
  };
}
