// Texture-less debug materials that decode the contract §2 formats (WORLD dev harness only).
import * as THREE from 'three';
import { TILE_NAMES } from '../../shared/blocks.js';

const FOG = new THREE.Color(0.62, 0.76, 0.92);
function tileColor(n) {
  if (/water/.test(n)) return [0.2, 0.4, 0.8];
  if (/grass_top|tall_grass/.test(n)) return [0.8, 0.9, 0.7];
  if (/grass_side/.test(n)) return [0.55, 0.45, 0.3];
  if (/leaves/.test(n)) return [0.55, 0.7, 0.5];
  if (/log.*top/.test(n)) return [0.7, 0.55, 0.35];
  if (/log/.test(n)) return [0.4, 0.3, 0.2];
  if (/snow/.test(n)) return [0.95, 0.97, 1.0];
  if (/sandstone/.test(n)) return [0.8, 0.72, 0.5];
  if (/sand/.test(n)) return [0.9, 0.82, 0.55];
  if (/gravel/.test(n)) return [0.5, 0.48, 0.47];
  if (/dirt/.test(n)) return [0.45, 0.32, 0.2];
  if (/stone|cobble/.test(n)) return [0.5, 0.5, 0.52];
  if (/bedrock/.test(n)) return [0.2, 0.2, 0.2];
  if (/ore/.test(n)) return [0.6, 0.5, 0.45];
  if (/ice/.test(n)) return [0.7, 0.85, 1.0];
  if (/lava|glow/.test(n)) return [1.0, 0.6, 0.1];
  if (/flower_red/.test(n)) return [0.9, 0.2, 0.2];
  if (/flower_yellow/.test(n)) return [0.95, 0.85, 0.2];
  if (/cactus/.test(n)) return [0.2, 0.55, 0.2];
  return [0.7, 0.6, 0.5];
}
const COLS = new Float32Array(128 * 3);
TILE_NAMES.forEach((n, i) => COLS.set(tileColor(n), i * 3));
const LOD_TINT = [[1, 1, 1], [1, 0.5, 0.5], [0.5, 1, 0.5], [0.5, 0.5, 1], [1, 1, 0.4], [1, 0.5, 1], [0.4, 1, 1], [1, 0.75, 0.4], [0.7, 0.6, 1], [0.6, 0.6, 0.6]];

const common = `
uniform vec3 uFog; uniform float uFar; uniform vec3 uSun;
varying vec3 vCol; varying float vDist; varying float vA;
float fogF(float d){ return smoothstep(uFar*0.5, uFar*0.97, d); }
`;

export function createDebugMaterials({ lodTint = false, viewDistance = 2560 } = {}) {
  const uni = { uFog: { value: FOG }, uFar: { value: viewDistance }, uSun: { value: new THREE.Vector3(0.5, 0.8, 0.3).normalize() }, uCols: { value: COLS }, uLodTint: { value: lodTint ? 1 : 0 }, uLodCols: { value: LOD_TINT.map(c => new THREE.Vector3(...c)) } };
  const solid = new THREE.ShaderMaterial({
    uniforms: uni, side: THREE.FrontSide,
    vertexShader: common + `
    attribute vec4 aPos; attribute vec4 aMeta; attribute vec4 aTint; uniform vec3 uCols[128];
    void main(){
      vec3 p = aPos.xyz / 16.0; int mx = int(aMeta.x + 0.5);
      int face = mx & 7; float ao = float((mx >> 3) & 3);
      bool cut = (mx & 64) != 0;
      vec3 base = uCols[int(aPos.w + 0.5)];
      float sky = floor(aMeta.w / 16.0 + 0.01) / 15.0; float blk = (aMeta.w - floor(aMeta.w / 16.0 + 0.01) * 16.0) / 15.0;
      float sh = face == 2 ? 1.0 : face == 3 ? 0.5 : (face < 2 ? 0.78 : 0.66); if (face == 6) sh = 0.9;
      float lit = max(0.12 + 0.88 * sky, blk);
      if ((mx & 128) != 0) lit = 1.0;
      vCol = base * aTint.rgb * sh * (0.4 + 0.2 * ao) * lit;
      vec4 mv = modelViewMatrix * vec4(p, 1.0); vDist = length(mv.xyz); vA = 1.0;
      gl_Position = projectionMatrix * mv;
    }`,
    fragmentShader: common + `void main(){ vec3 c = mix(vCol, uFog, fogF(vDist)); gl_FragColor = vec4(c, 1.0); }`,
  });
  const water = new THREE.ShaderMaterial({
    uniforms: uni, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: common + `
    attribute vec4 aPos; attribute vec4 aMeta; attribute vec4 aTint;
    void main(){
      vec3 p = aPos.xyz / 16.0;
      float sky = floor(aMeta.w / 16.0 + 0.01) / 15.0;
      vCol = aTint.rgb * mix(vec3(0.55,0.75,1.0), vec3(0.15,0.3,0.6), aTint.a) * (0.3 + 0.7 * sky);
      vec4 mv = modelViewMatrix * vec4(p, 1.0); vDist = length(mv.xyz); vA = 0.55 + 0.4 * aTint.a;
      gl_Position = projectionMatrix * mv;
    }`,
    fragmentShader: common + `void main(){ vec3 c = mix(vCol, uFog, fogF(vDist)); gl_FragColor = vec4(c, vA); }`,
  });
  const lodVS = (isWater) => common + `
    attribute vec4 aColor; attribute vec4 aMeta; uniform float uLodTint; uniform vec3 uLodCols[10];
    void main(){
      int face = int(aMeta.x + 0.5); int L = int(aMeta.w + 0.5);
      float sh = face == 2 ? 1.0 : face < 2 ? 0.78 : 0.66;
      vec3 c = aColor.rgb;
      ${isWater ? 'c = c * mix(vec3(0.9,1.0,1.1), vec3(0.3,0.45,0.7), aColor.a);' : 'c = c * sh * (0.5 + 0.5 * aColor.a);'}
      if (uLodTint > 0.5) c *= uLodCols[min(L, 9)];
      vCol = c; vA = ${isWater ? '0.6 + 0.35 * aColor.a' : '1.0'};
      vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = length(mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`;
  const lodSolid = new THREE.ShaderMaterial({ uniforms: uni, vertexShader: lodVS(false), fragmentShader: common + `void main(){ gl_FragColor = vec4(mix(vCol, uFog, fogF(vDist)), 1.0); }`, side: THREE.FrontSide });
  const lodWater = new THREE.ShaderMaterial({ uniforms: uni, transparent: true, depthWrite: false, vertexShader: lodVS(true), fragmentShader: common + `void main(){ gl_FragColor = vec4(mix(vCol, uFog, fogF(vDist)), vA); }`, side: THREE.DoubleSide });
  return { solid, water, lodSolid, lodWater, uniforms: uni, fogColor: FOG };
}
