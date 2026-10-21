// HORIZON — glue: menu -> loading -> play. Per-frame order (CONTRACT §4c):
//   controls -> player.update -> interaction -> world.update -> gameRenderer.update -> gameRenderer.render -> HUD / debug.
import * as THREE from 'three';
import { PRESETS, QUALITY_ORDER } from './shared/quality.js';
import { EventBus } from './features/events.js';
import { FeatureRegistry } from './features/registry.js';
import { loadIdentity, saveIdentity } from './features/identity.js';
import { Permissions } from './features/permissions.js';
import { MobAI } from './game/MobAI.js';
import { loadSave, writeSave, wipeSave, hasSave } from './game/Save.js';
import { HOTBAR_DEFAULT, PLACEABLE, SOLID, LIQUID, EMIT, OPAQUE, B } from './shared/blocks.js';
import { SEA_LEVEL } from './shared/constants.js';
import { Player } from './game/Player.js';
import { Controls } from './game/Controls.js';
import { Interaction } from './game/Interaction.js';
import { AutoQuality, guessInitialTier } from './game/AutoQuality.js';
import { GameAudio } from './game/Audio.js';
import { setTileGenerator } from './game/blockColors.js';
import { MockRenderer } from './game/dev/mockRenderer.js';
import { MockWorld } from './game/dev/mockWorld.js';
import { UI, blockLabel } from './ui/ui.js';
import { loadSettings, saveSettings } from './ui/settings.js';

// Real modules are optional while the other teams' code lands: import.meta.glob never fails on a missing file.
const rendererLoader = import.meta.glob('./render/GameRenderer.js')['./render/GameRenderer.js'];
const texturesLoader = import.meta.glob('./render/textures.js')['./render/textures.js'];
const worldLoader = import.meta.glob('./world/World.js')['./world/World.js'];
const terrainLoader = import.meta.glob('./world/terrain.js')['./world/terrain.js'];

const qs = new URLSearchParams(location.search);
const P = {
  seed: qs.get('seed'), quality: qs.get('quality'), autostart: qs.get('autostart') === '1', time: qs.get('time'),
  x: qs.get('x'), y: qs.get('y'), z: qs.get('z'), yaw: qs.get('yaw'), pitch: qs.get('pitch'), fly: qs.get('fly') === '1',
  mock: qs.get('mock'), save: qs.get('save') === '1', weather: qs.get('weather'), hud: qs.get('hud') !== '0', notouch: qs.get('notouch') === '1', touch: qs.get('touch') === '1',
};
const wantMockWorld = P.mock === '1' || P.mock === 'world', wantMockRender = P.mock === '1' || P.mock === 'render';
const isTouch = P.touch || (!P.notouch && 'ontouchstart' in window && matchMedia('(pointer:coarse)').matches);

const events = new EventBus();
const registry = new FeatureRegistry();
const identity = loadIdentity();
const permissions = new Permissions();
const canvas = document.getElementById('game');
// GPU reset / driver crash / too many contexts: save, tell the player, and offer a clean reload (three.js cannot resume mid-session reliably)
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  try { saveNow(true); } catch { /* ignore */ }
  if (G.state === 'playing') pauseGame();
  ui.fatal('A placa de vídeo reiniciou o contexto gráfico (WebGL). Seu progresso foi salvo; recarregue a página para continuar.');
}, false);
const settings = loadSettings();
if (P.quality) settings.quality = P.quality === 'auto' || QUALITY_ORDER.includes(P.quality) ? P.quality : settings.quality;

/** Everything that exists once a game has started. */
const G = { started: false, ready: false, state: 'menu', gr: null, world: null, terrain: null, player: null, controls: null, interaction: null, aq: null, mockWorld: false, mockRender: false,
  last: performance.now(), fps: 60, cpuMs: 0, frames: 0, gpu: '', wantShot: false, pauseAt: 0, seed: 1, loadFrames: 0, biomeNames: null };
const hotbar = { slots: HOTBAR_DEFAULT.slice(), sel: 0 };
const audio = new GameAudio();
const hz = window.__hz = { ready: false, world: null, gameRenderer: null, player: null, camera: null, interaction: null, controls: null, autoQuality: null,
  setQuality: () => {}, teleport: () => {}, lookAt: () => {}, setTime: () => {}, screenshotReady: () => false, stats: () => ({}) };

// ---------------------------------------------------------------------------------------------------------------------
// quality
// ---------------------------------------------------------------------------------------------------------------------
function probeGPU() {
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
    return String(s || '');
  } catch { return ''; }
}

/** Preset object with the user's view-distance scale applied (viewDistance and chunkRadius proportionally). */
function effectivePreset(tierName) {
  const base = PRESETS[tierName] || PRESETS.medium, vs = settings.viewScale / 100, fx = settings.fx || {};
  const p = Object.assign({}, base, { viewDistance: base.viewDistance * vs, chunkRadius: Math.max(2, Math.min(20, Math.round(base.chunkRadius * vs))) });
  // user switches can only turn effects OFF; the preset decides what is available on this tier
  p.post = Object.assign({}, base.post);
  for (const k of ['ssr', 'ssao', 'taa', 'vol', 'bloom', 'exp', 'cine', 'flare', 'mb']) if (fx[k] === false) p.post[k] = false;
  if (fx.vclouds === false && p.clouds > 2) p.clouds = 2;
  if (fx.shadows === false) p.shadows = Object.assign({}, base.shadows, { on: false });
  if (fx.weather === false) p.precip = 0;
  if (fx.mobs === false) p.mobs = 0;
  return p;
}
const currentTierName = () => (G.aq ? G.aq.current.tierName : (settings.quality === 'auto' ? 'medium' : settings.quality));
function viewLabel(pct) {
  const d = Math.round(PRESETS[currentTierName()].viewDistance * pct / 100);
  return `${pct}% · ${d >= 1000 ? (d / 1000).toFixed(1) + ' km' : d + ' blocos'}`;
}

function applyQuality(s) {
  if (!G.gr) return;
  if (s.tierChanged || !G.qualityApplied) {
    const p = effectivePreset(s.tierName);
    G.gr.setQuality(p); if (G.world) G.world.setQuality(p);
    G.qualityApplied = true;
  }
  G.gr.setRenderScale(s.renderScale);
}
let viewTimer = 0;
function reapplyQuality() { // slider moved: debounce expensive rebuilds
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => { if (G.aq) { G.qualityApplied = false; applyQuality({ tierName: G.aq.current.tierName, renderScale: G.aq.renderScale, tierChanged: true }); } }, 250);
}

// ---------------------------------------------------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------------------------------------------------
const ui = new UI(settings, {
  play: (seed, quality) => { settings.quality = quality; settings.seed = seed; saveSettings(settings); audio.unlock(); startGame(seed); },
  resume: () => resumeGame(),
  quit: () => { location.href = location.pathname; },
  wipe: () => { G.saveOn = false; wipeSave(G.seed); ui.toast('Mundo salvo apagado. Recarregando…'); setTimeout(() => { location.href = location.pathname; }, 700); },
  setting: onSetting,
  selectSlot: (i) => selectSlot(i),
  pickBlock: (id) => setSlot(hotbar.sel, id),
  screenshot: () => { G.wantShot = true; },
  palette: () => togglePalette(),
  viewLabel,
  panelOpen: () => { if (G.state === 'playing') { G.controls.reset(); setState('panel'); G.controls.unlock(); G.panelFromPlay = true; } },
  panelClose: () => { if (G.panelFromPlay && G.state === 'panel') { G.panelFromPlay = false; setState('playing'); if (!isTouch && !G.noLock) G.controls.lock(); } },
});
ui.syncSettings(); ui.setHotbar(hotbar.slots, hotbar.sel, false); ui.setTouch(isTouch);
ui.showMenu(isTouch ? 'Modo toque detectado' : '');
{ // identity field + feature menu hooks (multiplayer join, galaxy map, ... add their buttons here)
  const nameEl = document.getElementById('player-name'); nameEl.value = identity.name;
  nameEl.addEventListener('change', () => { identity.name = nameEl.value.trim().slice(0, 20) || identity.name; nameEl.value = identity.name; saveIdentity(identity); });
  registry.load().then(() => registry.menu({ ui, identity, settings, events, startGame: (o = {}) => { audio.unlock(); return startGame(o.seedStr || '', o); } }));
}

function onSetting(key, v) {
  saveSettings(settings);
  if (key === 'quality') { if (G.aq) G.aq.setMode(v); ui.syncSettings(); }
  else if (key === 'viewScale' || key === 'fx') reapplyQuality();
  else if (key === 'fov') { if (G.player) G.player.fovBase = v; }
  else if (key === 'sens') { if (G.controls) G.controls.sens = v; }
  else if (key === 'volume') audio.setVolume(v);
  else if (key === 'timeSpeed') { if (G.gr) G.gr.time.speed = 0.02 * v; }
  else if (key === 'showFps') ui.syncSettings();
}

function selectSlot(i) { hotbar.sel = (i + 9) % 9; ui.setHotbar(hotbar.slots, hotbar.sel); }
/** Put a block id (number) or item id (string) into hotbar slot i; the items feature (ctx.inventory) honours the minigame lock. */
function setSlot(i, v) {
  if (G.ctx && G.ctx.inventory) { G.ctx.inventory.setSlot(i, v); return; }
  hotbar.slots[i] = v; ui.setHotbar(hotbar.slots, hotbar.sel);
}

/** Handheld light: warm lantern that follows the camera (caves / night). Glowing blocks in hand make it stronger and wider. */
function applyHeldLight() {
  if (!G.gr) return;
  const glow = EMIT[hotbar.slots[hotbar.sel]] > 0;
  G.gr.setHeldLight(G.lantern !== false, glow ? 1.7 : 1, glow ? 24 : 16);
}

/** First-person held block: follows the hotbar, bobs with movement, swings on break/place, lit by local sky exposure. */
let _handLightAt = 0;
function updateHand(dt, now) {
  const { gr, player: p, world, controls, interaction } = G, hand = gr.hand;
  hand.setBlock(hotbar.slots[hotbar.sel]);
  const sp = Math.hypot(p.vx, p.vz);
  hand.update(dt, { speed: Math.min(1, sp / 5.5), sprint: p.sprinting, air: !p.onGround && !p.flying && !p.inWater });
  hand.setBreaking(controls.mouse.breakHeld && interaction.progress > 0);
  if (now - _handLightAt > 250) {            // sky exposure above the camera, 4x per second
    _handLightAt = now;
    const cx = Math.floor(p.x), cy = Math.floor(p.y + 1.6), cz = Math.floor(p.z);
    let covered = 0;
    for (let y = cy + 1; y < cy + 48; y++) { const b = world.getBlock(cx, y, cz); if (b !== B.UNLOADED && OPAQUE[b]) { covered = y - cy; break; } }
    hand.setLight(covered === 0 ? 1 : covered < 4 ? 0.25 : 0.45, covered === 0 ? 1 : 0);
    G.cover = covered === 0 ? 0 : covered < 8 ? 0.95 : 1;
  }
}

// ---- weather -------------------------------------------------------------------------------------------------------
// Auto cycle: clear spells alternate with rain (temperate) / snow (cold biomes) / occasional thunderstorms. Deserts stay dry.
const WX = { fixed: false, timer: 100 + Math.random() * 120, active: false, kind: 'clear', checkAt: 0 };
const COLD_BIOMES = new Set(['TAIGA', 'SNOWY', 'FROZEN', 'PEAKS']);
function climateAt(x, z) {
  try {
    if (G.terrain && G.terrain.biomeAt && G.biomeNames) {
      const n = G.biomeNames[G.terrain.biomeAt(Math.floor(x), Math.floor(z))];
      if (COLD_BIOMES.has(n)) return 'snow';
      if (n === 'DESERT') return 'dry';
    }
  } catch { /* optional */ }
  return 'rain';
}
/** kind: 'clear' | 'rain' | 'storm' | 'snow' */
function applyWeather(kind, instant = false) {
  const gr = G.gr; if (!gr || !gr.setWeather) return;
  WX.kind = kind;
  if (kind === 'clear') gr.setWeather('clear');
  else gr.setWeather(kind === 'snow' ? 'snow' : 'rain', kind === 'storm' ? 1 : 0.65 + 0.35 * Math.random(), kind === 'storm');
  if (instant) { const w = gr._wx; w.cur = w.target; }
}
function cycleWeather() {
  const order = ['clear', 'rain', 'storm', 'snow'], next = order[(order.indexOf(WX.kind) + 1) % order.length];
  WX.fixed = true; applyWeather(next);
  ui.toast({ clear: 'Tempo limpo', rain: 'Chuva', storm: 'Tempestade', snow: 'Neve' }[next]);
}
// ---- photo mode (P): HUD + hand hidden, depth of field focused on whatever is under the crosshair, [ ] change the aperture ----
const PH = { on: false, focus: 24, target: 24, aperture: 3.5 };
const _ray = new THREE.Vector3();
function togglePhoto() {
  PH.on = !PH.on;
  document.body.classList.toggle('photo', PH.on);
  const ok = G.gr.setPhoto(PH.on, PH.focus, PH.aperture);
  if (G.interaction) G.interaction.enabled = !PH.on;
  if (PH.on) ui.toast(ok ? 'Modo foto: [ e ] ajustam o desfoque · P sai · F2 salva' : 'Modo foto (profundidade de campo exige qualidade Média ou maior)');
}
function updatePhoto(dt) {
  if (!PH.on) return;
  const cam = G.gr.camera; cam.getWorldDirection(_ray);
  const hit = G.world.raycast(cam.position, _ray, 160);
  PH.target = hit ? Math.max(0.8, hit.dist) : 120;
  PH.focus += (PH.target - PH.focus) * Math.min(1, dt * 5);
  G.gr.setPhoto(true, PH.focus, PH.aperture);
}

// ---- autosave: edits + player state, every ~8 s when something changed, plus when the tab is hidden / the page closes ----
function saveNow(force) {
  if (!G.saveOn || !G.ready || !G.world || !G.player) return;
  const rev = G.world.editRev || 0, p = G.player, moved = !G.lastSavePos || Math.hypot(p.x - G.lastSavePos[0], p.z - G.lastSavePos[2]) > 4;
  if (!force && rev === G.lastSaveRev && !moved) return;
  const ok = writeSave(G.seed, { edits: G.world.exportEdits(), pos: [p.x, p.y, p.z], yaw: p.yaw, pitch: p.pitch, hours: G.gr.time.hours, hotbar: hotbar.slots, sel: hotbar.sel });
  if (ok) { G.lastSaveRev = rev; G.lastSavePos = [p.x, p.y, p.z]; } else if (!G.saveWarned) { G.saveWarned = true; ui.toast('Não foi possível salvar (armazenamento indisponível)'); }
  G.lastSaveAt = performance.now();
}
function autosave(now) { if (now - (G.lastSaveAt || 0) > 8000) saveNow(false); }
addEventListener('pagehide', () => saveNow(true));
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(true); });

function updateWeather(dt, now) {
  const p = G.player;
  if (settings.fx && settings.fx.weather === false && !WX.fixed) { if (WX.kind !== 'clear') applyWeather('clear'); WX.timer = 30; return; }
  if (!WX.fixed) {
    WX.timer -= dt;
    if (WX.timer <= 0) {
      if (WX.kind !== 'clear') { applyWeather('clear'); WX.timer = 150 + Math.random() * 280; }
      else {
        const c = climateAt(p.x, p.z);
        if (c === 'dry') WX.timer = 45;
        else { applyWeather(c === 'snow' ? 'snow' : Math.random() < 0.35 ? 'storm' : 'rain'); WX.timer = 90 + Math.random() * 150; }
      }
    }
  }
  if (WX.kind !== 'clear' && now - WX.checkAt > 4000) { // follow the climate while walking
    WX.checkAt = now;
    const c = climateAt(p.x, p.z);
    if (c === 'dry') applyWeather('clear');
    else if ((c === 'snow') !== (WX.kind === 'snow')) applyWeather(c === 'snow' ? 'snow' : 'rain');
  }
  G.gr.setWeatherCover(G.cover || 0);
  if (now - (WX.ambAt || 0) > 1000) { // ambient life follows biome / time of day (re-evaluated 1x per second)
    WX.ambAt = now;
    let nm = '';
    try { if (G.terrain && G.biomeNames) nm = G.biomeNames[G.terrain.biomeAt(Math.floor(p.x), Math.floor(p.z))] || ''; } catch { /* optional */ }
    const wet = G.gr.getWeather().amount, open = 1 - (G.cover || 0);
    const night = G.gr.time.isNight ? 1 : 0, lush = ['PLAINS', 'FOREST', 'BIRCH', 'SWAMP', 'CHERRY', 'TAIGA', 'RIVER'].includes(nm) ? 1 : 0;
    WX.petals = nm === 'CHERRY' ? open * (1 - wet * 0.6) * (1 - night * 0.7) : 0;
    WX.flies = night * lush * (1 - wet) * (nm === 'SWAMP' || nm === 'CHERRY' ? 1 : 0.7) * (p.headUnderwater ? 0 : 1);
  }
  G.gr.setAmbient(WX.petals || 0, WX.flies || 0);
  audio.setRain(G.gr.getWeather().type === 'rain' ? G.gr.getWeather().amount * (1 - (G.cover || 0) * 0.85) : 0);
}

const TIME_STOPS = [6.2, 12, 18, 23.5];
function cycleTime() {
  const t = G.gr.time, h = t.hours;
  const next = TIME_STOPS.find((s) => s > h + 0.3) ?? TIME_STOPS[0];
  t.hours = next;
  const hh = Math.floor(next), mm = Math.floor((next - hh) * 60);
  ui.toast(`Hora do dia: ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
}

function takeScreenshot() {
  canvas.toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `horizon-${Date.now()}.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    ui.toast('Captura de tela salva');
  }, 'image/png');
}

// ---------------------------------------------------------------------------------------------------------------------
// state transitions
// ---------------------------------------------------------------------------------------------------------------------
function setState(s) {
  G.state = s;
  if (G.controls) G.controls.active = s === 'playing';
  if (G.aq) { if (s === 'playing') G.aq.resume(performance.now()); else G.aq.pause(); }
}

function pauseGame(note) {
  if (G.state !== 'playing') return;
  G.controls.reset(); setState('paused'); G.pauseAt = performance.now();
  ui.showPause(note || (isTouch || G.noLock ? 'Toque em “Continuar” para voltar ao jogo.' : 'Clique em “Continuar” para voltar ao jogo.'));
}
function resumeGame() {
  if (G.state === 'menu' || G.state === 'loading') return;
  ui.hidePause(); ui.showPalette(false); setState('playing'); audio.unlock();
  if (!isTouch && !G.noLock) G.controls.lock();
}
function togglePalette() {
  if (G.state === 'palette') { ui.showPalette(false); setState('playing'); if (!isTouch && !G.noLock) G.controls.lock(); }
  else if (G.state === 'playing') { G.controls.reset(); setState('palette'); G.controls.unlock(); ui.showPalette(true); }
}
document.addEventListener('pointerlockchange', () => { if (G.controls && !G.controls.locked && G.state === 'playing' && !G.noLock) pauseGame(); });
document.addEventListener('pointerlockerror', () => {
  if (G.controls && G.controls._lockAct) G.controls.enterDragMode(); // lock refused despite a user gesture (sandboxed frame): switch to drag-look
  if (G.controls && G.controls.dragMode) return;
  if (G.state === 'playing' && !G.noLock) pauseGame('Não foi possível capturar o mouse. Clique em “Continuar”.');
});
document.addEventListener('keydown', (e) => { if (e.code === 'Escape' && G.state === 'paused' && performance.now() - G.pauseAt > 350) resumeGame(); });
document.addEventListener('visibilitychange', () => { if (G.aq) { if (document.hidden) G.aq.pause(); else if (G.state === 'playing') G.aq.resume(performance.now()); } });

// ---------------------------------------------------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------------------------------------------------
function parseSeed(str) {
  if (P.seed) str = P.seed;
  if (!str) return P.autostart ? 1337 : 1 + Math.floor(Math.random() * 999999);
  if (/^-?\d+$/.test(str)) return parseInt(str, 10) | 0;
  let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1000000000;
}

async function loadTextures() {
  if (!texturesLoader) return;
  try { const m = await texturesLoader(); setTileGenerator(m.generateTilePixels); ui.refreshIcons(); } catch (e) { console.warn('[HZ] textures unavailable, flat icons', e.message); }
}

async function loadImpl(loader, name, mock) {
  if (!mock && loader) { try { return (await loader())[name]; } catch (e) { console.warn(`[HZ] ${name} failed to load, using mock:`, e.message); } }
  return null;
}

/** Find a dry spawn (seed-dependent origin, spiral search) and place the player above it. */
function findSpawn(world, seed, wantSnow = false) {
  let s = (seed * 2654435761) >>> 0; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const ox = Math.floor((rnd() - 0.5) * 4000), oz = Math.floor((rnd() - 0.5) * 4000);
  // Golden-angle spiral that keeps growing (≈3 km) until dry, low-lying land is found; prefers beaches/plains over peaks.
  let best = null;
  for (let i = 0; i < 2400; i++) {
    const a = i * 2.39996, r = 20 * Math.sqrt(i) * 2, x = Math.floor(ox + Math.cos(a) * r), z = Math.floor(oz + Math.sin(a) * r);
    const y = world.getSurfaceY(x, z);
    if (y > SEA_LEVEL + 1 && y < SEA_LEVEL + 40) {
      const top = world.getBlock(x, y, z); // keep friendly planets from dropping you on a snowfield
      if (wantSnow || (top !== B.SNOW && top !== B.SNOW_GRASS && top !== B.ICE) || i > 1200) return { x: x + 0.5, y: y + 2, z: z + 0.5 };
    }
    if (!best && y > SEA_LEVEL + 1) best = { x: x + 0.5, y: y + 2, z: z + 0.5 };
  }
  return best || { x: ox + 0.5, y: Math.max(SEA_LEVEL + 3, world.getSurfaceY(ox, oz) + 2), z: oz + 0.5 };
}

/**
 * @param {string} seedStr  typed seed ('' = the player's own home planet)
 * @param {{planet?:object, edits?:number[], net?:object, role?:'solo'|'host'|'guest'}} [opts]  features pass these to start on a specific planet / as a guest
 */
async function startGame(seedStr, opts = {}) {
  if (G.started) return;
  G.started = true; G.opts = opts; G.role = opts.role || 'solo';
  ui.hideMenu(); ui.showLoading(); G.state = 'loading';
  try {
    ui.setProgress(0.02, 'Carregando módulos…');
    await registry.load();
    let planet = opts.planet || await registry.resolvePlanet({ identity, seedStr, params: P, opts });
    if (!planet) { const sd = parseSeed(seedStr || (P.autostart ? '' : identity.id)); planet = { seed: sd, profile: null, address: null, name: seedStr ? `Mundo ${sd}` : 'Seu planeta', ownerId: identity.id, ownerName: identity.name, isHome: !seedStr, domeMode: 'closed' }; }
    G.planet = planet; G.seed = planet.seed;
    const [GR, WorldCls, terrainMod] = await Promise.all([loadImpl(rendererLoader, 'GameRenderer', wantMockRender), loadImpl(worldLoader, 'World', wantMockWorld), terrainLoader ? terrainLoader().catch(() => null) : null]);
    G.mockRender = !GR; G.mockWorld = !WorldCls;
    G.gpu = probeGPU();
    const hw = { cores: navigator.hardwareConcurrency || 4, memory: navigator.deviceMemory || 0, mobile: isTouch || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent), glRenderer: G.gpu };
    const initialTier = settings.quality === 'auto' ? guessInitialTier(hw) : Math.max(0, QUALITY_ORDER.indexOf(settings.quality));
    const startPreset = effectivePreset(QUALITY_ORDER[initialTier]);

    ui.setProgress(0.05, 'Criando renderizador…');
    G.gr = new (GR || MockRenderer)({ canvas, quality: startPreset });
    const gr = G.gr, camera = gr.camera;
    gr.resize(innerWidth, innerHeight);
    gr.time.speed = 0.02 * settings.timeSpeed;
    gr.onThunder = (delay, strength) => audio.thunder(delay, strength);
    if (P.weather) { WX.fixed = true; applyWeather(P.weather, true); }
    if (P.time) gr.time.hours = parseFloat(P.time) || 9;
    window.addEventListener('resize', () => gr.resize(innerWidth, innerHeight));

    G.world = new (WorldCls || MockWorld)({ seed: G.seed, scene: gr.scene, materials: gr.materials, quality: startPreset, onProgress: (p) => { G.loadProgress = p; }, events, profile: planet.profile });
    if (G.world.group && G.world.group.parent !== gr.scene) gr.scene.add(G.world.group);
    if (terrainMod && terrainMod.createTerrain) {
      try { G.terrain = terrainMod.createTerrain(G.seed); if (terrainMod.BIOME) G.biomeNames = Object.fromEntries(Object.entries(terrainMod.BIOME).map(([k, v]) => [v, k])); } catch { /* optional */ }
    }

    const player = G.player = new Player(G.world, camera);
    player.fovBase = settings.fov; player.fovCur = settings.fov; player.autoStep = isTouch;
    player.onStep = (id, sprint) => audio.footstep(id, sprint);
    player.onLand = (v) => audio.land(v);
    player.onSplash = (v) => audio.splash(v);
    // saved game: edits are re-applied before any chunk is generated; position/time restore unless the URL overrides them
    G.saveOn = (!P.autostart || P.save) && G.role !== 'guest';
    if (opts.edits && G.world.importEdits) G.world.importEdits(opts.edits);
    const sv = G.saveOn ? loadSave(G.seed) : null;
    if (sv && sv.edits && G.world.importEdits) G.world.importEdits(sv.edits);
    G.resumed = !!(sv && sv.pos && P.x === null && P.z === null);
    const sp = G.resumed ? { x: sv.pos[0], y: sv.pos[1], z: sv.pos[2] } : findSpawn(G.world, G.seed, !planet.profile || planet.profile.type === 'frozen');
    const sx = P.x !== null ? parseFloat(P.x) : sp.x, sz = P.z !== null ? parseFloat(P.z) : sp.z;
    const sy = P.y !== null ? parseFloat(P.y) : (P.x !== null || P.z !== null ? G.world.getSurfaceY(Math.floor(sx), Math.floor(sz)) + 2 : sp.y);
    player.teleport(sx, sy, sz);
    player.setLook(P.yaw !== null ? parseFloat(P.yaw) * Math.PI / 180 : (G.resumed ? sv.yaw : P.autostart ? 0 : Math.random() * Math.PI * 2), P.pitch !== null ? parseFloat(P.pitch) * Math.PI / 180 : (G.resumed ? sv.pitch : 0));
    if (G.resumed) { if (sv.hours != null && !P.time) gr.time.hours = sv.hours; if (Array.isArray(sv.hotbar)) { hotbar.slots = sv.hotbar.slice(0, 9); hotbar.sel = sv.sel | 0; } }
    player.flying = P.fly || sy > G.world.getSurfaceY(Math.floor(sx), Math.floor(sz)) + 6;

    const controls = G.controls = new Controls({ canvas, player, touch: isTouch });
    controls.sens = settings.sens;
    controls.onDragMode = () => {
      G.noLock = true;
      ui.toast('Mouse sem captura: arraste para olhar · segure parado para quebrar · toque rápido ou botão direito para colocar');
      if (G.state === 'paused') resumeGame();
    };
    G.noLock = P.autostart;
    controls.actions = {
      hotbar: selectSlot, hotbarDelta: (d) => selectSlot(hotbar.sel + d), palette: togglePalette, debug: () => ui.toggleDebug(), screenshot: () => { G.wantShot = true; },
      cycleTime, weather: cycleWeather, photo: togglePhoto, aperture: (d) => { PH.aperture = Math.max(0.6, Math.min(14, PH.aperture * (d > 0 ? 1.35 : 1 / 1.35))); ui.toast('Abertura: ' + PH.aperture.toFixed(1)); }, lantern: () => { G.lantern = G.lantern === false; ui.toast(G.lantern === false ? 'Lanterna desligada' : 'Lanterna ligada'); }, mute: () => { audio.setMuted(!audio.muted); ui.toast(audio.muted ? 'Som desligado' : 'Som ligado'); }, pause: () => pauseGame(),
      flyToggled: (on) => { ui.setFly(on); ui.toast(on ? 'Voo ligado' : 'Voo desligado'); }, flySpeed: (v) => ui.toast(`Velocidade de voo: ${v.toFixed(0)}`),
    };
    ui.setFly(player.flying);

    G.interaction = new Interaction({
      scene: gr.scene, world: G.world, camera, player, getSelected: () => hotbar.slots[hotbar.sel],
      onBreak: (id) => { audio.blockBreak(id); if (G.gr.hand) G.gr.hand.swing(); },
      onPlace: (id) => { audio.blockPlace(id); if (G.gr.hand) G.gr.hand.swing(); },
      onPick: (id) => {
        if (!PLACEABLE.includes(id)) return;
        const i = hotbar.slots.indexOf(id);
        if (i >= 0) selectSlot(i); else setSlot(hotbar.sel, id);
      },
    });
    G.interaction.enabled = false;
    G.mobs = new MobAI({ world: G.world, gr, audio, biomeAt: (x, z) => { try { return G.biomeNames[G.terrain.biomeAt(Math.floor(x), Math.floor(z))] || 'PLAINS'; } catch { return 'PLAINS'; } } });

    audio.setVolume(settings.volume);
    G.aq = new AutoQuality({ initialTier, apply: applyQuality });
    G.aq.setMode(settings.quality);
    if (settings.quality === 'auto' && G.gpu) console.log('[HZ] GPU:', G.gpu, '-> initial tier', QUALITY_ORDER[initialTier]);
    installHooks();
    G.ctx = buildCtx(gr, camera, player, controls);
    ui.setPlanetBadge(planet.name ? `<b>${planet.name}</b>${planet.address ? ' · ' + planet.address : ''}${G.role === 'guest' ? ' · visitante' : ''}` : '');
    events.emit('planet:enter', { planet });
    registry.init(G.ctx);
    ui.setProgress(0.1, 'Gerando terreno…');
    ui.setUnderwater(false);
  } catch (e) {
    console.error('[HZ] startup failed', e);
    ui.hideLoading(); ui.fatal('Não foi possível iniciar o jogo: ' + (e && e.message ? e.message : e) + '. Seu navegador precisa suportar WebGL2.');
  }
}

/** Terrain data around the spawn is loaded now: move to the nearest open-air spot on real ground (not inside / on top of a tree). */
function relocateToClearGround() {
  const w = G.world, p = G.player, bx = Math.floor(p.x), bz = Math.floor(p.z);
  const clear = (x, z) => {
    const sy = w.getSurfaceY(x, z), g = w.getBlock(x, sy, z);
    if (g === B.UNLOADED || !SOLID[g] || LIQUID[g] || g === B.LEAVES_OAK || g === B.LEAVES_BIRCH || g === B.LEAVES_SPRUCE || g === B.LOG_OAK || g === B.LOG_BIRCH || g === B.LOG_SPRUCE || g === B.CHERRY_LEAVES || g === B.CHERRY_LOG) return -1;
    for (let dy = 1; dy <= 3; dy++) for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (SOLID[w.getBlock(x + ox, sy + dy, z + oz)]) return -1;
    // open sky/space around: no trunk or canopy within 3 blocks horizontally, 1..6 above ground (so we never spawn hugging a tree)
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) for (let dy = 1; dy <= 6; dy++) {
      const b = w.getBlock(x + dx, sy + dy, z + dz);
      if (b === B.LEAVES_OAK || b === B.LEAVES_BIRCH || b === B.LEAVES_SPRUCE || b === B.LOG_OAK || b === B.LOG_BIRCH || b === B.LOG_SPRUCE || b === B.CHERRY_LEAVES || b === B.CHERRY_LOG || b === B.CACTUS) return -1;
    }
    return sy;
  };
  for (let r = 0; r <= 24; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const sy = clear(bx + dx, bz + dz);
    if (sy >= 0) { p.teleport(bx + dx + 0.5, sy + 1.001, bz + dz + 0.5); return; }
  }
}

/** Pick the yaw (radians) whose view is most open: downhill / water / far terrain beats walls of hillside. Forward = (-sin yaw, -cos yaw). */
function bestViewYaw(w, x, z) {
  const ground = w.getSurfaceY(Math.floor(x), Math.floor(z));
  let best = 0, bestScore = -Infinity;
  for (let k = 0; k < 24; k++) {
    const yaw = (k / 24) * Math.PI * 2; let score = 0;
    for (const d of [16, 40, 90, 180, 360, 700]) {
      const h = w.getSurfaceY(Math.floor(x - Math.sin(yaw) * d), Math.floor(z - Math.cos(yaw) * d));
      const rise = h - ground;
      score -= rise > 4 ? Math.min(rise, 60) * (d < 100 ? 2 : 0.6) : 0; // walls/hills in the way
      score += h <= SEA_LEVEL ? 6 : Math.min(Math.abs(rise), 40) * 0.08;  // water + relief add interest
    }
    if (score > bestScore) { bestScore = score; best = yaw; }
  }
  return best;
}

function finishLoading() {
  G.ready = true; G.lastSaveRev = G.world.editRev || 0; G.lastSaveAt = performance.now();
  if (P.x === null && P.z === null && !G.player.flying && !G.resumed) relocateToClearGround();
  if (P.yaw === null && P.x === null && P.z === null && !G.resumed) G.player.setLook(bestViewYaw(G.world, G.player.x, G.player.z), -0.04);
  G.player.unstick();
  ui.hideLoading(); ui.showHUD(P.hud); ui.setHotbar(hotbar.slots, hotbar.sel);
  G.controls.active = true; G.interaction.enabled = true;
  G.state = 'playing'; G.aq.resume(performance.now());
  events.emit('world:ready', { planet: G.planet }); registry.ready(G.ctx);
  if (!isTouch && !G.noLock) {
    G.controls.lock();
    setTimeout(() => { if (G.state === 'playing' && !G.controls.locked) pauseGame('Clique em “Continuar” para capturar o mouse e jogar.'); }, 250);
  }
  ui.toast(`Semente ${G.seed}${G.mockWorld || G.mockRender ? ' · modo simulado' : ''}`);
  setTimeout(() => { hz.ready = true; }, 0);
}

// ---------------------------------------------------------------------------------------------------------------------
// frame loop
// ---------------------------------------------------------------------------------------------------------------------
const _v2 = new THREE.Vector2();
function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = now - G.last; G.last = now;
  if (!G.started || !G.gr || !G.aq) return;
  const dt = Math.min(dtMs / 1000, 0.1), c0 = performance.now();
  const { gr, world, player, controls, interaction } = G;
  G.fps += (1000 / Math.max(dtMs, 0.5) - G.fps) * 0.08;

  controls.update();
  if (G.ready && G.state === 'playing') player.update(dt); else player.updateCamera(dt);
  gr.setUnderwater(player.headUnderwater);
  if (G.mockRender) ui.setUnderwater(player.headUnderwater);
  gr.renderer.getDrawingBufferSize(_v2);
  interaction.enabled = G.state === 'playing';
  interaction.update(dt, controls.mouse, _v2.y / (2 * Math.tan(player.camera.fov * Math.PI / 360)));
  world.update(player.camera, dt);
  applyHeldLight();
  if (gr.hand) updateHand(dt, now);
  updateWeather(dt, now);
  if (G.ready && G.ctx) registry.update(dt, G.ctx);
  updatePhoto(dt);
  autosave(now);
  if (G.mobs && G.ready && gr.mobs) G.mobs.update(G.state === 'playing' ? dt : 0, gr.camera.position, player);
  gr.update(dt);
  gr.render(world);
  audio.update(dt, player.y, gr.time.isNight, player.headUnderwater);

  if (G.wantShot) { G.wantShot = false; takeScreenshot(); }
  const cpu = performance.now() - c0; G.cpuMs += (cpu - G.cpuMs) * 0.1;
  G.frames++;

  if (G.state === 'loading') {
    G.loadFrames++;
    const st = world.stats ? world.stats() : null;
    if (st) ui.setProgress(0.1 + 0.9 * (G.loadProgress || 0), `Terreno: ${st.chunks} chunks · fila ${st.chunkQueue}`);
    if (world.isReady() && G.loadFrames > 2) finishLoading();
  } else {
    G.aq.feed(dtMs, now);
    ui.pushFrame(dtMs);
    ui.updateDebug(now, G.fps, debugInfo);
  }
}

function debugInfo() {
  const p = G.player, h = G.interaction && G.interaction.hit;
  let biome = '';
  try { if (G.terrain && G.terrain.biomeAt && G.biomeNames) biome = G.biomeNames[G.terrain.biomeAt(Math.floor(p.x), Math.floor(p.z))] || ''; } catch { /* optional */ }
  return {
    cpuMs: G.cpuMs, gpu: G.gpu, render: G.gr.info(), world: G.world.stats ? G.world.stats() : {}, auto: G.aq.current,
    x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, hours: G.gr.time.hours, night: G.gr.time.isNight, timeSpeed: settings.timeSpeed,
    state: (p.flying ? 'voando' : p.inWater ? 'nadando' : p.onGround ? 'no chão' : 'no ar') + (p.frozen ? ' (aguardando terreno)' : '') + (biome ? ` · bioma ${biome}` : ''),
    target: h ? `${blockLabel(h.block)} (${h.x}, ${h.y}, ${h.z}) a ${h.dist !== undefined ? h.dist.toFixed(1) : '?'} m` : '',
  };
}

/** The one object every feature receives. Documented in docs/CONTRACT2.md; add fields here, never reach into main.js internals. */
function buildCtx(gr, camera, player, controls) {
  return {
    THREE, events, identity, settings, ui, audio, registry, permissions,
    /** plain data other features read (e.g. the network layer sends it with every position update): team, hp, held item, extra */
    localState: { team: null, hp: 20, item: null, extra: {} },
    gr, camera, player, controls, interaction: G.interaction, world: G.world, hotbar, mobs: G.mobs,
    planet: G.planet, role: G.role, net: (G.opts && G.opts.net) || null,
    addHotkey: (code, fn) => controls.extraKeys.set(code, fn),
    removeHotkey: (code) => controls.extraKeys.delete(code),
    get state() { return G.state; },
    get ready() { return G.ready; },
  };
}

function installHooks() {
  Object.assign(hz, {
    world: G.world, gameRenderer: G.gr, player: G.player, camera: G.gr.camera, interaction: G.interaction, controls: G.controls, autoQuality: G.aq, ui,
    setQuality: (name) => { settings.quality = name; saveSettings(settings); G.aq.setMode(name); ui.syncSettings(); },
    mobs: () => G.mobs, ctx: () => G.ctx, events, registry, save: () => saveNow(true), wipeSave: () => wipeSave(G.seed),
    teleport: (x, y, z) => { // high above the ground => hover (fly mode) instead of dropping
      G.player.teleport(x, y, z);
      if (y > G.world.getSurfaceY(Math.floor(x), Math.floor(z)) + 4) { G.player.flying = true; ui.setFly(true); }
    },
    lookAt: (yawDeg, pitchDeg) => { G.player.setLook(yawDeg * Math.PI / 180, pitchDeg * Math.PI / 180); },
    setTime: (h) => { G.gr.time.hours = h; },
    setWeather: (kind, instant = true) => { WX.fixed = true; applyWeather(kind, instant); },
    screenshotReady: () => hz.ready && G.frames > 3,
    stats: () => ({ fps: G.fps, cpuMs: G.cpuMs, frames: G.frames, state: G.state, pos: [G.player.x, G.player.y, G.player.z], onGround: G.player.onGround, frozen: G.player.frozen,
      quality: G.aq.current, render: G.gr.info(), world: G.world.stats ? G.world.stats() : null, mock: { world: G.mockWorld, render: G.mockRender } }),
  });
}

requestAnimationFrame(frame);
loadTextures();
if (P.autostart) { audio.setMuted(true); startGame(settings.seed); }
