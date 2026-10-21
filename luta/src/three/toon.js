// GH3-style materials: 3-step toon shading, screen-space ink hatching in the shadow bands,
// and inverted-hull ink outlines with a constant on-screen thickness.
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const grad = new THREE.DataTexture(new Uint8Array([70, 150, 255]), 3, 1, THREE.RedFormat);
grad.minFilter = grad.magFilter = THREE.NearestFilter;
grad.generateMipmaps = false;
grad.needsUpdate = true;

// hatch spacing in device pixels (set from the pixel ratio on resize)
export const hatchU = { value: 7 };

const HATCH = /* glsl */`
  {
    float lf = dot(reflectedLight.directDiffuse + reflectedLight.indirectDiffuse, vec3(0.3333)) / max(dot(diffuseColor.rgb, vec3(0.3333)), 0.03);
    float hA = step(mod(gl_FragCoord.x + gl_FragCoord.y, uHatch), uHatch * 0.2);
    float hB = step(mod(gl_FragCoord.x - gl_FragCoord.y, uHatch), uHatch * 0.2);
    outgoingLight *= 1.0 - 0.5 * hA * (1.0 - smoothstep(0.42, 0.52, lf)) - 0.4 * hB * (1.0 - smoothstep(0.2, 0.28, lf));
  }
  #include <opaque_fragment>`;

const cache = new Map();
export function toon(color, opts = {}) {
  const key = opts.map ? null : `${color}|${opts.emissive || ''}|${opts.side || 0}`;
  if (key && cache.has(key)) return cache.get(key);
  const m = new THREE.MeshToonMaterial({
    color, gradientMap: grad, map: opts.map || null,
    emissive: opts.emissive || 0x000000, side: opts.side || THREE.FrontSide,
  });
  m.onBeforeCompile = sh => {
    sh.uniforms.uHatch = hatchU;
    sh.fragmentShader = 'uniform float uHatch;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', HATCH);
  };
  m.customProgramCacheKey = () => 'gb3-toon-hatch';
  if (key) cache.set(key, m);
  return m;
}

const outlineMats = new Map();
function outlineMat(w) {
  let m = outlineMats.get(w);
  if (!m) {
    m = new THREE.ShaderMaterial({
      uniforms: { uW: { value: 0.0024 * w } },
      vertexShader: /* glsl */`
        uniform float uW;
        void main() {
          vec3 n = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          mv.xyz += n * uW * (-mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`void main() { gl_FragColor = vec4(0.075, 0.039, 0.086, 1.0); }`,
      side: THREE.BackSide,
    });
    outlineMats.set(w, m);
  }
  return m;
}

// flat-shaded geometry (boxes, extrusions) needs welded, averaged normals for a crack-free hull
const smoothCache = new WeakMap();
export function smoothGeo(g) {
  let s = smoothCache.get(g);
  if (!s) {
    s = g.clone();
    for (const k of Object.keys(s.attributes)) if (k !== 'position') s.deleteAttribute(k);
    s = mergeVertices(s, 0.01);
    s.computeVertexNormals();
    smoothCache.set(g, s);
  }
  return s;
}
const FLAT = new Set(['BoxGeometry', 'ExtrudeGeometry', 'CylinderGeometry', 'ShapeGeometry']);
export function outline(mesh, w = 1) {
  const g = FLAT.has(mesh.geometry.type) ? smoothGeo(mesh.geometry) : mesh.geometry;
  const o = new THREE.Mesh(g, outlineMat(w));
  o.raycast = () => {};
  mesh.add(o);
  return mesh;
}

// mesh helper: geometry + material, optional ink outline, added to parent at (x, y, z)
export function part(geo, mat, parent, x = 0, y = 0, z = 0, ink = 1) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  if (ink) outline(m, ink);
  parent.add(m);
  return m;
}

export function canvasTex(cv, repeat) {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
