// Deterministic universe: galaxy -> star systems (one candidate per map cell) -> planets. Everything is a pure function of the address.
import { encodeAddress, decodeAddress, seedOf, hashStr, SYS_SIZE } from './address.js';
import { TYPES, makeProfile } from './profiles.js';

const CENTER = SYS_SIZE / 2, HOME_RADIUS = 2400, DENSITY = 0.22;

/** mulberry32 seeded rng */
export function rng32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const cellHash = (g, sx, sy, salt) => hashStr(`${g}|${sx}|${sy}|${salt}`);

// ---------------------------------------------------------------------------------------------------------------- names (pt-BR / sci-fi)
const PRE = ['Al', 'Be', 'Cas', 'Del', 'Eri', 'Fó', 'Gal', 'Hé', 'Io', 'Ka', 'Lu', 'Mi', 'Nor', 'Or', 'Pra', 'Qui', 'Ri', 'Sel', 'Tau', 'Ur', 'Vê', 'Xa', 'Zé', 'Ar', 'Bo', 'Cri', 'Dra', 'Ém', 'Fe', 'Gri', 'Ju', 'Kor', 'Mer', 'Ná', 'Pol', 'Sír'];
const MID = ['ra', 'ti', 'no', 'lu', 've', 'ma', 'si', 'co', 'dra', 'fe', 'qui', 'ta', 'ri', 'mo', 'ne', 'la', 'be', 'zu', 'pe', 'ga'];
const END_STAR = ['ris', 'nus', 'rion', 'tha', 'lia', 'mar', 'dor', 'ra', 'ton', 'gia', 'phe', 'lux', 'ris', 'nax', 'ron', 'bel'];
const END_PLANET = ['ária', 'ônia', 'ândia', 'ópolis', 'ira', 'inha', 'eia', 'ânia', 'ora', 'úria', 'alis', 'ídia', 'ona', 'ália', 'ixa', 'ênia'];
const pick = (rng, a) => a[Math.floor(rng() * a.length)];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/** @returns {string} a star/system name like 'Cassinorion' */
export function starName(rng) { return cap(pick(rng, PRE) + (rng() < 0.7 ? pick(rng, MID) : '') + pick(rng, END_STAR)); }
/** @returns {string} a planet name like 'Zéravária' */
export function planetName(rng) { return cap(pick(rng, PRE) + pick(rng, MID) + (rng() < 0.3 ? pick(rng, MID) : '') + pick(rng, END_PLANET)); }
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

// ---------------------------------------------------------------------------------------------------------------- stars
// [id, label, weight, colour (sRGB-ish), luminosity (sun=1)]
const STARS = [
  ['M', 'Anã vermelha', 34, [255, 142, 96], 0.12], ['K', 'Anã laranja', 20, [255, 184, 112], 0.45], ['G', 'Estrela amarela', 18, [255, 236, 170], 1.0],
  ['F', 'Estrela branco-amarela', 12, [250, 246, 224], 2.2], ['A', 'Estrela branca', 7, [214, 228, 255], 6], ['B', 'Gigante azul', 3, [160, 190, 255], 30],
  ['R', 'Gigante vermelha', 4, [255, 110, 70], 14], ['W', 'Anã branca', 2, [232, 240, 255], 0.5],
];
function pickWeighted(rng, list, w) { let t = 0; for (const x of list) t += w(x); let r = rng() * t; for (const x of list) { r -= w(x); if (r <= 0) return x; } return list[list.length - 1]; }

// planet type weights by heat band (heat = luminosity / orbit^2, ~1 = Earth-like)
const TYPE_W = {
  inferno: { volcanic: 6, desert: 4, barren: 3 },
  hot: { desert: 6, volcanic: 3, barren: 2, alien: 1 },
  warm: { verdant: 3, lush: 3, desert: 2, ocean: 2, alien: 2 },
  temperate: { verdant: 5, lush: 2, ocean: 3, alien: 2, frozen: 0.5 },
  cool: { frozen: 2, verdant: 2.5, alien: 2, barren: 2, ocean: 1.5, lush: 1 },
  cold: { frozen: 4, barren: 4, alien: 2, ocean: 0.4 },
};
const band = (h) => (h > 6 ? 'inferno' : h > 2.2 ? 'hot' : h > 1.35 ? 'warm' : h > 0.6 ? 'temperate' : h > 0.28 ? 'cool' : 'cold');

/** probability that a map cell holds a star system: falls off from the galactic centre and follows two soft spiral arms */
export function galaxyDensity(galaxy, sx, sy) {
  const dx = sx - CENTER, dy = sy - CENTER, r = Math.hypot(dx, dy) + 1;
  const arm = 0.5 + 0.5 * Math.cos(2 * Math.atan2(dy, dx) - Math.log(r) * 3.2 + galaxy);
  return DENSITY * (0.55 + 0.9 * arm) * (0.45 + 1.2 * Math.exp(-r / 9000));
}
/** does the map cell (sx,sy) hold a star system? */
export function systemExists(galaxy, sx, sy) { return (cellHash(galaxy, sx, sy, 'x') & 0xffff) / 65536 < galaxyDensity(galaxy, sx, sy); }
export const GALAXY_CENTER = CENTER;

/**
 * Generate a whole star system.
 * @returns {{galaxy:number,sx:number,sy:number,name:string,star:{type:string,label:string,color:number[],lum:number,binary:boolean},planets:object[],hab:number}}
 */
export function generateSystem(galaxy, sx, sy) {
  const rng = rng32(cellHash(galaxy, sx, sy, 's'));
  const st = pickWeighted(rng, STARS, (s) => s[2]);
  const star = { type: st[0], label: st[1], color: st[3], lum: st[4] * (0.8 + rng() * 0.4), binary: rng() < 0.16 };
  const n = 3 + Math.floor(rng() * 5);
  const planets = [];
  let a = 0.25 + rng() * 0.2, hab = 0, bestD = 1e9;
  const used = new Set();
  for (let i = 0; i < n; i++) {
    const heat = star.lum / (a * a);
    const d = Math.abs(Math.log(heat));
    if (d < bestD) { bestD = d; hab = i; }
    planets.push({ index: i, orbit: a, heat });
    a *= 1.38 + rng() * 0.4;
  }
  const sysRng = rng32(cellHash(galaxy, sx, sy, 'n'));
  const sysName = starName(sysRng);
  for (const p of planets) {
    const r = rng32(cellHash(galaxy, sx, sy, 'p' + p.index));
    const w = TYPE_W[band(p.heat)];
    let t = pickWeighted(r, Object.keys(w), (k) => w[k]);
    if (p.index === hab) t = pickWeighted(r, ['verdant', 'lush', 'ocean', 'alien'], (k) => ({ verdant: 6, lush: 2, ocean: 2, alien: 1 })[k]);
    let name = planetName(r); while (used.has(name)) name = planetName(r); used.add(name);
    p.type = t; p.name = name; p.moons = 0; p.ring = r() < (p.orbit > 2 ? 0.35 : 0.06); p.size = 0.7 + r() * 0.8;
  }
  return { galaxy, sx, sy, name: sysName, star, planets, hab };
}

/** Full PlanetInfo-ish data for an address. @returns {{address:string,seed:number,system:object,index:number,planet:object,name:string,type:string,profile:object}|null} */
export function generatePlanet(addr) {
  const d = typeof addr === 'string' ? decodeAddress(addr) : addr;
  if (!d) return null;
  const sys = generateSystem(d.galaxy, d.sx, d.sy);
  const index = Math.min(d.planet, sys.planets.length - 1);
  const pl = sys.planets[index];
  const address = encodeAddress({ ...d, planet: index });
  const seed = seedOf(address);
  const profile = makeProfile(pl.type, rng32(seed ^ 0x5bd1e995));
  profile.sky.sunCount = sys.star.binary ? 2 : profile.sky.sunCount;
  if (profile.sky.sunCount === 2 && !profile.sky.sun2) profile.sky.sun2 = [0.6, 0.75, 1.0];
  // the star colours the planet's sun (blended with the archetype's own sun tint)
  const sc = sys.star.color.map((x) => x / 255);
  profile.sky.sun = profile.sky.sun.map((v, i) => Math.round((v * 0.5 + sc[i] * 0.5) * 1000) / 1000);
  return { address, seed, system: sys, index, planet: pl, name: pl.name, type: pl.type, profile };
}

/** deterministic home planet: a verdant/lush world in the habitable zone of a star near the galactic centre (type is a pure function of the address) */
export function homeAddress(identityId) {
  const h = hashStr('home:' + identityId), r = rng32(h);
  const galaxy = h & 63, ang = r() * Math.PI * 2, rad = Math.sqrt(r()) * HOME_RADIUS;
  let sx = Math.round(CENTER + Math.cos(ang) * rad), sy = Math.round(CENTER + Math.sin(ang) * rad);
  for (let k = 0; k < 20000; k++) {
    if (systemExists(galaxy, sx, sy)) {
      const sys = generateSystem(galaxy, sx, sy), ok = sys.planets.filter((p) => p.type === 'verdant' || p.type === 'lush');
      if (ok.length) return encodeAddress({ galaxy, sx, sy, planet: ok[h % ok.length].index });
    }
    const a = k * 2.39996, q = 1 + Math.sqrt(k);
    sx = Math.round(sx + Math.cos(a) * q * 0.6); sy = Math.round(sy + Math.sin(a) * q * 0.6);
  }
  return encodeAddress({ galaxy, sx, sy, planet: 0 });
}

/** Systems whose map cell lies in [x0,x1]x[y0,y1] (cell units). Cheap (no planets): used by the galaxy map. */
export function systemsInRegion(galaxy, x0, y0, x1, y1, out = []) {
  for (let sy = Math.floor(y0); sy <= Math.ceil(y1); sy++) for (let sx = Math.floor(x0); sx <= Math.ceil(x1); sx++) {
    if (sx < 0 || sy < 0 || sx >= SYS_SIZE || sy >= SYS_SIZE || !systemExists(galaxy, sx, sy)) continue;
    const h = cellHash(galaxy, sx, sy, 'pos'), st = pickWeighted(rng32(cellHash(galaxy, sx, sy, 's')), STARS, (s) => s[2]);
    out.push({ sx, sy, x: sx + 0.15 + 0.7 * ((h & 255) / 255), y: sy + 0.15 + 0.7 * (((h >>> 8) & 255) / 255), color: st[3], lum: st[4], type: st[0] });
  }
  return out;
}

/** @returns {object|null} the profile for an address (null if invalid) */
export function profileFor(addr) { const g = generatePlanet(addr); return g ? g.profile : null; }
/** @returns {{name:string,type:string,summary:string}|null} */
export function describe(addr) {
  const g = generatePlanet(addr); if (!g) return null;
  const T = TYPES[g.type], p = g.profile;
  return { name: g.name, type: g.type, summary: `${T.label} · ${g.system.name} ${ROMAN[g.index]} · gravidade ${p.gravity.toFixed(2)}g · dia de ${p.dayLength} min${p.sky.sunCount > 1 ? ' · dois sóis' : ''}${p.sky.moons.length ? ` · ${p.sky.moons.length} lua${p.sky.moons.length > 1 ? 's' : ''}` : ''}` };
}
export { ROMAN };
