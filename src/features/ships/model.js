// Spaceship model: one merged mesh of coloured cuboids (one draw call per ship) with flat per-face shading, an accent colour per pilot and an
// emissive engine flame that stretches with the throttle (done in the vertex shader). Model space: 1 unit = 1 block, forward = -Z, nose at z = -3.4.
import * as THREE from 'three';
import { UNIFORMS, NOISE, SKY_FN, FOG_FN, LIGHT_FN, TONEMAP_FN, OUTPUT } from '../../render/shaders/common.js';

const HULL = [206, 212, 222], HULL2 = [150, 158, 172], DARK = [44, 48, 58], DARK2 = [28, 30, 38], GLASS = [90, 205, 255];

// box = [x0,y0,z0, x1,y1,z1, [r,g,b], emissive (0 none · 0..1 glow · 2 engine flame), accent mask 0..1]; mirrored across x when `mirror`
const BOXES = [
  [-0.5, -0.25, -2.3, 0.5, 0.4, 1.7, HULL, 0, 0, false],
  [-0.34, -0.2, -3.1, 0.34, 0.28, -2.3, HULL, 0, 0, false],
  [-0.14, -0.1, -3.45, 0.14, 0.14, -3.1, DARK, 0, 0, false],
  [-0.36, 0.4, -1.6, 0.36, 0.78, -0.2, GLASS, 0.3, 0, false],
  [-0.4, 0.4, -0.2, 0.4, 0.62, 0.9, HULL2, 0, 0, false],
  [-0.14, 0.4, -2.0, 0.14, 0.46, 1.3, HULL, 0, 1, false],               // dorsal stripe
  [-0.34, -0.42, -1.2, 0.34, -0.25, 1.1, DARK, 0, 0, false],            // belly
  [-2.5, -0.1, -0.2, -0.5, 0.1, 1.7, HULL, 0, 0, true],                  // wing
  [-2.4, -0.06, -0.1, -0.7, 0.14, 0.5, HULL, 0, 1, true],               // accent panel on the wing
  [-2.62, -0.22, 0.5, -2.4, 0.56, 1.8, HULL2, 0, 1, true],               // wing-tip fin
  [-1.2, -0.04, -1.9, -0.5, 0.06, -1.1, HULL2, 0, 0, true],              // canard
  [-0.07, 0.4, 0.8, 0.07, 1.25, 1.9, HULL, 0, 1, false],               // tail fin
  [-0.95, -0.3, 0.5, -0.5, 0.28, 2.0, DARK, 0, 0, true],                // engine pod
  [-0.9, -0.24, 1.95, -0.55, 0.22, 2.15, DARK2, 0, 0, true],            // nozzle
  [-0.82, -0.14, 2.15, -0.63, 0.12, 2.6, [255, 190, 90], 2, 0, true],   // flame
  [-1.8, -0.06, 1.1, -1.5, 0.1, 1.5, [255, 90, 80], 0.9, 0, true],     // wing-tip nav light
];

const FACE = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const CORNERS = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];

export function buildShipGeometry() {
  const pos = [], nrm = [], col = [], flag = [], idx = [];
  const add = (x0, y0, z0, x1, y1, z1, c, em, ac) => {
    for (let f = 0; f < 6; f++) {
      const base = pos.length / 3, shade = f === 2 ? 1.0 : f === 3 ? 0.6 : f < 2 ? 0.84 : 0.92;
      for (const q of CORNERS[f]) {
        pos.push(q[0] ? x1 : x0, q[1] ? y1 : y0, q[2] ? z1 : z0); nrm.push(...FACE[f]);
        col.push(c[0] * shade / 255, c[1] * shade / 255, c[2] * shade / 255); flag.push(em, ac);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  };
  for (const [x0, y0, z0, x1, y1, z1, c, em, ac, mirror] of BOXES) {
    add(x0, y0, z0, x1, y1, z1, c, em, ac);
    if (mirror) add(-x1, y0, z0, -x0, y1, z1, c, em, ac);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aN', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aC', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aF', new THREE.Float32BufferAttribute(flag, 2));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

const VS = /* glsl */`
${UNIFORMS}
attribute vec3 aN; attribute vec3 aC; attribute vec2 aF;
uniform float uThr;
varying vec3 vCol; varying vec3 vN; varying vec3 vRel; varying vec2 vF;
void main(){
  vec3 p = position;
  if (aF.x > 1.5) p.z = 2.15 + (p.z - 2.15) * (0.35 + uThr * 2.6);        // the flame grows with the throttle
  vec4 w = modelMatrix * vec4(p, 1.0);
  vRel = w.xyz; vN = normalize(mat3(modelMatrix) * aN); vCol = aC; vF = aF;
  gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * w.xyz, 1.0);
}`;

const FS = /* glsl */`
${UNIFORMS}
${NOISE}
${SKY_FN}
${FOG_FN}
${LIGHT_FN}
${TONEMAP_FN}
uniform vec3 uAccent; uniform float uThr;
varying vec3 vCol; varying vec3 vN; varying vec3 vRel; varying vec2 vF;
void main(){
  FADE_TEST
  vec3 base = mix(vCol, uAccent * (vCol.r + vCol.g + vCol.b) * 0.5 + uAccent * 0.55, vF.y);
  vec3 alb = srgb2lin(clamp(base, 0.0, 1.0));
  vec3 n = normalize(vN);
  float ndl = max(dot(n, uKeyDir), 0.0);
  vec3 col = alb * lightTerm(n.y, 0.9, ndl, 1.0, 0.0, 1.0, 1.0);
  if (uHeld.a > 0.0) col += alb * heldLight(vRel, n, 1.0, 1.0);
  float fr = pow(1.0 - max(dot(n, normalize(-vRel)), 0.0), 3.0);
  col += uKeyColor * 0.14 * fr * (1.0 - vF.y * 0.3);                        // metallic rim
  float em = clamp(vF.x, 0.0, 1.0);
  col = mix(col, alb * (vF.x > 1.5 ? 2.2 + 3.0 * uThr : 2.6), em);
  col = applyFog(col, vRel);
  float outAlpha = 1.0;
  ${OUTPUT}
}`;

/** @param {object} shared GameRenderer.shared uniforms */
export function makeShipMaterial(shared, accent) {
  const c = new THREE.Color(accent || '#6bd5ff');
  return new THREE.ShaderMaterial({ uniforms: Object.assign({ uAccent: { value: new THREE.Vector3(c.r, c.g, c.b) }, uThr: { value: 0 } }, shared), vertexShader: VS, fragmentShader: FS, side: THREE.FrontSide });
}
