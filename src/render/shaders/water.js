import { UNIFORMS, NOISE, SKY_FN, FOG_FN, TONEMAP_FN, OUTPUT, WATER_FN } from './common.js';
import { DECODE } from './solid.js';

export const WATER_VS = /* glsl */`
${UNIFORMS}
${DECODE}
varying vec3 vRel;
varying vec3 vMV;
varying vec2 vWD;   // depth, sky
varying vec3 vWT;   // biome water tint
void main(){
  vec3 p = aPos.xyz * (1.0 / 16.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vRel = mv.xyz * mat3(viewMatrix);
  vMV = mv.xyz;
  vWD = vec2(aTint.a, floor(aMeta.w / 16.0) / 15.0);
  vWT = clamp(aTint.rgb / vec3(0.176, 0.392, 0.8), 0.55, 1.4);
}
`;

export const WATER_FS = /* glsl */`
${UNIFORMS}
${NOISE}
${SKY_FN}
${FOG_FN}
${TONEMAP_FN}
${WATER_FN}
varying vec3 vRel;
varying vec3 vMV;
varying vec2 vWD;
varying vec3 vWT;
void main(){
  FADE_TEST
  float dist = length(vRel);
  float detail = 1.0 - smoothstep(80.0, 500.0, dist);
  #ifdef WATER_SSR
    vec4 w = uFogP.z > 0.5 ? waterShade(vRel, vWD.x, vWD.y, detail, vWT) : waterShadeSSR(vMV, vRel, vWD.y, detail, vWT);
  #else
    vec4 w = waterShade(vRel, vWD.x, vWD.y, detail, vWT);
  #endif
  vec3 col = applyFog(w.rgb, vRel);
  float outAlpha = w.a;
  ${OUTPUT}
}
`;
