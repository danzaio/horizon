// Share codes: "HZG1.<base64url(deflate-raw(json))>.<crc32 hex>". Works on static hosting (no server): paste the code or open ?game=<code>.
// Import is hostile-input safe: length cap, decompressed-size cap, checksum, then full schema validation.
import { validateGameDef } from './schema.js';

const PREFIX = 'HZG1', MAX_CODE = 400000, MAX_JSON = 1500000;
const enc = new TextEncoder(), dec = new TextDecoder();

let _crcTable = null;
/** CRC-32 of a byte array, as 8 hex chars. */
export function crc32(bytes) {
  if (!_crcTable) { _crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; _crcTable[n] = c >>> 0; } }
  let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = _crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}
export function toB64Url(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64Url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out;
}
async function pipe(bytes, stream, cap = Infinity) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader(), parts = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > cap) { reader.cancel(); throw new Error('Código grande demais.'); } parts.push(value); }
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
const hasCS = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined' && typeof Blob !== 'undefined';

/** Compact share code for a GameDef. */
export async function exportCode(def) {
  const json = enc.encode(JSON.stringify(def)), crc = crc32(json);
  if (hasCS()) return `${PREFIX}.${toB64Url(await pipe(json, new CompressionStream('deflate-raw')))}.${crc}`;
  return `${PREFIX}r.${toB64Url(json)}.${crc}`;
}

/** @returns {Promise<{def:object, warnings:string[]}>} validated game; throws Error(pt-BR message) on bad input */
export async function importCode(text) {
  const t = String(text || '').trim();
  const m = /(HZG1r?)\.([A-Za-z0-9_\s-]+)\.([0-9a-f]{8})/.exec(t.length > MAX_CODE ? '' : t);   // also finds the code inside a link or a chat message; line-wrapped payloads are fine
  if (!m) throw new Error('Código inválido. Ele começa com HZG1.');
  let json;
  try {
    const bytes = fromB64Url(m[2].replace(/\s+/g, ''));
    json = m[1] === 'HZG1r' ? bytes : await pipe(bytes, new DecompressionStream('deflate-raw'), MAX_JSON);
  } catch (e) { throw new Error(e && e.message === 'Código grande demais.' ? e.message : 'Código corrompido ou incompleto.'); }
  if (json.length > MAX_JSON) throw new Error('Código grande demais.');
  if (crc32(json) !== m[3]) throw new Error('Código corrompido (verificação falhou).');
  let raw; try { raw = JSON.parse(dec.decode(json)); } catch { throw new Error('Código corrompido.'); }
  return validateGameDef(raw);
}

/** Parses pasted text that is either a share code, a link containing ?game=…, or raw GameDef JSON. */
export async function importAny(text) {
  const t = String(text || '').trim();
  if (t.startsWith('{')) { let raw; try { raw = JSON.parse(t); } catch { throw new Error('JSON inválido.'); } return validateGameDef(raw); }
  return importCode(t);
}
