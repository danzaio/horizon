import { UNIFORMS, NOISE, SKY_FN, FOG_FN, LIGHT_FN, TONEMAP_FN, OUTPUT } from './common.js';

// Decodes chunk format CONTRACT §2a. Defines: NO_POST, WIND, SHADOWS, SHADOW_TAPS, V_FLIP
export const DECODE = /* glsl */`
attribute vec4 aPos;
attribute vec4 aMeta;
attribute vec4 aTint;
const vec3 FN[7] = vec3[7](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1), vec3(0,1,0));
const float FSH[7] = float[7](0.82, 0.82, 1.0, 0.52, 0.9, 0.9, 1.0);
const float AOC[4] = float[4](0.42, 0.66, 0.85, 1.0);
// returns local position after wind; rel (camera relative) is written to relOut
vec3 decodeWind(inout vec3 p, int m, int face, float vv){
  #ifdef WIND
    if ((m & 32) != 0) {
      vec3 r0 = (modelViewMatrix * vec4(p, 1.0)).xyz * mat3(viewMatrix);
      vec2 wp = r0.xz + uWorldOffset;
      float ph = dot(wp, vec2(0.83, 0.57)) + uWind.y * 2.1;
      float gust = 0.55 + 0.45 * sin(dot(wp, vec2(0.045, 0.03)) - uWind.y * 0.9);
      float h = (face == 6) ? clamp(vv, 0.0, 1.0) * 0.14 : 0.04;
      vec2 o = vec2(sin(ph) + 0.4 * sin(ph * 2.3 + 1.0), cos(ph * 0.8 + 0.5)) * h * gust * uWind.x;
      p.xz += o;
    }
  #endif
  return p;
}
`;

export const SOLID_VS = /* glsl */`
${UNIFORMS}
${DECODE}
varying vec2 vUv;
flat varying float vLayer;
varying vec3 vTint;
flat varying vec4 vFlags;   // x cutout, y emissive, z faceShade, w nY
varying vec3 vL;            // sky, block, ao
flat varying vec3 vN;
varying vec3 vRel;
flat varying float vSway;
#ifdef SHADOWS
uniform mat4 uShadowMatrix;
uniform vec4 uShadowP; // x normal offset, y texel
varying vec3 vShadowC;
#endif
void main(){
  int m = int(aMeta.x + 0.5);
  int face = m & 7;
  vec3 p = aPos.xyz * (1.0 / 16.0);
  float vv = aMeta.z;
  #ifdef V_FLIP
    float vTop = 1.0 - mod(vv, 2.0);
  #else
    float vTop = mod(vv, 2.0);
  #endif
  decodeWind(p, m, face, vTop);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vRel = mv.xyz * mat3(viewMatrix);
  vUv = vec2(aMeta.y, aMeta.z);
  #ifdef V_FLIP
    vUv.y = -vUv.y;
  #endif
  vLayer = aPos.w;
  vTint = aTint.rgb;
  float cut = float((m >> 6) & 1);
  vSway = float((m >> 5) & 1);
  vFlags = vec4(cut, float((m >> 7) & 1), FSH[face], FN[face].y);
  vN = FN[face];
  float ao = float((m >> 3) & 3);
  vL = vec3(floor(aMeta.w / 16.0) / 15.0, mod(aMeta.w, 16.0) / 15.0, AOC[int(ao)]);
  #ifdef SHADOWS
    vec4 sc = uShadowMatrix * vec4(vRel + FN[face] * uShadowP.x, 1.0);
    vShadowC = sc.xyz * 0.5 + 0.5;
  #endif
}
`;

export const SHADOW_FN = /* glsl */`
#ifdef SHADOWS
uniform sampler2D uShadowMap;
uniform vec4 uShadowP;
varying vec3 vShadowC;
float shadowLookup(float ndl){
  vec3 c = vShadowC;
  float edge = smoothstep(0.0, 0.08, min(min(c.x, 1.0 - c.x), min(c.y, 1.0 - c.y)));
  float bias = 0.0007 + 0.0016 * (1.0 - ndl);
  float z = c.z - bias;
  float ts = uShadowP.y;
  float s = 0.0;
  #if SHADOW_TAPS >= 9
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
      s += step(z, texture(uShadowMap, c.xy + vec2(float(i), float(j)) * ts).r);
    s *= (1.0 / 9.0);
  #else
    s += step(z, texture(uShadowMap, c.xy + vec2(-0.5, -0.5) * ts).r);
    s += step(z, texture(uShadowMap, c.xy + vec2( 0.5, -0.5) * ts).r);
    s += step(z, texture(uShadowMap, c.xy + vec2(-0.5,  0.5) * ts).r);
    s += step(z, texture(uShadowMap, c.xy + vec2( 0.5,  0.5) * ts).r);
    s *= 0.25;
  #endif
  float outside = step(c.z, 0.999) * step(0.001, c.z);
  return mix(1.0, s, edge * outside * uShadowP.z);
}
#endif
`;

export const SOLID_FS = /* glsl */`
${UNIFORMS}
${NOISE}
${SKY_FN}
${FOG_FN}
${LIGHT_FN}
${TONEMAP_FN}
${SHADOW_FN}
uniform sampler2DArray uTiles;
varying vec2 vUv;
flat varying float vLayer;
varying vec3 vTint;
flat varying vec4 vFlags;
varying vec3 vL;
flat varying vec3 vN;
varying vec3 vRel;
flat varying float vSway;
#ifdef SURF_CAUST
// animated caustic web (Hoskins-style), tiled; bright thin filaments
float caustic(vec2 uv, float t){
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0, i = p;
  float c = 1.0, inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c = 1.17 - pow(c / 4.0, 1.4);
  return pow(abs(c), 8.0);
}
#endif
void main(){
  FADE_TEST
  #ifdef SURF_BUMP
    vec3 dp1 = dFdx(vRel), dp2 = dFdy(vRel); vec2 du1 = dFdx(vUv), du2 = dFdy(vUv);   // before any discard: derivatives need all lanes
  #endif
  vec4 t = texture(uTiles, vec3(vUv, vLayer));
  if (vFlags.x > 0.5 && t.a < 0.45) discard;
  vec3 tint = mix(vec3(1.0), vTint, mix(t.a, 1.0, vFlags.x));
  vec3 albedo = srgb2lin(t.rgb * tint) * (1.0 - 0.24 * uWeather.x * (1.0 - vFlags.y)); // wet surfaces are darker
  vec3 N = vN;
  #ifdef SURF_BUMP
    // pixel-art relief: height = albedo luminance, one forward difference per texel -> tilted normal, stable per pixel of the texture
    if (vFlags.x < 0.5 && vFlags.y < 0.5) {
      float amt = 1.0 - smoothstep(12.0, 46.0, length(vRel));
      if (amt > 0.01) {
        float h0 = dot(t.rgb, vec3(0.3, 0.59, 0.11));
        float hu = dot(texture(uTiles, vec3(vUv + vec2(0.0625, 0.0), vLayer)).rgb, vec3(0.3, 0.59, 0.11));
        float hv = dot(texture(uTiles, vec3(vUv + vec2(0.0, 0.0625), vLayer)).rgb, vec3(0.3, 0.59, 0.11));
        vec3 dp2p = cross(dp2, vN), dp1p = cross(vN, dp1);
        vec3 T = dp2p * du1.x + dp1p * du2.x, B = dp2p * du1.y + dp1p * du2.y;
        float inv = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
        vec2 g = vec2(hu - h0, hv - h0) * (2.6 * amt);
        N = normalize(vN - (T * g.x + B * g.y) * inv);
      }
    }
  #endif
  // snow settling during snowfall (uWeather.z): sky-exposed up-facing surfaces whiten, leaves a little
  float snowK = uWeather.z * smoothstep(0.55, 0.9, N.y) * smoothstep(0.55, 0.95, vL.x) * (1.0 - vFlags.y) * mix(1.0, 0.55, vFlags.x);
  albedo = mix(albedo, vec3(0.78, 0.84, 0.92), snowK * 0.93);
  float ndlG = max(dot(vN, uKeyDir), 0.0);   // geometric (shadow bias), shading uses the bumped normal
  float ndl = max(dot(N, uKeyDir), 0.0);
  float sh = 1.0;
  #ifdef SHADOWS
    sh = shadowLookup(ndlG);
  #endif
  #ifdef CLOUD_SHADOW
    // cheap cloud shadows: same 2-octave noise as the sky clouds, sampled where the sun ray crosses the cloud plane
    {
      float ky = max(uKeyDir.y, 0.2);
      vec2 cxz = vRel.xz + uWorldOffset + uKeyDir.xz * ((uCloudP.y - (uFogP.w + vRel.y)) / ky);
      vec2 cp = cxz * 0.0048 + vec2(uTime * 0.012, uTime * 0.0045);
      float cn = vnoise(cp) * 0.65 + vnoise(cp * 2.3 + 7.3) * 0.35;
      sh *= 1.0 - 0.5 * smoothstep(uCloudP.x, uCloudP.x + 0.22, cn) * smoothstep(0.1, 0.4, uKeyDir.y);
    }
  #endif
  vec3 col = albedo * lightTerm(N.y, vFlags.z, ndl, vL.x, vL.y, vL.z, sh);
  if (uHeld.a > 0.0) col += albedo * heldLight(vRel, N, vL.x, vL.z);
  #ifdef SURF_SSS
    // foliage translucency: sun shining through leaves / grass toward the camera
    if (vSway > 0.5 && vFlags.x > 0.5) {
      float back = pow(max(dot(normalize(vRel), uKeyDir), 0.0), 2.4);
      col += albedo * vec3(1.0, 0.92, 0.45) * uKeyColor * (back * smoothstep(0.5, 0.92, vL.x) * sh * 0.85 * (1.0 - 0.9 * uWeather.x));
    }
  #endif
  #ifdef SURF_FX
    // rain: wet surfaces mirror the sky (fresnel) with a sharper sun glint
    float wet = uWeather.x;
    if (wet > 0.02 && vFlags.x < 0.5 && vFlags.y < 0.5) {
      vec3 Vc = normalize(-vRel);
      float F = 0.03 + 0.97 * pow(1.0 - max(dot(N, Vc), 0.0), 5.0);
      col += skyGradient(reflect(-Vc, N)) * (F * wet * 0.7 * smoothstep(0.4, 0.9, vL.x) * (0.4 + 0.6 * max(N.y, 0.0)));
    }
  #endif
  #ifdef SURF_CAUST
    float wy = uFogP.w + vRel.y;
    if (wy < 62.0 && vL.x > 0.3 && uSkyP.w > 0.02) {
      float cs = caustic((vRel.xz + uWorldOffset) * 0.17 + vec2(0.0, wy * 0.05), uTime * 0.85);
      float k = exp(-(62.9 - wy) * 0.09) * smoothstep(0.3, 0.8, vL.x) * max(uKeyDir.y, 0.0) * uSkyP.w;
      col += albedo * uKeyColor * (cs * k * 1.8 * (0.35 + 0.65 * max(N.y, 0.0)) * (0.4 + 0.6 * sh));
    }
  #endif
  col = mix(col, albedo * 2.2, vFlags.y);
  col = applyFog(col, vRel);
  float outAlpha = 1.0;
  ${OUTPUT}
}
`;
