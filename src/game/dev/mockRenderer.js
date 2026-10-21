// Mock GameRenderer (§4a API): plain WebGLRenderer + sky colour + fog. Used by ?mock=1 / ?mock=render for independent testing.
import * as THREE from 'three';
import { getPreset } from '../../shared/quality.js';

const DAY = new THREE.Color(0x8cc4ff), DUSK = new THREE.Color(0xff9a62), NIGHT = new THREE.Color(0x070b1e), UNDER = new THREE.Color(0x1a4f9a);

export class MockRenderer {
  constructor({ canvas, quality = 'medium' }) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.3, 24000);
    this.scene.background = new THREE.Color(DAY); this.scene.fog = new THREE.Fog(DAY.getHex(), 40, 300);
    this.time = { hours: 9, speed: 0.02, paused: false, sunDir: new THREE.Vector3(0, 1, 0), moonDir: new THREE.Vector3(0, -1, 0), isNight: false };
    this.materials = { solid: new THREE.MeshBasicMaterial({ color: 0x889988 }), water: new THREE.MeshBasicMaterial({ color: 0x3060c0, transparent: true, opacity: 0.6 }), lodSolid: new THREE.MeshBasicMaterial({ color: 0x778877 }), lodWater: new THREE.MeshBasicMaterial({ color: 0x3060c0 }) };
    this._w = 1; this._h = 1; this._scale = 1; this._under = false; this._tmp = new THREE.Color();
    this.setQuality(quality);
  }
  setQuality(q) { const p = typeof q === 'string' ? getPreset(q) : q; this.quality = p; this.scene.fog.far = Math.min(p.viewDistance, 700); this.scene.fog.near = this.scene.fog.far * 0.2; this.setRenderScale(p.renderScale); }
  setRenderScale(s) { this._scale = Math.max(0.3, Math.min(1, s)); this._apply(); }
  setUnderwater(b) { this._under = !!b; }
  resize(w, h) { this._w = w; this._h = h; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); this._apply(); }
  _apply() { this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * this._scale); this.renderer.setSize(this._w, this._h, false); }
  update(dt) {
    const t = this.time;
    if (!t.paused) t.hours = (t.hours + t.speed * dt) % 24;
    const a = (t.hours - 6) / 12 * Math.PI;
    t.sunDir.set(Math.cos(a) * 0.8, Math.sin(a), 0.4).normalize(); t.moonDir.copy(t.sunDir).negate(); t.isNight = t.sunDir.y < -0.08;
    const el = t.sunDir.y, c = this._tmp;
    if (el > 0.25) c.copy(DAY); else if (el > 0) c.copy(DUSK).lerp(DAY, el / 0.25); else c.copy(DUSK).lerp(NIGHT, Math.min(1, -el / 0.25));
    if (this._under) c.copy(UNDER);
    this.scene.background.copy(c); this.scene.fog.color.copy(c);
    this.scene.fog.far = this._under ? 40 : Math.min(this.quality.viewDistance, 700);
  }
  render() { this.renderer.render(this.scene, this.camera); }
  info() { const i = this.renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, renderScale: this._scale, quality: this.quality.label || 'custom' }; }
  dispose() { this.renderer.dispose(); }
}
