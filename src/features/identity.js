// Persistent player identity (no accounts): a random id, a display name and a colour. The id also seeds the player's home planet.
const KEY = 'horizon.identity.v1';
const ADJ = ['Astro', 'Cósmico', 'Pixel', 'Nebuloso', 'Solar', 'Lunar', 'Quântico', 'Cobalto', 'Rubro', 'Zenite'];
const NOUN = ['Explorador', 'Piloto', 'Mineiro', 'Viajante', 'Arquiteto', 'Nômade', 'Cartógrafo', 'Engenheiro'];
const COLORS = ['#ff6b6b', '#ffb36b', '#ffd86b', '#7be08a', '#6bd5ff', '#8f9bff', '#d68fff', '#ff8fd0'];

const rnd = (n) => Math.floor(Math.random() * n);
const makeId = () => Array.from({ length: 8 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[rnd(31)]).join('');

/** @returns {{id:string, name:string, color:string}} */
export function loadIdentity() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { /* storage unavailable */ }
  if (!d || !d.id) d = { id: makeId(), name: `${ADJ[rnd(ADJ.length)]} ${NOUN[rnd(NOUN.length)]}`, color: COLORS[rnd(COLORS.length)] };
  saveIdentity(d);
  return d;
}
export function saveIdentity(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* ignore */ } }
