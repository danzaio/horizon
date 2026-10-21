import { UNIFORMS } from './common.js';
import { DECODE } from './solid.js';

// Shadow caster depth pass: decodes chunk format (+ wind), alpha-tests cutout tiles.
export const DEPTH_VS = /* glsl */`
${UNIFORMS}
${DECODE}
varying vec2 vUv;
flat varying float vLayer;
flat varying float vCut;
void main(){
  int m = int(aMeta.x + 0.5);
  int face = m & 7;
  vec3 p = aPos.xyz * (1.0 / 16.0);
  decodeWind(p, m, face, mod(aMeta.z, 2.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  vUv = vec2(aMeta.y, aMeta.z);
  vLayer = aPos.w;
  vCut = float((m >> 6) & 1);
}
`;
export const DEPTH_FS = /* glsl */`
uniform sampler2DArray uTiles;
varying vec2 vUv;
flat varying float vLayer;
flat varying float vCut;
void main(){
  if (vCut > 0.5 && texture(uTiles, vec3(vUv, vLayer)).a < 0.45) discard;
  gl_FragColor = vec4(1.0);
}
`;
