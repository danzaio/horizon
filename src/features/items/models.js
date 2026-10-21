// Held-item models (coloured cuboids, pixel units, grip at the origin, blade/barrel toward +Y or -Z) and the icon rasterizer that
// draws the very same boxes on a small 2D canvas, so inventory icons and first-person models always match. No assets.
//
// box = [x0,y0,z0,x1,y1,z1,[r,g,b],part]   part: 0 static · 1 pulled back by the bow charge · 2 emissive · 3 pulsing emissive · 4 flame (jetpack)

const C = {
  steel: [204, 216, 228], steel2: [150, 166, 184], gold: [214, 168, 58], wood: [122, 82, 46], wood2: [90, 60, 34], dark: [52, 54, 62], dark2: [36, 38, 46],
  red: [196, 56, 46], white: [236, 232, 220], orange: [255, 150, 50], cyan: [90, 220, 255], purple: [120, 84, 190], green: [90, 170, 70], snow: [246, 250, 255],
  string: [226, 222, 205], paper: [214, 190, 140], blue: [70, 120, 220], pink: [255, 120, 170],
};

/** @type {Record<string, {boxes:Array, scale?:number, pos?:number[], rot?:number[], swing?:string, iconRot?:number[]}>} */
export const MODELS = {
  sword: { swing: 'slash', scale: 0.0228, pos: [0.28, -0.36, -0.5], rot: [-0.3, -0.3, 0.3], iconRot: [0, 0, -0.78], boxes: [
    [-1.1, 3, -0.6, 1.1, 20, 0.6, C.steel], [-0.4, 5, -0.7, 0.4, 18, 0.7, C.steel2], [-0.6, 20, -0.5, 0.6, 22, 0.5, C.steel],
    [-4.2, 1.4, -1.4, 4.2, 3, 1.4, C.gold], [-1, -4, -1, 1, 1.4, 1, C.wood], [-1.6, -6, -1.6, 1.6, -4, 1.6, C.gold]] },
  bow: { swing: 'none', scale: 0.0189, pos: [0.2, -0.3, -0.5], rot: [0.05, 0.15, 0.1], iconRot: [0, 0.5, 0.2], boxes: [
    [-0.7, -1, -6, 0.7, 1, -4.4, C.wood2], [-0.7, 1, -5.2, 0.7, 6, -3.6, C.wood], [-0.7, -6, -5.2, 0.7, -1, -3.6, C.wood], [-0.7, 6, -4.2, 0.7, 10, -2.4, C.wood], [-0.7, -10, -4.2, 0.7, -6, -2.4, C.wood],
    [-0.7, 10, -2.6, 0.7, 12.5, -0.8, C.wood2], [-0.7, -12.5, -2.6, 0.7, -10, -0.8, C.wood2],
    [-0.15, -12, -0.4, 0.15, 12, 0.1, C.string, 1], [-0.28, -0.28, -12, 0.28, 0.28, 0.4, C.paper, 1], [-0.7, -0.7, -15, 0.7, 0.7, -12, C.steel, 1], [-0.9, -0.9, -0.2, 0.9, 0.9, 2.2, C.red, 1]] },
  arrow: { swing: 'throw', scale: 0.0260, pos: [0.26, -0.3, -0.5], rot: [-0.3, -0.3, 0.3], iconRot: [0, 0, -0.78], boxes: [
    [-0.5, -9, -0.5, 0.5, 8, 0.5, C.paper], [-1.2, 8, -1.2, 1.2, 12, 1.2, C.steel], [-1.6, -11, -0.3, 1.6, -7, 0.3, C.white], [-0.3, -11, -1.6, 0.3, -7, 1.6, C.white]] },
  tnt: { swing: 'throw', scale: 0.017, pos: [0.2, -0.2, -0.45], rot: [0.25, -0.5, 0.05], iconRot: [0.3, 0.7, 0], boxes: [
    [-5, -5, -5, 5, 5, 5, C.red], [-5.15, -1.5, -5.15, 5.15, 1.5, 5.15, C.white], [-0.5, 5, -0.5, 0.5, 8, 0.5, C.dark2], [-0.8, 8, -0.8, 0.8, 9.6, 0.8, [255, 200, 70], 3]] },
  lighter: { swing: 'thrust', scale: 0.02, pos: [0.22, -0.26, -0.45], rot: [0.1, -0.3, 0.1], iconRot: [0.2, 0.6, 0], boxes: [
    [-2.5, -6, -1.5, 2.5, 4, 1.5, C.steel2], [-2.6, 1, -1.6, 2.6, 4.2, 1.6, C.dark], [-0.8, 4, -0.5, 0.8, 7, 0.5, C.dark2], [-0.9, 7, -0.6, 0.9, 10, 0.6, C.orange, 3]] },
  gravity_gun: { swing: 'thrust', scale: 0.0149, pos: [0.2, -0.2, -0.42], rot: [0.05, 0.1, 0], iconRot: [0.35, -0.7, 0], boxes: [
    [-2.2, -3, -9, 2.2, 2.4, 5, C.dark], [-1.4, -1, -19, 1.4, 1.4, -9, C.dark2], [-3.4, -2.4, -19, -2.2, 2.2, -7, C.orange, 3], [2.2, -2.4, -19, 3.4, 2.2, -7, C.orange, 3],
    [-0.9, -0.9, -15, 0.9, 0.9, -11, C.cyan, 3], [-1.2, -9, 1, 1.2, -3, 4, C.dark2], [-2.6, 2.4, -6, 2.6, 3.4, 2, C.steel2]] },
  jetpack: { swing: 'none', scale: 0.0088, pos: [0.2, -0.18, -0.5], rot: [0.15, -0.5, 0.1], iconRot: [0.25, 0.7, 0], boxes: [
    [-6, 3, -3, 6, 15, 3, C.steel2], [-6.3, 5, -3.3, -1, 14, 3.3, C.red], [1, 5, -3.3, 6.3, 14, 3.3, C.red], [-6, 0.8, -3, -1.2, 3, 3, C.dark], [1.2, 0.8, -3, 6, 3, 3, C.dark],
    [-3, 15, -1.5, 3, 17, 1.5, C.gold], [-5, -8, -2, -2, 0, 2, C.orange, 4], [2, -8, -2, 5, 0, 2, C.orange, 4], [-4.2, -5, -1, -2.8, 0, 1, [255, 240, 150], 4], [2.8, -5, -1, 4.2, 0, 1, [255, 240, 150], 4]] },
  grapple: { swing: 'thrust', scale: 0.0156, pos: [0.2, -0.2, -0.42], rot: [0.05, 0.1, 0], iconRot: [0.3, -0.7, 0], boxes: [
    [-2, -3, -8, 2, 2, 4, C.dark], [-1.2, -0.6, -16, 1.2, 1.2, -8, C.steel2], [-2.6, -1, -19, -1.2, 2, -15, C.steel], [1.2, -1, -19, 2.6, 2, -15, C.steel], [-0.8, 1.2, -20, 0.8, 3.4, -16, C.steel],
    [-1.2, -8, 0, 1.2, -3, 3, C.wood2], [-0.6, 2, -4, 0.6, 4, 0, C.red]] },
  snowball: { swing: 'throw', scale: 0.022, pos: [0.2, -0.17, -0.45], rot: [0.2, -0.4, 0], iconRot: [0.3, 0.6, 0], boxes: [
    [-3, -3, -3, 3, 3, 3, C.snow], [-2, 3, -2, 2, 3.8, 2, C.white], [-3.4, -1.5, -1.5, -3, 1.5, 1.5, [210, 226, 240]], [-1.5, -3.8, -1.5, 1.5, -3, 1.5, [200, 220, 238]]] },
  wand: { swing: 'thrust', scale: 0.0202, pos: [0.27, -0.36, -0.5], rot: [-0.3, -0.3, 0.3], iconRot: [0, 0.3, -0.78], boxes: [
    [-0.8, -8, -0.8, 0.8, 11, 0.8, C.purple], [-1.1, 4, -1.1, 1.1, 5.5, 1.1, C.gold], [-2.2, 11, -2.2, 2.2, 15, 2.2, [255, 232, 120], 3], [-0.8, 15, -0.8, 0.8, 18, 0.8, [255, 255, 200], 3], [-3.4, 12, -0.6, -2.2, 13.4, 0.6, [255, 232, 120], 3], [2.2, 12, -0.6, 3.4, 13.4, 0.6, [255, 232, 120], 3]] },
  pickaxe: { swing: 'slash', scale: 0.0175, pos: [0.27, -0.36, -0.5], rot: [-0.3, -0.3, 0.3], iconRot: [0, 0, -0.78], mining: 1, boxes: [
    [-0.9, -8, -0.9, 0.9, 14, 0.9, C.wood], [-9, 13, -1.4, 9, 16, 1.4, C.steel2], [-9.6, 11, -1.2, -7, 13, 1.2, C.steel], [7, 11, -1.2, 9.6, 13, 1.2, C.steel], [-3, 16, -1.2, 3, 17, 1.2, C.steel]] },
  axe: { swing: 'slash', scale: 0.0175, pos: [0.27, -0.36, -0.5], rot: [-0.3, -0.3, 0.3], iconRot: [0, 0, -0.78], mining: 1, boxes: [
    [-0.9, -8, -0.9, 0.9, 14, 0.9, C.wood], [0.9, 8, -1.3, 8, 15, 1.3, C.steel2], [6.4, 6.4, -1.2, 9, 16.6, 1.2, C.steel], [0.9, 9, -1.4, 3, 14, 1.4, C.dark]] },
  fireworks: { swing: 'throw', scale: 0.0221, pos: [0.25, -0.34, -0.5], rot: [-0.3, -0.3, 0.2], iconRot: [0, 0.4, -0.5], boxes: [
    [-1.6, -4, -1.6, 1.6, 8, 1.6, C.red], [-1.7, 0, -1.7, 1.7, 2, 1.7, C.white], [-1.8, 8, -1.8, 1.8, 11, 1.8, C.gold], [-0.4, -14, -0.4, 0.4, -4, 0.4, C.wood], [-0.5, 11, -0.5, 0.5, 13, 0.5, C.orange, 3]] },
  pearl: { swing: 'throw', scale: 0.022, pos: [0.2, -0.17, -0.45], rot: [0.2, -0.4, 0], iconRot: [0.3, 0.6, 0], boxes: [
    [-3, -3, -3, 3, 3, 3, [30, 150, 150], 3], [-1.6, 3, -1.6, 1.6, 3.6, 1.6, [160, 255, 240], 3], [-2.4, -1, 3, -0.6, 1, 3.5, [190, 255, 250], 3]] },
  feather: { swing: 'none', scale: 0.0221, pos: [0.25, -0.3, -0.5], rot: [0.1, -0.3, 0.3], iconRot: [0, 0.3, -0.7], boxes: [
    [-0.4, -8, -0.3, 0.4, 12, 0.3, C.white], [0.4, 0, -0.3, 2.4, 8, 0.3, C.snow], [-2.4, 1, -0.3, -0.4, 9, 0.3, C.snow], [0.4, 8, -0.3, 1.6, 11, 0.3, C.snow], [-1.6, 9, -0.3, -0.4, 12, 0.3, C.snow]] },
  shield: { swing: 'thrust', scale: 0.0125, pos: [0.1, -0.17, -0.5], rot: [0.05, 0.2, 0], iconRot: [0.1, 0.5, 0], boxes: [
    [-7, -8, -1, 7, 8, 1, C.wood], [-6, -7, 1, 6, 7, 1.8, C.blue], [-1.2, -6, 1.8, 1.2, 6, 2.4, C.gold], [-5, -1.2, 1.8, 5, 1.2, 2.4, C.gold], [-0.8, 8, -1, 0.8, 10, 1, C.dark]] },
  boots: { swing: 'none', scale: 0.016, pos: [0.2, -0.17, -0.45], rot: [0.2, -0.4, 0], iconRot: [0.3, 0.7, 0], boxes: [
    [-6, -6, -3, -1, 4, 3, [190, 90, 40]], [-6, -6, -9, -1, -2, -3, [160, 70, 30]], [1, -6, -3, 6, 4, 3, [190, 90, 40]], [1, -6, -9, 6, -2, -3, [160, 70, 30]], [-6.2, -6.3, -9.2, -0.8, -5, 3.2, C.white], [0.8, -6.3, -9.2, 6.2, -5, 3.2, C.white]] },
  build_wand: { swing: 'thrust', scale: 0.0202, pos: [0.27, -0.36, -0.5], rot: [-0.3, -0.3, 0.3], iconRot: [0, 0.3, -0.78], boxes: [
    [-0.8, -8, -0.8, 0.8, 11, 0.8, C.wood2], [-2.4, 11, -2.4, 2.4, 15, 2.4, C.blue, 3], [-1.2, 15, -1.2, 1.2, 17, 1.2, C.cyan, 3], [-1.1, 3, -1.1, 1.1, 5, 1.1, C.steel]] },
  paint: { swing: 'thrust', scale: 0.0202, pos: [0.27, -0.36, -0.5], rot: [-0.3, -0.3, 0.3], iconRot: [0, 0.3, -0.78], boxes: [
    [-0.8, -8, -0.8, 0.8, 6, 0.8, C.wood], [-1.4, 6, -1.4, 1.4, 9, 1.4, C.steel2], [-1.6, 9, -1.6, 1.6, 14, 1.6, C.pink], [-1, 14, -1, 1, 16, 1, [255, 190, 210]]] },
  apple: { swing: 'throw', scale: 0.022, pos: [0.2, -0.17, -0.45], rot: [0.2, -0.4, 0], iconRot: [0.3, 0.6, 0], boxes: [
    [-3.4, -3.4, -3.4, 3.4, 3, 3.4, [214, 50, 44]], [-2.6, 3, -2.6, 2.6, 3.6, 2.6, [170, 36, 34]], [-0.4, 3.6, -0.4, 0.4, 6, 0.4, C.wood2], [0.4, 4.6, -0.3, 3, 5.6, 0.3, C.green]] },
  rifle: { swing: 'thrust', scale: 0.0135, pos: [0.2, -0.2, -0.42], rot: [0.04, 0.08, 0], iconRot: [0.3, -0.7, 0], boxes: [
    [-1.8, -4, -6, 1.8, 1.6, 8], [-1.4, -1.2, -22, 1.4, 1.2, -6, C.dark2], [-0.5, -0.5, -26, 0.5, 0.5, -22, C.steel2], [-1.4, 1.6, -4, 1.4, 3, 6, C.steel2],
    [-1.1, -9, 2, 1.1, -3.6, 5, C.wood2], [-1.6, -3.2, 8, 1.6, 2, 15, C.wood], [-1, -8, -7, 1, -3.6, -4, C.dark], [-0.5, 3, -2, 0.5, 4.6, 0, C.red, 2]].map((b, i) => (i === 0 ? [...b, C.dark] : b)) },
  shotgun: { swing: 'thrust', scale: 0.0135, pos: [0.2, -0.2, -0.42], rot: [0.04, 0.08, 0], iconRot: [0.3, -0.7, 0], boxes: [
    [-1.6, -2.4, -4, 1.6, 1.4, 8, C.wood], [-1.2, -0.2, -24, 1.2, 1.8, -4, C.steel2], [-1.2, -2.4, -20, 1.2, -0.2, -6, C.dark], [-1.8, -3.4, 8, 1.8, 1.6, 16, C.wood2],
    [-1.4, -3, -12, 1.4, -1, -6, C.wood], [-0.5, -9, 0, 0.5, -2.4, 3, C.dark2], [-0.4, 1.8, -23, 0.4, 3, -21, C.gold]] },
  rocket_launcher: { swing: 'thrust', scale: 0.0108, pos: [0.14, -0.22, -0.46], rot: [0.04, 0.12, 0], iconRot: [0.3, -0.7, 0], boxes: [
    [-3.2, -2, -22, 3.2, 4.4, 10, [88, 100, 74]], [-3.8, -2.6, -24, 3.8, 5, -20, C.dark], [-3.8, -2.6, 8, 3.8, 5, 12, C.dark], [-1.2, 4.4, -12, 1.2, 6.6, -4, C.steel2],
    [-1.2, -9, -4, 1.2, -2, 0, C.dark2], [-1.4, -3, -22, 1.4, -2, -4, C.orange, 2], [-2.2, 1.2, 12, 2.2, 3, 14, [255, 120, 40], 3]] },
  railgun: { swing: 'thrust', scale: 0.0125, pos: [0.2, -0.2, -0.44], rot: [0.04, 0.08, 0], iconRot: [0.3, -0.7, 0], boxes: [
    [-2.2, -3, -8, 2.2, 3, 8, C.dark], [-1, -1, -26, 1, 1, -8, C.steel], [-2.8, -2.2, -22, -1.6, 2.2, -10, [60, 160, 220], 3], [1.6, -2.2, -22, 2.8, 2.2, -10, [60, 160, 220], 3],
    [-1.4, 3, -6, 1.4, 5.4, 6, C.steel2], [-0.7, -0.7, -27, 0.7, 0.7, -26, C.cyan, 3], [-1.1, -10, 3, 1.1, -3, 6, C.dark2], [-1.4, -2, 8, 1.4, 2, 12, C.steel2]] },
  grenade: { swing: 'throw', scale: 0.022, pos: [0.2, -0.17, -0.45], rot: [0.2, -0.4, 0], iconRot: [0.3, 0.6, 0], boxes: [
    [-3, -4, -3, 3, 3, 3, [66, 78, 52]], [-2.4, 3, -2.4, 2.4, 4.6, 2.4, C.steel2], [-0.5, 4.6, -0.5, 0.5, 7, 0.5, C.gold], [2.4, 4.6, -0.3, 5.4, 5.4, 0.3, C.steel], [-3.2, -1, -3.2, 3.2, 0.6, 3.2, [44, 52, 36]]] },
  mine: { swing: 'throw', scale: 0.024, pos: [0.2, -0.2, -0.45], rot: [0.5, -0.4, 0], iconRot: [0.6, 0.6, 0], boxes: [
    [-5, -1, -5, 5, 1, 5, C.dark], [-4, 1, -4, 4, 2, 4, C.dark2], [-1, 2, -1, 1, 3.4, 1, C.red, 3], [-5.2, -1.4, -1, 5.2, -0.6, 1, C.gold]] },
  hammer: { swing: 'slash', scale: 0.0165, pos: [0.27, -0.34, -0.5], rot: [-0.3, -0.3, 0.3], iconRot: [0, 0, -0.78], boxes: [
    [-0.9, -9, -0.9, 0.9, 12, 0.9, C.wood], [-5, 12, -4, 5, 19, 4, C.steel2], [-5.4, 12.6, -3.4, 5.4, 18.4, 3.4, C.dark], [-1.8, 14, -4.4, 1.8, 17, 4.4, C.orange, 3], [-1.2, -11, -1.2, 1.2, -9, 1.2, C.gold]] },
  harpoon: { swing: 'thrust', scale: 0.0149, pos: [0.2, -0.22, -0.42], rot: [0.05, 0.1, 0], iconRot: [0.3, -0.7, 0], boxes: [
    [-1.4, -2, -6, 1.4, 2, 8, C.wood2], [-0.5, -0.5, -22, 0.5, 0.5, -6, C.steel2], [-2.4, -1.2, -26, 2.4, 1.2, -22, C.steel], [-0.8, -0.8, -30, 0.8, 0.8, -26, C.steel], [-1.2, -8, 2, 1.2, -2, 5, C.dark2], [-0.6, 2, -2, 0.6, 4, 2, [230, 190, 100]]] },
  glider: { swing: 'none', scale: 0.0122, pos: [0.16, -0.14, -0.5], rot: [0.5, 0.2, 0.1], iconRot: [0.6, 0.5, 0], boxes: [
    [-13, 0, -4, 13, 0.8, 4, [220, 90, 60]], [-9, 0.8, -4, 9, 1.4, 4, C.white], [-0.8, -3, -6, 0.8, 0.2, 7, C.wood], [-3, 0.6, 4, 3, 1.4, 8, C.red], [-0.4, -1, -9, 0.4, 0.2, -6, C.steel2]] },
  bullet: { swing: 'throw', scale: 0.03, pos: [0.2, -0.2, -0.45], rot: [0.2, -0.4, 0], iconRot: [0, 0.4, -0.6], boxes: [
    [-1.4, -5, -1.4, 1.4, 3, 1.4, C.gold], [-1.1, 3, -1.1, 1.1, 6, 1.1, [190, 120, 60]], [-0.6, 6, -0.6, 0.6, 7.2, 0.6, C.steel2]] },
  shell: { swing: 'throw', scale: 0.03, pos: [0.2, -0.2, -0.45], rot: [0.2, -0.4, 0], iconRot: [0, 0.4, -0.6], boxes: [
    [-2, -6, -2, 2, 2, 2, C.red], [-2.1, 2, -2.1, 2.1, 5, 2.1, C.gold], [-2.1, -6, -2.1, 2.1, -4.4, 2.1, C.gold]] },
  missile_ammo: { swing: 'throw', scale: 0.024, pos: [0.2, -0.2, -0.45], rot: [0.2, -0.4, 0], iconRot: [0, 0.4, -0.7], boxes: [
    [-2, -8, -2, 2, 6, 2, [180, 190, 190]], [-1.6, 6, -1.6, 1.6, 10, 1.6, C.red], [-4, -9, -0.4, 4, -5, 0.4, C.dark], [-0.4, -9, -4, 0.4, -5, 4, C.dark]] },
  cell: { swing: 'throw', scale: 0.03, pos: [0.2, -0.2, -0.45], rot: [0.2, -0.4, 0], iconRot: [0, 0.4, -0.6], boxes: [
    [-2.4, -5, -2.4, 2.4, 5, 2.4, C.dark], [-1.6, -3.4, -2.6, 1.6, 3.4, 2.6, C.cyan, 3], [-1.2, 5, -1.2, 1.2, 6.4, 1.2, C.steel]] },
  prop_gun: { swing: 'thrust', scale: 0.0149, pos: [0.2, -0.2, -0.42], rot: [0.05, 0.1, 0], iconRot: [0.35, -0.7, 0], boxes: [
    [-2.2, -3, -8, 2.2, 2.4, 5, C.dark], [-1.8, -1.4, -15, 1.8, 2, -8, C.dark2], [-2.6, 2.4, -6, 2.6, 3.4, 2, C.green, 3], [-1.2, -9, 1, 1.2, -3, 4, C.dark2], [-2.4, -2.4, -16, 2.4, 2.4, -15, C.green, 3]] },
};

// ---- pixel icon rasterizer: orthographic projection of the boxes with painter's algorithm, 3 visible faces per box ----
const FACES = [ // normal, 4 corner selectors (x?,y?,z?) CCW
  [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], 1.0], [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], 0.86],
  [[1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], 0.7], [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], 0.7],
  [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], 0.8], [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], 0.55],
];
const _cache = new Map();

function rot(v, o, rx, ry, rz) { // yaw(ry) then pitch(rx) then roll(rz), writes into o
  let x = v[0], y = v[1], z = v[2], c, s, t;
  c = Math.cos(ry); s = Math.sin(ry); t = x * c + z * s; z = -x * s + z * c; x = t;
  c = Math.cos(rx); s = Math.sin(rx); t = y * c - z * s; z = y * s + z * c; y = t;
  c = Math.cos(rz); s = Math.sin(rz); t = x * c - y * s; y = x * s + y * c; x = t;
  o[0] = x; o[1] = y; o[2] = z;
}

/** Draws the model `id` (from MODELS) into a 32x32 canvas. Returns false when the model is unknown. */
export function drawModelIcon(canvas, id) {
  const m = MODELS[id]; if (!m) return false;
  const S = 32; canvas.width = canvas.height = S;
  const g = canvas.getContext('2d'); g.clearRect(0, 0, S, S);
  let img = _cache.get(id);
  if (!img) {
    const [rx, ry, rz] = m.iconRot || [0.3, 0.6, 0], faces = [], tmp = [0, 0, 0];
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const b of m.boxes) {
      if (b[7] === 4) continue;                       // no flames in icons
      for (const [n, cs, sh] of FACES) {
        const nn = [0, 0, 0]; rot(n, nn, rx, ry, rz);
        if (nn[2] <= 0.02) continue;                  // back-facing (camera looks down -Z, +Z is toward the viewer)
        const pts = cs.map((q) => { rot([q[0] ? b[3] : b[0], q[1] ? b[4] : b[1], (q[2] ? b[5] : b[2])], tmp, rx, ry, rz); minX = Math.min(minX, tmp[0]); maxX = Math.max(maxX, tmp[0]); minY = Math.min(minY, tmp[1]); maxY = Math.max(maxY, tmp[1]); return [tmp[0], tmp[1], tmp[2]]; });
        faces.push({ pts, z: (pts[0][2] + pts[1][2] + pts[2][2] + pts[3][2]) / 4, c: b[6], sh: sh * (b[7] >= 2 ? 1.25 : 1) });
      }
    }
    faces.sort((a, b) => a.z - b.z);
    const k = 26 / Math.max(maxX - minX, maxY - minY, 1), ox = S / 2 - (minX + maxX) / 2 * k, oy = S / 2 + (minY + maxY) / 2 * k;
    img = document.createElement('canvas'); img.width = img.height = S;
    const ig = img.getContext('2d'); ig.imageSmoothingEnabled = false;
    for (const f of faces) {
      ig.beginPath();
      f.pts.forEach((p, i) => { const x = Math.round(ox + p[0] * k), y = Math.round(oy - p[1] * k); if (i) ig.lineTo(x, y); else ig.moveTo(x, y); });
      ig.closePath();
      const r = Math.min(255, f.c[0] * f.sh) | 0, gg = Math.min(255, f.c[1] * f.sh) | 0, bb = Math.min(255, f.c[2] * f.sh) | 0;
      ig.fillStyle = `rgb(${r},${gg},${bb})`; ig.fill(); ig.strokeStyle = ig.fillStyle; ig.lineWidth = 0.8; ig.stroke();
    }
    _cache.set(id, img);
  }
  g.drawImage(img, 0, 0);
  return true;
}
