// Shared GLSL chunks: uniforms, noise, sky gradient, aerial-perspective fog, lighting, tonemap.
// All lighting is linear. Textures/aColor are sRGB bytes decoded with srgb2lin().

export const UNIFORMS = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;      // direction TO the sun
uniform vec3 uMoonDir;
uniform vec3 uKeyDir;      // main light (sun by day, moon by night)
uniform vec3 uKeyColor;    // linear HDR colour of the key light
uniform vec3 uAmbSky;      // hemispheric ambient (linear)
uniform vec3 uAmbGround;
uniform vec3 uZenith;      // sky gradient (display-linear, multiplied by uSkyGain)
uniform vec3 uHorizon;
uniform vec3 uSunGlow;
uniform vec4 uSkyP;        // x night amount 0..1, y sky gain, z exposure, w sun-above-horizon 0..1
uniform vec4 uFogP;        // x 1/fogEnd, y low-height fog boost, z underwater 0..1, w camera Y
uniform vec3 uWaterFog;    // underwater fog colour (linear)
uniform vec2 uWorldOffset; // camera xz mod 4096
uniform vec3 uWind;        // x strength, y time, z gust
uniform float uFade;       // per-mesh fade-in (1 = opaque); set via onBeforeRender while a chunk/tile fades in over its coarser parent
uniform vec4 uCloudP;      // x cloud coverage, y cloud altitude, z morning/evening mist 0..1
uniform vec4 uWeather;     // x overcast/wet 0..1, y lightning flash 0..1
uniform vec4 uHeld;        // handheld light: rgb = colour*intensity (linear), a = 1/radius (0 = off)
`;

export const NOISE = /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y); }
float bayer4(vec2 p){
  ivec2 q = ivec2(mod(p, 4.0));
  const float M[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
  return (M[q.x + q.y * 4] + 0.5) / 16.0;
}
#define FADE_TEST if (uFade < 0.999 && bayer4(gl_FragCoord.xy) > uFade) discard;
vec3 srgb2lin(vec3 c){ return c*c*(c*0.2848 + 0.7152) + 0.0; }   // cheap sRGB->linear (|err|<1%)
vec3 lin2srgb(vec3 c){ return pow(max(c, vec3(0.0)), vec3(0.4545)); }
`;

export const SKY_FN = /* glsl */`
// Overcast: greys and darkens the sky (storm clouds), lightning adds a cold flash.
vec3 overcast(vec3 c){
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  return mix(c, vec3(l) * vec3(0.8, 0.86, 0.96) * 0.7, uWeather.x * 0.84) + vec3(0.55, 0.62, 0.95) * (uWeather.y * 0.75);
}
vec3 skyGradient(vec3 d){
  float h = clamp(d.y, 0.0, 1.0);
  #ifdef SKY_CHEAP
    float t = sqrt(h) * (1.2 - 0.2 * h);
    vec3 c = mix(uHorizon, uZenith, t);
    float sd = max(dot(d, uSunDir), 0.0), sd2 = sd * sd, sd4 = sd2 * sd2;
    c += uSunGlow * (sd4 * 0.3 + sd4 * sd4 * sd4 * 0.5) * (1.0 - t * 0.6) * uSkyP.w;
    return overcast(c * uSkyP.y);
  #else
    float t = pow(h, 0.42);
    vec3 c = mix(uHorizon, uZenith, t);
    float sd = max(dot(d, uSunDir), 0.0);
    float low = 1.0 - t;
    float mie = pow(sd, 5.0) * 0.28 + pow(sd, 48.0) * 0.55 + pow(sd, 700.0) * 2.0;
    c += uSunGlow * mie * (0.55 + 1.6 * low) * uSkyP.w;
    float md = max(dot(d, uMoonDir), 0.0);
    c += vec3(0.42, 0.52, 0.8) * (pow(md, 60.0) * 0.35 + pow(md, 8.0) * 0.04) * uSkyP.x;
    return overcast(c * uSkyP.y);
  #endif
}
`;

export const FOG_FN = /* glsl */`
vec3 applyFog(vec3 col, vec3 rel){
  float dist = length(rel);
  vec3 dir = rel / max(dist, 1e-3);
  float worldY = uFogP.w + rel.y;
  float t = dist * uFogP.x * (1.0 + uWeather.x * 1.25);
  #ifndef SKY_CHEAP
    t *= 1.0 + (uFogP.y + uCloudP.z * 3.2) * exp(-max(worldY - 60.0, 0.0) * 0.014);
  #endif
  float f = 1.0 - exp(-3.1 * t * t * t);
  f = max(f, smoothstep(0.84, 1.0, dist * uFogP.x));
  vec3 fc = skyGradient(dir);
  float uw = uFogP.z;
  f = mix(f, 1.0 - exp(-dist * 0.055), uw);
  fc = mix(fc, uWaterFog * (0.62 + 0.6 * (dir.y * 0.5 + 0.5)), uw);
  return mix(col, fc, clamp(f, 0.0, 1.0));
}
`;

export const LIGHT_FN = /* glsl */`
vec3 lightTerm(float nY, float faceShade, float diff, float sky, float blk, float ao, float shadow){
  float s = sky * sky * (1.6 - 0.6 * sky);
  vec3 amb = mix(uAmbGround, uAmbSky, nY * 0.5 + 0.5) * s * faceShade + vec3(0.016, 0.018, 0.026);
  float sunVis = smoothstep(0.5, 0.92, sky);
  vec3 sun = uKeyColor * diff * sunVis * shadow * (1.0 - 0.86 * uWeather.x);
  amb = amb * (1.0 - 0.14 * uWeather.x) + vec3(0.7, 0.78, 1.0) * (uWeather.y * 0.85 * s);
  vec3 bl = vec3(1.0, 0.58, 0.26) * (blk * blk * 1.5 + blk * 0.12);
  return (amb * ao + sun * mix(1.0, ao, 0.45)) + bl * (0.55 + 0.45 * ao);
}
// Warm light that follows the camera (torch in hand): strong underground / at night, nearly invisible in daylight.
vec3 heldLight(vec3 rel, vec3 N, float sky, float ao){
  float hd = length(rel);
  float a = clamp(1.0 - hd * uHeld.a, 0.0, 1.0);
  a *= a * (0.6 + 0.4 * a);
  float facing = 0.4 + 0.6 * max(dot(N, -rel / max(hd, 1e-3)), 0.0);
  float vis = mix(1.0, 0.1, (1.0 - uSkyP.x) * sky);
  return uHeld.rgb * (a * facing * vis * (0.55 + 0.45 * ao));
}
`;

// Shared by the NO_POST path (finalColor) and the PostFX composite so every tier looks the same.
export const GRADE_FN = /* glsl */`
vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
// c = tonemapped display-linear colour. Mild: slightly desaturated greens, cool shadows / warm highlights, soft contrast.
vec3 gradeColor(vec3 c){
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, 0.9);
  c *= mix(vec3(0.97, 1.0, 1.035), vec3(1.025, 1.0, 0.97), smoothstep(0.06, 0.75, l));
  return mix(c, c * c * (3.0 - 2.0 * c), 0.14);
}
`;

export const TONEMAP_FN = /* glsl */`
${GRADE_FN}
vec3 finalColor(vec3 c, vec2 fragCoord){
  c = gradeColor(aces(c * uSkyP.z));
  c = lin2srgb(c);
  c += (hash12(fragCoord) - 0.5) * (1.5 / 255.0);
  return c;
}
`;

// Output stage shared by every material: with post the HDR linear colour goes to the RT, without it we tonemap here.
export const OUTPUT = /* glsl */`
#ifdef NO_POST
  gl_FragColor = vec4(finalColor(col, gl_FragCoord.xy), outAlpha);
#else
  gl_FragColor = vec4(col, outAlpha);
#endif
`;

export const WATER_FN = /* glsl */`
// World-space wave normal (up-facing). detail 0..1 fades the high frequencies with distance. WATER_FX: 0 flat, 1 waves, 2 +noise octaves.
vec3 waterNormal(vec3 rel, float detail){
  #if WATER_FX == 0
    return vec3(0.0, 1.0, 0.0);
  #else
    vec2 wp = rel.xz + uWorldOffset;
    float tm = uTime;
    vec2 g = vec2(0.0);
    g += vec2(cos(dot(wp, vec2(0.62, 0.45)) * 1.3 + tm * 1.3), cos(dot(wp, vec2(-0.5, 0.71)) * 1.7 - tm * 1.1)) * 0.5;
    g += vec2(cos(dot(wp, vec2(0.9, -0.3)) * 3.1 + tm * 2.0), cos(dot(wp, vec2(0.2, 0.95)) * 2.6 + tm * 1.7)) * 0.35;
    #if WATER_FX >= 2
      vec2 q = wp * 1.7 + vec2(tm * 0.35, tm * 0.22);
      float e = 0.35;
      float n0 = vnoise(q), nx = vnoise(q + vec2(e, 0.0)), nz = vnoise(q + vec2(0.0, e));
      vec2 q2 = wp * 4.3 - vec2(tm * 0.5, -tm * 0.3);
      float m0 = vnoise(q2), mx = vnoise(q2 + vec2(e, 0.0)), mz = vnoise(q2 + vec2(0.0, e));
      g += vec2(nx - n0, nz - n0) * (1.6 / e) * 0.5 + vec2(mx - m0, mz - m0) * (1.0 / e) * 0.3;
    #endif
    #if WATER_FX >= 2
      if (uWeather.x > 0.05) {   // raindrop rings: one drop per 1.1-block cell, expanding ring with a falling envelope; active cells scale with rain intensity
        vec2 rp = wp * 0.9, cell = floor(rp), f = fract(rp) - 0.5;
        float h = hash12(cell), t = fract(uTime * (0.7 + 0.6 * h) + h * 7.0);
        vec2 dv = f - (hash22(cell) - 0.5) * 0.4;
        float r = length(dv), ring = 0.04 + t * 0.46;
        float wv = exp(-pow((r - ring) * 17.0, 2.0)) * (1.0 - t) * step(h, uWeather.x * 0.8) * detail;
        g += dv / max(r, 1e-3) * wv * 5.5;
      }
    #endif
    float wetK = 1.0 + 0.7 * uWeather.x;   // rain roughens the surface
    return normalize(vec3(-g.x * 0.07 * detail * wetK, 1.0, -g.y * 0.07 * detail * wetK));
  #endif
}

// returns water surface colour (HDR linear) + alpha. rel = camera relative world pos, depth01 = depth factor 0..1 (shallow..deep)
vec4 waterShade(vec3 rel, float depth01, float skyL, float detail, vec3 wtint){
  #if WATER_FX == 0
    vec3 lit0 = (uAmbSky * 0.8 + uKeyColor * 0.22 * max(uKeyDir.y, 0.0)) * (0.35 + 0.65 * skyL);
    vec3 body0 = mix(vec3(0.10, 0.52, 0.55), vec3(0.012, 0.07, 0.19), smoothstep(0.0, 0.55, depth01)) * wtint;
    vec3 hz = mix(uHorizon, uZenith, 0.3) * uSkyP.y;
    float gl = clamp(1.0 - 1.4 * abs(normalize(rel).y), 0.0, 1.0);
    return vec4(mix(body0 * lit0 + vec3(0.003, 0.012, 0.016), hz * 0.8, gl * gl * 0.55), 0.8);
  #endif
  vec3 V = -normalize(rel);
  vec3 N = waterNormal(rel, detail);
  vec2 wp = rel.xz + uWorldOffset;
  float tm = uTime;
  float ndv = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  F = mix(F, 0.0, uFogP.z);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 refl = skyGradient(R);
  float gd = 0.35 + 0.65 * detail;
  float glit = pow(max(dot(R, uSunDir), 0.0), 380.0) * 4.5 * uSkyP.w * gd;
  glit += pow(max(dot(R, uMoonDir), 0.0), 220.0) * 0.45 * uSkyP.x * gd;
  refl += uSunGlow * min(glit, 3.0) * uSkyP.y;
  vec3 shallow = vec3(0.10, 0.52, 0.55), deep = vec3(0.012, 0.07, 0.19);
  vec3 body = mix(shallow, deep, smoothstep(0.0, 0.55, depth01)) * wtint;
  vec3 lit = (uAmbSky * 0.8 + uKeyColor * 0.22 * max(uKeyDir.y, 0.0)) * (0.35 + 0.65 * skyL);
  vec3 col = body * lit * 1.0 + vec3(0.003, 0.012, 0.016);
  col = mix(col, refl * 0.9, F);
  float alpha = mix(0.52, 0.93, smoothstep(0.0, 0.5, depth01));
  alpha = mix(alpha, 1.0, F);
  #if WATER_FX >= 2
    float foamN = vnoise(wp * 2.2 + tm * 0.2) * 0.6 + vnoise(wp * 6.0 - tm * 0.4) * 0.4;
    float foam = smoothstep(0.1, 0.0, depth01 - foamN * 0.08) * smoothstep(0.35, 0.7, foamN) * detail;
    col = mix(col, vec3(0.9, 0.95, 1.0) * (uAmbSky * 1.2 + 0.15), foam * 0.8);
    alpha = mix(alpha, 1.0, foam);
  #endif
  return vec4(col, alpha);
}

#ifdef WATER_SSR
// ---- screen-space water: refraction + absorption from the REAL scene depth behind the surface, SSR with sky fallback ----
uniform sampler2D tSceneColor;   // opaque scene (everything except water), same camera
uniform sampler2D tSceneDepth;
uniform vec4 uProjP;             // x proj[0][0], y proj[1][1], z near, w far
uniform vec2 uInvRes;
float lzOf(float d){ return (uProjP.z * uProjP.w) / ((uProjP.w - uProjP.z) * d - uProjP.w); }   // negative view-space z
vec3 uvOf(vec3 pv){ vec2 ndc = vec2(pv.x * uProjP.x, pv.y * uProjP.y) / (-pv.z); return vec3(ndc * 0.5 + 0.5, -pv.z); }
float hashW(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }

vec4 waterShadeSSR(vec3 mv, vec3 rel, float skyL, float detail, vec3 wtint){
  vec3 V = -normalize(rel);
  vec3 N = waterNormal(rel, detail);
  vec3 Nv = mat3(viewMatrix) * N;
  vec2 uv = gl_FragCoord.xy * uInvRes;
  float dSc = texture2D(tSceneDepth, uv).r;
  float sceneZ = dSc > 0.99999 ? -uProjP.w : lzOf(dSc);
  float dz = max(mv.z - sceneZ, 0.0);                                    // view-space gap water -> seabed
  float L = min(dz / max(-normalize(mv).z, 0.15), 90.0);                   // path length through the water
  // refraction: distort the lookup more with thickness, but never sample something in front of the surface
  vec2 off = Nv.xy * (0.07 * min(L, 5.0) / (1.0 + (-mv.z) * 0.03));
  vec2 uvR = uv + off;
  float zR = lzOf(texture2D(tSceneDepth, uvR).r);
  if (zR > mv.z - 0.05) uvR = uv;
  vec3 sc = texture2D(tSceneColor, uvR).rgb;
  // Beer-Lambert: red dies first, deep water goes blue-green
  vec3 absorb = vec3(0.42, 0.115, 0.06);
  vec3 trans = exp(-absorb * L);
  vec3 lit = (uAmbSky * 0.8 + uKeyColor * 0.22 * max(uKeyDir.y, 0.0)) * (0.35 + 0.65 * skyL);
  vec3 scatter = vec3(0.05, 0.36, 0.42) * wtint * lit;
  vec3 refr = sc * trans + scatter * (1.0 - exp(-L * 0.16));
  // reflection: sky first, then try to find scene geometry along the mirrored ray
  float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N); R.y = abs(R.y);
  vec3 refl = skyGradient(R);
  float gd = 0.35 + 0.65 * detail;
  float glit = pow(max(dot(R, uSunDir), 0.0), 380.0) * 4.5 * uSkyP.w * gd;
  glit += pow(max(dot(R, uMoonDir), 0.0), 220.0) * 0.45 * uSkyP.x * gd;
  refl += uSunGlow * min(glit, 3.0) * uSkyP.y;
  vec3 Rv = reflect(normalize(mv), Nv);
  float hit = 0.0;
  if (Rv.z < -0.02 && -mv.z < 420.0) {
    float tt = 0.35 + 0.16 * fract(hashW(gl_FragCoord.xy) + fract(uTime * 7.31) * 0.61803), prevT = 0.0;
    vec3 hp = vec3(0.0);
    for (int i = 0; i < 26; i++) {
      vec3 p = mv + Rv * tt;
      vec3 u3 = uvOf(p);
      if (p.z > -0.2 || u3.x < 0.0 || u3.x > 1.0 || u3.y < 0.0 || u3.y > 1.0) break;
      float sz = lzOf(texture2D(tSceneDepth, u3.xy).r);
      float diff = sz - p.z;                                   // >0: ray point is BEHIND the surface stored in the depth buffer
      if (diff > 0.0 && diff < max(0.7, tt * 0.4)) {
        float lo = prevT, hi = tt;                             // binary refine
        for (int j = 0; j < 4; j++) {
          float mid = 0.5 * (lo + hi); vec3 pm = mv + Rv * mid; vec3 um = uvOf(pm);
          if (lzOf(texture2D(tSceneDepth, um.xy).r) - pm.z > 0.0) hi = mid; else lo = mid;
        }
        hp = uvOf(mv + Rv * hi);
        hit = 1.0;
        break;
      }
      prevT = tt; tt *= 1.17;
    }
    if (hit > 0.5) {
      vec2 e = min(hp.xy, 1.0 - hp.xy);
      float fade = smoothstep(0.0, 0.12, min(e.x, e.y)) * (1.0 - smoothstep(250.0, 420.0, -mv.z));
      float isSky = step(0.99999, texture2D(tSceneDepth, hp.xy).r);
      vec3 hc = texture2D(tSceneColor, hp.xy).rgb;
      refl = mix(refl, hc, fade * (1.0 - isSky));
    }
  }
  vec3 col = mix(refr, refl * 0.95, F);
  // shoreline foam where the water gets thin
  vec2 wp = rel.xz + uWorldOffset;
  float foamN = vnoise(wp * 2.2 + uTime * 0.2) * 0.6 + vnoise(wp * 6.0 - uTime * 0.4) * 0.4;
  float foam = smoothstep(0.55, 0.0, L - foamN * 0.35) * smoothstep(0.3, 0.7, foamN) * detail * (1.0 - uFogP.z);
  col = mix(col, vec3(0.92, 0.96, 1.0) * (uAmbSky * 1.25 + 0.15), foam * 0.85);
  return vec4(col, 1.0);
}
#endif
`;
