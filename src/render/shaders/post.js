import { GRADE_FN } from './common.js';

export const FS_VS = /* glsl */`
varying vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// bright-pass + 13-tap-ish downsample (soft knee)
export const BLOOM_DOWN_FS = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform vec4 uThresh; // x threshold, y knee
varying vec2 vUv;
vec3 prefilter(vec3 c){
  #ifdef PREFILTER
    float br = max(c.r, max(c.g, c.b));
    float soft = clamp(br - uThresh.x + uThresh.y, 0.0, 2.0 * uThresh.y);
    soft = soft * soft / (4.0 * uThresh.y + 1e-4);
    c *= max(soft, br - uThresh.x) / max(br, 1e-4);
  #endif
  return c;
}
void main(){
  vec2 t = uTexel;
  vec3 c = prefilter(texture2D(tSrc, vUv).rgb) * 4.0;
  c += prefilter(texture2D(tSrc, vUv + vec2(-1.0, -1.0) * t).rgb);
  c += prefilter(texture2D(tSrc, vUv + vec2( 1.0, -1.0) * t).rgb);
  c += prefilter(texture2D(tSrc, vUv + vec2(-1.0,  1.0) * t).rgb);
  c += prefilter(texture2D(tSrc, vUv + vec2( 1.0,  1.0) * t).rgb);
  gl_FragColor = vec4(min(c / 8.0, vec3(64.0)), 1.0);
}
`;

export const BLOOM_UP_FS = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uWeight;
varying vec2 vUv;
void main(){
  vec2 t = uTexel;
  vec3 c = texture2D(tSrc, vUv + vec2(-1.0, 0.0) * t).rgb + texture2D(tSrc, vUv + vec2(1.0, 0.0) * t).rgb
         + texture2D(tSrc, vUv + vec2(0.0, -1.0) * t).rgb + texture2D(tSrc, vUv + vec2(0.0, 1.0) * t).rgb;
  c += (texture2D(tSrc, vUv + vec2(-0.5, -0.5) * t).rgb + texture2D(tSrc, vUv + vec2(0.5, -0.5) * t).rgb
      + texture2D(tSrc, vUv + vec2(-0.5, 0.5) * t).rgb + texture2D(tSrc, vUv + vec2(0.5, 0.5) * t).rgb) * 2.0;
  gl_FragColor = vec4(c * (uWeight / 12.0), 1.0);
}
`;

export const RAYS_FS = /* glsl */`
uniform sampler2D tDepth; uniform vec2 uSun; uniform vec3 uColor; uniform float uAspect;
varying vec2 vUv;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 dv = (uSun - vUv);
  float len = length(dv * vec2(uAspect, 1.0));
  vec2 stp = dv / 16.0;
  vec2 uv = vUv + stp * hash(gl_FragCoord.xy);
  float acc = 0.0, w = 1.0;
  for (int i = 0; i < 16; i++) {
    float d = texture2D(tDepth, uv).r;
    acc += step(0.99999, d) * w;
    w *= 0.935;
    uv += stp;
  }
  float fall = exp(-len * 2.2);
  gl_FragColor = vec4(uColor * acc * (1.0 / 16.0) * fall, 1.0);
}
`;

// ---- SSAO: depth-only, normals from depth, 12-tap spiral hemisphere in screen space (half-res), interleaved-gradient rotation ----
export const SSAO_FS = /* glsl */`
uniform sampler2D tDepth; uniform vec2 uProj; uniform vec2 uNF; uniform vec2 uRes; uniform float uRadius; uniform float uTime;
varying vec2 vUv;
float viewZ(float d){ return (uNF.x * uNF.y) / ((uNF.y - uNF.x) * d - uNF.y); }
vec3 posAt(vec2 uv){ float z = viewZ(texture2D(tDepth, uv).r); return vec3((uv * 2.0 - 1.0) * (-z) / uProj, z); }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  float d0 = texture2D(tDepth, vUv).r;
  if (d0 > 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec3 P = posAt(vUv);
  vec2 tx = 1.0 / uRes;
  vec3 Pr = posAt(vUv + vec2(tx.x, 0.0)), Pl = posAt(vUv - vec2(tx.x, 0.0)), Pu = posAt(vUv + vec2(0.0, tx.y)), Pd = posAt(vUv - vec2(0.0, tx.y));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));
  if (dot(N, P) > 0.0) N = -N;
  float rs = clamp(uRadius * uProj.y * 0.5 * uRes.y / max(-P.z, 0.2), 4.0, 90.0);
  float rot = ign(gl_FragCoord.xy + fract(uTime * 7.0) * 17.0) * 6.2831853;
  float occ = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i), r = sqrt((fi + 0.5) / 12.0), a = fi * 2.399963 + rot;
    vec3 S = posAt(vUv + vec2(cos(a), sin(a)) * r * rs * tx);
    vec3 v = S - P; float l = length(v);
    float nv = max(dot(N, v / max(l, 1e-4)) - 0.1, 0.0);
    float q = l / uRadius;
    occ += nv / (1.0 + q * q * 1.5);
  }
  float ao = 1.0 - clamp(occ * (2.4 / 12.0), 0.0, 1.0);
  ao = mix(ao, 1.0, smoothstep(50.0, 150.0, -P.z));
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

export const SSAO_BLUR_FS = /* glsl */`
uniform sampler2D tAO; uniform sampler2D tDepth; uniform vec2 uTexel; uniform vec2 uNF;
varying vec2 vUv;
float viewZ(float d){ return (uNF.x * uNF.y) / ((uNF.y - uNF.x) * d - uNF.y); }
void main(){
  float z0 = viewZ(texture2D(tDepth, vUv).r);
  float sum = 0.0, wsum = 0.0;
  for (int j = -2; j <= 1; j++) for (int i = -2; i <= 1; i++) {
    vec2 uv = vUv + (vec2(float(i), float(j)) + 0.5) * uTexel;
    float z = viewZ(texture2D(tDepth, uv).r);
    float w = exp(-abs(z - z0) * 2.5 / max(-z0 * 0.05, 0.15));
    sum += texture2D(tAO, uv).r * w; wsum += w;
  }
  float ao = sum / max(wsum, 1e-4);
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}
`;

// copies colour + depth of the opaque pass into the second RT, so water can be drawn on top while reading the original
export const COPY_FS = /* glsl */`
uniform sampler2D tColor; uniform sampler2D tDepth;
varying vec2 vUv;
void main(){ gl_FragColor = texture2D(tColor, vUv); gl_FragDepth = texture2D(tDepth, vUv).r; }
`;

// ---- TAA resolve: camera-motion reprojection from depth (everything in the world is static), 3x3 neighbourhood clamp ----
export const TAA_FS = /* glsl */`
uniform sampler2D tCur; uniform sampler2D tHist; uniform sampler2D tDepth;
uniform mat4 uInvVP; uniform mat4 uPrevVP; uniform vec3 uDelta; uniform vec2 uTexel; uniform float uFirst; uniform vec2 uNF;
varying vec2 vUv;
float viewZ(float d){ return (uNF.x * uNF.y) / ((uNF.y - uNF.x) * d - uNF.y); }
void main(){
  vec3 cur = min(texture2D(tCur, vUv).rgb, vec3(24.0));
  vec3 mn = cur, mx = cur, sum = cur;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    if (i == 0 && j == 0) continue;
    vec3 c = min(texture2D(tCur, vUv + vec2(float(i), float(j)) * uTexel).rgb, vec3(24.0));
    mn = min(mn, c); mx = max(mx, c); sum += c;
  }
  vec3 avg = sum / 9.0;
  float d = texture2D(tDepth, vUv).r;
  vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 rel1 = w.xyz / w.w;                       // camera-relative world position
  vec4 pc = uPrevVP * vec4(rel1 + uDelta, 1.0);  // same point, relative to the previous camera
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  if (viewZ(d) > -1.2) puv = vUv;               // held block: attached to the camera, it does not move relative to the screen
  float inside = step(0.0, puv.x) * step(puv.x, 1.0) * step(0.0, puv.y) * step(puv.y, 1.0) * step(0.0, pc.w);
  vec3 hist = texture2D(tHist, puv).rgb;
  vec3 hc = clamp(hist, mn - 0.02, mx + 0.02);
  float rej = clamp(length(hist - hc) / (length(avg) + 0.1), 0.0, 1.0);   // history had to be pulled in a lot: disocclusion / changed lighting
  vec2 mv = (puv - vUv) / uTexel;
  float blend = 0.08 + 0.35 * rej + 0.12 * clamp(length(mv) * 0.15, 0.0, 1.0);
  blend = mix(blend, 1.0, max(uFirst, 1.0 - inside));
  gl_FragColor = vec4(mix(hc, cur, clamp(blend, 0.0, 1.0)), 1.0);
}
`;

// ---- volumetric light shafts: half-res ray-march from the camera to the surface through the sun shadow map (HG phase, height falloff) ----
export const VOL_FS = /* glsl */`
uniform sampler2D tDepth; uniform sampler2D tShadow;
uniform mat4 uInvVP; uniform mat4 uShadowMatrix;
uniform vec3 uSunDir; uniform vec3 uSunColor;
uniform vec4 uVolP;   // x density, y max distance, z camera world y, w time
uniform vec2 uRes;
varying vec2 vUv;
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  float d = texture2D(tDepth, vUv).r;
  vec4 w = uInvVP * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  vec3 end = w.xyz / w.w;
  float len = length(end);
  vec3 dir = end / max(len, 1e-3);
  float maxD = min(len, uVolP.y);
  const int N = 18;
  float jit = fract(ign(gl_FragCoord.xy) + fract(uVolP.w * 3.7) * 0.61803);
  float acc = 0.0;
  for (int i = 0; i < N; i++) {
    float t = (float(i) + jit) / float(N) * maxD;
    vec3 p = dir * t;
    vec3 c = (uShadowMatrix * vec4(p, 1.0)).xyz * 0.5 + 0.5;
    float inMap = step(0.0, c.x) * step(c.x, 1.0) * step(0.0, c.y) * step(c.y, 1.0) * step(c.z, 1.0);
    float vis = mix(1.0, step(c.z - 0.0016, texture2D(tShadow, c.xy).r), inMap);
    float h = uVolP.z + p.y;
    float dens = exp(-max(h - 58.0, 0.0) * 0.022) * (1.0 + 1.6 * exp(-abs(h - 64.0) * 0.12));   // thicker haze near sea level / valley floors
    acc += vis * dens;
  }
  acc *= maxD / float(N) * uVolP.x;
  float cosT = dot(dir, uSunDir), g = 0.62;
  float phase = (1.0 - g * g) / (4.0 * 3.14159 * pow(1.0 + g * g - 2.0 * g * cosT, 1.5));
  gl_FragColor = vec4(uSunColor * acc * (phase * 3.2 + 0.035), 1.0);
}
`;

// ---- auto exposure (eye adaptation), GPU-only: scene -> 64x36 log-luminance -> 1x1 adapted multiplier (ping-pong) ----
export const LUM_FS = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uStep;
varying vec2 vUv;
void main(){
  float s = 0.0;
  for (int j = 0; j < 6; j++) for (int i = 0; i < 6; i++) {
    vec3 c = min(texture2D(tSrc, vUv + (vec2(float(i), float(j)) - 2.5) * uStep).rgb, vec3(12.0));
    s += log(dot(c, vec3(0.2126, 0.7152, 0.0722)) + 0.02);
  }
  gl_FragColor = vec4(vec3(s / 36.0), 1.0);
}
`;
export const EXPO_FS = /* glsl */`
uniform sampler2D tLum; uniform sampler2D tPrev; uniform vec4 uP;   // x composite exposure, y dt, z first, w strength
varying vec2 vUv;
void main(){
  float s = 0.0;
  for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++) s += texture2D(tLum, (vec2(float(i), float(j)) + 0.5) / 8.0).r;
  float L = exp(s / 64.0) * uP.x;                                  // average scene luminance as the player will see it
  float target = clamp(pow(0.17 / max(L, 1e-3), uP.w), 0.62, 1.9); // dark -> brighten, bright -> pull back, gently
  float prev = texture2D(tPrev, vec2(0.5)).r;
  float k = 1.0 - exp(-uP.y * (target > prev ? 0.9 : 2.4));       // eyes adapt to bright faster than to dark
  float cur = uP.z > 0.5 ? target : mix(prev, target, k);
  gl_FragColor = vec4(vec3(cur), 1.0);
}
`;

export const COMPOSITE_FS = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tBloom; uniform sampler2D tRays; uniform sampler2D tAO; uniform sampler2D tVol; uniform vec2 uVolTexel; uniform sampler2D tExp; uniform sampler2D tDepth;
uniform vec4 uFlare;      // sun uv x,y ; strength ; aspect
uniform vec2 uMb;         // x shutter, y enabled
uniform vec2 uNF;
uniform vec4 uDof;        // x focus distance, y aperture, z enabled, w max blur radius (px)
uniform mat4 uInvVP; uniform mat4 uPrevVP; uniform vec3 uDelta;
uniform vec4 uP;       // x exposure, y bloom strength, z rays strength, w underwater
uniform vec2 uRes; uniform float uTime;
varying vec2 vUv;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
${GRADE_FN}
void main(){
  vec2 uv = vUv;
  if (uP.w > 0.001) uv += vec2(sin(uv.y * 38.0 + uTime * 2.0), cos(uv.x * 31.0 + uTime * 1.7)) * 0.0018 * uP.w;
  vec3 c = texture2D(tScene, uv).rgb;
  #ifdef CINE
    {   // lateral chromatic aberration, grows with distance from the centre
      vec2 q0 = uv - 0.5; float k = dot(q0, q0) * 0.012;
      c.r = texture2D(tScene, uv + q0 * k).r; c.b = texture2D(tScene, uv - q0 * k).b;
    }
  #endif
  #ifdef MBLUR
    if (uMb.y > 0.5) {   // camera motion blur: velocity from depth reprojection, 8 taps along it
      float dd = texture2D(tDepth, uv).r;
      float vz = (uNF.x * uNF.y) / ((uNF.y - uNF.x) * dd - uNF.y);
      vec4 w = uInvVP * vec4(uv * 2.0 - 1.0, dd * 2.0 - 1.0, 1.0);
      vec4 pc = uPrevVP * vec4(w.xyz / w.w + uDelta, 1.0);
      vec2 vel = clamp((uv - pc.xy / pc.w * 0.5 - 0.5) * uMb.x, vec2(-0.028), vec2(0.028)) * step(vz, -1.2);   // the held block is never blurred
      if (length(vel) > 0.0009) {
        vec3 acc = c;
        for (int i = 1; i < 8; i++) acc += texture2D(tScene, uv + vel * (float(i) / 7.0 - 0.5)).rgb;
        c = acc / 8.0;
      }
    }
  #endif
  #ifdef DOF
    if (uDof.z > 0.5) {   // photo mode: depth of field (golden-angle gather, samples only contribute if their own circle of confusion reaches this pixel)
      float z0 = -(uNF.x * uNF.y) / ((uNF.y - uNF.x) * texture2D(tDepth, uv).r - uNF.y);
      float coc = clamp(abs(1.0 / max(z0, 0.05) - 1.0 / uDof.x) * uDof.y, 0.0, 1.0) * uDof.w;
      if (coc > 0.7) {
        vec3 acc = c; float wsum = 1.0;
        for (int i = 0; i < 24; i++) {
          float fi = float(i) + 0.5, r = sqrt(fi / 24.0) * coc, a = fi * 2.399963;
          vec2 o = vec2(cos(a), sin(a)) * r / uRes;
          float zs = -(uNF.x * uNF.y) / ((uNF.y - uNF.x) * texture2D(tDepth, uv + o).r - uNF.y);
          float cs = clamp(abs(1.0 / max(zs, 0.05) - 1.0 / uDof.x) * uDof.y, 0.0, 1.0) * uDof.w;
          float w = clamp(cs - r + 1.0, 0.0, 1.0);
          vec3 sc = texture2D(tScene, uv + o).rgb;
          acc += sc * (1.0 + 2.5 * smoothstep(1.2, 4.0, dot(sc, vec3(0.33)))) * w; wsum += w * (1.0 + 2.5 * smoothstep(1.2, 4.0, dot(sc, vec3(0.33))));   // bright highlights bloom into bokeh
        }
        c = acc / wsum;
      }
    }
  #endif
  #ifdef SSAO
    {
      float ao = texture2D(tAO, uv).r, lum = dot(c, vec3(0.2126, 0.7152, 0.0722)) * uP.x;
      c *= mix(1.0, ao, 0.92 * mix(1.0, 0.5, smoothstep(0.3, 1.1, lum)));   // less AO on strongly sunlit pixels (it should only dim ambient light)
    }
  #endif
  #ifdef BLOOM
    c += texture2D(tBloom, uv).rgb * uP.y;
  #endif
  #ifdef RAYS
    c += texture2D(tRays, uv).rgb * uP.z;
  #endif
  #ifdef VOLUMETRIC
    {
      vec3 v = texture2D(tVol, uv).rgb * 0.4 + 0.15 * (texture2D(tVol, uv + vec2(uVolTexel.x, 0.0)).rgb + texture2D(tVol, uv - vec2(uVolTexel.x, 0.0)).rgb
             + texture2D(tVol, uv + vec2(0.0, uVolTexel.y)).rgb + texture2D(tVol, uv - vec2(0.0, uVolTexel.y)).rgb);
      c += v;
    }
  #endif
  #ifdef FLARE
    if (uFlare.z > 0.001) {
      vec2 sp = uFlare.xy, asp = vec2(uFlare.w, 1.0);
      float vis = 0.0;                                                   // soft sun visibility: 9 depth taps around the sun position
      for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) vis += step(0.99999, texture2D(tDepth, sp + vec2(float(i), float(j)) * 0.012).r);
      vis /= 9.0;
      if (vis > 0.01) {
        vec2 axis = vec2(0.5) - sp, d = (vUv - sp) * asp;
        vec3 fl = vec3(0.0);
        for (int i = 1; i <= 5; i++) {                                    // ghosts mirrored through the screen centre
          float fi = float(i);
          vec2 gp = sp + axis * (fi * 0.46);
          float r = length((vUv - gp) * asp);
          vec3 tint = mix(vec3(1.0, 0.7, 0.4), vec3(0.4, 0.7, 1.0), fi / 5.0);
          fl += tint * (smoothstep(0.05 + 0.012 * fi, 0.0, r) * 0.10 + smoothstep(0.012, 0.0, abs(r - (0.05 + 0.012 * fi))) * 0.07) / fi;
        }
        float hr = length(d);
        fl += vec3(1.0, 0.86, 0.6) * (smoothstep(0.02, 0.0, abs(hr - 0.2)) * 0.07 + exp(-hr * 6.0) * 0.12);      // halo + soft glow
        fl += vec3(0.7, 0.85, 1.0) * exp(-abs(d.y) * 90.0) * exp(-abs(d.x) * 2.4) * 0.09;                          // anamorphic streak
        c += fl * uFlare.z * vis;
      }
    }
  #endif
  #ifdef AUTOEXP
    c *= texture2D(tExp, vec2(0.5)).r;
  #endif
  c *= uP.x;
  // underwater tint
  c = mix(c, c * vec3(0.55, 0.95, 1.1) + vec3(0.0, 0.012, 0.02), uP.w);
  c = gradeColor(aces(c));
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * 0.4;
  c = pow(max(c, vec3(0.0)), vec3(0.4545));
  #ifdef CINE
    c += (hash12(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * (5.0 / 255.0) * (1.0 - dot(c, vec3(0.3, 0.55, 0.15)) * 0.7);   // subtle film grain, strongest in the shadows
  #endif
  #ifndef FXAA
    c += (hash12(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0);
  #endif
  gl_FragColor = vec4(c, 1.0);
}
`;

export const FXAA_FS = /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel;
varying vec2 vUv;
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
void main(){
  vec3 rgbM = texture2D(tSrc, vUv).rgb;
  vec3 rgbNW = texture2D(tSrc, vUv + vec2(-1.0, -1.0) * uTexel).rgb;
  vec3 rgbNE = texture2D(tSrc, vUv + vec2( 1.0, -1.0) * uTexel).rgb;
  vec3 rgbSW = texture2D(tSrc, vUv + vec2(-1.0,  1.0) * uTexel).rgb;
  vec3 rgbSE = texture2D(tSrc, vUv + vec2( 1.0,  1.0) * uTexel).rgb;
  float lM = luma(rgbM), lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE);
  float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE))), lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
  float dirReduce = max((lNW + lNE + lSW + lSE) * 0.25 * 0.125, 1.0 / 128.0);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * uTexel;
  vec3 rgbA = 0.5 * (texture2D(tSrc, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tSrc, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
  vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tSrc, vUv + dir * -0.5).rgb + texture2D(tSrc, vUv + dir * 0.5).rgb);
  float lB = luma(rgbB);
  vec3 c = (lB < lMin || lB > lMax) ? rgbA : rgbB;
  c += (hash12(gl_FragCoord.xy) - 0.5) * (1.5 / 255.0);
  gl_FragColor = vec4(c, 1.0);
}
`;
