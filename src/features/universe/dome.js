// Dome visual: translucent hexagonal energy shell around the home spawn (one draw call, depth-tested, off on potato).
// Reads ctx.dome.mode (N) + 'dome:change': closed = shimmering shell, open = faint shell with a doorway, invite = amber pulse.
import * as THREE from 'three';

const RADIUS = 48;
const MODES = { closed: 0, open: 1, invite: 2 };
const VS = /* glsl */`
varying vec3 vDir; varying vec3 vN; varying vec3 vV;
void main(){
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const FS = /* glsl */`
uniform float uTime; uniform vec4 uSkyP; uniform float uMode; uniform float uDoor; uniform float uFade;
varying vec3 vDir; varying vec3 vN; varying vec3 vV;
float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec3 d = normalize(vDir);
  vec2 p = d.xz / (1.0 + max(d.y, -0.6)) * 9.0;                      // stereographic: conformal, so cells stay hexagons
  vec2 r = vec2(1.0, 1.7320508), hf = r * 0.5;
  vec2 a = mod(p, r) - hf, b = mod(p - hf, r) - hf;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b, id = p - gv;
  vec2 q = abs(gv); float he = max(dot(q, normalize(vec2(1.0, 1.7320508))), q.x);
  float edge = smoothstep(0.075, 0.0, 0.5 - he);                       // bright seams
  float rad = length(p);
  float pulse = pow(0.5 + 0.5 * sin(rad * 1.4 - uTime * 1.3), 8.0);       // soft ripples travelling outwards
  float flick = smoothstep(0.93, 1.0, sin(uTime * 0.55 + h12(id) * 47.0));
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
  float amb = 0.035 + 0.28 * fres;
  float a0 = amb + edge * (0.16 + 0.45 * pulse + 0.2 * fres) + flick * 0.22 * (0.4 + edge);
  vec3 cClosed = vec3(0.25, 0.78, 1.0), cOpen = vec3(0.35, 1.0, 0.7), cInv = vec3(1.0, 0.72, 0.28);
  vec3 col = uMode < 1.0 ? mix(cClosed, cOpen, uMode) : mix(cOpen, cInv, uMode - 1.0);
  float openK = clamp(1.0 - abs(uMode - 1.0), 0.0, 1.0);                // 1 only in 'open'
  a0 *= mix(1.0, 0.45, openK);
  float ang = atan(d.z, d.x) - uDoor; ang = abs(atan(sin(ang), cos(ang)));
  float gap = smoothstep(0.62, 0.5, ang * 1.0 + d.y * 1.15);          // arched doorway in 'open' mode
  a0 *= 1.0 - gap * openK;
  a0 += exp(-pow(d.y * 7.0, 2.0)) * (0.3 + 0.4 * pulse) * (1.0 - 0.7 * gap * openK);   // glowing ground ring
  a0 *= smoothstep(-0.3, -0.04, d.y) * uFade;
  float k = uSkyP.y * 0.85;                                           // keep the glow readable at any exposure
  gl_FragColor = vec4(col * (0.55 + 0.9 * edge + 0.5 * pulse) * k, clamp(a0, 0.0, 0.85));
}`;

let st = null;   // { mesh, mat, mode, shown, base:[x,y,z] }

/** build the dome mesh when this planet is a home planet and the machine can afford it */
export function initDome(ctx) {
  st = null;
  if (!ctx.planet.isHome || !ctx.gr || !ctx.gr.shared) return;
  const sh = ctx.gr.shared;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: sh.uTime, uSkyP: sh.uSkyP, uMode: { value: 0 }, uDoor: { value: (ctx.planet.seed % 628) / 100 }, uFade: { value: 1 } },
    vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 56, 28, 0, Math.PI * 2, 0, Math.PI / 2 + 0.32), mat);
  mesh.scale.setScalar(RADIUS); mesh.visible = false; mesh.renderOrder = 4; mesh.frustumCulled = false; mesh.name = 'dome';
  ctx.gr.scene.add(mesh);
  st = { mesh, mat, mode: modeOf(ctx), cur: modeNum(modeOf(ctx)), center: null };
  st.off = ctx.events.on('dome:change', (e) => { if (st && e && e.mode in MODES) st.mode = e.mode; });
}

const modeOf = (ctx) => (ctx.dome && ctx.dome.mode in MODES ? ctx.dome.mode : ctx.planet.domeMode in MODES ? ctx.planet.domeMode : 'closed');
const modeNum = (m) => MODES[m] ?? 0;
const key = (ctx) => `horizon.dome.${ctx.planet.seed}`;

/** the world is ready: pin the dome around the spawn (remembered per planet so it never wanders) */
export function readyDome(ctx) {
  if (!st) return;
  let c = null;
  try { c = JSON.parse(localStorage.getItem(key(ctx)) || 'null'); } catch { /* storage unavailable */ }
  if (!Array.isArray(c) || c.length !== 2) { c = [Math.floor(ctx.player.x), Math.floor(ctx.player.z)]; try { localStorage.setItem(key(ctx), JSON.stringify(c)); } catch { /* ignore */ } }
  const gy = ctx.world.getSurfaceY(c[0], c[1]);
  st.center = c; st.mesh.position.set(c[0] + 0.5, gy - 1, c[1] + 0.5);
}

/** per frame: mode easing + visibility (only a few uniforms; nothing when potato or far away) */
export function updateDome(dt, ctx) {
  if (!st || !st.center) return;
  const q = ctx.gr.quality, near = Math.hypot(ctx.player.x - st.center[0], ctx.player.z - st.center[1]) < RADIUS * 4;
  const on = near && !!q && q.skyDetail > 0;
  if (st.mesh.visible !== on) st.mesh.visible = on;
  if (!on) return;
  const m = modeOf(ctx); if (m !== st.mode) st.mode = m;
  const t = modeNum(st.mode); st.cur += (t - st.cur) * Math.min(1, dt * 2.5);
  st.mat.uniforms.uMode.value = st.cur;
}

export function disposeDome(ctx) {
  if (!st) return;
  if (st.off) st.off();
  ctx.gr.scene.remove(st.mesh); st.mesh.geometry.dispose(); st.mat.dispose(); st = null;
}
