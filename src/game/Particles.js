// Pooled block-break particles: one THREE.Points object (<= MAX live), tiny custom ShaderMaterial, CPU integrated, zero per-frame allocation.
import * as THREE from 'three';

const MAX = 64;
const VERT = /* glsl */`
attribute vec3 aColor; attribute float aLife;
uniform float uPx; varying vec3 vColor; varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(0.11 * uPx / max(-mv.z, 0.1), 1.0, 48.0);
  vColor = aColor * (0.7 + 0.3 * aLife); vA = smoothstep(0.0, 0.3, aLife);
}`;
const FRAG = /* glsl */`
varying vec3 vColor; varying float vA;
void main(){ if (vA < 0.02) discard; gl_FragColor = vec4(vColor, vA); }`;

export class Particles {
  /** @param {THREE.Object3D} scene */
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3); this.col = new Float32Array(MAX * 3); this.life = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3); this.ttl = new Float32Array(MAX);
    this.n = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aLife = new THREE.BufferAttribute(this.life, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos); g.setAttribute('aColor', this.aCol); g.setAttribute('aLife', this.aLife);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms: { uPx: { value: 700 } }, transparent: true, depthWrite: false });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    scene.add(this.points);
    this._ring = 0;
  }

  /** Burst of `count` particles at world (x,y,z) with colour rgb (0..1). */
  burst(x, y, z, rgb, count = 16) {
    if (this.n === 0) this.points.position.set(Math.floor(x), Math.floor(y), Math.floor(z)); // local origin keeps float32 precise
    const o = this.points.position;
    for (let i = 0; i < count; i++) {
      const k = this.n < MAX ? this.n++ : (this._ring = (this._ring + 1) % MAX);
      const j = k * 3, v = 0.78 + Math.random() * 0.4;
      this.pos[j] = x - o.x + (Math.random() - 0.5) * 0.8; this.pos[j + 1] = y - o.y + (Math.random() - 0.5) * 0.8; this.pos[j + 2] = z - o.z + (Math.random() - 0.5) * 0.8;
      this.vel[j] = (Math.random() - 0.5) * 3.2; this.vel[j + 1] = 1.5 + Math.random() * 3; this.vel[j + 2] = (Math.random() - 0.5) * 3.2;
      this.col[j] = rgb[0] * v; this.col[j + 1] = rgb[1] * v; this.col[j + 2] = rgb[2] * v;
      this.ttl[k] = 0.5 + Math.random() * 0.5; this.life[k] = 1;
    }
  }

  /** @param {number} dt  @param {number} pxPerUnit  drawing-buffer height / (2*tan(fov/2)) */
  update(dt, pxPerUnit) {
    this.mat.uniforms.uPx.value = pxPerUnit;
    if (this.n === 0) return;
    let i = 0;
    while (i < this.n) {
      const j = i * 3;
      this.ttl[i] -= dt;
      if (this.ttl[i] <= 0) { // swap-remove with last live particle
        const l = --this.n, m = l * 3;
        this.pos[j] = this.pos[m]; this.pos[j + 1] = this.pos[m + 1]; this.pos[j + 2] = this.pos[m + 2];
        this.vel[j] = this.vel[m]; this.vel[j + 1] = this.vel[m + 1]; this.vel[j + 2] = this.vel[m + 2];
        this.col[j] = this.col[m]; this.col[j + 1] = this.col[m + 1]; this.col[j + 2] = this.col[m + 2];
        this.ttl[i] = this.ttl[l]; this.life[i] = this.life[l];
        continue;
      }
      this.vel[j + 1] -= 16 * dt;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      this.life[i] = Math.min(1, this.ttl[i] * 2.5);
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = this.aCol.needsUpdate = this.aLife.needsUpdate = true;
  }

  dispose() { this.points.removeFromParent(); this.points.geometry.dispose(); this.mat.dispose(); }
}
