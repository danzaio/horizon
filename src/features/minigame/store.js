// Saved games in localStorage (`horizon.games.v1`): [{ id, savedAt, def }]. Every read goes through the schema validator; every access is try/catch'd.
import { validateGameDef } from './schema.js';

const KEY = 'horizon.games.v1';

/** @returns {{id:string, savedAt:number, def:object}[]} */
export function listGames() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]'), out = [];
    if (Array.isArray(raw)) for (const g of raw.slice(0, 100)) { try { out.push({ id: String(g.id).slice(0, 24), savedAt: +g.savedAt || 0, def: validateGameDef(g.def).def }); } catch { /* skip corrupt entry */ } }
    return out;
  } catch { return []; }
}
function write(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch { return false; } }

/** Saves (insert or replace by id). Returns the stored id, or '' when storage is unavailable. */
export function saveGame(def, id) {
  const list = listGames(); id = id || 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  const rec = { id, savedAt: Date.now(), def }, i = list.findIndex((g) => g.id === id);
  if (i >= 0) list[i] = rec; else list.unshift(rec);
  return write(list.slice(0, 100)) ? id : '';
}
export function deleteGame(id) { return write(listGames().filter((g) => g.id !== id)); }

const BEST = 'horizon.games.best.v1';
/** Personal best time (seconds) per game name, or 0. */
export function getBest(name) { try { return +(JSON.parse(localStorage.getItem(BEST) || '{}')[name]) || 0; } catch { return 0; } }
/** Records `t` if it beats the stored best; returns true for a new record. */
export function recordBest(name, t) {
  try { const o = JSON.parse(localStorage.getItem(BEST) || '{}'), old = +o[name] || 0; if (old && old <= t) return false; o[String(name).slice(0, 40)] = Math.round(t * 10) / 10; localStorage.setItem(BEST, JSON.stringify(o)); return true; } catch { return false; }
}
