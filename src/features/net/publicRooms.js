// Official public rooms: places that always exist, even when nobody is in them. Each has a FIXED room code and a fixed planet. Entering one means:
// look for a host on that code (a few seconds); if there is none you become the host (open dome, listed in the public list) and the next arrivals find you.
// When the host leaves the others are brought back through the same door (one of them becomes the new host). No server: rendezvous is the usual public relays.
import { generatePlanet, homeAddress } from '../universe/generator.js';
import { encodeAddress } from '../universe/address.js';

export const PUBLIC_ROOMS = [
  { id: 'praca', code: 'PRCA-2AAA', name: 'Praça Central', icon: '🌍', desc: 'Explore, construa e converse. O ponto de encontro de todo mundo.', type: 'home', horde: false, pvp: false },
  { id: 'horda', code: 'HRDA-3AAA', name: 'Arena da Horda', icon: '👾', desc: 'Ondas de monstros sem parar. Use a nave: um pilota, outro atira.', type: 'barren', horde: true, pvp: false, sx: 40 },
  { id: 'pvp', code: 'PVPA-4AAA', name: 'Arena PvP', icon: '⚔️', desc: 'Todos contra todos: fuzil, escopeta, dash e wall-jump.', type: 'frozen', horde: false, pvp: true, sx: 90 },
  { id: 'nave', code: 'NAVE-5AAA', name: 'Pista de Naves', icon: '🚀', desc: 'Planeta alienígena com céu aberto para corridas de nave.', type: 'alien', horde: false, pvp: false, sx: 140 },
  { id: 'obra', code: 'OBRA-6AAA', name: 'Construção Livre', icon: '🏗', desc: 'Planeta exuberante para construir juntos sem pressa.', type: 'lush', horde: false, pvp: false, sx: 190 },
];
// 'O' is not in the code alphabet: the code above for 'obra' must still parse
PUBLIC_ROOMS[4].code = 'CNST-6AAA';

const cache = new Map();
/** deterministic planet address for a room (same on every machine) */
export function roomAddress(def) {
  if (cache.has(def.id)) return cache.get(def.id);
  let addr;
  if (def.type === 'home') addr = homeAddress('hz-public-' + def.id);
  else for (let sx = def.sx || 0; sx < (def.sx || 0) + 600 && !addr; sx++) for (let p = 0; p < 7 && !addr; p++) {
    try { const a = encodeAddress({ galaxy: 3, sx, sy: 7, planet: p }), g = generatePlanet(a); if (g && g.type === def.type) addr = a; } catch { /* no such system */ }
  }
  addr = addr || homeAddress('hz-public-' + def.id);
  cache.set(def.id, addr); return addr;
}
export const roomById = (id) => PUBLIC_ROOMS.find((r) => r.id === id) || null;
