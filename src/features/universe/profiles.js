// PlanetProfile: small JSON that fully describes one planet's look and rules (see docs/PLANETS.md).
// TYPES holds the archetypes; makeProfile(type, rng) applies per-planet random variation so no two planets look alike.
// Colours: palette.* are sRGB bytes (0..255); sky.* are display-linear floats exactly like TimeOfDay uses.
import { DEFAULT_SKY } from '../../world/profile.js';
export { sanitizeProfile } from '../../world/profile.js';


/**
 * type definitions. Every numeric entry may be {r:[min,max]} (rolled per planet) or a plain number.
 * terrain: heightBias (-0.6 oceans .. +0.3 continents), mountainScale, hillScale, riverScale, lakeScale, caveScale, treeMul
 * climate: tempBias, humBias (added to the temperature/humidity noise: -1.. +1)
 */
export const TYPES = {
  verdant: {
    label: 'Verdejante', blurb: 'Colinas, florestas e rios: o planeta natal clássico.', icon: [90, 170, 70],
    terrain: { heightBias: { r: [0.02, 0.09] }, mountainScale: { r: [0.8, 1.25] }, hillScale: { r: [0.85, 1.25] }, riverScale: { r: [0.9, 1.4] }, lakeScale: { r: [0.8, 1.4] }, caveScale: 1, treeMul: { r: [0.9, 1.3] } },
    climate: { tempBias: { r: [0.1, 0.22] }, humBias: { r: [0.25, 0.4] }, spread: 0.4 },
    palette: { grass: [128, 188, 78], foliage: [92, 156, 52], water: [60, 120, 215], hue: 14 },
    sky: { zenith: [0.07, 0.24, 0.62], horizon: [0.50, 0.68, 0.92], cloud: { r: [0.4, 0.62] } },
    gravity: { r: [0.95, 1.05] }, dayLength: { r: [18, 24] }, villages: 1,
  },
  lush: {
    label: 'Selvagem', blurb: 'Selva úmida e densa, árvores gigantes e rios caudalosos.', icon: [40, 190, 80],
    terrain: { heightBias: { r: [0.03, 0.1] }, mountainScale: { r: [0.6, 0.9] }, hillScale: { r: [1.2, 1.7] }, riverScale: { r: [1.4, 2.0] }, lakeScale: { r: [1.2, 2] }, caveScale: 1.1, treeMul: { r: [2.1, 2.8] } },
    climate: { tempBias: { r: [0.28, 0.4] }, humBias: { r: [0.55, 0.8] }, spread: 0.4, snowLine: 40 },
    palette: { grass: [64, 214, 58], foliage: [30, 188, 56], water: [34, 196, 168], hue: 10 }, trees: 'oak',
    sky: { zenith: [0.05, 0.30, 0.55], horizon: [0.52, 0.80, 0.78], dusk: [1.0, 0.55, 0.28], cloud: { r: [0.6, 0.75] }, fog: { r: [1.2, 1.6] } },
    gravity: { r: [0.95, 1.1] }, dayLength: { r: [20, 26] }, villages: 0.5,
  },
  desert: {
    label: 'Deserto', blurb: 'Dunas, mesas de argila e um sol impiedoso.', icon: [226, 180, 96],
    terrain: { heightBias: { r: [0.12, 0.2] }, mountainScale: { r: [0.5, 0.9] }, hillScale: { r: [1.0, 1.5] }, riverScale: 0, lakeScale: 0.15, caveScale: { r: [0.8, 1.2] }, treeMul: { r: [0.4, 0.8] } },
    climate: { tempBias: { r: [0.8, 1.1] }, humBias: { r: [-0.9, -0.7] }, spread: 0.5, snowLine: 70 },
    palette: { grass: [196, 168, 88], foliage: [150, 140, 60], water: [60, 150, 170], hue: 10 },
    sand: { pick: [null, 'red'] },
    sky: { zenith: [0.20, 0.30, 0.54], horizon: [0.92, 0.70, 0.46], dusk: [1.0, 0.5, 0.2], sun: [1.0, 0.88, 0.62], sunScale: { r: [1.15, 1.5] }, cloud: { r: [0.05, 0.2] }, fog: { r: [1.1, 1.4] } },
    gravity: { r: [0.85, 1.0] }, dayLength: { r: [22, 30] }, villages: 0.8,
  },
  frozen: {
    label: 'Gélido', blurb: 'Tundra de gelo, auroras e noites longas.', icon: [190, 225, 245],
    terrain: { heightBias: { r: [0.0, 0.08] }, mountainScale: { r: [1.1, 1.6] }, hillScale: { r: [0.8, 1.2] }, riverScale: 0.5, lakeScale: 1.2, caveScale: 1, treeMul: { r: [0.5, 0.9] } },
    climate: { tempBias: { r: [-1.25, -1.0] }, humBias: { r: [0.0, 0.3] }, spread: 0.5 },
    palette: { grass: [168, 204, 222], foliage: [100, 160, 190], water: [64, 120, 190], hue: 8 },
    sky: { zenith: [0.10, 0.24, 0.52], horizon: [0.62, 0.78, 0.94], dusk: [0.95, 0.55, 0.7], sun: [0.92, 0.96, 1.0], sunScale: { r: [0.7, 0.9] }, stars: { r: [1.3, 1.8] }, aurora: 2.2, cloud: { r: [0.45, 0.7] } },
    gravity: { r: [0.8, 0.95] }, dayLength: { r: [26, 34] }, villages: 0.7,
  },
  volcanic: {
    label: 'Vulcânico', blurb: 'Rocha negra, céu em brasa e mares de magma.', icon: [220, 70, 30],
    terrain: { heightBias: { r: [0.12, 0.22] }, mountainScale: { r: [1.4, 1.9] }, hillScale: { r: [1.1, 1.5] }, riverScale: 0, lakeScale: 1.3, caveScale: { r: [1.4, 1.9] }, treeMul: 0 },
    climate: { tempBias: { r: [0.6, 0.8] }, humBias: { r: [-0.6, -0.4] }, spread: 0.4, snowLine: 90 },
    palette: { grass: [64, 56, 56], foliage: [96, 44, 30], water: [255, 96, 24], hue: 6 },
    ground: { top: 'GRAVEL', fill: 'STONE', lod: [88, 84, 84] }, sand: { pick: ['gravel'] },
    sky: { zenith: [0.13, 0.035, 0.035], horizon: [0.78, 0.24, 0.08], dusk: [1.0, 0.32, 0.06], sun: [1.0, 0.5, 0.24], sunScale: { r: [1.4, 1.8] }, stars: 0.6, cloud: { r: [0.65, 0.85] }, fog: { r: [1.5, 2.0] } },
    gravity: { r: [1.05, 1.25] }, dayLength: { r: [16, 22] }, villages: 0, seaGlow: 1,
  },
  ocean: {
    label: 'Oceânico', blurb: 'Um mundo de água com raras ilhas e recifes.', icon: [50, 140, 230],
    terrain: { heightBias: { r: [-0.5, -0.36] }, mountainScale: { r: [0.4, 0.7] }, hillScale: { r: [0.6, 1.0] }, riverScale: 0, lakeScale: 0, caveScale: 0.8, treeMul: { r: [1.0, 1.5] } },
    climate: { tempBias: { r: [0.1, 0.3] }, humBias: { r: [0.1, 0.4] }, spread: 0.5 },
    palette: { grass: [96, 204, 122], foliage: [60, 176, 96], water: [30, 160, 226], hue: 12 },
    sky: { zenith: [0.06, 0.26, 0.66], horizon: [0.56, 0.76, 0.96], cloud: { r: [0.35, 0.55] } },
    gravity: { r: [0.95, 1.05] }, dayLength: { r: [20, 26] }, villages: 0.4,
  },
  alien: {
    label: 'Alienígena', blurb: 'Vegetação violeta e turquesa sob dois sóis e duas luas.', icon: [170, 90, 230],
    terrain: { heightBias: { r: [0.02, 0.1] }, mountainScale: { r: [1.0, 1.6] }, hillScale: { r: [1.2, 1.8] }, riverScale: { r: [0.8, 1.3] }, lakeScale: { r: [1, 1.8] }, caveScale: { r: [1.1, 1.5] }, treeMul: { r: [1.4, 2.0] } },
    climate: { tempBias: { r: [0.05, 0.2] }, humBias: { r: [0.3, 0.5] }, spread: 0.4, snowLine: 45 },
    palette: { grass: [150, 70, 214], foliage: [36, 206, 190], water: [92, 62, 214], hue: 24 }, trees: 'oak',
    sky: { zenith: [0.17, 0.07, 0.46], horizon: [0.78, 0.36, 0.72], dusk: [0.2, 0.9, 0.85], sun: [1.0, 0.82, 0.58], sunCount: 2, sun2: [0.55, 0.72, 1.0], sunScale: { r: [0.8, 1.1] }, stars: { r: [1.4, 2.0] }, aurora: 1.6, cloud: { r: [0.3, 0.55] },
      moons: [{ size: { r: [1.8, 2.8] }, color: [0.82, 0.6, 1.0] }, { size: { r: [0.8, 1.2] }, color: [0.5, 1.0, 0.9] }] },
    gravity: { r: [0.55, 0.8] }, dayLength: { r: [26, 36] }, villages: 0,
  },
  barren: {
    label: 'Árido-Lunar', blurb: 'Rocha cinzenta, atmosfera rala e estrelas gigantes.', icon: [150, 150, 146],
    terrain: { heightBias: { r: [0.22, 0.32] }, mountainScale: { r: [0.9, 1.3] }, hillScale: { r: [0.9, 1.3] }, riverScale: 0, lakeScale: 0, caveScale: { r: [1.3, 1.8] }, treeMul: 0 },
    climate: { tempBias: { r: [0.25, 0.4] }, humBias: { r: [-1.0, -0.8] }, spread: 0.3, snowLine: 90 },
    palette: { grass: [142, 142, 138], foliage: [120, 120, 116], water: [76, 100, 130], hue: 0 },
    ground: { top: 'GRAVEL', fill: 'STONE', lod: [112, 110, 108] }, sand: { pick: ['gravel'] },
    sky: { zenith: [0.025, 0.035, 0.085], horizon: [0.34, 0.36, 0.42], dusk: [0.7, 0.55, 0.45], sun: [1.0, 0.97, 0.92], sunScale: { r: [1.1, 1.4] }, stars: { r: [2.6, 3.4] }, aurora: 0, cloud: 0, fog: { r: [0.35, 0.55] },
      moons: [{ size: { r: [3.0, 4.6] }, color: [0.85, 0.82, 0.78] }] },
    gravity: { r: [0.4, 0.6] }, dayLength: { r: [30, 40] }, villages: 0,
  },
};
export const TYPE_IDS = Object.keys(TYPES);

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const r3 = (x) => Math.round(x * 1000) / 1000;
/** resolve {r:[a,b]} / number / array against an rng */
function roll(v, rng) {
  if (v && typeof v === 'object' && !Array.isArray(v) && v.r) return v.r[0] + (v.r[1] - v.r[0]) * rng();
  return v;
}
/** rotate the hue of an sRGB byte colour by `deg` and scale its value a little */
function hueShift(c, deg, val) {
  const [r, g, b] = c.map((x) => x / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0; if (d > 0) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + deg + 360) % 360;
  const s = mx === 0 ? 0 : d / mx, v = clamp(mx * val, 0, 1), cc = v * s, x = cc * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - cc;
  const [R, G, Bv] = h < 60 ? [cc, x, 0] : h < 120 ? [x, cc, 0] : h < 180 ? [0, cc, x] : h < 240 ? [0, x, cc] : h < 300 ? [x, 0, cc] : [cc, 0, x];
  return [Math.round((R + m) * 255), Math.round((G + m) * 255), Math.round((Bv + m) * 255)];
}
const jitterLin = (c, rng, a) => c.map((x) => r3(clamp(x * (1 + (rng() - 0.5) * 2 * a), 0, 4)));

/**
 * Build the PlanetProfile for a planet type with per-planet variation.
 * @param {string} type key of TYPES
 * @param {() => number} rng deterministic uniform [0,1) generator
 * @returns {object} PlanetProfile v1
 */
export function makeProfile(type, rng) {
  const T = TYPES[type] || TYPES.verdant;
  const hue = (rng() - 0.5) * 2 * (T.palette.hue || 0), val = 0.92 + rng() * 0.16;
  const terrain = {}; for (const k of Object.keys(T.terrain)) terrain[k] = r3(roll(T.terrain[k], rng));
  const climate = { tempBias: r3(roll(T.climate.tempBias, rng)), humBias: r3(roll(T.climate.humBias, rng)), spread: T.climate.spread ?? 1, snowLine: T.climate.snowLine || 0 };
  const palette = { grass: hueShift(T.palette.grass, hue, val), foliage: hueShift(T.palette.foliage, hue * 0.8, val), water: hueShift(T.palette.water, hue * 0.5, 1) };
  const s = T.sky, D = DEFAULT_SKY, sj = 0.06;
  const sky = {
    zenith: jitterLin(s.zenith || D.zenith, rng, sj), horizon: jitterLin(s.horizon || D.horizon, rng, sj), dusk: s.dusk || D.dusk, sun: s.sun || D.sun,
    sunCount: s.sunCount || 1, sunScale: r3(roll(s.sunScale, rng) ?? 1), stars: r3(roll(s.stars, rng) ?? 1), aurora: roll(s.aurora, rng) ?? 1,
    cloud: r3(roll(s.cloud, rng) ?? 0.5), fog: r3(roll(s.fog, rng) ?? 1),
    moons: (s.moons || []).map((m) => ({ size: r3(roll(m.size, rng)), color: m.color })),
  };
  if (s.sun2) sky.sun2 = s.sun2;
  if (!s.moons && rng() < 0.4) sky.moons.push({ size: r3(1.4 + rng() * 1.8), color: [0.78, 0.83, 0.95] });   // a plain moon for ~40% of the ordinary worlds
  if (!s.moons && type !== 'desert' && rng() < 0.12) sky.moons.push({ size: r3(0.7 + rng() * 0.6), color: [0.9, 0.7, 0.55] });
  const out = { v: 1, type, terrain, climate, palette, sky, gravity: r3(roll(T.gravity, rng)), dayLength: Math.round(roll(T.dayLength, rng)), villages: T.villages };
  if (T.trees) out.trees = T.trees;
  if (T.ground) out.ground = { top: T.ground.top, fill: T.ground.fill, lod: T.ground.lod };
  if (T.sand) { const p = T.sand.pick[Math.floor(rng() * T.sand.pick.length)]; if (p) out.sand = p; }
  if (T.seaGlow) out.seaGlow = T.seaGlow;
  return out;
}
