import * as THREE from 'three';
import { DEPTH_VS, DEPTH_FS } from './shaders/depth.js';

const _pc = new THREE.Color(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _c = new THREE.Vector3(), _t = new THREE.Matrix4();

/** Sun shadow map: ortho camera centred on the player, texel-snapped, re-rendered lazily. */
export class ShadowPass {
  /** @param {object} shared shared uniforms @param {{value:THREE.Texture}} tilesUniform */
  constructor(shared, tilesUniform) {
    this.shared = shared;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2);
    this.cam.layers.set(1);
    this.depthMat = new THREE.ShaderMaterial({ uniforms: Object.assign({}, shared, { uTiles: tilesUniform }), vertexShader: DEPTH_VS, fragmentShader: DEPTH_FS, side: THREE.DoubleSide });
    this.rt = null; this.size = 0; this.radius = 0;
    this._lastSun = new THREE.Vector3(); this._lastCenter = new THREE.Vector3(1e9, 0, 0); this._lastT = 0;
    this._casters = [];
  }
  /** @param {{size:number,radius:number}} s */
  setQuality(s) {
    this.radius = s.radius;
    if (this.size !== s.size) {
      if (this.rt) { this.rt.dispose(); this.rt.depthTexture.dispose(); }
      const dt = new THREE.DepthTexture(s.size, s.size);
      dt.minFilter = dt.magFilter = THREE.NearestFilter;
      this.rt = new THREE.WebGLRenderTarget(s.size, s.size, { format: THREE.RedFormat, type: THREE.UnsignedByteType, depthBuffer: true, depthTexture: dt, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
      this.size = s.size;
      this._lastT = 0;
      this.shared.uShadowMap.value = dt;
      this.shared.uShadowP.value.y = 1 / s.size;
    }
  }
  render(renderer, scene, world, camera, time) {
    const sh = this.shared.uShadowP.value, R = this.radius;
    sh.z = world && world.getShadowCasters ? time.shadowStrength : 0;
    if (sh.z < 0.02) return;
    const now = performance.now(), texel = (2 * R) / this.size, quantum = Math.max(texel * 8, Math.round((R * 0.08) / texel) * texel);
    const sun = time.sunDir;
    _c.copy(camera.position);
    _f.copy(sun); _r.set(0, 1, 0).cross(_f).normalize(); _u.copy(_f).cross(_r);
    const cr = Math.round(_c.dot(_r) / quantum) * quantum, cu = Math.round(_c.dot(_u) / quantum) * quantum, cf = _c.dot(_f);
    _c.set(0, 0, 0).addScaledVector(_r, cr).addScaledVector(_u, cu).addScaledVector(_f, cf);
    const moved = _c.distanceToSquared(this._lastCenter) > 1e-6 || sun.distanceToSquared(this._lastSun) > 7.5e-5;
    const D = R + 150;
    const cam = this.cam;
    if (moved || now - this._lastT > 900) {
      cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R; cam.near = 1; cam.far = 2 * D;
      cam.position.copy(_c).addScaledVector(sun, D);
      cam.up.set(0, 1, 0);
      cam.lookAt(_c);
      cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
      this._casters.length = 0;
      world.getShadowCasters(camera.position, R * 1.5, this._casters);
      const prev = renderer.getRenderTarget(), pc = renderer.getClearColor(_pc), pa = renderer.getClearAlpha();
      renderer.setRenderTarget(this.rt);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear(true, true, false);
      scene.overrideMaterial = this.depthMat;
      renderer.render(scene, cam);
      scene.overrideMaterial = null;
      renderer.setRenderTarget(prev);
      renderer.setClearColor(pc, pa);
      this._lastCenter.copy(_c); this._lastSun.copy(sun); this._lastT = now;
    }
    // camera-relative world -> light clip. Uses the CURRENT camera position (cheap, double precision on CPU).
    _t.makeTranslation(camera.position.x, camera.position.y, camera.position.z);
    this.shared.uShadowMatrix.value.copy(cam.projectionMatrix).multiply(cam.matrixWorldInverse).multiply(_t);
    sh.x = texel * 1.6; sh.w = R * 0.92;
  }
  dispose() {
    if (this.rt) { this.rt.depthTexture.dispose(); this.rt.dispose(); }
    this.depthMat.dispose();
  }
}
