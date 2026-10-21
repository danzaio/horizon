import * as THREE from 'three';
import { SKY_VS, SKY_FS } from './shaders/sky.js';

/** Camera-following sky dome (single draw, drawn after opaque geometry, depth = far plane, so only uncovered pixels shade). */
export class Sky {
  /** @param {object} shared shared uniform objects */
  constructor(shared) {
    this.uniforms = shared;
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: SKY_VS, fragmentShader: SKY_FS, depthWrite: false, depthTest: true, side: THREE.BackSide, defines: { SKY_DETAIL: 1, CLOUDS: 1 } });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), this.material);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 10; this.mesh.matrixAutoUpdate = false;
  }
  /** @param {object} q quality preset */
  setQuality(q, noPost) {
    const d = this.material.defines, nd = { SKY_DETAIL: q.skyDetail, CLOUDS: q.clouds };
    if (noPost) nd.NO_POST = 1;
    if (q.skyDetail === 0) nd.SKY_CHEAP = 1;
    const same = Object.keys(nd).length === Object.keys(d).length && Object.keys(nd).every(k => d[k] === nd[k]);
    if (!same) { this.material.defines = nd; this.material.needsUpdate = true; }
  }
}
