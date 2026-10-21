// Save games: player edits (World overlay) + player state, per seed, in localStorage. Everything is try/catch-guarded:
// private windows, blocked storage, quota errors or an artifact sandbox must never break the game.
const KEY = (seed) => `horizon.save.v2.${seed}`;
const VERSION = 2;   // bump when terrain/structure generation changes in a way old edits would no longer fit

export function loadSave(seed) {
  try {
    const raw = localStorage.getItem(KEY(seed));
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.v === VERSION ? d : null;
  } catch { return null; }
}
export function hasSave(seed) { try { return !!localStorage.getItem(KEY(seed)); } catch { return false; } }
export function wipeSave(seed) { try { localStorage.removeItem(KEY(seed)); } catch { /* ignore */ } }

/** @returns {boolean} whether the write succeeded */
export function writeSave(seed, data) {
  try { localStorage.setItem(KEY(seed), JSON.stringify(Object.assign({ v: VERSION, t: Date.now() }, data))); return true; } catch { return false; }
}
