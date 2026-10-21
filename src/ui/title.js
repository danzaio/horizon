// Pixel-art "HORIZON" title + sunrise landscape backdrop, drawn on canvases (no fonts / images needed => works offline).
const GLYPHS = {
  H: ['X...X', 'X...X', 'X...X', 'XXXXX', 'X...X', 'X...X', 'X...X'],
  O: ['.XXX.', 'X...X', 'X...X', 'X...X', 'X...X', 'X...X', '.XXX.'],
  R: ['XXXX.', 'X...X', 'X...X', 'XXXX.', 'X.X..', 'X..X.', 'X...X'],
  I: ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', 'XXXXX'],
  Z: ['XXXXX', '....X', '...X.', '..X..', '.X...', 'X....', 'XXXXX'],
  N: ['X...X', 'XX..X', 'X.X.X', 'X..XX', 'X...X', 'X...X', 'X...X'],
};
const ROW_COLORS = ['#fff3d1', '#ffdd9a', '#ffb454', '#ff8d6b', '#ff6b9a', '#d765c8', '#9a63e6'];

/** Draw the title into `cv` (resizes it). */
export function drawTitle(cv, text = 'HORIZON') {
  const p = 9, cols = text.length * 6 - 1;
  cv.width = cols * p + p; cv.height = 7 * p + p;
  const ctx = cv.getContext('2d');
  const cells = [];
  [...text].forEach((ch, li) => GLYPHS[ch].forEach((row, y) => { for (let x = 0; x < 5; x++) if (row[x] === 'X') cells.push([li * 6 + x, y]); }));
  ctx.fillStyle = 'rgba(8,4,28,.7)'; for (const [x, y] of cells) ctx.fillRect(x * p + p * 0.6, y * p + p * 0.6, p, p);
  for (const [x, y] of cells) {
    ctx.fillStyle = ROW_COLORS[y]; ctx.fillRect(x * p, y * p, p, p);
    ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(x * p, y * p, p, 2); ctx.fillRect(x * p, y * p, 2, p);
    ctx.fillStyle = 'rgba(40,0,60,.35)'; ctx.fillRect(x * p, y * p + p - 2, p, 2); ctx.fillRect(x * p + p - 2, y * p, 2, p);
  }
}

/** Low-res pixel landscape: gradient sky, sun, layered ridges. Redrawn once; CSS scales it with pixelated rendering. */
export function drawBackdrop(cv) {
  const W = 320, H = 180; cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const sky = ['#0b1030', '#171a45', '#2d2160', '#5a2d7a', '#963a86', '#d24f84', '#ff7d6b', '#ffb067', '#ffd68a'];
  const hz = Math.floor(H * 0.64);
  for (let y = 0; y < hz; y += 2) { ctx.fillStyle = sky[Math.min(sky.length - 1, Math.floor(y / hz * sky.length))]; ctx.fillRect(0, y, W, 2); }
  let s = 7; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  ctx.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i < 60; i++) ctx.fillRect(rnd() * W | 0, rnd() * hz * 0.5 | 0, 1, 1);
  ctx.fillStyle = '#fff2c4'; ctx.beginPath(); ctx.arc(W * 0.68, hz - 6, 15, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(255,214,140,.25)'; ctx.beginPath(); ctx.arc(W * 0.68, hz - 6, 28, 0, 7); ctx.fill();
  const layers = [['#7a3a7a', 0.55, 46, 0.025, 1], ['#4a2868', 0.62, 34, 0.04, 2], ['#2a1b4a', 0.7, 26, 0.06, 3], ['#120d28', 0.8, 18, 0.09, 4]];
  for (const [col, base, amp, fr, ph] of layers) {
    ctx.fillStyle = col;
    for (let x = 0; x < W; x++) {
      const h = Math.floor(H * base - amp * (0.5 + 0.5 * Math.sin(x * fr + ph) * Math.cos(x * fr * 2.3 + ph * 2) + 0.25 * Math.sin(x * fr * 5 + ph)));
      const hh = Math.floor(h / 3) * 3; // blocky steps
      ctx.fillRect(x, hh, 1, H - hh);
    }
  }
  ctx.fillStyle = 'rgba(6,9,20,.35)'; ctx.fillRect(0, 0, W, H);
}
