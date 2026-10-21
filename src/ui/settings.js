// Persisted user settings (localStorage, always guarded: private windows / blocked storage must not break the game).
const KEY = 'horizon.settings.v1';
export const DEFAULTS = { quality: 'auto', viewScale: 100, fov: 75, sens: 1, volume: 0.7, timeSpeed: 1, showFps: false, seed: '', fx: {} };   // fx: per-effect overrides, {ssr:false,...}; absent = whatever the preset enables

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}
