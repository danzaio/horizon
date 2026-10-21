// PlanetProfile validation shared by the engine (World, workers) and the universe feature: a profile may come from the network or a save,
// so its shape is never trusted. Returns a clamped copy, or null when it is not a v1 profile.
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
/** default sky (the legacy look), documented here so docs and renderer agree */
export const DEFAULT_SKY = { zenith: [0.07, 0.24, 0.62], horizon: [0.50, 0.68, 0.92], dusk: [1.0, 0.46, 0.24], sun: [1.0, 0.86, 0.62], sunCount: 1, sunScale: 1, moons: [], stars: 1, aurora: 1, cloud: 0.5, fog: 1 };

/** Clamp/validate a profile that came from outside (network snapshot, save): never trust the shape. Returns a safe copy or null. */
export function sanitizeProfile(p) {
  if (!p || typeof p !== 'object' || p.v !== 1 || typeof p.type !== 'string' || !/^[a-z]{3,12}$/.test(p.type)) return null;
  const num = (x, a, b, d) => (typeof x === 'number' && isFinite(x) ? clamp(x, a, b) : d);
  const col = (c, d, mx) => (Array.isArray(c) && c.length === 3 ? c.map((x, i) => num(x, 0, mx, d[i])) : d.slice());
  const t = p.terrain || {}, c = p.climate || {}, pl = p.palette || {}, s = p.sky || {};
  return {
    v: 1, type: p.type,
    terrain: { heightBias: num(t.heightBias, -0.8, 0.5, 0), mountainScale: num(t.mountainScale, 0, 3, 1), hillScale: num(t.hillScale, 0, 3, 1), riverScale: num(t.riverScale, 0, 3, 1), lakeScale: num(t.lakeScale, 0, 3, 1), caveScale: num(t.caveScale, 0, 3, 1), treeMul: num(t.treeMul, 0, 4, 1) },
    climate: { tempBias: num(c.tempBias, -2, 2, 0), humBias: num(c.humBias, -2, 2, 0), spread: num(c.spread, 0, 2, 1), snowLine: num(c.snowLine, -60, 120, 0) },
    palette: { grass: col(pl.grass, [128, 188, 78], 255), foliage: col(pl.foliage, [92, 156, 52], 255), water: col(pl.water, [60, 120, 215], 255) },
    sky: {
      zenith: col(s.zenith, DEFAULT_SKY.zenith, 4), horizon: col(s.horizon, DEFAULT_SKY.horizon, 4), dusk: col(s.dusk, DEFAULT_SKY.dusk, 4), sun: col(s.sun, DEFAULT_SKY.sun, 4),
      sunCount: s.sunCount === 2 ? 2 : 1, sunScale: num(s.sunScale, 0.3, 3, 1), stars: num(s.stars, 0, 5, 1), aurora: num(s.aurora, 0, 4, 1), cloud: num(s.cloud, 0, 1, 0.5), fog: num(s.fog, 0.2, 3, 1),
      sun2: s.sun2 ? col(s.sun2, [0.55, 0.72, 1], 4) : undefined,
      moons: Array.isArray(s.moons) ? s.moons.slice(0, 3).map((m) => ({ size: num(m && m.size, 0.3, 6, 1.5), color: col(m && m.color, [0.8, 0.83, 0.95], 4) })) : [],
    },
    gravity: num(p.gravity, 0.2, 2, 1), dayLength: num(p.dayLength, 5, 90, 20), villages: num(p.villages, 0, 1, 1),
    trees: p.trees === 'oak' ? 'oak' : undefined,
    ground: p.ground && ['GRAVEL', 'STONE', 'SAND', 'RED_SAND', 'DIRT', 'COBBLE'].includes(p.ground.top) ? { top: p.ground.top, fill: ['STONE', 'DIRT', 'COBBLE'].includes(p.ground.fill) ? p.ground.fill : 'STONE', lod: col(p.ground.lod, [110, 108, 106], 255) } : undefined,
    sand: p.sand === 'red' || p.sand === 'gravel' ? p.sand : undefined, seaGlow: num(p.seaGlow, 0, 1, 0),
  };
}
