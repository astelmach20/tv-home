// Pixels for the Wii Menu theme's static parts, ported from wii-tv's WiiBase.java (MIT, MauroProto): the striped
// backdrop, the blue line, the bottom panel with its button tracks, the round buttons' bodies and the empty-slot
// texture. Coordinates are pixels of the 1920x1080 reference, which is also the launcher's canvas size.
import * as P from './palette.js';

export const W = 1920;
export const H = 1080;
export const CX = 959.5;
const LINE_TOP = 783.36;
const LINE_BOTTOM = 898.48;
/** x of the four points of the left curve's cubic; y runs top, top, bottom, bottom. Mirrored on the right. */
const CURVE = [288, 448, 516, 686] as const;
const LINE_HALF = 2.5;
const LINE_RGB = [0x3e, 0xbc, 0xe8] as const;
const HIGHLIGHT_D = -8.5;
const HIGHLIGHT_SIGMA = 1.3;
const HIGHLIGHT_AMP = 6;

export const BTN_CX = 172.1;
export const BTN_CY = 908.9;
export const BTN_RING = 88.6;
export const BTN_RING_HALF = 2.7;
const TRACK_CY = 918;
const TRACK_END_X = 178;
/** Button body grey as a polynomial in (x, y) / BODY_R, least-squares fitted to both buttons of the capture. */
const BODY_R = 86;
const BODY = [219.876, -27.784, -14.379, 0.952, -0.734, 13.346, 24.161, 7.595, 4.184, 31.043, -6.78, -32.405] as const;

const at = (a: readonly number[], i: number) => a[i] ?? 0;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const bez = (a: number, b: number, c: number, d: number, t: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

/** Height of the blue line's centre at x. */
export function lineY(x: number): number {
  const xm = x > CX ? 2 * CX - x : x;
  if (xm <= CURVE[0]) return LINE_TOP;
  if (xm >= CURVE[3]) return LINE_BOTTOM;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 22; i++) {
    const t = (lo + hi) / 2;
    if (bez(CURVE[0], CURVE[1], CURVE[2], CURVE[3], t) < xm) lo = t;
    else hi = t;
  }
  return bez(LINE_TOP, LINE_TOP, LINE_BOTTOM, LINE_BOTTOM, (lo + hi) / 2);
}

/** Smooth bump that is 1 between lo and hi and falls off over `soft` px either side. */
function band(v: number, lo: number, hi: number, soft: number) {
  if (v < lo) return clamp01(1 - (lo - v) / soft);
  if (v > hi) return clamp01(1 - (v - hi) / soft);
  return 1;
}

/** Panel colour, bilinear between table cells, as [r, g, b]. */
function panel(xm: number, d: number, out: number[]) {
  const fi = Math.min(Math.max(0, xm / P.PANEL_STEP_X), P.PANEL_NX - 1.001);
  const fj = Math.min(Math.max(0, d) / P.PANEL_STEP_D, P.PANEL_ND - 1.001);
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const ax = fi - i;
  const ay = fj - j;
  const n = P.PANEL_NX;
  const c00 = at(P.PANEL, j * n + i);
  const c10 = at(P.PANEL, j * n + i + 1);
  const c01 = at(P.PANEL, (j + 1) * n + i);
  const c11 = at(P.PANEL, (j + 1) * n + i + 1);
  const w00 = (1 - ax) * (1 - ay);
  const w10 = ax * (1 - ay);
  const w01 = (1 - ax) * ay;
  const w11 = ax * ay;
  for (let k = 0; k < 3; k++) {
    const sh = 16 - 8 * k;
    out[k] =
      ((c00 >> sh) & 255) * w00 + ((c10 >> sh) & 255) * w10 + ((c01 >> sh) & 255) * w01 + ((c11 >> sh) & 255) * w11;
  }
}

function trackDelta(y: number) {
  return at(P.TRACK_DELTA, Math.round(y) - P.TRACK_Y0);
}

/** Grey offset the button tracks and sockets add to the panel at a mirrored point (left half). */
function socketDelta(xm: number, y: number, rightSide: boolean) {
  if (xm > 330 || y < 780) return 0;
  let delta = 0;
  if (xm <= TRACK_END_X) {
    let dl = trackDelta(y);
    // The upper grooves stop short of the button; the lower edge runs on round the track's end.
    if (y < 870) dl *= clamp01((165 - xm) / 45);
    delta += dl;
  } else {
    const r = Math.hypot(xm - TRACK_END_X, y - TRACK_CY);
    if (r >= 98) delta += trackDelta(TRACK_CY + r);
    else if (y > TRACK_CY - 98) delta += -3;
  }
  const bx = xm - BTN_CX;
  const by = y - BTN_CY;
  const rr = Math.hypot(bx, by);
  if (rr > 0) {
    const towardCentre = bx / rr;
    if (towardCentre > 0) delta += 9 * towardCentre * band(rr, 99, 111, 4);
    const realX = rightSide ? -bx : bx;
    const c = (realX + by) / (rr * Math.SQRT2);
    if (c > 0 && rr > BTN_RING) delta -= 18 * c * clamp01(1 - (rr - BTN_RING - 1) / 14);
  }
  return delta;
}

/** The whole backdrop, W x H, as RGBA bytes. */
export function backdrop(out: Uint8ClampedArray) {
  const colLine = new Float32Array(W);
  const colCos = new Float32Array(W);
  const colBase = new Float32Array(W);
  const colAmp = new Float32Array(W);
  const colXm = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const ly = lineY(x);
    const slope = lineY(x + 0.5) - lineY(x - 0.5);
    colLine[x] = ly;
    colCos[x] = 1 / Math.sqrt(1 + slope * slope);
    const fd = Math.abs(x - CX) / 32;
    const i = Math.min(P.BG_BASE.length - 2, Math.floor(fd));
    const a = Math.min(1, fd - i);
    colBase[x] = at(P.BG_BASE, i) * (1 - a) + at(P.BG_BASE, i + 1) * a;
    colAmp[x] = at(P.BG_AMP, i) * (1 - a) + at(P.BG_AMP, i + 1) * a;
    colXm[x] = x > CX ? 2 * CX - x : x;
  }
  const inv2s2 = 1 / (2 * P.STRIPE_SIGMA * P.STRIPE_SIGMA);
  const hl2 = 2 * HIGHLIGHT_SIGMA * HIGHLIGHT_SIGMA;
  const rgb = [0, 0, 0];
  for (let y = 0; y < H; y++) {
    let ph = ((y - P.STRIPE_PHASE) / P.STRIPE_PERIOD) % 1;
    if (ph < 0) ph += 1;
    const dist = Math.min(ph, 1 - ph) * P.STRIPE_PERIOD;
    const k = Math.exp(-dist * dist * inv2s2);
    for (let x = 0; x < W; x++) {
      const dY = y - (colLine[x] ?? 0);
      const dp = dY * (colCos[x] ?? 1);
      if (dp < 0) {
        const hd = dp - HIGHLIGHT_D;
        const v = (colBase[x] ?? 0) + (colAmp[x] ?? 0) * k + HIGHLIGHT_AMP * Math.exp((-hd * hd) / hl2);
        rgb[0] = rgb[1] = rgb[2] = v;
      } else {
        const xm = colXm[x] ?? 0;
        panel(xm, dY, rgb);
        const dl = socketDelta(xm, y, x > CX);
        for (let c = 0; c < 3; c++) rgb[c] = (rgb[c] ?? 0) + dl;
      }
      const cov = clamp01(LINE_HALF - Math.abs(dp) + 0.5);
      const o = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = rgb[c] ?? 0;
        out[o + c] = v + ((LINE_RGB[c] ?? v) - v) * cov;
      }
      out[o + 3] = 255;
    }
  }
}

/** One round button's body and blue ring, centred in a size x size square, transparent outside the ring. */
export function button(out: Uint8ClampedArray, size: number) {
  const c = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.hypot(dx, dy);
      const outer = clamp01(BTN_RING + BTN_RING_HALF - r + 0.5);
      if (outer <= 0) continue;
      const nx = dx / BODY_R;
      const ny = dy / BODY_R;
      const r2 = nx * nx + ny * ny;
      const k = BODY;
      const v =
        k[0] +
        k[1] * nx +
        k[2] * ny +
        k[3] * nx * nx +
        k[4] * ny * ny +
        k[5] * nx * ny +
        k[6] * nx * nx * nx +
        k[7] * ny * ny * ny +
        k[8] * nx * nx * ny +
        k[9] * nx * ny * ny +
        k[10] * r2 * r2 +
        k[11] * r2 * r2 * r2;
      const ring = clamp01(BTN_RING_HALF - Math.abs(r - BTN_RING) + 0.5);
      const o = (y * size + x) * 4;
      out[o] = v + (0x4d - v) * ring;
      out[o + 1] = v + (0xbd - v) * ring;
      out[o + 2] = v + (0xe3 - v) * ring;
      out[o + 3] = outer * 255;
    }
  }
}

function hash(x: number, y: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return h ^ (h >>> 16);
}

/** The frosted grey an empty channel slot shows: darker at the top, faint horizontal grain. */
export function emptySlot(out: Uint8ClampedArray, tw: number, th: number) {
  for (let y = 0; y < th; y++) {
    const t = y / Math.max(1, th - 1);
    const base = 0xcf + (0xdf - 0xcf) * t * t;
    const streak = ((hash(y, 7) & 255) / 255 - 0.5) * 3;
    for (let x = 0; x < tw; x++) {
      const v = base + streak + ((hash(x, y) & 255) / 255 - 0.5) * 5;
      const o = (y * tw + x) * 4;
      out[o] = out[o + 1] = out[o + 2] = v;
      out[o + 3] = 255;
    }
  }
}
