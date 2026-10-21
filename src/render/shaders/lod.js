import { UNIFORMS, NOISE, SKY_FN, FOG_FN, LIGHT_FN, TONEMAP_FN, OUTPUT, WATER_FN } from './common.js';

const FACES = /* glsl */`
const vec3 FN[7] = vec3[7](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1), vec3(0,1,0));
const float FSH[7] = float[7](0.82, 0.82, 1.0, 0.52, 0.9, 0.9, 1.0);
`;

// LOD format CONTRACT §2b. aColor = final sRGB albedo (same space as tint*texture), a = baked shade.
export const LOD_VS = /* glsl */`
${UNIFORMS}
${FACES}
attribute vec4 aColor;
attribute vec4 aMeta;
varying vec3 vCol;
varying vec4 vInfo;       // shade, flags, hash, level
flat varying vec3 vN;
varying vec3 vRel;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vRel = mv.xyz * mat3(viewMatrix);
  vCol = aColor.rgb;
  int face = int(aMeta.x + 0.5);
  vN = FN[face];
  vInfo = vec4(aColor.a, aMeta.y, aMeta.z, aMeta.w);
}
`;

export const LOD_FS = /* glsl */`
${UNIFORMS}
${NOISE}
${SKY_FN}
${FOG_FN}
${LIGHT_FN}
${TONEMAP_FN}
${FACES}
varying vec3 vCol;
varying vec4 vInfo;
flat varying vec3 vN;
varying vec3 vRel;
void main(){
  FADE_TEST
  float dist = length(vRel);
  int fl = int(vInfo.y + 0.5);
  vec3 alb = vCol;
  #ifdef LOD_DETAIL
    vec3 wp = vec3(vRel.x + uWorldOffset.x, uFogP.w + vRel.y, vRel.z + uWorldOffset.y);
    float nb = 1.0 - smoothstep(40.0, 260.0, dist);
    float nc = 1.0 - smoothstep(120.0, 900.0, dist);
    vec3 cell = floor(mod(wp + vN * 0.01 - vN * 0.5, 4096.0) + 0.0);
    float hb = hash13(cell + vInfo.z);
    float side = abs(vN.y) < 0.5 ? 1.0 : 0.0;
    // 1-block pattern
    float v = (hb - 0.5) * 0.16 * nb;
    // medium-scale blotch
    vec2 q = (abs(vN.y) > 0.5 ? wp.xz : vec2(wp.x + wp.z, wp.y)) * 0.35;
    v += (vnoise(mod(q, 512.0)) - 0.5) * 0.14 * nc;
    if ((fl & 1) != 0) { // canopy: leafy
      float lf = vnoise(mod(wp.xz * 0.9, 512.0) + wp.y * 0.3);
      v += (lf - 0.5) * 0.38 * nc + (hb - 0.5) * 0.12 * nb;
    }
    if ((fl & 4) != 0) { // cliff strata
      float st = hash12(vec2(floor(wp.y * 0.5), 3.0));
      v += (st - 0.5) * 0.22 * nc * (0.5 + side);
    }
    alb *= 1.0 + v;
    if ((fl & 2) != 0) { // snow sparkle
      float sp = step(0.985, hash13(cell * 1.7 + floor(uTime * 2.0 + vInfo.z)));
      alb += vec3(0.5) * sp * nb;
    }
  #endif
  alb = srgb2lin(clamp(alb, 0.0, 1.0));
  // far away, stepped walls read as 'buildings': blend their normal/shade toward the top face so distant ranges look like terrain
  float farK = smoothstep(150.0, 1100.0, dist);
  vec3 N = normalize(mix(vN, vec3(0.0, 1.0, 0.0), farK * 0.8));
  float fsh0 = 0.0;
  if (vInfo.w > 4.5 && vN.y > 0.5) {
    // sloped (smooth) tiles: hill-shade from the true surface normal so far ranges read as relief lit by the sun, not flat colour
    vec3 gn = normalize(cross(dFdx(vRel), dFdy(vRel)));
    if (gn.y < 0.0) gn = -gn;
    N = normalize(mix(gn, vec3(0.0, 1.0, 0.0), 0.12)); fsh0 = 1.0;
  }
  float ndl = max(dot(N, uKeyDir), 0.0);
  float nY = N.y;
  float fsh = mix(abs(vN.y) > 0.5 ? (vN.y > 0.0 ? 1.0 : 0.52) : 0.86, 1.0, farK * 0.85 * (1.0 - fsh0) + fsh0);
  float ao = mix(mix(0.45, 1.0, vInfo.x), 1.0, farK * 0.8);
  float shd = 1.0;
  #ifdef CLOUD_SHADOW
    {   // drifting cloud shadows over the far landscape
      float ky = max(uKeyDir.y, 0.2);
      vec2 cxz = vRel.xz + uWorldOffset + uKeyDir.xz * ((uCloudP.y - (uFogP.w + vRel.y)) / ky);
      vec2 cp = cxz * 0.0048 + vec2(uTime * 0.012, uTime * 0.0045);
      float cn = vnoise(cp) * 0.65 + vnoise(cp * 2.3 + 7.3) * 0.35;
      shd = 1.0 - 0.5 * smoothstep(uCloudP.x, uCloudP.x + 0.22, cn) * smoothstep(0.1, 0.4, uKeyDir.y);
    }
  #endif
  alb = mix(alb, vec3(0.78, 0.84, 0.92), uWeather.z * smoothstep(0.6, 0.9, N.y) * ((fl & 1) != 0 ? 0.55 : 0.9) * 0.9);   // snow settling
  vec3 col = alb * lightTerm(nY, fsh, ndl, 1.0, 0.0, ao, shd);
  col = applyFog(col, vRel);
  float outAlpha = 1.0;
  ${OUTPUT}
}
`;

export const LODW_VS = /* glsl */`
${UNIFORMS}
attribute vec4 aColor;
varying vec3 vRel;
varying vec3 vMV;
varying float vDepth;
varying vec3 vWT;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vRel = mv.xyz * mat3(viewMatrix);
  vMV = mv.xyz;
  vDepth = min(aColor.a * 64.0 / 16.0, 1.0);
  vWT = clamp(aColor.rgb / vec3(0.176, 0.392, 0.8), 0.55, 1.4);
}
`;

export const LODW_FS = /* glsl */`
${UNIFORMS}
${NOISE}
${SKY_FN}
${FOG_FN}
${TONEMAP_FN}
${WATER_FN}
varying vec3 vRel;
varying vec3 vMV;
varying float vDepth;
varying vec3 vWT;
void main(){
  FADE_TEST
  float dist = length(vRel);
  float detail = (1.0 - smoothstep(80.0, 700.0, dist)) * 0.8;
  #ifdef WATER_SSR
    vec4 w = uFogP.z > 0.5 ? waterShade(vRel, vDepth, 1.0, detail, vWT) : waterShadeSSR(vMV, vRel, 1.0, detail, vWT);
  #else
    vec4 w = waterShade(vRel, vDepth, 1.0, detail, vWT);
  #endif
  vec3 col = applyFog(w.rgb, vRel);
  float outAlpha = w.a;
  ${OUTPUT}
}
`;
