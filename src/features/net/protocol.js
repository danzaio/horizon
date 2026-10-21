// Wire protocol constants + sanitisers shared by host and guest. Every value that comes from the network is untrusted: clamp, cap, strip.
export const PROTO = 1;                 // bump on incompatible changes (hello.ver must match)
export const MAX_FRAME = 12000;         // chars per wire frame; larger messages are fragmented by Link
export const MAX_BIG = 8e6;             // max chars of one reassembled message (welcome with a big edit list)
export const MAX_PLAYERS = 8;           // host included
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';   // no 0/O/1/I/L: easy to read aloud
export const ROOM_APP_ID = 'horizon-voxel-p2p-v1';

export const rnd = (n) => Math.floor(Math.random() * n);
const crypto_ = typeof crypto !== 'undefined' ? crypto : null;
/** Random string from `alphabet` (crypto-grade when available). */
export function randomString(len, alphabet = CODE_ALPHABET) {
  const b = new Uint8Array(len);
  if (crypto_ && crypto_.getRandomValues) crypto_.getRandomValues(b); else for (let i = 0; i < len; i++) b[i] = rnd(256);
  let s = ''; for (let i = 0; i < len; i++) s += alphabet[b[i] % alphabet.length];
  return s;
}
/** Room code like "ABCD-EF12" */
export const makeRoomCode = () => { const s = randomString(8); return s.slice(0, 4) + '-' + s.slice(4); };
export const makeToken = () => randomString(6);
export const makeId = () => randomString(8, 'abcdefghjkmnpqrstuvwxyz23456789');

/** Accepts "abcd ef12", "ABCD-EF12~K7Q9X2", a full link with ?join=… or a manual invite ("hz1.…"). @returns {{kind:'room'|'manual'|'bad', room?:string, token?:string, code?:string}} */
export function parseJoin(input) {
  let s = String(input || '').trim();
  const m = s.match(/[?&#]join=([^&#\s]+)/i); if (m) { try { s = decodeURIComponent(m[1]); } catch { s = m[1]; } }
  if (/^hz\d+\./i.test(s)) return { kind: 'manual', code: s.replace(/\s+/g, '') };
  s = s.toUpperCase().replace(/[^A-Z0-9~]/g, '');
  const [r, t] = s.split('~');
  if (r.length === 8 && [...r].every((c) => CODE_ALPHABET.includes(c))) return { kind: 'room', room: r.slice(0, 4) + '-' + r.slice(4), token: t || '' };
  return { kind: 'bad' };
}

export const finite = (v, def = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : def);
export const clampNum = (v, lo, hi, def = 0) => { v = finite(v, def); return v < lo ? lo : v > hi ? hi : v; };
export const clampInt = (v, lo, hi, def = 0) => Math.round(clampNum(v, lo, hi, def));
export const r2 = (v) => Math.round(v * 100) / 100;
export const r3 = (v) => Math.round(v * 1000) / 1000;

/** Printable, single-line, length-capped text. Output is still untrusted: always display with textContent, never innerHTML. */
export function cleanText(s, max = 200) {
  if (typeof s !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩﻿]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
/** other features may drop names into innerHTML: remove the characters that matter there */
export const noHtml = (s) => s.replace(/[<>&"`]/g, '');
export const cleanName = (s, fallback = 'Visitante') => noHtml(cleanText(s, 20)).trim() || fallback;
export function cleanColor(s, fallback = '#6bd5ff') { return typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : fallback; }
/** hotbar item: block id (number) or item id (short string) */
export function cleanItem(v) { if (typeof v === 'number') return clampInt(v, 0, 65535, 0); if (typeof v === 'string') return v.slice(0, 24); return null; }
export function cleanTeam(v) { if (typeof v === 'number') return clampInt(v, -1, 64, 0); if (typeof v === 'string') return v.slice(0, 16); return null; }
/** JSON-able, bounded extra data (localState.extra). Returns null when too big or not plain data. */
export function cleanExtra(v, maxChars = 600) {
  if (v === null || typeof v !== 'object') return {};
  try { const s = JSON.stringify(v); if (s.length > maxChars) return {}; return JSON.parse(s, noProto); } catch { return {}; }
}
/** JSON.parse reviver: drops "__proto__" keys from untrusted data */
export const noProto = (k, v) => (k === '__proto__' ? undefined : v);

/** Flat world-edit list [cx,cz,idx,id,…] from a host: keeps only well-formed tuples (the engine indexes typed arrays with these). */
export function cleanEdits(a) {
  if (!Array.isArray(a)) return [];
  const out = [];
  for (let i = 0; i + 3 < a.length; i += 4) {
    const cx = a[i], cz = a[i + 1], idx = a[i + 2], id = a[i + 3];
    if (Number.isInteger(cx) && Number.isInteger(cz) && Number.isInteger(idx) && Number.isInteger(id) && cx >= -32768 && cx < 32768 && cz >= -32768 && cz < 32768 && idx >= 0 && idx < 32 * 32 * 192 && id >= 0 && id <= 254) out.push(cx, cz, idx, id);
  }
  return out;
}

/** PlanetInfo received from a host: copy known fields only; profile is passed through when it is a small JSON object. */
export function sanitizePlanet(p) {
  if (!p || typeof p !== 'object') return null;
  let profile = null;
  if (p.profile && typeof p.profile === 'object') { try { const s = JSON.stringify(p.profile); if (s.length < 40000) profile = JSON.parse(s, noProto); } catch { profile = null; } }
  return {
    seed: clampInt(p.seed, -2147483648, 2147483647, 1), address: typeof p.address === 'string' ? noHtml(p.address.slice(0, 32)) : null,
    name: noHtml(cleanText(p.name, 40)) || 'Planeta', type: typeof p.type === 'string' ? noHtml(p.type.slice(0, 24)) : 'terran', profile,
    ownerId: noHtml(cleanText(p.ownerId, 16)), ownerName: cleanName(p.ownerName, 'Anfitrião'), isHome: !!p.isHome,
    domeMode: p.domeMode === 'open' || p.domeMode === 'invite' ? p.domeMode : 'closed',
  };
}

/** Token bucket: take() is true while the sender stays under `rate` events/s (with a burst allowance). */
export class Bucket {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.v = burst; this.t = performance.now(); }
  take(n = 1) {
    const now = performance.now(); this.v = Math.min(this.burst, this.v + (now - this.t) * this.rate / 1000); this.t = now;
    if (this.v < n) return false;
    this.v -= n; return true;
  }
}

export const KIND_RE = /^[a-z0-9_:.-]{1,48}$/i;
export const BLOCK_ID_MAX = 254;      // 255 is the engine's UNLOADED sentinel
export const WORLD_H = 192;
