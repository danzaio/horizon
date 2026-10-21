// Cameos and props: Zé Gotinha (drops a vaccine), the Vorcaro cameo (throws "CDBs"),
// the vaccine pickup and the giant inflatable yellow duck floating behind the stage.
import * as THREE from 'three';
import { toon, part } from './toon.js';
import { Rocker } from './rocker.js';
import { GY } from '../shared.js';

export const VORCARO = {
  id: 'vorcaro', len: { torso: 96, thigh: 62, shin: 60, upper: 54, fore: 50 }, limb: { thigh: 27, shin: 23, upper: 21, fore: 19 },
  skin: '#e9b892', pants: '#1c2238', pantsS: '#10142a', sleeve: '#1c2238', fore: '#1c2238', boot: '#141414', hair: '#2a1a10', prop: 'briefcase',
};
export const makeVorcaro = () => new Rocker(VORCARO);

// Torcida leaders: Janones (Exército do Lula) and Nikolas "Chupetinha" (Tropa do Flávio), megaphone in hand
const LEADER_BASE = { len: { torso: 96, thigh: 60, shin: 58, upper: 54, fore: 50 }, limb: { thigh: 28, shin: 23, upper: 23, fore: 20 }, prop: 'megaphone' };
export const LEADERS = {
  janones: { ...LEADER_BASE, id: 'janones', skin: '#c68b63', pants: '#2a3350', pantsS: '#161c30', sleeve: '#c8122c', fore: '#c68b63', boot: '#f2f2ee',
    hair: '#16100c', stubble: true, mega: '#ffd400', tee: { bg: '#c8122c', fg: '#ffffff', text: 'EXPLODE', back: 'JANONES' } },
  nikolas: { ...LEADER_BASE, id: 'nikolas', skin: '#f0c8a2', pants: '#1f2a44', pantsS: '#10172c', sleeve: '#ffd21a', fore: '#f0c8a2', boot: '#ffffff',
    hair: '#2b1c13', stubble: true, glasses: true, quiff: true, mega: '#0e9a48', tee: { bg: '#ffd21a', fg: '#0e9a48', text: 'TROPA', back: 'CHUPETINHA' } },
};

const sph = (r) => new THREE.SphereGeometry(r, 24, 16);
const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 12);

export class Gotinha {
  constructor() {
    const R = this.root = new THREE.Group();
    const pts = [];
    for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + i / 12 * (Math.PI / 2 + 0.75); pts.push(new THREE.Vector2(Math.cos(a) * 56, 62 + Math.sin(a) * 56)); }
    for (let i = 1; i <= 8; i++) { const k = i / 8; pts.push(new THREE.Vector2(41.6 * Math.pow(1 - k, 1.3), 100 + k * 82)); }
    this.body = new THREE.Group(); R.add(this.body);
    part(new THREE.LatheGeometry(pts, 32), toon('#f2f7ff'), this.body);
    const white = toon('#ffffff'), ink = toon('#16131a'), blue = toon('#1f5fd0');
    for (const s of [-1, 1]) {
      part(sph(9.5), white, this.body, s * 14, 112, 33, 0.7).scale.set(0.85, 1.1, 0.45);
      part(sph(4.6), ink, this.body, s * 13, 111, 37.5, 0);
      part(sph(7), toon('#ff9db0'), this.body, s * 30, 86, 43, 0).scale.set(1, 0.7, 0.4);
    }
    const smile = part(new THREE.TorusGeometry(15, 2.8, 8, 18, Math.PI), toon('#c8122c'), this.body, 0, 84, 50, 0.6); smile.rotation.z = Math.PI;
    this.arms = [-1, 1].map(s => {
      const g = new THREE.Group(); g.position.set(s * 50, 76, 0); this.body.add(g);
      part(cap(5, 30), white, g, 0, -18, 0, 0.7); part(sph(10), white, g, 0, -40, 0, 0.8);
      return g;
    });
    this.legs = [-1, 1].map(s => {
      const g = new THREE.Group(); g.position.set(s * 20, 14, 0); R.add(g);
      part(cap(6, 16), white, g, 0, -10, 0, 0.7);
      part(sph(12), blue, g, 0, -22, 6, 0.9).scale.set(1, 0.6, 1.5);
      return g;
    });
    R.visible = false;
  }
  update(x, y, dir, t, acting) {
    const R = this.root;
    R.position.set(x - 640, GY - y + 28, 30);
    R.rotation.y = acting ? 0 : dir * 0.45;
    const moving = !acting, ph = t * 0.4;
    this.body.position.y = moving ? Math.abs(Math.sin(ph)) * 8 : Math.sin(t * 0.15) * 3;
    this.legs.forEach((g, i) => { g.rotation.x = moving ? Math.sin(ph + i * Math.PI) * 0.7 : 0; });
    this.arms[0].rotation.z = moving ? -0.4 + Math.sin(ph) * 0.4 : -0.3;
    this.arms[1].rotation.z = acting ? 2.4 + Math.sin(t * 0.5) * 0.5 : 0.4 + Math.sin(ph) * 0.4; // waves "olá!"
  }
}

export class Syringe {
  constructor() {
    const R = this.root = new THREE.Group(), g = this.g = new THREE.Group(); R.add(g);
    const glass = toon('#cdeeff'), metal = toon('#c9c9d2');
    part(new THREE.CylinderGeometry(8, 8, 50, 16), glass, g, 0, 0, 0, 0.8);
    part(new THREE.CylinderGeometry(6, 6, 32, 16), toon('#29b8ff', { emissive: '#0a3a6a' }), g, 0, -6, 0, 0);
    part(new THREE.CylinderGeometry(2.2, 2.2, 22, 8), metal, g, 0, 36, 0, 0.6);
    part(new THREE.CylinderGeometry(10, 10, 3, 16), metal, g, 0, 47, 0, 0.6);
    part(new THREE.CylinderGeometry(14, 14, 3, 16), glass, g, 0, 25, 0, 0.6);
    part(new THREE.CylinderGeometry(0.9, 0.9, 26, 6), metal, g, 0, -38, 0, 0.4);
    g.rotation.z = Math.PI / 2;
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(46, 24), new THREE.MeshBasicMaterial({ color: '#2bffb0', transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.rotation.x = -Math.PI / 2; R.add(this.glow);
    R.visible = false;
  }
  update(x, y, t) {
    this.root.position.set(x - 640, 0, 10);
    this.g.position.y = GY - y + Math.sin(t * 0.1) * 6;
    this.g.rotation.y = t * 0.05;
    this.glow.position.y = 1.5; this.glow.material.opacity = 0.3 + Math.sin(t * 0.2) * 0.12;
  }
}

export function buildDuck() {
  const D = new THREE.Group(), y = toon('#ffd51a'), o = toon('#ff8a1c'), ink = toon('#16131a');
  part(sph(70), y, D, 0, 0, 0, 1.2).scale.set(1.35, 0.85, 1);
  part(sph(44), y, D, 62, 72, 0, 1.2);
  part(sph(22), o, D, 104, 62, 0, 1).scale.set(1.45, 0.42, 1);
  for (const s of [-1, 1]) {
    part(sph(8), toon('#ffffff'), D, 90, 84, s * 22, 0.7).scale.set(0.6, 1, 0.8);
    part(sph(4), ink, D, 94, 84, s * 23, 0);
    part(sph(36), y, D, -10, 6, s * 60, 1).scale.set(1.25, 0.55, 0.4);
  }
  part(new THREE.ConeGeometry(26, 50, 16), y, D, -96, 34, 0, 1).rotation.z = 0.9;
  return D;
}

