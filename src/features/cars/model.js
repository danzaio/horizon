// BYD Dolphin Mini (blocks: 1 unit = 1 m, forward = -Z, origin at ground level under the middle of the car). Body paint = the accent colour
// (Peach Pink / Mint / Surf Blue / Apricity White), white two-tone roof, black pillars, slim LED head- and tail-lights, small hatch spoiler.
import { buildGeometry } from '../ships/model.js';

const WHITE = [236, 238, 240], BODY = [232, 232, 232], BLACK = [22, 24, 28], DARK = [40, 44, 52], GLASS = [34, 48, 66], TYRE = [20, 20, 24], HUB = [206, 212, 222], LAMP = [255, 250, 232], TAIL = [255, 40, 44];
// [x0,y0,z0,x1,y1,z1,color,emissive,accent,mirror]
export const CAR_BOXES = [
  [-0.85, 0.32, -1.9, 0.85, 0.98, 1.9, BODY, 0, 1, false],              // lower body (painted)
  [-0.82, 0.98, -1.85, 0.82, 1.06, -0.85, BODY, 0, 1, false],          // short bonnet
  [-0.78, 1.06, -0.85, 0.78, 1.5, 1.45, GLASS, 0.1, 0, false],         // greenhouse (tinted glass)
  [-0.8, 1.5, -0.95, 0.8, 1.58, 1.5, WHITE, 0, 0, false],              // white roof
  [-0.82, 1.06, 0.3, -0.74, 1.5, 0.46, BLACK, 0, 0, true],             // B/C pillar
  [-0.82, 1.06, -0.88, -0.74, 1.5, -0.8, BLACK, 0, 0, true],           // A pillar
  [-0.7, 1.5, 1.45, 0.7, 1.58, 1.64, BLACK, 0, 0, false],              // hatch spoiler
  [-0.8, 0.3, -1.96, 0.8, 0.52, -1.86, DARK, 0, 0, false],             // front bumper
  [-0.8, 0.3, 1.86, 0.8, 0.52, 1.96, DARK, 0, 0, false],               // rear bumper
  [-0.72, 0.7, -1.93, -0.3, 0.9, -1.88, LAMP, 1, 0, true],             // headlight
  [-0.3, 0.78, -1.93, 0.3, 0.82, -1.88, LAMP, 0.8, 0, false],          // DRL bar
  [-0.78, 0.72, 1.9, -0.35, 0.92, 1.95, TAIL, 1, 0, true],             // taillight
  [-0.35, 0.8, 1.9, 0.35, 0.84, 1.95, TAIL, 0.7, 0, false],            // light bar
  [-0.88, 0.3, -1.3, -0.84, 0.44, 1.3, DARK, 0, 0, true],              // side skirt
  [-1.0, 1.02, -0.72, -0.86, 1.12, -0.5, DARK, 0, 0, true],            // mirror
  [-0.99, 0.0, -1.44, -0.74, 0.66, -0.76, TYRE, 0, 0, true],           // front wheel
  [-0.99, 0.0, 0.8, -0.74, 0.66, 1.48, TYRE, 0, 0, true],              // rear wheel
  [-1.0, 0.16, -1.26, -0.98, 0.5, -0.94, HUB, 0, 0, true],             // hubcaps
  [-1.0, 0.16, 0.96, -0.98, 0.5, 1.28, HUB, 0, 0, true],
  [-0.86, 0.66, -1.5, -0.84, 0.92, -0.7, DARK, 0, 0, true],            // wheel arches
  [-0.86, 0.66, 0.74, -0.84, 0.92, 1.54, DARK, 0, 0, true],
];
export const buildCarGeometry = () => buildGeometry(CAR_BOXES);
export const CAR_COLORS = ['#f4b6c2', '#a8dcc4', '#8fc2ee', '#f1f1f1', '#ffd36b', '#c9a8ff'];
