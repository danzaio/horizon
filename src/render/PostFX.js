import * as THREE from 'three';
import { FS_VS, BLOOM_DOWN_FS, BLOOM_UP_FS, RAYS_FS, COMPOSITE_FS, FXAA_FS, SSAO_FS, SSAO_BLUR_FS, COPY_FS, TAA_FS, VOL_FS, LUM_FS, EXPO_FS } from './shaders/post.js';

const _v = new THREE.Vector4();

/** HDR scene RT -> dual-filter bloom + god rays -> ACES composite (+ FXAA). */
export class PostFX {
  /** @param {THREE.WebGLRenderer} renderer @param {object} shared */
  constructor(renderer, shared) {
    this.shared = shared; this.opt = { bloom: true, godrays: true, fxaa: true, ssao: false, ssr: false, taa: false, vol: false, exp: false, flare: false, cine: false, mb: false };
    this.expIdx = 0; this.expFirst = true; this._expT = 0;
    this.dof = { on: false, focus: 20, aperture: 3 };
    this.fxaaOn = true; this.hist = [null, null]; this.hi = 0; this.frameN = 0; this.taaValid = false;
    this._prevVP = new THREE.Matrix4(); this._prevPos = new THREE.Vector3(); this._vp = new THREE.Matrix4(); this._v = new THREE.Matrix4(); this._p1 = new THREE.Matrix4(); this._delta = new THREE.Vector3();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(g, null); this.quad.frustumCulled = false;
    this.fsScene = new THREE.Scene(); this.fsScene.add(this.quad);
    this.fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mk = (fs, defs, uniforms, extra) => new THREE.ShaderMaterial(Object.assign({ vertexShader: FS_VS, fragmentShader: fs, defines: defs || {}, uniforms, depthTest: false, depthWrite: false }, extra));
    this.downPre = mk(BLOOM_DOWN_FS, { PREFILTER: 1 }, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThresh: { value: new THREE.Vector4(1.0, 0.5, 0, 0) } });
    this.down = mk(BLOOM_DOWN_FS, {}, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uThresh: { value: new THREE.Vector4() } });
    this.up = mk(BLOOM_UP_FS, {}, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 1 } }, { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    this.rays = mk(RAYS_FS, {}, { tDepth: { value: null }, uSun: { value: new THREE.Vector2() }, uColor: { value: new THREE.Vector3() }, uAspect: { value: 1 } });
    this.comp = mk(COMPOSITE_FS, {}, { tScene: { value: null }, tBloom: { value: null }, tRays: { value: null }, tAO: { value: null }, tExp: { value: null }, tDepth: { value: null }, uFlare: { value: new THREE.Vector4() }, uMb: { value: new THREE.Vector2(0.5, 0) }, uNF: { value: new THREE.Vector2(0.3, 24000) }, uDof: { value: new THREE.Vector4(20, 3, 0, 16) }, uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uDelta: { value: new THREE.Vector3() }, tVol: { value: null }, uVolTexel: { value: new THREE.Vector2() }, uP: { value: new THREE.Vector4(1, 0.6, 0.8, 0) }, uRes: { value: new THREE.Vector2() }, uTime: shared.uTime });
    this.ssao = mk(SSAO_FS, {}, { tDepth: { value: null }, uProj: { value: new THREE.Vector2() }, uNF: { value: new THREE.Vector2() }, uRes: { value: new THREE.Vector2() }, uRadius: { value: 1.3 }, uTime: shared.uTime });
    this.ssaoBlur = mk(SSAO_BLUR_FS, {}, { tAO: { value: null }, tDepth: { value: null }, uTexel: { value: new THREE.Vector2() }, uNF: { value: new THREE.Vector2() } });
    this.taa = mk(TAA_FS, {}, { tCur: { value: null }, tHist: { value: null }, tDepth: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uDelta: { value: new THREE.Vector3() }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 1 }, uNF: { value: new THREE.Vector2(0.3, 24000) } });
    this.vol = mk(VOL_FS, {}, { tDepth: { value: null }, tShadow: { value: null }, uInvVP: { value: new THREE.Matrix4() }, uShadowMatrix: shared.uShadowMatrix, uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Vector3() }, uVolP: { value: new THREE.Vector4(0.02, 70, 0, 0) }, uRes: { value: new THREE.Vector2() } });
    this.volRT = null;
    this.lum = mk(LUM_FS, {}, { tSrc: { value: null }, uStep: { value: new THREE.Vector2() } });
    this.expo = mk(EXPO_FS, {}, { tLum: { value: null }, tPrev: { value: null }, uP: { value: new THREE.Vector4(1, 0.016, 1, 0.55) } });
    this.lumRT = null; this.expRT = [null, null];
    this.copy = mk(COPY_FS, {}, { tColor: { value: null }, tDepth: { value: null } }, { depthTest: true, depthFunc: THREE.AlwaysDepth, depthWrite: true });
    this.sceneRT2 = null; this.finalRT = null;
    this.aoRT = null; this.aoRT2 = null;
    this.fxaa = mk(FXAA_FS, {}, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.sceneRT = null; this.mips = []; this.raysRT = null; this.ldrRT = null;
    this.w = 0; this.h = 0; this.under = 0;
    this.sun = new THREE.Vector3(); this.raysOn = false;
  }
  /** @param {{bloom:boolean,godrays:boolean,fxaa:boolean}} o */
  setQuality(o) {
    const same = o.bloom === this.opt.bloom && o.godrays === this.opt.godrays && o.fxaa === this.opt.fxaa && !!o.ssao === !!this.opt.ssao && !!o.ssr === !!this.opt.ssr && !!o.taa === !!this.opt.taa && !!o.vol === !!this.opt.vol && !!o.exp === !!this.opt.exp && !!o.flare === !!this.opt.flare && !!o.cine === !!this.opt.cine && !!o.mb === !!this.opt.mb && this.sceneRT;
    this.opt = o; this.fxaaOn = !!o.fxaa && !o.taa;
    const d = this.comp.defines, want = { BLOOM: o.bloom ? 1 : undefined, RAYS: o.godrays ? 1 : undefined, FXAA: this.fxaaOn ? 1 : undefined, SSAO: o.ssao ? 1 : undefined, VOLUMETRIC: o.vol ? 1 : undefined, AUTOEXP: o.exp ? 1 : undefined, DOF: 1, FLARE: o.flare ? 1 : undefined, CINE: o.cine ? 1 : undefined, MBLUR: o.mb ? 1 : undefined };
    let ch = false;
    for (const k in want) if ((d[k] !== undefined) !== (want[k] !== undefined)) { if (want[k]) d[k] = 1; else delete d[k]; ch = true; }
    if (ch) this.comp.needsUpdate = true;
    if (this.w && !same) this.setSize(this.w, this.h, true);
  }
  setUnderwater(v) { this.under = v; }
  /** photo-mode depth of field: focus distance in blocks, aperture strength */
  setDof(on, focus, aperture) { this.dof.on = on; if (focus) this.dof.focus = focus; if (aperture) this.dof.aperture = aperture; }
  setSize(w, h, force) {
    if (!force && w === this.w && h === this.h) return;
    this.w = w; this.h = h; this._free();
    const rt = (x, y, depth) => new THREE.WebGLRenderTarget(Math.max(1, x | 0), Math.max(1, y | 0), { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: !!depth, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.sceneRT = rt(w, h, true);
    this.sceneRT.depthTexture = new THREE.DepthTexture(w, h);
    this.sceneRT.depthTexture.minFilter = this.sceneRT.depthTexture.magFilter = THREE.NearestFilter;
    if (this.opt.ssr) { this.sceneRT2 = rt(w, h, true); this.sceneRT2.depthTexture = new THREE.DepthTexture(w, h); this.sceneRT2.depthTexture.minFilter = this.sceneRT2.depthTexture.magFilter = THREE.NearestFilter; }   // water + overlay pass target
    if (this.opt.vol) this.volRT = rt(w >> 1, h >> 1);
    if (this.opt.exp) { this.lumRT = rt(64, 36); this.expRT = [rt(1, 1), rt(1, 1)]; this.expFirst = true; }
    if (this.opt.taa) { this.hist[0] = rt(w, h, false); this.hist[1] = rt(w, h, false); this.taaValid = false; }
    if (this.opt.bloom) { let mw = w >> 1, mh = h >> 1; for (let i = 0; i < 4; i++) { this.mips.push(rt(mw, mh)); mw >>= 1; mh >>= 1; } }
    if (this.opt.godrays) this.raysRT = rt(w >> 2, h >> 2);
    if (this.opt.ssao) { const ao = (x, y) => new THREE.WebGLRenderTarget(Math.max(1, x | 0), Math.max(1, y | 0), { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false }); this.aoRT = ao(w >> 1, h >> 1); this.aoRT2 = ao(w >> 1, h >> 1); }
    if (this.fxaaOn) { this.ldrRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false }); }
  }
  _free() {
    if (this.sceneRT) { this.sceneRT.depthTexture.dispose(); this.sceneRT.dispose(); }
    for (const m of this.mips) m.dispose();
    this.mips.length = 0;
    if (this.raysRT) this.raysRT.dispose();
    if (this.ldrRT) this.ldrRT.dispose();
    if (this.aoRT) { this.aoRT.dispose(); this.aoRT2.dispose(); }
    if (this.sceneRT2) { if (this.sceneRT2.depthTexture) this.sceneRT2.depthTexture.dispose(); this.sceneRT2.dispose(); }
    for (let i = 0; i < 2; i++) if (this.hist[i]) { this.hist[i].dispose(); this.hist[i] = null; }
    if (this.volRT) { this.volRT.dispose(); this.volRT = null; }
    if (this.lumRT) { this.lumRT.dispose(); this.lumRT = null; }
    for (let i = 0; i < 2; i++) if (this.expRT[i]) { this.expRT[i].dispose(); this.expRT[i] = null; }
    this.sceneRT2 = this.finalRT = null;
    this.sceneRT = this.raysRT = this.ldrRT = this.aoRT = this.aoRT2 = null;
  }
  _pass(renderer, mat, target, clear) {
    this.quad.material = mat;
    renderer.setRenderTarget(target);
    if (clear) renderer.clear(true, false, false);
    renderer.render(this.fsScene, this.fsCam);
  }
  render(renderer, scene, camera, time) {
    if (!this.sceneRT) { const s = renderer.getDrawingBufferSize(_v2); this.setSize(s.x, s.y); }
    const o = this.opt, prevAuto = renderer.autoClear, sh = this.shared;
    const useTaa = !!(o.taa && this.hist[0]);
    camera.updateMatrixWorld(true);
    const needMat = useTaa || o.mb;
    if (needMat) {
      // unjittered matrices for reprojection (TAA + motion blur)
      camera.clearViewOffset(); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      this._p1.copy(camera.projectionMatrix); this._v.copy(camera.matrixWorldInverse).setPosition(0, 0, 0);
      this._vp.multiplyMatrices(this._p1, this._v);
    }
    if (useTaa) {
      // sub-pixel (Halton 2,3) jitter for this frame's rasterisation
      const k = this.frameN++ & 15;
      camera.setViewOffset(this.w, this.h, halton(k + 1, 2) - 0.5, halton(k + 1, 3) - 0.5, this.w, this.h);
    }
    if (o.ssr && this.sceneRT2) {
      // 1) opaque world + sky (layer 0)  2) copy colour+depth  3) water (layer 2) reading the copy  4) overlay: rain, hand (layer 4)
      const lm = camera.layers.mask;
      camera.layers.set(0);
      renderer.setRenderTarget(this.sceneRT); renderer.render(scene, camera);
      renderer.autoClear = false;
      this.copy.uniforms.tColor.value = this.sceneRT.texture; this.copy.uniforms.tDepth.value = this.sceneRT.depthTexture;
      this._pass(renderer, this.copy, this.sceneRT2, false);
      const pe = camera.projectionMatrix.elements;
      sh.tSceneColor.value = this.sceneRT.texture; sh.tSceneDepth.value = this.sceneRT.depthTexture;
      sh.uProjP.value.set(pe[0], pe[5], camera.near, camera.far); sh.uInvRes.value.set(1 / this.w, 1 / this.h);
      renderer.setRenderTarget(this.sceneRT2);
      camera.layers.set(2); renderer.render(scene, camera);
      camera.layers.set(4); renderer.render(scene, camera);
      camera.layers.mask = lm;
      this.finalRT = this.sceneRT2;
    } else {
      renderer.setRenderTarget(this.sceneRT);
      renderer.render(scene, camera);
      renderer.autoClear = false;
      this.finalRT = this.sceneRT;
    }
    if (o.ssao && this.aoRT) {
      const pe = camera.projectionMatrix.elements, su = this.ssao.uniforms;
      su.tDepth.value = this.sceneRT.depthTexture; su.uProj.value.set(pe[0], pe[5]); su.uNF.value.set(camera.near, camera.far); su.uRes.value.set(this.w, this.h);
      this._pass(renderer, this.ssao, this.aoRT, false);
      const bu = this.ssaoBlur.uniforms;
      bu.tAO.value = this.aoRT.texture; bu.tDepth.value = this.sceneRT.depthTexture; bu.uTexel.value.set(1 / this.aoRT.width, 1 / this.aoRT.height); bu.uNF.value.set(camera.near, camera.far);
      this._pass(renderer, this.ssaoBlur, this.aoRT2, false);
    }
    let sceneTex = this.finalRT.texture;
    if (useTaa) {
      camera.clearViewOffset(); camera.updateProjectionMatrix();
      const tu = this.taa.uniforms, cur = this.hi, prev = cur ^ 1;
      tu.uInvVP.value.copy(this._vp).invert();
      tu.uPrevVP.value.copy(this._prevVP);
      this._delta.copy(camera.position).sub(this._prevPos); tu.uDelta.value.copy(this._delta);
      tu.tCur.value = this.finalRT.texture; tu.tHist.value = this.hist[prev].texture; tu.tDepth.value = this.finalRT.depthTexture;
      tu.uNF.value.set(camera.near, camera.far); tu.uTexel.value.set(1 / this.w, 1 / this.h); tu.uFirst.value = this.taaValid ? 0 : 1;
      this._pass(renderer, this.taa, this.hist[cur], false);
      this.taaValid = true; sceneTex = this.hist[cur].texture; this.hi = prev;
    }
    let volOn = false;
    if (o.vol && this.volRT && this.shared.uShadowMap.value && this.shared.uShadowP.value.z > 0.02 && time.sunUp > 0.04) {
      const vu = this.vol.uniforms;
      this._v.copy(camera.matrixWorldInverse).setPosition(0, 0, 0);
      vu.uInvVP.value.multiplyMatrices(camera.projectionMatrix, this._v).invert();
      vu.tDepth.value = this.finalRT.depthTexture; vu.tShadow.value = this.shared.uShadowMap.value;
      vu.uSunDir.value.copy(time.sunDir); vu.uSunColor.value.set(time.sunGlow.x, time.sunGlow.y, time.sunGlow.z).multiplyScalar(0.9 * time.sunUp * (1.0 - this.under) * (1.0 - 0.92 * Math.min(1, this.shared.uWeather.value.x * 1.25)));   // overcast: no sun, no shafts
      vu.uVolP.value.set(0.026, Math.min(70, this.shared.uShadowP.value.w || 70), camera.position.y, this.shared.uTime.value);
      vu.uRes.value.set(this.w, this.h);
      this._pass(renderer, this.vol, this.volRT, false);
      volOn = true;
    }
    let expOn = false;
    if (o.exp && this.lumRT && this.expRT[0]) {
      const now = performance.now(), dt = Math.min(0.1, Math.max(0.001, (now - (this._expT || now)) / 1000)); this._expT = now;
      this.lum.uniforms.tSrc.value = sceneTex; this.lum.uniforms.uStep.value.set(1 / 64 / 6, 1 / 36 / 6);
      this._pass(renderer, this.lum, this.lumRT, false);
      const eu = this.expo.uniforms, cur = this.expIdx, prev = cur ^ 1;
      eu.tLum.value = this.lumRT.texture; eu.tPrev.value = this.expRT[prev].texture;
      eu.uP.value.set(time.skyP.z * (this.under > 0.5 ? 0.6 : 1.0), dt, this.expFirst ? 1 : 0, 0.55);
      this._pass(renderer, this.expo, this.expRT[cur], false);
      this.expFirst = false; this.expIdx = prev; expOn = true;
      this._expTex = this.expRT[cur].texture;
    }
    if (o.bloom && this.mips.length) {
      const m = this.mips;
      this.downPre.uniforms.tSrc.value = sceneTex;
      this.downPre.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
      this.downPre.uniforms.uThresh.value.set(0.95 / time.skyP.z, 0.5 / time.skyP.z, 0, 0);
      this._pass(renderer, this.downPre, m[0], false);
      for (let i = 1; i < 4; i++) {
        this.down.uniforms.tSrc.value = m[i - 1].texture;
        this.down.uniforms.uTexel.value.set(1 / m[i - 1].width, 1 / m[i - 1].height);
        this._pass(renderer, this.down, m[i], false);
      }
      for (let i = 3; i > 0; i--) {
        this.up.uniforms.tSrc.value = m[i].texture;
        this.up.uniforms.uTexel.value.set(1 / m[i].width, 1 / m[i].height);
        this.up.uniforms.uWeight.value = 1.0;
        this._pass(renderer, this.up, m[i - 1], false);
      }
    }
    let raysAmt = 0;
    if (o.godrays && this.raysRT && !volOn && time.sunUp > 0.05 && this.under < 0.5) {
      _s.copy(time.sunDir).transformDirection(camera.matrixWorldInverse).multiplyScalar(1000);
      _s4.set(_s.x, _s.y, _s.z, 1).applyMatrix4(camera.projectionMatrix);
      if (_s4.w > 0.01) {
        const sx = _s4.x / _s4.w * 0.5 + 0.5, sy = _s4.y / _s4.w * 0.5 + 0.5;
        const edge = Math.max(0, 1 - Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5)) * 1.1);
        raysAmt = Math.min(1, edge * 1.4) * time.sunUp;
        if (raysAmt > 0.01) {
          const u = this.rays.uniforms;
          u.tDepth.value = this.sceneRT.depthTexture; u.uSun.value.set(sx, sy); u.uAspect.value = this.w / this.h;
          u.uColor.value.set(time.sunGlow.x, time.sunGlow.y, time.sunGlow.z);
          this._pass(renderer, this.rays, this.raysRT, false);
        } else raysAmt = 0;
      }
    }
    const cu = this.comp.uniforms;
    cu.tScene.value = sceneTex;
    cu.tBloom.value = this.mips.length ? this.mips[0].texture : null;
    cu.tRays.value = this.raysRT ? this.raysRT.texture : null;
    cu.tAO.value = this.aoRT2 ? this.aoRT2.texture : null;
    cu.tExp.value = expOn ? this._expTex : null;
    cu.tVol.value = volOn ? this.volRT.texture : null; cu.uVolTexel.value.set(1.2 / this.w, 1.2 / this.h);
    cu.uP.value.set(time.skyP.z, 0.4 + 0.3 * time.skyP.x, raysAmt * 0.9, this.under);
    cu.tDepth.value = this.finalRT.depthTexture; cu.uNF.value.set(camera.near, camera.far);
    cu.uDof.value.set(this.dof.focus, this.dof.aperture, this.dof.on ? 1 : 0, 18 * Math.max(0.5, this.h / 720));
    if (o.flare) {
      _s.copy(time.sunDir).transformDirection(camera.matrixWorldInverse).multiplyScalar(1000);
      _s4.set(_s.x, _s.y, _s.z, 1).applyMatrix4(camera.projectionMatrix);
      let f = 0;
      if (_s4.w > 0.01 && time.sunUp > 0.05 && this.under < 0.5) {
        const sx = _s4.x / _s4.w * 0.5 + 0.5, sy = _s4.y / _s4.w * 0.5 + 0.5;
        const edge = Math.max(0, 1 - Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5)) * 1.7);
        f = Math.min(1, edge * 1.5) * time.sunUp * (1 - this.shared.uWeather.value.x);
        cu.uFlare.value.set(sx, sy, f, this.w / this.h);
      } else cu.uFlare.value.z = 0;
    }
    if (o.mb) {
      const haveMat = this._prevVP.elements[0] !== 1 || this._prevVP.elements[5] !== 1 || this._prevPos.lengthSq() > 0;
      cu.uInvVP.value.copy(this._vp).invert(); cu.uPrevVP.value.copy(this._prevVP);
      this._delta.copy(camera.position).sub(this._prevPos); cu.uDelta.value.copy(this._delta);
      cu.uNF.value.set(camera.near, camera.far);
      cu.uMb.value.set(0.6, haveMat && this.taaValid !== false ? 1 : 0);
    }
    cu.uRes.value.set(this.w, this.h);
    if (this.fxaaOn && this.ldrRT) {
      this._pass(renderer, this.comp, this.ldrRT, false);
      this.fxaa.uniforms.tSrc.value = this.ldrRT.texture;
      this.fxaa.uniforms.uTexel.value.set(1 / this.w, 1 / this.h);
      this._pass(renderer, this.fxaa, null, false);
    } else this._pass(renderer, this.comp, null, false);
    if (needMat) { this._prevVP.copy(this._vp); this._prevPos.copy(camera.position); if (!o.taa) this.taaValid = true; }
    renderer.autoClear = prevAuto;
  }
  dispose() {
    this._free();
    for (const m of [this.downPre, this.down, this.up, this.rays, this.comp, this.fxaa, this.ssao, this.ssaoBlur, this.copy, this.taa, this.vol, this.lum, this.expo]) m.dispose();
    this.quad.geometry.dispose();
  }
}
const halton = (i, b) => { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; };
const _v2 = new THREE.Vector2(), _s = new THREE.Vector3(), _s4 = new THREE.Vector4();
