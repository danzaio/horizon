// The 3D concert stage on the Esplanada: truss, amp walls, drum riser, volumetric light beams,
// the Congresso silhouette, crowd cut-outs, projectiles, and the fighting-game camera.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toon, part, canvasTex, hatchU } from './toon.js';
import { Rocker } from './rocker.js';
import { Gotinha, Syringe, makeVorcaro, buildDuck, LEADERS } from './extras.js';
import { W, H, GY, TAU, clamp, lerp, rnd, canvas, FONT } from '../shared.js';

const FOV = 30, TANH = Math.tan(FOV / 2 * Math.PI / 180);
const LIGHTCOLS = ['#ff2bd6', '#29d8ff', '#ffb52b', '#8a5bff', '#ff4d2b'].map(c => new THREE.Color(c));

function paint(w, h, fn) { const c = canvas(w, h); fn(c.getContext('2d'), w, h); return c; }
function radialTex(inner, outer) {
  return canvasTex(paint(128, 128, (g) => { const r = g.createRadialGradient(64, 64, 2, 64, 64, 63); r.addColorStop(0, inner); r.addColorStop(1, outer); g.fillStyle = r; g.fillRect(0, 0, 128, 128); }));
}
function windowsTex(cols, rows, lit) {
  return canvasTex(paint(cols * 8, rows * 8, (g, w, h) => {
    g.fillStyle = '#2c0f3a'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (Math.random() < lit) { g.fillStyle = Math.random() < 0.8 ? '#ffd98a' : '#fff4d0'; g.fillRect(x * 8 + 2, y * 8 + 2, 4, 4); }
  }));
}

export class Stage3D {
  constructor(cv, chars) {
    const r = this.renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#2a0b30', 2200, 6000);
    this.camera = new THREE.PerspectiveCamera(FOV, W / H, 10, 14000);
    this.cam = { x: 640, y: 200, w: 1250, orbit: 0, init: false };
    this.t = 0; this.chars = chars;
    this.buildLights();
    this.set = new THREE.Group(); this.scene.add(this.set);
    this.buildStage(); this.buildCity(); this.buildCrowd();
    this.rockers = {};
    for (const id in chars) { const rk = this.rockers[id] = new Rocker(chars[id]); rk.root.visible = false; this.scene.add(rk.root); }
    const shadowTex = radialTex('rgba(0,0,0,.75)', 'rgba(0,0,0,0)');
    this.blobs = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(170, 50), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.renderOrder = 1; this.scene.add(m); return m; });
    this.buildProjectiles();
    // cameos
    this.gotinha = new Gotinha(); this.scene.add(this.gotinha.root);
    this.syringe = new Syringe(); this.scene.add(this.syringe.root);
    this.vorcaro = makeVorcaro(); this.vorcaro.root.visible = false; this.scene.add(this.vorcaro.root);
    this.buildTorcidas();
    this.setTorcidas(Object.keys(chars));
    this._v = new THREE.Vector3();
  }

  buildLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#a080d0', '#3a1428', 0.75));
    const key = new THREE.DirectionalLight('#fff0dc', 2.7); key.position.set(-500, 900, 1200); s.add(key);
    this.rimA = new THREE.DirectionalLight('#ff3ad0', 2.4); this.rimA.position.set(-900, 500, -800); s.add(this.rimA);
    this.rimB = new THREE.DirectionalLight('#2ad8ff', 2.0); this.rimB.position.set(900, 400, -700); s.add(this.rimB);
    this.flash = new THREE.PointLight('#ffd27a', 0, 1100, 0); this.flash.position.set(0, 200, 250); s.add(this.flash);
  }

  buildStage() {
    const S = this.set;
    // floor: black stage boards
    const floorTex = canvasTex(paint(1024, 512, (g, w, h) => {
      g.fillStyle = '#241820'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 32) { g.fillStyle = `hsl(320,14%,${9 + Math.random() * 5}%)`; g.fillRect(x + 1, 0, 30, h); }
      g.fillStyle = 'rgba(0,0,0,.6)'; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h);
      for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(Math.random() * w, Math.random() * h, rnd(20, 90), 2); }
      g.fillStyle = 'rgba(255,220,60,.7)'; for (const [x, y] of [[300, 300], [720, 300], [512, 380]]) { g.fillRect(x - 14, y - 2, 28, 5); g.fillRect(x - 2, y - 14, 5, 28); }
    }), [3, 1]);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(3000, 1000), new THREE.MeshLambertMaterial({ map: floorTex }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -300); S.add(floor);
    // front lip + bulbs
    part(new THREE.BoxGeometry(3000, 70, 30), toon('#0b060d'), S, 0, -35, 215, 0);
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(5, 8, 6), new THREE.MeshBasicMaterial(), 76);
    const m4 = new THREE.Matrix4(), cols = ['#ff3a3a', '#ffd400', '#2bff5a', '#29b8ff'].map(c => new THREE.Color(c));
    for (let i = 0; i < 76; i++) { m4.makeTranslation(-1500 + i * 40, -22, 231); bulbs.setMatrixAt(i, m4); bulbs.setColorAt(i, cols[i % 4]); }
    S.add(bulbs);
    // amp walls
    const grille = canvasTex(paint(256, 160, (g, w, h) => {
      g.fillStyle = '#121014'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#5e5448'; g.fillRect(12, 12, w - 24, h - 24);
      g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1.5; for (let k = -h; k < w; k += 6) { g.beginPath(); g.moveTo(k, 12); g.lineTo(k + h, h - 12); g.stroke(); }
      g.strokeStyle = '#e9e2cf'; g.lineWidth = 3; g.strokeRect(12, 12, w - 24, h - 24);
      g.font = 'italic bold 34px Georgia, serif'; g.textAlign = 'center'; g.fillStyle = '#e9d9a0'; g.fillText('Briga', w / 2, h - 30);
    }));
    const headTex = canvasTex(paint(256, 64, (g, w, h) => {
      g.fillStyle = '#121014'; g.fillRect(0, 0, w, h); g.fillStyle = '#d9c38f'; g.fillRect(10, 36, w - 20, 16);
      g.fillStyle = '#222'; for (let k = 0; k < 9; k++) { g.beginPath(); g.arc(24 + k * 26, 20, 7, 0, TAU); g.fill(); }
    }));
    const tolex = toon('#151117');
    const box = (w, h, d, front) => [tolex, tolex, tolex, tolex, new THREE.MeshLambertMaterial({ map: front }), tolex];
    const cabGeo = new THREE.BoxGeometry(170, 100, 80), headGeo = new THREE.BoxGeometry(170, 46, 70);
    const cabMat = box(0, 0, 0, grille), headMat = box(0, 0, 0, headTex);
    for (const x of [-740, -560, 560, 740]) {
      const z = -300 - Math.abs(x) * 0.05;
      part(cabGeo, cabMat, S, x, 50, z, 0.8); part(cabGeo, cabMat, S, x, 150, z, 0.8); part(headGeo, headMat, S, x, 223, z, 0.8);
    }
    // drum riser + kit
    part(new THREE.BoxGeometry(340, 44, 180), toon('#18101c'), S, 0, 22, -340, 0.8);
    const kickTex = canvasTex(paint(256, 256, (g) => {
      g.setTransform(0, -1, 1, 0, 0, 256); // the cap's UVs run sideways once the drum is turned to face the crowd
      g.fillStyle = '#e8e2d2'; g.beginPath(); g.arc(128, 128, 126, 0, TAU); g.fill();
      g.fillStyle = '#c8102e'; g.beginPath(); g.arc(128, 128, 98, 0, TAU); g.fill();
      g.font = `96px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 12; g.strokeStyle = '#130a16'; g.strokeText('GB3', 128, 132); g.fillStyle = '#ffd400'; g.fillText('GB3', 128, 132);
    }));
    const shell = toon('#7a1f2a');
    const kick = part(new THREE.CylinderGeometry(50, 50, 40, 32), [shell, new THREE.MeshLambertMaterial({ map: kickTex }), shell], S, 0, 94, -300, 0.8); kick.rotation.x = Math.PI / 2;
    for (const [x, y, z, r, rx] of [[-56, 150, -320, 20, 0.9], [56, 150, -320, 20, 0.9], [-110, 104, -290, 26, 0.2], [110, 96, -300, 28, 0]]) {
      const d = part(new THREE.CylinderGeometry(r, r, 22, 24), [shell, toon('#efe8d8'), shell], S, x, y, z, 0.8); d.rotation.x = rx;
    }
    const gold = toon('#e8b93a'), chrome = toon('#a8a8b4');
    for (const [x, y, z, rz] of [[-150, 196, -310, 0.25], [150, 204, -320, -0.25], [-200, 140, -270, 0.05]]) {
      const c = part(new THREE.CylinderGeometry(34, 34, 2, 28), gold, S, x, y, z, 0.6); c.rotation.z = rz; c.rotation.x = 0.35;
      part(new THREE.CylinderGeometry(2, 2, y, 6), chrome, S, x, y / 2, z, 0);
    }
    // truss
    const trussMat = toon('#8d8f9c');
    const tower = this.trussGeo(880, 34);
    for (const x of [-760, 760]) part(tower, trussMat, S, x, 0, -160, 0.5);
    const beam = part(this.trussGeo(1554, 34), trussMat, S, -777, 880, -160, 0.5); beam.rotation.z = -Math.PI / 2;
    // light cans + volumetric beams + floor pools
    this.beams = [];
    const canGeo = new THREE.CylinderGeometry(14, 18, 30, 16), canMat = toon('#1a1a20');
    const coneGeo = new THREE.CylinderGeometry(10, 150, 860, 32, 1, true); coneGeo.translate(0, -430, 0);
    const poolTex = radialTex('rgba(255,255,255,.9)', 'rgba(255,255,255,0)');
    for (let i = 0; i < 6; i++) {
      const pivot = new THREE.Group(); pivot.position.set(-500 + i * 200, 846, -160); S.add(pivot);
      part(canGeo, canMat, pivot, 0, 0, 0, 0.6);
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color() }, uI: { value: 0.3 } },
        vertexShader: /* glsl */`varying float vA; varying vec3 vN; varying vec3 vV;
          void main() { vA = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */`uniform vec3 uColor; uniform float uI; varying float vA; varying vec3 vN; varying vec3 vV;
          void main() { float f = abs(dot(normalize(vN), normalize(vV))); float a = pow(vA, 1.4) * pow(f, 1.6) * uI; gl_FragColor = vec4(uColor * a, a); }`,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const cone = new THREE.Mesh(coneGeo, mat); pivot.add(cone);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(320, 200), new THREE.MeshBasicMaterial({ map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff, opacity: 0.35 }));
      pool.rotation.x = -Math.PI / 2; pool.renderOrder = 2; S.add(pool);
      this.beams.push({ pivot, mat, pool, ph: i * 1.7 });
    }
    // giant inflatable yellow duck floating behind the amps
    this.duck = buildDuck(); this.duck.position.set(-1150, 330, -1000); this.duck.rotation.y = 0.6; this.duck.scale.setScalar(1.15); S.add(this.duck);
    // drifting stage smoke
    const smokeTex = radialTex('rgba(200,160,240,.5)', 'rgba(200,160,240,0)');
    this.smoke = [];
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(520, 180), new THREE.MeshBasicMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.4 }));
      m.position.set(rnd(-900, 900), 60 + (i % 3) * 25, -260 + (i % 4) * 90); m.userData.v = rnd(0.3, 0.8) * (i % 2 ? 1 : -1); S.add(m); this.smoke.push(m);
    }
  }

  trussGeo(len, w) {
    const parts = [], r = 2.6, h = w / 2;
    const rod = (x1, y1, z1, x2, y2, z2) => {
      const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2), L = a.distanceTo(b);
      const g = new THREE.CylinderGeometry(r, r, L, 5, 1, true);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
      g.translate((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2); parts.push(g);
    };
    const C = [[-h, -h], [h, -h], [h, h], [-h, h]];
    for (const [x, z] of C) rod(x, 0, z, x, len, z);
    for (let y = 0; y < len - 1; y += w) for (let k = 0; k < 4; k++) { const [x1, z1] = C[k], [x2, z2] = C[(k + 1) % 4]; rod(x1, y, z1, x2, Math.min(len, y + w), z2); }
    return mergeGeometries(parts);
  }

  buildCity() {
    const S = this.set;
    // sky backdrop
    const sky = canvasTex(paint(2048, 1024, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h * 0.75);
      gr.addColorStop(0, '#0c0318'); gr.addColorStop(0.45, '#2e0a3c'); gr.addColorStop(0.82, '#7d1c3c'); gr.addColorStop(1, '#c2462e');
      g.fillStyle = gr; g.fillRect(0, 0, w, h * 0.75); g.fillStyle = '#1d0b22'; g.fillRect(0, h * 0.75, w, h * 0.25);
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,240,255,${rnd(0.2, 0.9)})`; const s = Math.random() < 0.1 ? 3 : 1.6; g.fillRect(rnd(0, w), rnd(0, h * 0.55), s, s); }
      const mx = 1480, my = 280, glow = g.createRadialGradient(mx, my, 80, mx, my, 420); glow.addColorStop(0, 'rgba(255,170,90,.55)'); glow.addColorStop(1, 'rgba(255,120,60,0)');
      g.fillStyle = glow; g.fillRect(mx - 420, my - 420, 840, 840);
      g.fillStyle = '#f6c27a'; g.beginPath(); g.arc(mx, my, 150, 0, TAU); g.fill(); g.lineWidth = 10; g.strokeStyle = '#130a16'; g.stroke();
      g.fillStyle = 'rgba(190,110,60,.55)'; for (const [x, y, r] of [[-50, -44, 28], [44, 40, 36], [20, -60, 14], [-70, 56, 18], [90, -30, 16]]) { g.beginPath(); g.arc(mx + x, my + y, r, 0, TAU); g.fill(); }
      g.fillStyle = 'rgba(30,6,40,.6)'; for (const [x, y, ww] of [[200, 240, 600], [1100, 520, 760], [700, 140, 440], [1500, 600, 520]]) { g.beginPath(); g.ellipse(x + ww / 2, y, ww / 2, 16, 0, 0, TAU); g.fill(); }
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; for (let i = 0; i < 90; i++) { g.beginPath(); g.moveTo(i * 12, 0); g.lineTo(i * 12 - 220, 300); g.stroke(); g.beginPath(); g.moveTo(w - i * 12, 0); g.lineTo(w - i * 12 + 220, 300); g.stroke(); }
    }));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(9000, 3600), new THREE.MeshBasicMaterial({ map: sky, fog: false }));
    back.position.set(0, 900, -3200); S.add(back);
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(9000, 2600), new THREE.MeshBasicMaterial({ color: '#1d0b22' }));
    lawn.rotation.x = -Math.PI / 2; lawn.position.set(0, -4, -2100); S.add(lawn);
    // Congresso Nacional: twin towers, the bowl and the dome
    const dark = new THREE.MeshBasicMaterial({ color: '#2c0f3a', side: THREE.DoubleSide });
    const C = new THREE.Group(); C.position.set(0, 0, -1800); S.add(C);
    part(new THREE.BoxGeometry(1200, 44, 280), dark, C, 0, 22, 0, 0.7);
    const towerMat = new THREE.MeshBasicMaterial({ map: windowsTex(5, 52, 0.45) });
    for (const x of [-26, 26]) part(new THREE.BoxGeometry(38, 460, 64), towerMat, C, x, 44 + 230, 0, 0.7);
    part(new THREE.BoxGeometry(96, 16, 64), dark, C, 0, 330, 0, 0.7);
    const bowl = part(new THREE.SphereGeometry(160, 40, 12, 0, TAU, Math.PI / 2, Math.PI / 2), dark, C, -420, 44 + 70, 0, 0.7); bowl.scale.y = 0.45;
    const dome = part(new THREE.SphereGeometry(120, 40, 12, 0, TAU, 0, Math.PI / 2), dark, C, 420, 44, 0, 0.7); dome.scale.y = 0.6;
    // Esplanada ministries
    const minMat = new THREE.MeshBasicMaterial({ map: windowsTex(16, 8, 0.35) });
    for (const s of [-1, 1]) for (let i = 0; i < 6; i++) part(new THREE.BoxGeometry(220, 90, 70), minMat, S, s * (900 + i * 40), 45, -1000 - i * 260, 0.6).rotation.y = s * 0.12;
  }

  buildCrowd() {
    const mk = (variant) => canvasTex(paint(128, 224, (g, w, h) => {
      const draw = (col, lw) => {
        g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round'; g.lineWidth = 15 + lw;
        if (variant >= 1) { g.beginPath(); g.moveTo(28, 120); g.lineTo(14 + variant * 3, 26); g.stroke(); }
        if (variant >= 2) { g.beginPath(); g.moveTo(100, 120); g.lineTo(112 - variant, 20); g.stroke(); }
        g.beginPath(); g.moveTo(8, h); g.quadraticCurveTo(10, 120, 64, 116); g.quadraticCurveTo(118, 120, 120, h); g.fill();
        g.beginPath(); g.ellipse(64, 88, 24 + lw / 2, 29 + lw / 2, 0, 0, TAU); g.fill();
      };
      draw('#ffffff', 3); draw('#000000', 0);
      g.fillStyle = '#000';
      if (variant >= 1) { g.beginPath(); g.arc(14 + variant * 3, 22, 10, 0, TAU); g.fill(); }
      if (variant >= 2) { g.beginPath(); g.arc(112 - variant, 16, 10, 0, TAU); g.fill(); }
    }));
    const faces = [0, 1, 2, 3].map(mk);
    // [side][variant]: left half of the arena cheers for the left fighter, right half for the right one
    this.crowdMats = [0, 1].map(() => faces.map(t => new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.3, fog: false })));
    this.tint = [new THREE.Color('#ff4a5a'), new THREE.Color('#7dff5a')];
    this.crowdExc = [0.2, 0.2];
    const ids = Object.keys(this.chars).filter(id => this.chars[id].torcida);
    // per-torcida cloth for flags and cardboard signs
    const flagMat = {}, signMat = {};
    for (const id of ids) {
      const T = this.chars[id].torcida;
      flagMat[id] = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false, map: canvasTex(paint(128, 80, (g, w, h) => {
        g.fillStyle = T.cloth; g.fillRect(0, 0, w, h); g.lineWidth = 6; g.strokeStyle = '#130a16'; g.strokeRect(0, 0, w, h);
        g.fillStyle = T.emblemCol; g.strokeStyle = '#130a16'; g.lineWidth = 3;
        if (T.emblem === 'star') { g.beginPath(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 11 : 26, a = i / 10 * TAU - Math.PI / 2; g.lineTo(64 + Math.cos(a) * r, 40 + Math.sin(a) * r); } g.closePath(); g.fill(); g.stroke(); }
        else { g.font = `54px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.strokeText(T.emblem, 64, 42); g.fillText(T.emblem, 64, 42); }
      })) });
      signMat[id] = T.signs.map(txt => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false, map: canvasTex(paint(256, 160, (g, w, h) => {
        g.fillStyle = '#ead9a8'; g.fillRect(0, 0, w, h); g.lineWidth = 10; g.strokeStyle = T.cloth; g.strokeRect(5, 5, w - 10, h - 10);
        let size = 70; g.font = `${size}px ${FONT}`; while (g.measureText(txt).width > w - 40) { size -= 4; g.font = `${size}px ${FONT}`; }
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#16131a'; g.fillText(txt, w / 2, h / 2 + 4);
      })) }));
    }
    const geo = new THREE.PlaneGeometry(130, 228), flagGeo = new THREE.PlaneGeometry(64, 40), signGeo = new THREE.PlaneGeometry(92, 57);
    const poleGeo = new THREE.CylinderGeometry(2.2, 2.2, 1, 6), poleMat = new THREE.MeshBasicMaterial({ color: '#0b060d', fog: false });
    this.crowd = [];
    for (let row = 0; row < 3; row++) for (let x = -1000; x <= 1000; x += 64 + row * 10) {
      const side = x < 0 ? 0 : 1, variant = (Math.random() * 4) | 0;
      const m = new THREE.Mesh(geo, this.crowdMats[side][variant]);
      const sc = 0.95 + row * 0.12 + rnd(-0.05, 0.08);
      m.scale.setScalar(sc); m.position.set(x + rnd(-18, 18), -170 + 114 * sc, 300 + row * 80);
      m.userData = { base: m.position.y, ph: rnd(0, TAU), amp: rnd(0.7, 1.3), side, decos: [] };
      if (variant >= 1 && Math.random() < 0.4) {
        const flag = Math.random() < 0.6, k = (Math.random() * 3) | 0;
        const hx = variant === 1 ? -47 : variant === 2 ? (Math.random() < 0.5 ? -44 : 46) : (Math.random() < 0.5 ? -41 : 45), len = flag ? 112 : 78;
        for (const id of ids) {
          const g = new THREE.Group(); g.position.set(hx, 90, 1); g.scale.setScalar(0.55); g.visible = false; g.userData.id = id;
          const pole = new THREE.Mesh(poleGeo, poleMat); pole.scale.y = len; pole.position.y = len / 2; g.add(pole);
          const cloth = new THREE.Mesh(flag ? flagGeo : signGeo, flag ? flagMat[id] : signMat[id][k]);
          cloth.position.set(flag ? 32 : 0, flag ? len - 20 : len + 24, 0.5); g.add(cloth);
          m.add(g); m.userData.decos.push({ g, cloth, flag });
        }
      }
      this.scene.add(m); this.crowd.push(m);
    }
  }

  // each torcida: a leader with a megaphone on a riser, a banner with the group name
  buildTorcidas() {
    this.tors = {};
    const plate = (l1, l2, bg) => canvasTex(paint(512, 128, (g, w, h) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h); g.lineWidth = 10; g.strokeStyle = '#130a16'; g.strokeRect(0, 0, w, h);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const t = (txt, y, size, col) => { g.font = `${size}px ${FONT}`; while (g.measureText(txt).width > w - 40) { size -= 3; g.font = `${size}px ${FONT}`; } g.lineWidth = size * 0.2; g.strokeStyle = '#130a16'; g.strokeText(txt, w / 2, y); g.fillStyle = col; g.fillText(txt, w / 2, y); };
      t(l1, 50, 56, '#ffffff'); t(l2, 98, 28, '#ffe9a0');
    }));
    for (const id in this.chars) {
      const T = this.chars[id].torcida; if (!T) continue;
      const G = new THREE.Group(); G.visible = false; this.scene.add(G);
      const leader = new Rocker(LEADERS[T.leaderId]); G.add(leader.root);
      const riser = new THREE.Group(); G.add(riser);
      const face = new THREE.MeshLambertMaterial({ map: plate(T.leader, 'PUXADOR DA TORCIDA', T.cloth) }), side = toon('#1a1118');
      part(new THREE.BoxGeometry(150, 44, 90), [side, side, side, side, face, side], riser, 0, 22, 120, 0.8);
      const pm = toon('#8d8f9c');
      for (const dx of [-100, 100]) part(new THREE.CylinderGeometry(2.6, 2.6, 300, 8), pm, riser, dx, 150, 70, 0.5);
      part(new THREE.BoxGeometry(206, 5, 5), pm, riser, 0, 292, 70, 0.5);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(196, 78), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, fog: false, map: canvasTex(paint(512, 205, (g, w, h) => {
        g.fillStyle = T.cloth; g.fillRect(0, 0, w, h); g.lineWidth = 14; g.strokeStyle = '#130a16'; g.strokeRect(0, 0, w, h);
        g.strokeStyle = T.emblemCol; g.lineWidth = 5; g.strokeRect(16, 16, w - 32, h - 32);
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
        const line = (txt, y, size) => { g.font = `${size}px ${FONT}`; while (g.measureText(txt).width > w - 70) { size -= 4; g.font = `${size}px ${FONT}`; } g.lineWidth = size * 0.2; g.strokeStyle = '#130a16'; g.strokeText(txt, w / 2, y); g.fillStyle = T.emblemCol; g.fillText(txt, w / 2, y); };
        const [first, ...rest] = T.name.split(' ');
        line(first, 70, 96); line(rest.join(' '), 150, 78);
      })) }));
      banner.position.set(0, 252, 70); riser.add(banner);
      this.tors[id] = { group: G, riser, leader };
    }
  }

  // which character's torcida sits on which half of the arena
  setTorcidas(ids) {
    this.torIds = ids;
    this.tint[0].set(this.chars[ids[0]].torcida.tint); this.tint[1].set(this.chars[ids[1] || ids[0]].torcida.tint);
    for (const m of this.crowd) for (const d of m.userData.decos) d.g.visible = d.g.userData.id === ids[m.userData.side];
  }

  buildProjectiles() {
    const ballTex = canvasTex(paint(256, 128, (g, w, h) => {
      g.fillStyle = '#fbfbf6'; g.fillRect(0, 0, w, h); g.fillStyle = '#16131a';
      const pent = (x, y, r) => { g.beginPath(); for (let i = 0; i < 5; i++) { const a = i / 5 * TAU - Math.PI / 2; g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); } g.closePath(); g.fill(); };
      for (let i = 0; i < 5; i++) { pent(i * 51 + 25, 40, 14); pent(i * 51, 88, 14); } pent(128, 4, 30); pent(128, 124, 30);
    }));
    this.ballMeshes = [0, 1].map(() => { const m = part(new THREE.SphereGeometry(22, 24, 16), toon('#ffffff', { map: ballTex }), this.scene); m.visible = false; return m; });
    // Lula's thrown hammer-and-sickle, spinning like a shuriken
    const sickle = new THREE.Shape(); sickle.absarc(0, 0, 30, -0.35, Math.PI * 1.05, false); sickle.absarc(6, -4, 22, Math.PI * 1.08, -0.2, true); sickle.closePath();
    const eg = (sh, d) => { const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.5, bevelSegments: 1 }); g.translate(0, 0, -d / 2); return g; };
    const gold = toon('#ffd400', { emissive: '#5a3000' }), wood = toon('#6b3a1a');
    this.foiceMeshes = [0, 1].map(() => {
      const g = new THREE.Group(), s = new THREE.Group(), hm = new THREE.Group();
      part(eg(sickle, 5), gold, s, 0, 6, 0, 0.8);
      part(new THREE.BoxGeometry(8, 30, 7), wood, s, 26, -20, 0, 0.8).rotation.z = 0.2;
      s.rotation.z = -0.75; g.add(s);
      part(new THREE.BoxGeometry(8, 62, 7), gold, hm, 0, -8, 3, 0.8);
      part(new THREE.BoxGeometry(34, 15, 12), gold, hm, 0, 26, 3, 0.8);
      hm.rotation.z = 0.75; g.add(hm);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(48, 24), new THREE.MeshBasicMaterial({ color: '#ff2020', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.position.z = -10; g.add(glow);
      g.scale.setScalar(1.45); g.visible = false; this.scene.add(g); return g;
    });
  }

  resize(cssW, cssH, dpr) {
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(cssW, cssH, false);
    hatchU.value = Math.round(6 * dpr);
  }

  // view: { mode: 'fight' | 'showcase', t, beat, excite, dark, flash, shake, cam: {x, y, w, orbit, snap}, actors: [...], projs: [...] }
  render(view) {
    const t = view.t, showcase = view.mode === 'showcase';
    this.set.visible = !showcase;
    for (const m of this.crowd) m.visible = !showcase;
    // actors
    const used = new Set();
    view.actors.forEach((a, i) => {
      const rk = this.rockers[a.id]; used.add(a.id);
      rk.root.visible = a.visible !== false;
      rk.setPose(a.pose, a);
      const b = this.blobs[i];
      b.visible = !showcase && rk.root.visible;
      const k = clamp(1 - (GY - a.y) / 420, 0.35, 1);
      b.position.set(a.x - 640, 1.5, 0); b.scale.set(k, k, 1); b.material.opacity = k;
    });
    for (const id in this.rockers) if (!used.has(id)) this.rockers[id].root.visible = false;
    for (let i = view.actors.length; i < 2; i++) this.blobs[i].visible = false;
    // projectiles
    let nb = 0, ns = 0;
    for (const m of [...this.ballMeshes, ...this.foiceMeshes]) m.visible = false;
    for (const p of view.projs || []) {
      const m = p.kind.startsWith('bola') ? this.ballMeshes[nb++] : p.kind === 'foice' ? this.foiceMeshes[ns++] : null;
      if (!m) continue; // the "sigilo" speech balloon is drawn by the 2D comic layer
      m.visible = true; m.position.set(p.x - 640, GY - p.y, 20);
      if (p.kind === 'foice') m.rotation.set(0, 0, -p.rot * 2.2); else m.rotation.z = -p.rot;
    }
    // cameos and pickups
    const cm = view.cameo;
    this.gotinha.root.visible = !!cm && cm.kind === 'gotinha';
    if (this.gotinha.root.visible) this.gotinha.update(cm.x, GY, cm.dir, cm.t, cm.state === 'act');
    this.vorcaro.root.visible = !!cm && cm.kind === 'vorcaro';
    if (this.vorcaro.root.visible) this.vorcaro.setPose(cm.pose, { x: cm.x, y: GY, z: -130, facing: cm.dir, yaw: 0.7, ex: { mouth: 0.45, angry: false } });
    const vac = (view.items || []).find(it => it.kind === 'vacina');
    this.syringe.root.visible = !!vac;
    if (vac) this.syringe.update(vac.x, vac.y, t);
    // torcida leaders on their risers
    for (const id in this.tors) this.tors[id].group.visible = false;
    this.crowdExc = view.cheer || this.crowdExc;
    if (!showcase && view.torcidas) view.torcidas.forEach((tc, i) => {
      const tor = this.tors[tc.id]; if (!tor) return;
      const sx = i ? 500 : -500;
      tor.group.visible = true; tor.riser.position.x = sx;
      tor.leader.setPose(tc.pose, { x: 640 + sx, y: GY - 44 - (tc.hop || 0) * 0.6, z: 120, facing: i ? -1 : 1, yaw: 0.5, ex: tc.ex, scale: 0.62 });
    });
    if (!showcase) this.animateSet(t, view.beat, view.excite || 0, view.dark);
    this.flash.intensity = (view.flash || 0) * 6;
    if (view.flashPos) this.flash.position.set(view.flashPos[0] - 640, GY - view.flashPos[1], 160);
    this.updateCamera(view);
    this.renderer.render(this.scene, this.camera);
  }

  animateSet(t, beat, excite, dark) {
    const bar = Math.floor(beat / 4), pulse = 0.55 + 0.45 * Math.pow(1 - (beat % 1), 3);
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i], col = LIGHTCOLS[(i + bar) % LIGHTCOLS.length];
      b.pivot.rotation.z = Math.sin(t * 0.012 + b.ph) * 0.45;
      b.pivot.rotation.x = 0.25 + Math.sin(t * 0.009 + b.ph * 2) * 0.2;
      b.mat.uniforms.uColor.value.copy(col);
      b.mat.uniforms.uI.value = (dark ? 0.15 : 0.5) * pulse;
      const dir = this._v.set(0, -1, 0).applyEuler(b.pivot.rotation);
      const k = b.pivot.position.y / -dir.y;
      b.pool.position.set(b.pivot.position.x + dir.x * k, 1, clamp(b.pivot.position.z + dir.z * k, -760, 190));
      b.pool.material.color.copy(col); b.pool.material.opacity = (dark ? 0.15 : 0.4) * pulse;
    }
    this.rimA.color.copy(LIGHTCOLS[bar % LIGHTCOLS.length]); this.rimB.color.copy(LIGHTCOLS[(bar + 2) % LIGHTCOLS.length]);
    this.duck.position.y = 330 + Math.sin(t * 0.017) * 14; this.duck.rotation.z = Math.sin(t * 0.013) * 0.06;
    for (const m of this.smoke) { m.position.x += m.userData.v; if (m.position.x > 1100) m.position.x = -1100; if (m.position.x < -1100) m.position.x = 1100; }
    const dk = dark ? 0.35 : 0.75, pul = 0.85 + 0.15 * Math.pow(1 - (beat % 1), 2);
    for (let i = 0; i < 2; i++) for (const mat of this.crowdMats[i]) mat.color.copy(this.tint[i]).multiplyScalar(dk * pul * (0.8 + this.crowdExc[i] * 0.5));
    for (const m of this.crowd) {
      const u = m.userData, e = this.crowdExc[u.side];
      m.rotation.y = Math.atan2(this.camera.position.x - m.position.x, this.camera.position.z - m.position.z);
      m.position.y = u.base + Math.abs(Math.sin(beat * Math.PI + u.ph * 0.3)) * (5 + e * 14) * u.amp;
      for (const d of u.decos) if (d.g.visible) {
        d.g.rotation.z = Math.sin(t * 0.18 + u.ph) * (0.08 + 0.22 * e);
        if (d.flag) d.cloth.scale.x = 1 + Math.sin(t * 0.3 + u.ph) * 0.1 * (1 + e);
      }
    }
  }

  updateCamera(view) {
    const c = this.cam, cv = view.cam;
    const k = cv.snap || !c.init ? 1 : 0.08;
    c.init = true;
    c.x += (cv.x - c.x) * k; c.y += (cv.y - c.y) * k; c.w += (cv.w - c.w) * k; c.orbit += ((cv.orbit || 0) - c.orbit) * k;
    const half = c.w / 2, limit = view.mode === 'showcase' ? 1e4 : 760;
    const X = clamp(c.x - 640, -limit + half, limit - half), Y = GY - c.y;
    const d = (c.w * 9 / 16) / (2 * TANH), elev = view.mode === 'showcase' ? 0 : 0.11 * d;
    const sh = view.shake || 0;
    this.camera.position.set(X + Math.sin(c.orbit) * d + rnd(-sh, sh), Y + elev + rnd(-sh, sh) * 0.6, Math.cos(c.orbit) * d);
    this.camera.lookAt(X, Y, 0);
    this.camera.updateMatrixWorld();
  }

  // game coords → logical screen coords (for the 2D overlay)
  project(x, y, z = 0) {
    const v = this._v.set(x - 640, GY - y, z).project(this.camera);
    return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H];
  }
  // affine transform that maps game coords (on the fight plane z = 0) to logical screen coords
  planeTransform(cx, cy) {
    const p0 = this.project(cx, cy), px = this.project(cx + 100, cy), py = this.project(cx, cy + 100);
    const a = (px[0] - p0[0]) / 100, b = (px[1] - p0[1]) / 100, c = (py[0] - p0[0]) / 100, d = (py[1] - p0[1]) / 100;
    return [a, b, c, d, p0[0] - a * cx - c * cy, p0[1] - b * cx - d * cy];
  }
  guitarTip(id) {
    const v = this.rockers[id].guitarTip(this._v);
    return [v.x + 640, GY - v.y];
  }
}
