// Wii Menu theme, ported from wii-tv's WiiMenuView.java (MIT, MauroProto): twelve rounded channel frames to a page
// with the next page's first column at the edge, a striped backdrop, a curved blue line over a shaded panel holding
// a segment clock, the date and the round buttons, and a pointing hand that follows focus. Channels are the
// launcher's apps and inputs. Geometry is in pixels of the 1920x1080 reference, which is the page's own size.
// The TV can't repaint a full-screen canvas every frame, so each part is its own canvas, painted once, and the
// browser composites them: paging and the hand only move layers, focus fades a glow layer, and only the clock's
// small canvas repaints, once a second.
import { api, type LauncherApp, type LauncherInput } from '../../lib/api.js';
import { $, KEY, keyCode } from '../../lib/dom.js';
import { theme, onTheme } from '../theme.js';
import { preloadSounds, sound, startMusic, stopMusic, unblock, type Sound } from './audio.js';
import * as B from './base.js';
import * as G from './grid.js';
import { drawHand } from './hand.js';

// Channel frames: the box through the corner arcs' ends; the sides bow out by TILE_BULGE in the middle.
const TILE_X0 = 163;
const TILE_Y0 = 93.5;
const TILE_W = 381;
const TILE_H = 204.5;
const COL_PITCH = 404;
const ROW_PITCH = 228;
const PAGE_W = COL_PITCH * 4;
const TILE_R = 25;
const TILE_BULGE = 3;
const TILE_BORDER = 4.5;
const TILE_BORDER_RGB = [0xb5, 0xb5, 0xb5] as const;
/** Room around a tile's art for the bulge and antialiasing. */
const ART_PAD = 6;
/** Room around a frame for its focus glow. */
const GLOW_PAD = 16;
/** A page's canvas: its twelve frames with their art, placed at PAGE_X0 + page * PAGE_W, PAGE_Y0. */
const PAGE_X0 = TILE_X0 - ART_PAD - 2;
const PAGE_Y0 = Math.floor(TILE_Y0 - ART_PAD - 2);
const PAGE_CW = Math.ceil(TILE_X0 - PAGE_X0 + 3 * COL_PITCH + TILE_W + ART_PAD + 2);
const PAGE_CH = Math.ceil(TILE_Y0 - PAGE_Y0 + 2 * ROW_PITCH + TILE_H + ART_PAD + 2);

const ARROW_L = 1797.5;
const ARROW_TIP = 1850;
const ARROW_T = 365;
const ARROW_B = 462.5;
const ARROW_Y = 414;
/** An arrow's canvas, with the tip ARROW_PAD in from one side and vertically centred. */
const ARROW_CW = 70;
const ARROW_CH = 106;
const ARROW_PAD = 6;

const BTN_RIGHT_CX = 2 * B.CX - B.BTN_CX;
const BTN_SIZE = Math.ceil(2 * (B.BTN_RING + B.BTN_RING_HALF + 2));
/** Room around a round button or the SD card for its glow and the lift's scale. */
const BTN_PAD = 12;
const BTN_BOX = BTN_SIZE + 2 * BTN_PAD;
const SD_L = 356;
const SD_T = 897;
const SD_R = 424;
const SD_B = 994;

const DIGIT_W = 50;
const DIGIT_H = 79;
const DIGIT_T = 12;
const DIGIT_GAP = 2.5;
const CLOCK_TOP = 789;
const DIGIT_X = [825, 886, 983, 1044] as const;
const COLON_X = 959.5;
const COLON_DOT = 11;
const COLON_Y1 = 811.5;
const COLON_Y2 = 844.5;
const AMPM_X = 1142;
const AMPM_P_W = 24;
const AMPM_M_X = 1172;
const AMPM_M_W = 28;
const AMPM_BASE = 869;
const AMPM_CAP = 34;
const DATE_TRACKING = 2;
const DATE_EXTRA_SPACE = 3;
const DATE_BASE = 981;
const DATE_CAP = 55;
const CLOCK_COLOR = '#9a9a9a';
const DATE_COLOR = '#7c7c7c';
/** The clock's own canvas, around the digits, AM/PM and the date. */
const CLOCK_BOX = { x: 700, y: 780, w: 560, h: 220 } as const;
/** The hand's canvas, with the fingertip at (HAND_X, HAND_Y). */
const HAND_W = 150;
const HAND_H = 160;
const HAND_X = 50;
const HAND_Y = 24;
const FONT = '"LG Smart UI", Roboto, Arial, sans-serif';

const BLUE_RGB = [0x3f, 0xc0, 0xec] as const;
/** Segment bits a-g per digit; the original's 7 keeps the upper-left bar. */
const SEGMENTS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x27, 0x7f, 0x6f] as const;
/** The segment bits in the order digitSegs holds them: a, d, f, b, e, c, g. */
const SEGMENT_ORDER = [0x01, 0x08, 0x20, 0x02, 0x10, 0x04, 0x40] as const;

const HOVER_MS = 500;
/** How long the opening stays white before it fades: past webOS's own zoom-in of the app. */
const OPENING_HOLD_MS = 900;
const CLOCK_MS = 1000;
const BURN_IN_SHIFT_MS = 10 * 60_000;
const SETTINGS_APP = 'com.palm.app.settings';

interface Channel {
  key: string;
  label: string;
  run: () => void;
  /** Paints the channel's picture into a TILE_W x TILE_H box. */
  paint: (c: CanvasRenderingContext2D) => void;
  art?: HTMLCanvasElement;
}

interface MenuItem {
  label: string;
  run: () => void;
}

const rgba = (rgb: readonly number[], a = 1) => `rgba(${rgb.join(',')},${a.toFixed(3)})`;
const approach = (v: number, target: number, k: number, eps: number) => {
  const n = v + (target - v) * k;
  return Math.abs(target - n) < eps ? target : n;
};

// ---- shapes ----------------------------------------------------------------------------------------------------

/** A channel frame at the origin: rounded corners joined by sides that bow out by b in the middle. */
function tilePath(): Path2D {
  const tw = TILE_W;
  const th = TILE_H;
  const r = TILE_R;
  const b = TILE_BULGE;
  const k = r * 0.4477;
  const p = new Path2D();
  p.moveTo(r, 0);
  p.quadraticCurveTo(tw / 2, -2 * b, tw - r, 0);
  p.bezierCurveTo(tw - k, 0, tw, k, tw, r);
  p.quadraticCurveTo(tw + 2 * b, th / 2, tw, th - r);
  p.bezierCurveTo(tw, th - k, tw - k, th, tw - r, th);
  p.quadraticCurveTo(tw / 2, th + 2 * b, r, th);
  p.bezierCurveTo(k, th, 0, th - k, 0, th - r);
  p.quadraticCurveTo(-2 * b, th / 2, 0, r);
  p.bezierCurveTo(0, k, k, 0, r, 0);
  p.closePath();
  return p;
}

/** A closed polygon through [x, y, x, y, ...] with its corners rounded by r (Android's CornerPathEffect). */
function roundedPoly(pts: readonly number[], r: number): Path2D {
  const n = pts.length / 2;
  const pt = (i: number) => [pts[((i + n) % n) * 2] ?? 0, pts[((i + n) % n) * 2 + 1] ?? 0] as const;
  const p = new Path2D();
  const [x0, y0] = pt(0);
  const [xl, yl] = pt(-1);
  p.moveTo((x0 + xl) / 2, (y0 + yl) / 2);
  for (let i = 0; i < n; i++) {
    const [x, y] = pt(i);
    const [nx, ny] = pt(i + 1);
    p.arcTo(x, y, (x + nx) / 2, (y + ny) / 2, r);
  }
  p.closePath();
  return p;
}

/** The clock's digit segments: outer ones mitred into the box corners, the ones meeting the middle bar pointed. */
function digitPaths(): Path2D[][] {
  const t = DIGIT_T;
  const g = DIGIT_GAP;
  const k = t / 2;
  const ya = CLOCK_TOP;
  const yb = CLOCK_TOP + DIGIT_H;
  const ym = CLOCK_TOP + DIGIT_H / 2;
  const r = 2.5;
  return DIGIT_X.map((xa) => {
    const xb = xa + DIGIT_W;
    return [
      roundedPoly([xa + g, ya, xb - g, ya, xb - t - g, ya + t, xa + t + g, ya + t], r),
      roundedPoly([xa + t + g, yb - t, xb - t - g, yb - t, xb - g, yb, xa + g, yb], r),
      roundedPoly([xa, ya + g, xa + t, ya + t + g, xa + t, ym - k - g, xa + k, ym - g, xa, ym - k - g], r),
      roundedPoly([xb, ya + g, xb, ym - k - g, xb - k, ym - g, xb - t, ym - k - g, xb - t, ya + t + g], r),
      roundedPoly([xa, ym + k + g, xa + k, ym + g, xa + t, ym + k + g, xa + t, yb - t - g, xa, yb - g], r),
      roundedPoly([xb, ym + k + g, xb, yb - g, xb - t, yb - t - g, xb - t, ym + k + g, xb - k, ym + g], r),
      roundedPoly(
        [
          xa + k + g,
          ym,
          xa + t + g,
          ym - k,
          xb - t - g,
          ym - k,
          xb - k - g,
          ym,
          xb - t - g,
          ym + k,
          xa + t + g,
          ym + k,
        ],
        r,
      ),
    ];
  });
}

/** Right-pointing arrow around its tip at (0, 0); the back edge curves in toward the tip. */
function arrowPath(): Path2D {
  const l = ARROW_L - ARROW_TIP;
  const p = new Path2D();
  p.moveTo(0, 0);
  p.lineTo(l, ARROW_T - ARROW_Y);
  p.quadraticCurveTo(l + 12, 0, l, ARROW_B - ARROW_Y);
  p.closePath();
  return p;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  if (!c) throw new Error('no 2d canvas');
  return [cv, c];
}

// ---- static layers (computed once) -----------------------------------------------------------------------------

const TILE = tilePath();
const DIGITS = digitPaths();
const ARROW = arrowPath();
const SD = roundedPoly([SD_L, SD_T, SD_R - 9, SD_T, SD_R, SD_T + 9, SD_R, SD_B, SD_L, SD_B], 4);

interface Layers {
  strip: HTMLElement;
  pages: HTMLCanvasElement[];
  /** Two, so the old focus can fade out while the new one fades in. */
  glows: [HTMLCanvasElement, HTMLCanvasElement];
  arrows: [right: HTMLCanvasElement, left: HTMLCanvasElement];
  buttons: Map<G.Button, HTMLElement>;
  clock: CanvasRenderingContext2D;
  hand: HTMLCanvasElement;
}

let ui: Layers | null = null;
let emptyArt: HTMLCanvasElement | null = null;

function place(e: HTMLElement, x: number, y: number) {
  e.style.left = `${x}px`;
  e.style.top = `${y}px`;
}

/** A button or the SD card: its body and its glow, in a box that scales up a little when focused. */
function liftable(
  cls: string,
  w: number,
  h: number,
  body: (c: CanvasRenderingContext2D) => void,
  glow: (c: CanvasRenderingContext2D) => void,
): HTMLElement {
  const box = document.createElement('div');
  box.className = `wb ${cls}`;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
  const [b, bc] = canvas(w, h);
  body(bc);
  const [g, gc] = canvas(w, h);
  glow(gc);
  g.className = 'glow';
  box.append(b, g);
  return box;
}

function roundButton(paint: (c: CanvasRenderingContext2D) => void) {
  return liftable(
    'round',
    BTN_BOX,
    BTN_BOX,
    (c) => {
      const px = c.createImageData(BTN_SIZE, BTN_SIZE);
      B.button(px.data, BTN_SIZE);
      c.putImageData(px, BTN_PAD, BTN_PAD);
      paint(c);
    },
    (c) => {
      c.translate(BTN_BOX / 2, BTN_BOX / 2);
      for (let k = 3; k >= 1; k--) {
        c.strokeStyle = rgba(BLUE_RGB, 70 / k / 255);
        c.lineWidth = 3 + k * 5;
        c.beginPath();
        c.arc(0, 0, B.BTN_RING, 0, Math.PI * 2);
        c.stroke();
      }
    },
  );
}

/** Paints every part that doesn't change into its own canvas under #wii. */
function buildStatic(): Layers {
  const root = $('#wii');
  const menu = $('#wii-menu');
  const add = <T extends HTMLElement>(e: T, x: number, y: number): T => {
    place(e, x, y);
    root.insertBefore(e, menu);
    return e;
  };

  const [back, bc] = canvas(B.W, B.H);
  const img = bc.createImageData(B.W, B.H);
  B.backdrop(img.data);
  bc.putImageData(img, 0, 0);
  add(back, 0, 0);

  // putImageData ignores the clip, so the texture goes through a canvas of its own.
  const [grain, gc] = canvas(TILE_W, Math.ceil(TILE_H));
  const px = gc.createImageData(grain.width, grain.height);
  B.emptySlot(px.data, grain.width, grain.height);
  gc.putImageData(px, 0, 0);
  emptyArt = tileArt((c) => {
    c.drawImage(grain, ART_PAD, ART_PAD);
  });

  const strip = add(document.createElement('div'), 0, 0);
  strip.className = 'wii-strip';
  const glow = () => {
    const [cv, c] = canvas(TILE_W + 2 * GLOW_PAD, Math.ceil(TILE_H) + 2 * GLOW_PAD);
    c.translate(GLOW_PAD, GLOW_PAD);
    c.lineJoin = 'round';
    for (let k = 3; k >= 1; k--) {
      c.strokeStyle = rgba(BLUE_RGB, 64 / k / 255);
      c.lineWidth = TILE_BORDER + k * 5;
      c.stroke(TILE);
    }
    c.strokeStyle = rgba(BLUE_RGB);
    c.lineWidth = TILE_BORDER + 1.5;
    c.stroke(TILE);
    cv.className = 'glow';
    strip.append(cv);
    return cv;
  };

  const arrow = (flip: boolean) => {
    const [cv, c] = canvas(ARROW_CW, ARROW_CH);
    drawArrow(c, flip ? ARROW_PAD : ARROW_CW - ARROW_PAD, ARROW_CH / 2, flip);
    const tip = flip ? 2 * B.CX - ARROW_TIP : ARROW_TIP;
    return add(cv, flip ? tip - ARROW_PAD : tip - ARROW_CW + ARROW_PAD, ARROW_Y - ARROW_CH / 2);
  };
  const glows: Layers['glows'] = [glow(), glow()];
  const arrows: Layers['arrows'] = [arrow(false), arrow(true)];

  const settings = add(
    roundButton((c) => {
      drawWordmark(c, 'Settings');
    }),
    B.BTN_CX - BTN_BOX / 2,
    B.BTN_CY - BTN_BOX / 2,
  );
  const ins = add(roundButton(drawInputsIcon), BTN_RIGHT_CX - BTN_BOX / 2, B.BTN_CY - BTN_BOX / 2);
  const sdW = SD_R - SD_L + 2 * BTN_PAD;
  const sdH = SD_B - SD_T + 2 * BTN_PAD;
  const sd = add(
    liftable(
      'sd',
      sdW,
      sdH,
      (c) => {
        c.translate(BTN_PAD - SD_L, BTN_PAD - SD_T);
        drawSd(c);
      },
      (c) => {
        c.translate(BTN_PAD - SD_L, BTN_PAD - SD_T);
        for (let k = 3; k >= 1; k--) {
          c.strokeStyle = rgba(BLUE_RGB, 80 / k / 255);
          c.lineWidth = 2 + k * 4;
          c.stroke(SD);
        }
      },
    ),
    SD_L - BTN_PAD,
    SD_T - BTN_PAD,
  );

  const [clock, cc] = canvas(CLOCK_BOX.w, CLOCK_BOX.h);
  add(clock, CLOCK_BOX.x, CLOCK_BOX.y);
  const [hand, hc] = canvas(HAND_W, HAND_H);
  drawHand(hc, HAND_X, HAND_Y);
  hand.className = 'hand';
  add(hand, 0, 0);

  return {
    strip,
    pages: [],
    glows,
    arrows,
    buttons: new Map([
      [G.BTN_SETTINGS, settings],
      [G.BTN_SD, sd],
      [G.BTN_INPUTS, ins],
    ]),
    clock: cc,
    hand,
  };
}

/** The left button's label, embossed into the body. */
function drawWordmark(c: CanvasRenderingContext2D, label: string) {
  let size = 52;
  c.font = `bold ${size}px ${FONT}`;
  const tw = c.measureText(label).width;
  if (tw > 128) size = (size * 128) / tw;
  c.font = `bold ${size}px ${FONT}`;
  c.textAlign = 'center';
  const y = BTN_BOX / 2 + size / 3;
  c.fillStyle = 'rgba(255,255,255,.6)';
  c.fillText(label, BTN_BOX / 2, y + 2);
  c.fillStyle = '#a4a4a4';
  c.fillText(label, BTN_BOX / 2, y);
}

/** The right button's glyph: a screen with an arrow coming in, in the greys of the console's envelope. */
function drawInputsIcon(c: CanvasRenderingContext2D) {
  const cx = BTN_BOX / 2;
  const cy = BTN_BOX / 2;
  const ew = 97;
  const eh = 65;
  c.fillStyle = '#939393';
  c.beginPath();
  c.roundRect(cx - ew / 2, cy - eh / 2, ew, eh, 5);
  c.fill();
  c.strokeStyle = '#e2e2e2';
  c.lineWidth = 4.5;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(cx - 30, cy);
  c.lineTo(cx + 14, cy);
  c.moveTo(cx, cy - 14);
  c.lineTo(cx + 14, cy);
  c.lineTo(cx, cy + 14);
  c.moveTo(cx + 28, cy - 20);
  c.lineTo(cx + 28, cy + 20);
  c.stroke();
}

/** A tile's picture, clipped to the frame, with ART_PAD around it. */
function tileArt(paint: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const [cv, c] = canvas(TILE_W + 2 * ART_PAD, Math.ceil(TILE_H) + 2 * ART_PAD);
  c.translate(ART_PAD, ART_PAD);
  c.clip(TILE);
  c.translate(-ART_PAD, -ART_PAD);
  paint(c);
  return cv;
}

// ---- channels --------------------------------------------------------------------------------------------------

const launch = (id: string) => void api.launch(id).catch(() => {});

function whiteCard(c: CanvasRenderingContext2D) {
  const g = c.createLinearGradient(0, ART_PAD, 0, ART_PAD + TILE_H);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(1, '#e9e9e9');
  c.fillStyle = g;
  c.fillRect(0, 0, c.canvas.width, c.canvas.height);
}

function label(c: CanvasRenderingContext2D, text: string, y: number, size: number, color = '#7a7a7a') {
  c.font = `bold ${size}px ${FONT}`;
  c.fillStyle = color;
  c.textAlign = 'center';
  let t = text;
  while (t.length > 1 && c.measureText(t).width > TILE_W * 0.86) t = t.slice(0, -1);
  c.fillText(t === text ? t : `${t.trimEnd()}…`, ART_PAD + TILE_W / 2, ART_PAD + y);
}

function appChannel(a: LauncherApp): Channel {
  const icon = new Image();
  const ch: Channel = {
    key: `app:${a.id}`,
    label: a.title,
    run: () => {
      launch(a.id);
    },
    // A banner: the app's colour edge to edge with its icon in the middle, or its name if the icon won't load.
    paint: (c) => {
      if (!icon.complete || !icon.naturalWidth) {
        whiteCard(c);
        label(c, a.title, TILE_H * 0.58, 34);
        return;
      }
      c.fillStyle = a.color ?? '#ffffff';
      c.fillRect(0, 0, c.canvas.width, c.canvas.height);
      const size = TILE_H * 0.8;
      c.drawImage(icon, ART_PAD + (TILE_W - size) / 2, ART_PAD + (TILE_H - size) / 2, size, size);
    },
  };
  icon.onload = () => {
    ch.art = undefined;
    repaint(channels.indexOf(ch));
  };
  icon.src = `/icon?id=${encodeURIComponent(a.id)}`;
  return ch;
}

function inputChannel(i: LauncherInput): Channel {
  return {
    key: `input:${i.id}`,
    label: i.label,
    run: () => {
      launch(i.appId);
    },
    paint: (c) => {
      whiteCard(c);
      label(c, i.label, TILE_H * 0.5, 44, '#5e5e5e');
      c.font = `bold 24px ${FONT}`;
      c.textAlign = 'center';
      const status = `${i.port}  ·  ${i.on ? 'On' : 'Standby'}`;
      c.fillStyle = i.on ? '#3fa9d8' : '#9a9a9a';
      c.fillText(status, ART_PAD + TILE_W / 2, ART_PAD + TILE_H * 0.74);
    },
  };
}

// ---- state -----------------------------------------------------------------------------------------------------

let channels: Channel[] = [];
let inputs: LauncherInput[] = [];
let pages = G.MIN_PAGES;
let nav: G.Nav = { focus: 0, page: 0 };
let pagePos = 0;
/** Pages whose canvas needs painting again. */
const dirty = new Set<number>();
let glowOn: 0 | 1 = 0;
let handX = 0;
let handY = 0;
let handPlaced = false;
let colonOn = true;
let active = false;
let raf = 0;
let lastFrame = 0;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let saverOn = false;

let menuItems: MenuItem[] = [];
let menuFocus = 0;
let menuOpen = false;

function slotPos(slot: number, pos: number): [number, number] {
  const pg = Math.floor(slot / G.PER_PAGE);
  const i = slot % G.PER_PAGE;
  const row = Math.floor(i / G.COLS);
  const col = i % G.COLS;
  return [TILE_X0 + (pg * G.COLS + col) * COL_PITCH - pos * PAGE_W, TILE_Y0 + row * ROW_PITCH];
}

/** Where the hand's fingertip goes for this focus. */
function handTarget(f: number): [number, number] {
  if (f >= 0) {
    const [x, y] = slotPos(f, nav.page);
    return [x + TILE_W * 0.7, y + TILE_H * 0.8];
  }
  if (f === G.BTN_SD) return [(SD_L + SD_R) / 2 + 10, (SD_T + SD_B) / 2 + 14];
  return [(f === G.BTN_SETTINGS ? B.BTN_CX : BTN_RIGHT_CX) + 26, B.BTN_CY + 22];
}

/** Advances every animated value by dt seconds; true while anything is still moving. */
function step(dt: number): boolean {
  const kPage = 1 - Math.exp(-dt / 0.11);
  const kHand = 1 - Math.exp(-dt / 0.06);
  pagePos = approach(pagePos, nav.page, kPage, 0.0008);
  const moving = pagePos !== nav.page;
  const [tx, ty] = handTarget(nav.focus);
  if (!handPlaced) {
    handX = tx;
    handY = ty;
    handPlaced = true;
  }
  handX = approach(handX, tx, kHand, 0.3);
  handY = approach(handY, ty, kHand, 0.3);
  return moving || handX !== tx || handY !== ty;
}

// ---- drawing ---------------------------------------------------------------------------------------------------

/** Paints page p's twelve frames and their art into its canvas. */
function paintPage(p: number) {
  const c = ui?.pages[p]?.getContext('2d');
  if (!c) return;
  c.clearRect(0, 0, PAGE_CW, PAGE_CH);
  c.lineJoin = 'round';
  c.strokeStyle = rgba(TILE_BORDER_RGB);
  c.lineWidth = TILE_BORDER;
  for (let i = 0; i < G.PER_PAGE; i++) {
    const slot = p * G.PER_PAGE + i;
    const [sx, sy] = slotPos(slot, p);
    const x = sx - PAGE_X0;
    const y = sy - PAGE_Y0;
    const ch = channels[slot];
    if (ch) ch.art ??= tileArt(ch.paint);
    const art = ch?.art ?? emptyArt;
    if (art) c.drawImage(art, x - ART_PAD, y - ART_PAD);
    c.save();
    c.translate(x, y);
    c.stroke(TILE);
    c.restore();
  }
}

/** Makes one canvas per page and marks them all for painting. */
function buildPages() {
  if (!ui) return;
  const { strip, glows } = ui;
  while (ui.pages.length > pages) ui.pages.pop()?.remove();
  while (ui.pages.length < pages) {
    const [cv] = canvas(PAGE_CW, PAGE_CH);
    place(cv, PAGE_X0 + ui.pages.length * PAGE_W, PAGE_Y0);
    strip.insertBefore(cv, glows[0]);
    ui.pages.push(cv);
  }
  for (let p = 0; p < pages; p++) dirty.add(p);
  invalidate();
}

/** The page holding this slot needs painting again. */
function repaint(slot: number) {
  if (slot < 0) return;
  dirty.add(Math.floor(slot / G.PER_PAGE));
  invalidate();
}

/** Puts the glow on the focused frame or button and shows the arrows that lead somewhere. */
function showFocus() {
  if (!ui) return;
  const { glows, buttons, arrows } = ui;
  glows[glowOn].classList.remove('on');
  for (const [id, el] of buttons) el.classList.toggle('on', nav.focus === id);
  if (nav.focus >= 0) {
    glowOn = glowOn ? 0 : 1;
    const g = glows[glowOn];
    const [x, y] = slotPos(nav.focus, 0);
    g.style.transform = `translate3d(${x - GLOW_PAD}px, ${y - GLOW_PAD}px, 0)`;
    g.classList.add('on');
  }
  arrows[0].style.visibility = nav.page < pages - 1 ? 'visible' : 'hidden';
  arrows[1].style.visibility = nav.page > 0 ? 'visible' : 'hidden';
}

function drawArrow(c: CanvasRenderingContext2D, x: number, y: number, flip: boolean) {
  c.save();
  c.translate(x, y);
  if (flip) c.scale(-1, 1);
  const body = c.createLinearGradient(0, ARROW_T - ARROW_Y, 0, ARROW_B - ARROW_Y);
  [
    [0, '#6fcdf3'],
    [0.35, '#a9e6fb'],
    [0.5, '#ddf8ff'],
    [0.62, '#9fe0f8'],
    [1, '#62c5f0'],
  ].forEach(([at, col]) => {
    body.addColorStop(at as number, col as string);
  });
  c.fillStyle = body;
  c.fill(ARROW);
  const shine = c.createLinearGradient(ARROW_L - ARROW_TIP, 0, 0, 0);
  shine.addColorStop(0, 'rgba(255,255,255,.4)');
  shine.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = shine;
  c.fill(ARROW);
  c.strokeStyle = '#2e66c2';
  c.lineWidth = 3.2;
  c.lineJoin = 'round';
  c.stroke(ARROW);
  c.restore();
}

/** The SD card of the console, here the shortcut to the screensaver. */
function drawSd(c: CanvasRenderingContext2D) {
  c.save();
  c.translate(4, 4);
  c.fillStyle = 'rgba(0,0,0,.18)';
  c.fill(SD);
  c.restore();
  c.fillStyle = '#5cc8ee';
  c.fill(SD);
  c.fillStyle = '#a9ddf3';
  c.fillRect(SD_L + 4, SD_T + 4, SD_R - 10 - (SD_L + 4), 915 - (SD_T + 4));
  c.fillStyle = '#ffffff';
  c.fillRect(366, 915, 56, 60);
  c.fillStyle = '#4fc1ea';
  c.fillRect(366, 975, 56, 12);
  c.font = `italic bold 19px ${FONT}`;
  c.textAlign = 'center';
  c.fillStyle = '#59bde8';
  c.fillText('SD', 394, 952);
}

function drawClock(c: CanvasRenderingContext2D, now: Date) {
  const h = now.getHours() % 12 || 12;
  const m = now.getMinutes();
  c.fillStyle = CLOCK_COLOR;
  const digit = (pos: number, d: number) => {
    const bits = SEGMENTS[d] ?? 0;
    const segs = DIGITS[pos] ?? [];
    SEGMENT_ORDER.forEach((bit, k) => {
      const seg = segs[k];
      if (bits & bit && seg) c.fill(seg);
    });
  };
  if (h >= 10) digit(0, Math.floor(h / 10));
  digit(1, h % 10);
  digit(2, Math.floor(m / 10));
  digit(3, m % 10);
  if (colonOn) {
    const d = COLON_DOT / 2;
    for (const y of [COLON_Y1, COLON_Y2]) {
      c.beginPath();
      c.roundRect(COLON_X - d, y - d, COLON_DOT, COLON_DOT, 2);
      c.fill();
    }
  }
  // AM/PM letter by letter at the original's ink positions and widths.
  c.font = `bold ${AMPM_CAP / 0.711}px ${FONT}`;
  c.textAlign = 'left';
  const ink = (letter: string, left: number, width: number) => {
    const mt = c.measureText(letter);
    const inkW = mt.actualBoundingBoxLeft + mt.actualBoundingBoxRight;
    const sx = inkW > 0 ? width / inkW : 1;
    c.save();
    c.translate(left + mt.actualBoundingBoxLeft * sx, AMPM_BASE);
    c.scale(sx, 1);
    c.fillText(letter, 0, 0);
    c.restore();
  };
  ink(now.getHours() >= 12 ? 'P' : 'A', AMPM_X, AMPM_P_W);
  ink('M', AMPM_M_X, AMPM_M_W);

  // The date, set looser than the font: 2 px more between letters, 3 more at the space.
  const day = now.toLocaleDateString('en-US', { weekday: 'short' });
  const rest = `${now.getMonth() + 1}/${now.getDate()}`;
  c.font = `bold ${DATE_CAP / 0.711}px ${FONT}`;
  c.letterSpacing = `${DATE_TRACKING}px`;
  c.fillStyle = DATE_COLOR;
  const gap = c.measureText(' ').width + DATE_EXTRA_SPACE;
  const wDay = c.measureText(day).width;
  const wRest = c.measureText(rest).width;
  const x = B.CX - (wDay + gap + wRest) / 2;
  c.fillText(day, x, DATE_BASE);
  c.fillText(rest, x + wDay + gap, DATE_BASE);
  c.letterSpacing = '0px';
}

function paintClock() {
  const c = ui?.clock;
  if (!c) return;
  c.clearRect(0, 0, CLOCK_BOX.w, CLOCK_BOX.h);
  c.save();
  c.translate(-CLOCK_BOX.x, -CLOCK_BOX.y);
  drawClock(c, new Date());
  c.restore();
}

/** Moves the layers to the current animation state. */
function arrange() {
  if (!ui) return;
  ui.strip.style.transform = `translate3d(${-pagePos * PAGE_W}px, 0, 0)`;
  // Only pages on or next to the screen stay composited.
  ui.pages.forEach((cv, p) => {
    const d = p - pagePos;
    const vis = d > -1.2 && d < 1.9 ? 'visible' : 'hidden';
    if (cv.style.visibility !== vis) cv.style.visibility = vis;
  });
  ui.hand.style.transform = `translate3d(${handX - HAND_X}px, ${handY - HAND_Y}px, 0)`;
}

function frame(now: number) {
  raf = 0;
  const dt = lastFrame ? Math.min(0.05, (now - lastFrame) / 1000) : 1 / 60;
  lastFrame = now;
  const moving = step(dt);
  for (const p of dirty) paintPage(p);
  dirty.clear();
  arrange();
  if (moving) invalidate();
  else lastFrame = 0;
}

function invalidate() {
  if (active && !raf) raf = requestAnimationFrame(frame);
}

// ---- menus (the inputs list and the SD card) --------------------------------------------------------------------

function renderMenu() {
  const items = $('#wii-menu .wm-items');
  items.replaceChildren(
    ...menuItems.map((it, i) => {
      const el = document.createElement('div');
      el.className = `wm-item${i === menuFocus ? ' focused' : ''}`;
      el.textContent = it.label;
      return el;
    }),
  );
}

function showMenu(title: string, items: MenuItem[]) {
  clearTimeout(hoverTimer);
  menuItems = items;
  menuFocus = 0;
  menuOpen = true;
  $('#wii-menu .wm-title').textContent = title;
  renderMenu();
  $('#wii-menu').hidden = false;
}

function closeMenu() {
  menuOpen = false;
  $('#wii-menu').hidden = true;
  scheduleHover();
}

function menuKey(code: number): boolean {
  switch (code) {
    case KEY.UP:
    case KEY.DOWN: {
      const to = menuFocus + (code === KEY.UP ? -1 : 1);
      if (to >= 0 && to < menuItems.length) {
        menuFocus = to;
        sound('move');
        renderMenu();
      }
      return true;
    }
    case KEY.LEFT:
    case KEY.RIGHT:
      return true;
    case KEY.ENTER: {
      const it = menuItems[menuFocus];
      sound('select');
      closeMenu();
      it?.run();
      return true;
    }
    case KEY.BACK:
    case KEY.ESC:
      sound('back');
      closeMenu();
      return true;
    default:
      return false;
  }
}

// ---- keys ------------------------------------------------------------------------------------------------------

/** The remote's CH+ and CH- (and a keyboard's Page Up/Down) turn whole pages. */
const KEY_PAGE_UP = 33;
const KEY_PAGE_DOWN = 34;

function scheduleHover() {
  clearTimeout(hoverTimer);
  if (!active || menuOpen || nav.focus < 0 || nav.focus >= channels.length) return;
  hoverTimer = setTimeout(() => {
    if (active && !menuOpen && !saverOn) sound('woop');
  }, HOVER_MS);
}

function go(next: G.Nav) {
  if (next.focus === nav.focus && next.page === nav.page) return;
  const turned = next.page !== nav.page;
  nav = next;
  sound(turned ? 'page' : 'move');
  scheduleHover();
  showFocus();
  invalidate();
}

function activate() {
  clearTimeout(hoverTimer);
  const f = nav.focus;
  const big: Sound = 'big_buttons';
  if (f === G.BTN_SETTINGS) {
    sound(big);
    launch(SETTINGS_APP);
  } else if (f === G.BTN_SD) {
    sound(big);
    showMenu('SD Card', [{ label: 'Screensaver', run: startSaver }]);
  } else if (f === G.BTN_INPUTS) {
    sound(big);
    showMenu(
      'Inputs',
      inputs.length
        ? inputs.map((i) => ({ label: `${i.label}  ·  ${i.port}`, run: () => launch(i.appId) }))
        : [{ label: 'No inputs found', run: () => {} }],
    );
  } else {
    const ch = channels[f];
    if (!ch) return;
    sound('select');
    ch.run();
  }
}

function onKey(e: KeyboardEvent) {
  if (theme() !== 'wii') return;
  unblock();
  const code = keyCode(e);
  let handled = true;
  if (menuOpen) handled = menuKey(code);
  else {
    switch (code) {
      case KEY.LEFT:
        go(G.move(nav, -1, 0, pages));
        break;
      case KEY.RIGHT:
        go(G.move(nav, 1, 0, pages));
        break;
      case KEY.UP:
        go(G.move(nav, 0, -1, pages));
        break;
      case KEY.DOWN:
        go(G.move(nav, 0, 1, pages));
        break;
      case KEY_PAGE_UP:
        go(G.turnPage(nav, 1, pages));
        break;
      case KEY_PAGE_DOWN:
        go(G.turnPage(nav, -1, pages));
        break;
      case KEY.ENTER:
        activate();
        break;
      default:
        handled = false;
    }
  }
  if (handled) e.preventDefault();
}

// ---- lifecycle -------------------------------------------------------------------------------------------------

let startSaver: () => void = () => {};

async function loadChannels() {
  const [apps, ins] = await Promise.all([api.apps().catch(() => []), api.inputs().catch(() => [])]);
  const focusedKey = channels[nav.focus]?.key;
  inputs = ins;
  channels = [...apps.map(appChannel), ...ins.map(inputChannel)];
  pages = G.pageCount(channels.length);
  // Keep the hand on the same channel wherever it is now.
  const at = focusedKey ? channels.findIndex((ch) => ch.key === focusedKey) : -1;
  if (at >= 0) nav = { focus: at, page: Math.floor(at / G.PER_PAGE) };
  else if (nav.focus >= pages * G.PER_PAGE || nav.page >= pages) nav = { focus: 0, page: 0 };
  pagePos = nav.page;
  handPlaced = false;
  buildPages();
  showFocus();
}

/** White over the menu while it is first built; fading it out (class `go`) is the opening. */
function openingVeil(): HTMLElement {
  const veil = document.createElement('div');
  veil.id = 'wii-opening';
  veil.addEventListener('animationend', () => {
    veil.remove();
  });
  $('#wii').append(veil);
  return veil;
}

function music(withJingle: boolean) {
  if (active && !document.hidden && !saverOn) startMusic(withJingle);
  else stopMusic();
}

function setActive(on: boolean) {
  if (on === active) return;
  active = on;
  if (on) {
    // The first time on this page, the menu fades in from white with the jingle once its channels are painted.
    const opening = !ui;
    ui ??= buildStatic();
    const veil = opening ? openingVeil() : null;
    paintClock();
    preloadSounds();
    // webOS zooms the app in as it opens; the fade waits until that is over, or the zoom hides it.
    const settle = new Promise((done) => setTimeout(done, opening ? OPENING_HOLD_MS : 0));
    void Promise.all([loadChannels(), settle]).then(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          veil?.classList.add('go');
          music(true);
          scheduleHover();
        });
      });
    });
  } else {
    if (menuOpen) closeMenu();
    clearTimeout(hoverTimer);
    stopMusic();
  }
}

/** The screensaver came up or went away. */
export function wiiSaver(on: boolean) {
  saverOn = on;
  if (on) clearTimeout(hoverTimer);
  music(false);
}

export function startWii(saver: () => void) {
  startSaver = saver;
  document.addEventListener('keydown', onKey);
  onTheme((t) => {
    setActive(t === 'wii');
  });
  document.addEventListener('visibilitychange', () => {
    if (!active) return;
    music(false);
    if (!document.hidden) void loadChannels();
  });
  setInterval(() => {
    colonOn = !colonOn;
    if (active) paintClock();
  }, CLOCK_MS);
  // Shift the menu a few pixels every 10 min so its still parts don't burn into the OLED.
  setInterval(() => {
    const d = () => Math.round(Math.random() * 8 - 4);
    $('#wii').style.transform = `translate3d(${d()}px, ${d()}px, 0)`;
  }, BURN_IN_SHIFT_MS);
}
