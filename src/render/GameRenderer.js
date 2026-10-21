import * as THREE from 'three';
import { getPreset } from '../shared/quality.js';
import { TimeOfDay } from './TimeOfDay.js';
import { Sky } from './Sky.js';
import { createBlockTextureArray } from './textures.js';
import { createMaterials, updateMaterialQuality } from './materials.js';
import { ShadowPass } from './ShadowPass.js';
import { PostFX } from './PostFX.js';
import { Hand } from './Hand.js';
import { Precip } from './Precip.js';
import { Mobs } from './Mobs.js';

const U = (v) => ({ value: v });

/** Top-level renderer facade (CONTRACT §4a). */
export class GameRenderer {
  /** @param {{canvas: HTMLCanvasElement, quality?: string|object}} opts */
  constructor({ canvas, quality = 'medium' }) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    this.renderer.info.autoReset = false;
    this.renderer.autoClear = true;
    this.renderer.setClearColor(0x000000, 1);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.3, 24000);
    this.camera.layers.enable(2); this.camera.layers.enable(4);   // 2 = water (drawn after the opaque pass when SSR is on), 4 = overlay (rain, hand)
    this.time = new TimeOfDay();
    const t = this.time;
    this.shared = {
      uTime: U(0), uSunDir: U(t.sunDir), uMoonDir: U(t.moonDir), uKeyDir: U(t.keyDir), uKeyColor: U(t.keyColor),
      uAmbSky: U(t.ambSky), uAmbGround: U(t.ambGround), uZenith: U(t.zenith), uHorizon: U(t.horizon), uSunGlow: U(t.sunGlow),
      uSkyP: U(t.skyP), uFogP: U(new THREE.Vector4(1 / 640, 0.35, 0, 80)), uWaterFog: U(t.waterFog),
      uWorldOffset: U(new THREE.Vector2()), uWind: U(new THREE.Vector3(1, 0, 0)), uStarRot: U(t.starRot),
      uCloudP: U(new THREE.Vector4(0.5, 380, 0, 0)), uHeld: U(new THREE.Vector4(0, 0, 0, 0)), uWeather: U(new THREE.Vector4(0, 0, 0, 0)), uFade: U(1),
      tSceneColor: U(null), tSceneDepth: U(null), uProjP: U(new THREE.Vector4(1, 1, 0.3, 24000)), uInvRes: U(new THREE.Vector2(1, 1)),
      uShadowMap: U(null), uShadowMatrix: U(new THREE.Matrix4()), uShadowP: U(new THREE.Vector4(0.15, 1 / 2048, 1, 0)),
    };
    this.tiles = createBlockTextureArray();
    this.hand = new Hand(this.shared, this.tiles);   // first-person held block (parented to the camera)
    this.camera.add(this.hand.root); this.scene.add(this.camera);
    this.hand.root.traverse((o) => o.layers.set(4));
    const q0 = typeof quality === 'string' ? getPreset(quality) : quality;
    this.quality = q0;
    this.materials = createMaterials(this.tiles, this.shared, q0, false);
    this.sky = new Sky(this.shared);
    this.scene.add(this.sky.mesh);
    this.precip = new Precip(this.shared); this.scene.add(this.precip.group); this.precip.group.traverse((o) => o.layers.set(4));
    this.mobs = new Mobs(this.shared, 64); this.scene.add(this.mobs.group);   // animals (4 instanced draw calls)
    this._wx = { type: 'rain', target: 0, cur: 0, storm: false, cover: 0, flashT: -1, nextFlash: 6 };
    /** Called when lightning strikes: (delaySeconds, strength 0..1) so the game can schedule thunder audio. */
    this.onThunder = null;
    this.shadow = null; this.post = null;
    this.renderScale = q0.renderScale; this._appliedScale = -1; this._sizeKey = '';
    this.cssW = canvas.clientWidth || 1280; this.cssH = canvas.clientHeight || 720;
    this._under = 0; this._underTarget = 0; this._held = { on: true, k: 1, r: 16, cur: 0 }; this._fps = 0; this._wind = true;
    const ext = this.renderer.extensions;
    this.floatOK = !!(ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float'));
    this.setQuality(q0);
    this.warmup().catch(() => {});
  }

  /** @param {string|object} nameOrPreset */
  setQuality(nameOrPreset) {
    const q = typeof nameOrPreset === 'string' ? getPreset(nameOrPreset) : nameOrPreset;
    this.quality = q;
    const postOn = !!(q.post && q.post.on && this.floatOK);
    const shadowsOn = !!(q.shadows && q.shadows.on);
    this.shared.uFogP.value.x = 1 / (q.viewDistance * 0.92);
    this.shared.uWind.value.x = q.wind ? 1 : 0;
    if (shadowsOn) { if (!this.shadow) this.shadow = new ShadowPass(this.shared, this.materials.solid.uniforms.uTiles); this.shadow.setQuality(q.shadows); }
    else if (this.shadow) { this.shadow.dispose(); this.shadow = null; this.shared.uShadowMap.value = null; }
    if (postOn) { if (!this.post) this.post = new PostFX(this.renderer, this.shared); this.post.setQuality(q.post); }
    else if (this.post) { this.post.dispose(); this.post = null; }
    const ssrOn = postOn && !!q.post.ssr;
    updateMaterialQuality(this.materials, q, postOn, shadowsOn, ssrOn);
    this.hand.setPost(postOn);
    this.precip.setPost(postOn); this.precip.setCount(q.precip || 0); this.mobs.setPost(postOn);
    this.sky.setQuality(q, !postOn);
    this.setRenderScale(q.renderScale, this._appliedScale < 0);
  }

  /** @param {number} s multiplier on min(devicePixelRatio,2) */
  setRenderScale(s, force = false) {
    s = Math.min(1.25, Math.max(0.3, s));
    this.renderScale = s;
    if (!force && Math.abs(s - this._appliedScale) < 0.05) return;
    this._appliedScale = s;
    this._applySize();
  }

  _applySize() {
    const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2) * this._appliedScale;
    const key = dpr + ':' + this.cssW + ':' + this.cssH;
    if (key === this._sizeKey) return;
    this._sizeKey = key;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.cssW, this.cssH, false);
    this.camera.aspect = this.cssW / Math.max(1, this.cssH);
    this.camera.updateProjectionMatrix();
    if (this.post) { const v = this.renderer.getDrawingBufferSize(new THREE.Vector2()); this.post.setSize(v.x, v.y); }
  }

  /** @param {number} w CSS px @param {number} h CSS px */
  resize(w, h) { this.cssW = Math.max(1, w | 0); this.cssH = Math.max(1, h | 0); this._applySize(); }

  /**
   * Handheld light that follows the camera (caves, night). k = intensity multiplier (e.g. holding glowstone), r = radius in blocks.
   * @param {boolean} on @param {number} [k] @param {number} [r]
   */
  setHeldLight(on, k = 1, r = 16) { const h = this._held; h.on = !!on; h.k = k; h.r = r; }

  /**
   * Weather: 'clear' | 'rain' | 'snow'. intensity 0..1, storm = rain with lightning. Ramps smoothly (~4 s).
   * @param {string} type @param {number} [intensity] @param {boolean} [storm]
   */
  setWeather(type, intensity = 1, storm = false) {
    const w = this._wx;
    if (type === 'clear') { w.target = 0; w.storm = false; return; }
    w.type = type; w.target = Math.max(0, Math.min(1, intensity)); w.storm = !!storm && type === 'rain';
  }
  /** Ambient life strengths 0..1: falling petals (cherry grove) and fireflies (night). Particle counts follow the quality preset. */
  setAmbient(petals, fireflies) { this.precip.setAmbient(petals, fireflies); }
  /** 0..1: how roofed-over the camera is (no precipitation indoors / underground). */
  setWeatherCover(c) { this._wx.cover = c; }
  /** @returns {{type:string, amount:number, storm:boolean}} current (smoothed) weather */
  getWeather() { const w = this._wx; return { type: w.target > 0 || w.cur > 0.02 ? w.type : 'clear', amount: w.cur, storm: w.storm }; }

  /** Photo mode: depth of field (needs a post tier). @returns {boolean} whether DOF is available */
  setPhoto(on, focus, aperture) { if (this.hand) this.hand.root.visible = !on; if (!this.post) return false; this.post.setDof(on, focus, aperture); return true; }

  /** @param {boolean} on */
  setUnderwater(on) { this._underTarget = on ? 1 : 0; }

  /** Compiles every material variant of the current quality (call behind the loading screen). @returns {Promise<void>} */
  warmup() {
    const s = new THREE.Scene(), g = new THREE.BufferGeometry();
    for (const m of Object.values(this.materials)) s.add(new THREE.Mesh(g, m));
    s.add(new THREE.Mesh(g, this.hand.material));
    s.add(new THREE.Mesh(g, this.mobs.material));
    s.add(this.sky.mesh.clone());
    const r = this.renderer;
    if (r.extensions.has('KHR_parallel_shader_compile')) return r.compileAsync(s, this.camera).then(() => {});
    r.compile(s, this.camera);
    return Promise.resolve();
  }

  /** @param {number} dt seconds */
  update(dt) {
    const sh = this.shared, cam = this.camera.position, t = this.time;
    t.update(dt);
    sh.uTime.value += dt;
    sh.uWind.value.y = sh.uTime.value;
    sh.uWorldOffset.value.set(((cam.x % 4096) + 4096) % 4096, ((cam.z % 4096) + 4096) % 4096);
    this._under += (this._underTarget - this._under) * Math.min(1, dt * 10);
    if (Math.abs(this._under - this._underTarget) < 0.01) this._under = this._underTarget;
    sh.uFogP.value.z = this._under; sh.uFogP.value.w = cam.y;
    sh.uCloudP.value.x = 0.5 + 0.05 * Math.sin(sh.uTime.value * 0.01);
    { const hh = t.hours; sh.uCloudP.value.z = Math.exp(-(((hh - 6.4) / 1.05) ** 2)) + 0.45 * Math.exp(-(((hh - 19.7) / 0.9) ** 2)); }   // dawn mist pooling in valleys, soft evening haze
    if (dt > 0) this._fps += (1 / dt - this._fps) * 0.05;
    if (this.post) this.post.setUnderwater(this._under);
    const wx = this._wx;
    wx.cur += (wx.target - wx.cur) * Math.min(1, dt * 0.45);
    if (Math.abs(wx.cur - wx.target) < 0.004) wx.cur = wx.target;
    if (wx.storm && wx.cur > 0.6) {
      wx.nextFlash -= dt;
      if (wx.nextFlash <= 0) { wx.flashT = 0; wx.nextFlash = 5 + Math.random() * 14; if (this.onThunder) this.onThunder(0.35 + Math.random() * 3.2, 0.5 + Math.random() * 0.5); }
    }
    let flash = 0;
    if (wx.flashT >= 0) { wx.flashT += dt; const t = wx.flashT; flash = Math.min(1, Math.exp(-t * 10) + (t > 0.16 ? 0.8 * Math.exp(-(t - 0.16) * 9) : 0)); if (t > 1.4) wx.flashT = -1; }
    // snow cover builds while it snows and melts away slowly afterwards (0..1)
    wx.snow = Math.max(0, Math.min(1, (wx.snow || 0) + (wx.type === 'snow' && wx.cur > 0.3 ? wx.cur * dt * 0.025 : -dt * 0.012)));
    // rainbow: appears when real rain eases off while the sun is up and not too high, lingers about a minute, then fades
    if (wx.type === 'rain' && wx.cur > 0.45) wx.arm = true;
    const sunEl = t.sunDir.y;
    if (wx.arm && wx.target === 0 && wx.cur < 0.3 && sunEl > 0.06 && sunEl < 0.62) { wx.bow = Math.min(1, (wx.bow || 0) + dt * 0.12); wx.bowT = 0; if (wx.bow >= 1) wx.arm = false; }
    else if (wx.bow > 0) { wx.bowT = (wx.bowT || 0) + dt; if (wx.bowT > 70 || sunEl < 0.03 || wx.cur > 0.5) wx.bow = Math.max(0, wx.bow - dt * 0.03); }
    sh.uWeather.value.set(wx.cur * (wx.type === 'snow' ? 0.72 : 1) * (wx.storm ? 1.12 : 1), flash * (1 - wx.cover * 0.7), wx.snow, wx.bow || 0);
    this.precip.update(dt, cam, wx.type, wx.cur * (1 - wx.cover * 0.97));
    this.precip.updateAmbient(dt, cam);
    const h = this._held; h.cur += ((h.on ? 1 : 0) - h.cur) * Math.min(1, dt * 6);
    const fl = 1 + 0.045 * Math.sin(sh.uTime.value * 9.3) * Math.sin(sh.uTime.value * 5.1 + 1.7); // subtle torch flicker
    const v = sh.uHeld.value, k = h.cur * h.k * fl;
    v.set(1.0 * 1.12 * k, 0.68 * 1.12 * k, 0.38 * 1.12 * k, h.cur > 0.002 ? 1 / h.r : 0);
  }

  /** @param {{getShadowCasters?: Function}|null} world */
  render(world) {
    const r = this.renderer;
    r.info.reset();
    if (this.shadow) this.shadow.render(r, this.scene, world, this.camera, this.time);
    if (this.post) this.post.render(r, this.scene, this.camera, this.time);
    else { r.setRenderTarget(null); r.render(this.scene, this.camera); }
  }

  /** @returns {{calls:number,triangles:number,geometries:number,textures:number,renderScale:number,quality:object,fps:number}} */
  info() {
    const i = this.renderer.info;
    return { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, renderScale: this._appliedScale, quality: this.quality, fps: this._fps };
  }

  dispose() {
    if (this.shadow) this.shadow.dispose();
    if (this.post) this.post.dispose();
    this.tiles.dispose();
    for (const m of Object.values(this.materials)) m.dispose();
    this.hand.material.dispose(); this.precip.dispose(); this.mobs.dispose();
    this.renderer.dispose();
  }
}
