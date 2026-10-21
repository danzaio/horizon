// Constants and tiny helpers shared by the game logic (main.js) and the Three.js renderer (three/*).
// Game space is the 1280×720 "logical screen" of the 2D prototype: x → right, y → down, floor at GY.
// The 3D world uses the same units: X = x − 640, Y = GY − y (floor at Y = 0), Z toward the camera.
export const TAU = Math.PI * 2, D = Math.PI / 180;
export const W = 1280, H = 720, GY = 600;
export const rnd = (a, b) => a + Math.random() * (b - a);
export const irnd = n => (Math.random() * n) | 0;
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
export const FONT = "Impact, Haettenschweiler, 'Arial Narrow Bold', 'Arial Black', sans-serif";

export function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
