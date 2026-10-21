// WORLD dev harness: fly-camera autopilot over the streamed world with debug materials.
import * as THREE from 'three';
import { World } from '../World.js';
import { getPreset } from '../../shared/quality.js';
import { createDebugMaterials } from './debugMaterials.js';

const P = new URLSearchParams(location.search);
const num = (k, d) => (P.has(k) ? +P.get(k) : d);
const seed = num('seed', 1337);
const preset = Object.assign({}, getPreset(P.get('quality') || 'medium'));
if (P.has('vd')) preset.viewDistance = num('vd', preset.viewDistance);
if (P.has('workers')) preset.workers = num('workers', preset.workers);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(innerWidth, innerHeight);
const scene = new THREE.Scene();
const mats = createDebugMaterials({ lodTint: P.get('lodtint') === '1', viewDistance: preset.viewDistance });
scene.background = mats.fogColor;
const camera = new THREE.PerspectiveCamera(num('fov', 70), innerWidth / innerHeight, 0.3, 24000);
let world = new World({ seed, scene, materials: mats, quality: preset, onProgress: () => {} });
let yaw = num('yaw', 0) * Math.PI / 180, pitch = num('pitch', -15) * Math.PI / 180;
const speed = num('speed', 0), auto = P.get('auto') !== '0', turn = num('turn', 0);
const cp = camera.position;
cp.set(num('x', 0), 0, num('z', 0));
const alt = P.has('y') ? num('y', 120) : null;
cp.y = alt ?? world.getSurfaceY(cp.x, cp.z) + 6;
let frames = 0, idle = 0, last = performance.now();
const hud = document.getElementById('hud');
window.__world = world; window.__camera = camera; window.__devReady = false;
window.__worldStats = () => Object.assign({ frames, x: cp.x, y: cp.y, z: cp.z, ready: world.isReady(), calls: renderer.info.render.calls, rtris: renderer.info.render.triangles, geoms: renderer.info.memory.geometries, kids: world.group.children.length, sceneKids: scene.children.length }, world.stats());
window.__dev = {
  teleport(x, y, z, yw, pt) { cp.set(x, y, z); if (yw != null) yaw = yw * Math.PI / 180; if (pt != null) pitch = pt * Math.PI / 180; idle = 0; window.__devReady = false; },
  setQuality(name) { world.setQuality(getPreset(name)); idle = 0; window.__devReady = false; },
  /** dispose the world and build a fresh one with another seed (leak test) */
  reseed(sd, q) { world.dispose(); world = new World({ seed: sd, scene, materials: mats, quality: q ? getPreset(q) : preset }); window.__world = world; idle = 0; window.__devReady = false; },
  renderer, scene,
};
function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000); last = t;
  if (auto && speed) {
    yaw += turn * dt;
    cp.x += -Math.sin(yaw) * speed * dt; cp.z += -Math.cos(yaw) * speed * dt;
    if (alt === null) cp.y = Math.max(cp.y * 0.95 + (world.getSurfaceY(cp.x, cp.z) + 8) * 0.05, world.getSurfaceY(cp.x, cp.z) + 2);
  }
  camera.rotation.set(pitch, yaw, 0, 'YXZ'); camera.updateMatrixWorld();
  world.update(camera, dt);
  renderer.render(scene, camera);
  frames++;
  const s = world.stats();
  const quiet = s.chunkQueue + s.lodQueue === 0 && s.workersBusy === 0 && world.results.length === 0;
  idle = quiet && world.isReady() ? idle + 1 : 0;
  if (idle > 6) window.__devReady = true;
  if (frames % 10 === 0) hud.textContent = `pos ${cp.x.toFixed(0)} ${cp.y.toFixed(0)} ${cp.z.toFixed(0)}  chunks ${s.chunks}+${s.chunkQueue}q lod ${s.lodTiles}+${s.lodQueue}q tris ${s.tris} gen ${s.genMsAvg.toFixed(1)} mesh ${s.meshMsAvg.toFixed(1)} lod ${s.lodMsAvg.toFixed(1)} calls ${renderer.info.render.calls}`;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
