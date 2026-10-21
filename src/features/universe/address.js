// Planet addresses: 12 Crockford-base32 characters grouped XXXX-XXXX-XXXX = 60 bits.
//   payload (45 bits, scrambled by a bijective mixer): galaxy 6 | sx 18 | sy 18 | planet 3      (the galaxy-map cell of the star system)
//   check   (15 bits): hash of the payload, so typos and random text are rejected instead of becoming a planet.
// Pure functions, no DOM: usable from node tests and from workers.
const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const big = BigInt;
const MASK = big(2) ** big(45) - big(1);
const K1 = big('0x9E3779B97F4A7C15') & MASK, K2 = big('0xC2B2AE3D27D4EB4F') & MASK;
const SH = big(23);

export const GALAXIES = 64, SYS_BITS = 18, SYS_SIZE = 1 << SYS_BITS, MAX_PLANETS = 8;

function mix(x) { x = (x * K1) & MASK; x ^= x >> SH; x = (x * K2) & MASK; x ^= x >> big(19); return x; }
function inv(x, k) { // modular inverse of an odd constant mod 2^45 by Newton iteration
  let y = big(1);
  for (let i = 0; i < 6; i++) y = (y * (big(2) - ((k * y) & MASK))) & MASK;
  return y;
}
const K1I = inv(K1, K1), K2I = inv(K2, K2);
function unxor(x, s) { let r = x; for (let i = 0; i < 4; i++) r = x ^ (r >> s); return r & MASK; }
function unmix(x) { x = unxor(x, big(19)); x = (x * K2I) & MASK; x = unxor(x, SH); x = (x * K1I) & MASK; return x; }

function checkOf(payload) {
  let h = Number(payload & big(0xffffff)) ^ Math.imul(Number((payload >> big(24)) & big(0xffffff)), 0x9E3779B1);
  h = Math.imul(h ^ (h >>> 15), 0x85EBCA6B); h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35); h ^= h >>> 16;
  return (h >>> 0) & 0x7fff;
}

/**
 * @param {{galaxy:number, sx:number, sy:number, planet:number}} a  galaxy 0..63, sx/sy 0..262143, planet 0..7
 * @returns {string} 'XXXX-XXXX-XXXX'
 */
export function encodeAddress({ galaxy, sx, sy, planet }) {
  const p = (big(galaxy & 63) << big(39)) | (big(sx & 0x3ffff) << big(21)) | (big(sy & 0x3ffff) << big(3)) | big(planet & 7);
  let v = (mix(p) << big(15)) | big(checkOf(mix(p)));
  let s = '';
  for (let i = 0; i < 12; i++) { s = A[Number(v & big(31))] + s; v >>= big(5); }
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** Normalise user input: upper-case, Crockford aliases (O->0, I/L->1), strip separators. @returns {string|null} 12 chars or null */
export function cleanAddress(str) {
  if (typeof str !== 'string') return null;
  const s = str.toUpperCase().replace(/[\s\-_.]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(s) ? s : null;
}

/** @returns {{galaxy:number, sx:number, sy:number, planet:number}|null} null when the text is not a valid address (bad characters or checksum) */
export function decodeAddress(str) {
  const s = cleanAddress(str);
  if (!s) return null;
  let v = big(0);
  for (const c of s) v = (v << big(5)) | big(A.indexOf(c));
  const scr = v >> big(15);
  if (Number(v & big(0x7fff)) !== checkOf(scr)) return null;
  const p = unmix(scr);
  return { galaxy: Number(p >> big(39)) & 63, sx: Number((p >> big(21)) & big(0x3ffff)), sy: Number((p >> big(3)) & big(0x3ffff)), planet: Number(p & big(7)) };
}

export const isAddress = (str) => decodeAddress(str) !== null;
/** canonical 'XXXX-XXXX-XXXX' form of valid input, else null */
export function normalizeAddress(str) { const d = decodeAddress(str); return d ? encodeAddress(d) : null; }

/** 32-bit string hash (FNV-1a + avalanche) */
export function hashStr(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}

/** World seed (positive 30-bit int) fully determined by the address. */
export function seedOf(addr) {
  const d = typeof addr === 'string' ? decodeAddress(addr) : addr;
  if (!d) throw new Error('invalid address');
  return (hashStr(`${d.galaxy}:${d.sx}:${d.sy}:${d.planet}`) & 0x3fffffff) || 1;
}
