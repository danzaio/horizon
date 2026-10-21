import { UNIFORMS, NOISE, SKY_FN, TONEMAP_FN, OUTPUT } from './common.js';

export const SKY_VS = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}
`;

// Defines: NO_POST, SKY_DETAIL (0..2), CLOUDS (0..2)
export const SKY_FS = /* glsl */`
${UNIFORMS}
${NOISE}
${SKY_FN}
${TONEMAP_FN}
uniform mat3 uStarRot;
varying vec3 vDir;

float cloudNoise(vec2 p){
  #if CLOUDS >= 2
    return vnoise(p) * 0.52 + vnoise(p * 2.13 + 7.3) * 0.28 + vnoise(p * 4.41 + 3.1) * 0.14 + vnoise(p * 9.0 + 1.7) * 0.06;
  #else
    return vnoise(p) * 0.65 + vnoise(p * 2.3 + 7.3) * 0.35;
  #endif
}


#if CLOUDS >= 3
// Volumetric-looking cumulus: a height-field slab ray-marched in 10 steps, each step lit by marching toward the sun (self-shadowing),
// with powder darkening on the cores and a silver lining against the sun. Wind scrolls the field.
float cloudTop(vec2 xz, float cover){
  vec2 cp = xz * 0.0042 + vec2(uTime * 0.011, uTime * 0.004);
  float n = vnoise(cp) * 0.5 + vnoise(cp * 2.13 + 7.3) * 0.28 + vnoise(cp * 4.41 + 3.1) * 0.15 + vnoise(cp * 9.3 + 1.7) * 0.07;
  return (n - cover) * 2.1;                                   // cloud top as a fraction of the slab height (<0: clear sky)
}
vec4 volClouds(vec3 d){
  float camY = uFogP.w, base = uCloudP.y, thick = 170.0;
  float cover = uCloudP.x - 0.05 - uWeather.x * 0.4;
  float t0 = max((base - camY) / d.y, 0.0), t1 = min((base + thick - camY) / d.y, 16000.0);
  if (t1 <= t0) return vec4(0.0);
  const int N = 10;
  float dt = (t1 - t0) / float(N);
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + fract(uTime * 7.31) * 0.61803);
  vec3 sunL = uSunDir; vec2 sdxz = sunL.xz / max(sunL.y, 0.12);   // horizontal travel per unit of height toward the sun
  float T = 1.0; vec3 acc = vec3(0.0);
  float dayA = uSkyP.w;
  vec3 litC = mix(vec3(0.3, 0.34, 0.5) * 0.35, mix(vec3(1.0), uSunGlow, 0.38) * 1.18, dayA);
  vec3 shC = mix(uZenith, uHorizon, 0.5) * 0.8 + vec3(0.03, 0.035, 0.05) * dayA;
  float phase = pow(max(dot(d, sunL), 0.0), 6.0);
  for (int i = 0; i < N; i++) {
    float t = t0 + (float(i) + jit) * dt;
    vec2 xz = d.xz * t + uWorldOffset;
    float hf = (camY + d.y * t - base) / thick;
    float top = cloudTop(xz, cover);
    float dens = smoothstep(hf - 0.03, hf + 0.14, top) * smoothstep(0.0, 0.12, hf);
    dens *= 0.7 + 0.6 * vnoise(xz * 0.018 + vec2(hf * 4.0, 0.0));        // billowy erosion
    if (dens < 0.01) continue;
    // sun visibility: three taps toward the sun through the field
    float occ = 0.0;
    for (int k = 1; k <= 3; k++) {
      float hs = hf + 0.18 * float(k);
      vec2 xs = xz + sdxz * (0.18 * float(k) * thick);
      occ += smoothstep(hs - 0.04, hs + 0.2, cloudTop(xs, cover));
    }
    float lit = exp(-occ * 0.75);
    float powder = 1.0 - exp(-dens * 3.0);
    vec3 c = mix(shC, litC, lit * (0.55 + 0.45 * smoothstep(0.0, 0.7, hf)));
    c += litC * phase * lit * 0.55 * (1.0 - dens * 0.6);                  // silver lining
    c *= 0.82 + 0.18 * powder;
    float a = 1.0 - exp(-dens * dt * 0.0125);
    acc += T * a * c; T *= (1.0 - a);
    if (T < 0.03) break;
  }
  float fade = smoothstep(0.012, 0.16, d.y);
  vec3 col = acc * uSkyP.y;
  col = mix(col, skyGradient(d) * (1.0 - T), (1.0 - fade) * 0.9);        // melt into the haze near the horizon
  col = mix(col, vec3(dot(col, vec3(0.333))) * vec3(0.7, 0.75, 0.82), uWeather.x * 0.7);
  return vec4(col, (1.0 - T) * fade);
}
#endif

#if SKY_DETAIL >= 2
// Aurora: a few stacked curtains at 1-2.5 km altitude, bands drift and fold slowly; green at the bottom blending to violet.
float auroraBand(vec2 p){
  float n = vnoise(p * vec2(0.9, 0.3) + vec2(uTime * 0.018, 0.0)) * 0.75 + vnoise(p * vec2(2.6, 0.7) - vec2(uTime * 0.034, 0.0)) * 0.25;
  return smoothstep(0.62, 0.95, 1.0 - abs(n - 0.5) * 2.0);
}
vec3 aurora(vec3 d){
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 7; i++) {
    float k = float(i) / 6.0;
    float t = (900.0 + k * 1500.0) / max(d.y, 0.05);
    vec2 p = d.xz * t * 0.0011 + vec2(3.7, 1.3);
    float b = auroraBand(p) * (1.0 - k * 0.45);
    acc += mix(vec3(0.08, 1.0, 0.42), vec3(0.62, 0.22, 0.95), k * k) * b;
  }
  return acc * smoothstep(0.03, 0.35, d.y) * (0.5 + 0.5 * vnoise(d.xz * 9.0 + uTime * 0.05));
}
#endif

void main(){
  vec3 d = normalize(vDir);
  vec3 col = skyGradient(d);
  float up = d.y;
  // sun disc
  float sd = dot(d, uSunDir);
  float disc = smoothstep(0.99935, 0.99965, sd);
  col += vec3(1.0, 0.86, 0.62) * disc * 14.0 * uSkyP.w * step(-0.03, up) * (1.0 - 0.95 * uWeather.x);
  // moon + stars
  #if SKY_DETAIL >= 1
    float md = dot(d, uMoonDir);
    float night = uSkyP.x;
    if (md > 0.9985 && night > 0.01) {
      vec3 T = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.01))), Bt = cross(T, uMoonDir);
      vec2 mq = vec2(dot(d, T), dot(d, Bt)) / 0.0425;
      float r2 = dot(mq, mq);
      if (r2 < 1.0) {
        vec3 nn = T * mq.x + Bt * mq.y + uMoonDir * sqrt(1.0 - r2);
        float ph = smoothstep(-0.15, 0.25, dot(nn, uSunDir));
        float cr = 0.72 + 0.28 * vnoise(mq * 4.5 + 3.0) + 0.1 * vnoise(mq * 11.0);
        col = mix(col, vec3(0.78, 0.83, 0.95) * cr * (0.06 + ph) * 2.2 * uSkyP.y, smoothstep(1.0, 0.92, r2) * night);
      }
    }
    if (night > 0.02 && up > -0.05) {
      vec3 sd3 = uStarRot * d;
      vec3 q = sd3 * 150.0, id = floor(q);
      float h = hash13(id);
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + h * 3.0) + h * 40.0);
      float star = step(0.9955, h) * smoothstep(0.52, 0.05, length(fract(q) - 0.5)) * tw;
      vec3 sc = mix(vec3(0.8, 0.88, 1.0), vec3(1.0, 0.85, 0.65), hash13(id + 3.7));
      float band = exp(-pow(sd3.z * 3.2 + 0.25 * sin(sd3.x * 3.0), 2.0));
      float mw = band * (0.5 + 0.7 * vnoise(sd3.xy * 9.0 + sd3.z * 5.0)) * 0.05;
      float sky0 = smoothstep(0.0, 0.25, up);
      col += (sc * star * 1.6 + vec3(0.5, 0.55, 0.8) * mw) * night * (0.4 + 0.6 * sky0) * uSkyP.y;
    }
  #endif
  #if SKY_DETAIL >= 2
    if (uSkyP.x > 0.5 && up > 0.03 && uWeather.x < 0.6) col += aurora(d) * 0.13 * smoothstep(-0.25, 0.75, -d.z - 0.15 * d.x) * smoothstep(0.5, 0.95, uSkyP.x) * (1.0 - uWeather.x) * uSkyP.y;
  #endif
  #if SKY_DETAIL >= 1
    if (uWeather.w > 0.01 && up > 0.0) {   // primary rainbow: 42 deg ring around the anti-solar point, red outside, violet inside
      float ang = acos(clamp(dot(d, -uSunDir), -1.0, 1.0));
      float t = (ang - 0.7295) / 0.036;
      float band = smoothstep(1.15, 0.2, abs(t));
      if (band > 0.0) {
        float hue = clamp(0.5 - 0.5 * t, 0.0, 1.0) * 0.78;                       // 0 = red (outer) .. 0.78 = violet (inner)
        vec3 rb = 0.5 + 0.5 * cos(6.28318 * (vec3(hue) + vec3(0.0, 0.33, 0.67)));
        rb = pow(rb, vec3(1.6));
        col += rb * band * uWeather.w * 0.5 * smoothstep(0.0, 0.12, up) * uSkyP.y * (0.45 + 0.55 * uSkyP.w);
      }
    }
  #endif
  // clouds
  #if CLOUDS >= 3
    if (up > 0.012) { vec4 vc = volClouds(d); col = mix(col, vc.rgb, vc.a); }
  #elif CLOUDS >= 1
    if (up > 0.015) {
      float camY = uFogP.w;
      float th = (uCloudP.y - camY) / up;
      th = min(th, 14000.0);
      vec2 cp = ((d.xz * th) + uWorldOffset) * 0.0048 + vec2(uTime * 0.012, uTime * 0.0045);
      float cover = uCloudP.x - uWeather.x * 0.46;
      float n = cloudNoise(cp);
      float dens = smoothstep(cover, cover + 0.22, n);
      if (dens > 0.002) {
        vec2 sdir = normalize(uSunDir.xz + 1e-4) * 0.07;
        float lit;
        #if CLOUDS >= 2
          float n1 = cloudNoise(cp + sdir), n2 = cloudNoise(cp + sdir * 2.2);
          float thick = (smoothstep(cover, cover + 0.22, n1) + smoothstep(cover, cover + 0.22, n2)) * 0.5;
          lit = clamp(1.0 - thick * 0.9 + (n - n1) * 1.5, 0.0, 1.0);
          dens = pow(dens, 0.8);
        #else
          float n1 = cloudNoise(cp + sdir);
          lit = clamp(0.62 + (n - n1) * 2.6, 0.0, 1.0);
        #endif
        float dayA = uSkyP.w;
        vec3 litC = mix(vec3(0.38, 0.44, 0.65) * 0.3, mix(vec3(1.0), uSunGlow, 0.42) * 1.12, dayA);
        vec3 shC = mix(uZenith, uHorizon, 0.55) * 0.82 + vec3(0.03, 0.035, 0.05) * dayA;
        shC = mix(shC, shC * vec3(0.8, 0.82, 0.95), 0.35);
        vec3 cc = mix(shC, litC, lit) * uSkyP.y;
        cc = mix(cc, cc * vec3(0.55, 0.6, 0.68), uWeather.x) + vec3(0.5, 0.56, 0.9) * (uWeather.y * 0.8);
        float a = dens * smoothstep(0.015, 0.2, up) * (1.0 - 0.0 * night);
        col = mix(col, cc, a * 0.96);
      }
    }
  #endif
  vec3 wcol = uWaterFog * (0.62 + 0.6 * (d.y * 0.5 + 0.5));
  #if SKY_DETAIL >= 1
    float shaft = vnoise(vec2(atan(d.x, d.z) * 5.0 + uTime * 0.25, d.y * 1.5));
    wcol *= 1.0 + 0.55 * shaft * shaft * shaft * smoothstep(0.0, 0.7, d.y) * uSkyP.w;
  #endif
  col = mix(col, wcol * 1.4, uFogP.z);
  float outAlpha = 1.0;
  ${OUTPUT}
}
`;
