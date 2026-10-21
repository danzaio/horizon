import * as THREE from 'three';
import { SOLID_VS, SOLID_FS } from './shaders/solid.js';
import { WATER_VS, WATER_FS } from './shaders/water.js';
import { LOD_VS, LOD_FS, LODW_VS, LODW_FS } from './shaders/lod.js';

/** Defines per material for a quality preset. `post` = whether the PostFX chain will tonemap (else materials do). */
export function definesFor(q, post, shadowsOn, ssr = false) {
  const base = {};
  if (!post) base.NO_POST = 1;
  if (q.skyDetail === 0) base.SKY_CHEAP = 1;
  const solid = Object.assign({}, base), water = Object.assign({ WATER_FX: q.waterFX }, base), lod = Object.assign({}, base), lodw = Object.assign({ WATER_FX: q.waterFX }, base);
  if (ssr) { water.WATER_SSR = 1; lodw.WATER_SSR = 1; }
  if (q.wind) solid.WIND = 1;
  if (q.waterFX >= 1) solid.SURF_SSS = 1;
  if (q.waterFX >= 2) { solid.SURF_BUMP = 1; solid.SURF_FX = 1; solid.SURF_CAUST = 1; }
  if (shadowsOn) { solid.SHADOWS = 1; solid.SHADOW_TAPS = q.shadows.size >= 2048 ? 9 : 4; if (q.clouds >= 1) solid.CLOUD_SHADOW = 1; }
  if (q.clouds >= 2) lod.CLOUD_SHADOW = 1;      // 2 noise octaves per pixel: only worth it on tiers that already pay for shadows/volumetric sky
  if (q.waterFX >= 1 || q.clouds >= 1) lod.LOD_DETAIL = 1;
  return { solid, water, lod, lodw };
}

/**
 * Builds the four contract materials. All share the uniform objects in `shared`.
 * @param {THREE.DataArrayTexture} tiles
 * @param {object} shared name -> {value}
 * @param {object} q quality preset
 * @param {boolean} post
 */
export function createMaterials(tiles, shared, q, post = false) {
  const d = definesFor(q, post, false);
  const solid = new THREE.ShaderMaterial({ uniforms: Object.assign({ uTiles: { value: tiles } }, shared), vertexShader: SOLID_VS, fragmentShader: SOLID_FS, defines: d.solid });
  const water = new THREE.ShaderMaterial({ uniforms: Object.assign({}, shared), vertexShader: WATER_VS, fragmentShader: WATER_FS, defines: d.water, transparent: true, depthWrite: q.waterFX === 0, side: THREE.DoubleSide });
  const lodSolid = new THREE.ShaderMaterial({ uniforms: Object.assign({}, shared), vertexShader: LOD_VS, fragmentShader: LOD_FS, defines: d.lod });
  const lodWater = new THREE.ShaderMaterial({ uniforms: Object.assign({}, shared), vertexShader: LODW_VS, fragmentShader: LODW_FS, defines: d.lodw, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  water.renderOrder = 1; lodWater.renderOrder = 1;
  return { solid, water, lodSolid, lodWater };
}

const sameDefines = (a, b) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every(k => a[k] === b[k]); };
function setDefines(mat, defs) { if (!sameDefines(mat.defines || {}, defs)) { mat.defines = defs; mat.needsUpdate = true; } }

/** Re-targets material variants live (only recompiles programs whose defines changed). */
export function updateMaterialQuality(mats, q, post, shadowsOn, ssr = false) {
  const d = definesFor(q, post, shadowsOn, ssr);
  setDefines(mats.solid, d.solid); setDefines(mats.water, d.water); setDefines(mats.lodSolid, d.lod); setDefines(mats.lodWater, d.lodw);
  mats.water.depthWrite = q.waterFX === 0 || ssr; mats.lodWater.depthWrite = ssr;
}
