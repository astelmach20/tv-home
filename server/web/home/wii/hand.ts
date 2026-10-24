// The white pointing hand with the "1" badge that follows focus, ported from wii-tv's WiiHand.java (MIT,
// MauroProto). Drawn once into an offscreen canvas; each frame only places it with its fingertip on (x, y).

/** The hand was first drawn in units of 1/1024 of the width. */
const U = 1920 / 1024;
/** Where the fingertip sits in the cached image, and its size, in units. */
const OX = 20;
const OY = 4;
const IW = 52;
const IH = 68;

/** Index finger up, three curled fingers, palm and thumb: [left, top, right, bottom, radius], fingertip at x 5.5. */
const PARTS = [
  [0, 0, 11, 34, 5.5],
  [10, 16, 19, 34, 4.5],
  [18, 19, 26, 36, 4],
  [25, 22, 32, 38, 3.5],
  [-3, 26, 32, 50, 9],
  [-11, 25, 4, 37, 6],
] as const;
const CREASES = [
  [10.6, 23, 10.6, 31],
  [18.4, 25, 18.4, 33],
  [25.6, 28, 25.6, 35],
  [3, 32, 9, 34],
] as const;

function silhouette(c: CanvasRenderingContext2D) {
  c.beginPath();
  for (const [l, t, r, b, rad] of PARTS) c.roundRect((l - 5.5) * U, t * U, (r - l) * U, (b - t) * U, rad * U);
}

function render(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = Math.ceil(IW * U);
  cv.height = Math.ceil(IH * U);
  const c = cv.getContext('2d');
  if (!c) return cv;
  c.translate(OX * U, OY * U);

  // Shadow: one silhouette, so overlapping parts don't darken twice.
  const sh = document.createElement('canvas');
  sh.width = cv.width;
  sh.height = cv.height;
  const s = sh.getContext('2d');
  if (s) {
    s.translate(OX * U, OY * U);
    silhouette(s);
    s.fillStyle = '#000';
    s.fill('nonzero');
    c.globalAlpha = 0x38 / 255;
    c.drawImage(sh, -OX * U + 2.5 * U, -OY * U + 3.5 * U);
    c.globalAlpha = 1;
  }

  // The outline of the union: every part stroked at twice the width, then all filled white over it.
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = '#3a3a3a';
  c.lineWidth = 2 * 2.2 * U;
  for (const [l, t, r, b, rad] of PARTS) {
    c.beginPath();
    c.roundRect((l - 5.5) * U, t * U, (r - l) * U, (b - t) * U, rad * U);
    c.stroke();
  }
  silhouette(c);
  c.fillStyle = '#fff';
  c.fill('nonzero');
  c.lineWidth = 1.5 * U;
  c.beginPath();
  for (const [x1, y1, x2, y2] of CREASES) {
    c.moveTo((x1 - 5.5) * U, y1 * U);
    c.lineTo((x2 - 5.5) * U, y2 * U);
  }
  c.stroke();

  // The player badge.
  c.beginPath();
  c.roundRect(-4.5 * U, 47 * U, 28 * U, 13 * U, 4 * U);
  c.fillStyle = '#47b6ea';
  c.fill();
  c.strokeStyle = '#2c86ba';
  c.lineWidth = 1.6 * U;
  c.stroke();
  c.fillStyle = '#fff';
  c.font = `bold ${10.5 * U}px Arial, sans-serif`;
  c.textAlign = 'center';
  c.fillText('1', 9.5 * U, 53.5 * U + 3.8 * U);
  return cv;
}

let image: HTMLCanvasElement | null = null;

/** Draws the hand with its fingertip on (x, y), tilted as on the console. */
export function drawHand(c: CanvasRenderingContext2D, x: number, y: number) {
  image ??= render();
  c.save();
  c.translate(x, y);
  c.rotate((-8 * Math.PI) / 180);
  c.drawImage(image, -OX * U, -OY * U);
  c.restore();
}
