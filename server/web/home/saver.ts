// Aerial screensaver: starts after IDLE_MS without a key press; any key dismisses it (and is swallowed).
// Mixes in a public-domain painting every few clips. The server can start it, or a single theme, via /api/cmd.
import { api, type Aerial, type Painting } from '../lib/api.js';
import { $, replay } from '../lib/dom.js';
import { weather } from './weather.js';

const IDLE_MS = 3 * 60_000;
/** Move to the next aerial after this long even if the clip is longer. */
const CLIP_MS = 4 * 60_000;
const ART_MS = 75_000;
/** A painting after every N aerials (mixed mode only). */
const ART_EVERY = 3;
const NIGHT = { from: 21, to: 6 };

type Theme = 'ocean' | 'nature' | 'space';
const THEMES: readonly Theme[] = ['ocean', 'nature', 'space'];
const isTheme = (s: string | undefined): s is Theme => THEMES.some((t) => t === s);

const saver = $('#saver');
const vids: [HTMLVideoElement, HTMLVideoElement] = [$('#sv-a', HTMLVideoElement), $('#sv-b', HTMLVideoElement)];

let aerials: Aerial[] = [];
let list: Aerial[] = [];
let art: Painting[] = [];
let idx = 0;
let artIdx = 0;
let shown = 0;
let cur: 0 | 1 = 0;
let theme: Theme | null = null;
let active = false;
let idleTimer: ReturnType<typeof setTimeout> | undefined;
let clipTimer: ReturnType<typeof setTimeout> | undefined;

const shuffle = <T>(a: T[]) => a.map((x) => [Math.random(), x] as const).sort((p, q) => p[0] - q[0]).map(([, x]) => x);

/** Shuffled playlist: favorites twice as often, space clips (ISS night passes) favored at night. */
function playlist(clips: Aerial[]): Aerial[] {
  const h = new Date().getHours();
  const night = h >= NIGHT.from || h < NIGHT.to;
  const weight = (c: Aerial) => (c.tags.includes('space') ? (night ? 4 : 2) : c.tags.includes('favorite') ? 2 : 1);
  const out = shuffle(clips.flatMap((c) => Array<Aerial>(weight(c)).fill(c)));
  return out.filter((c, i) => out[i - 1]?.url !== c.url);
}

const forTheme = (t: Theme | null) => (t ? aerials.filter((c) => c.tags.includes(t)) : aerials);

function overlay() {
  const d = new Date();
  $('#sv-time').textContent = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/, '');
  $('#sv-date').textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  const w = weather();
  $('#sv-weather').textContent = w ? `${w.temp}° / H${w.high} L${w.low} / Rain ${w.rain}%` : '';
}

function showArt() {
  const a = art[artIdx++ % art.length];
  if (!a) {
    next();
    return;
  }
  const img = new Image();
  img.onload = () => {
    if (!active) return;
    const layer = $('#sv-art');
    layer.replaceChildren(img);
    replay(layer, 'show');
    vids.forEach((v) => v.classList.remove('show'));
    setTimeout(() => {
      vids.forEach((v) => {
        if (!v.classList.contains('show')) v.pause();
      });
    }, 3000);
    $('#sv-place').textContent = [a.title, a.artist, a.date].filter(Boolean).join('  ·  ');
  };
  img.onerror = () => {
    next();
  };
  img.src = a.url;
  clearTimeout(clipTimer);
  clipTimer = setTimeout(next, ART_MS);
}

function next() {
  if (!active || !list.length) return;
  if (!theme && art.length && ++shown % (ART_EVERY + 1) === 0) {
    showArt();
    return;
  }
  if (!theme && idx && idx % list.length === 0) list = playlist(aerials); // reshuffle each cycle (night weighting may change)
  const clip = list[idx++ % list.length];
  if (!clip) return;
  const nextIdx: 0 | 1 = cur === 0 ? 1 : 0;
  const v = vids[nextIdx];
  const old = vids[cur];
  v.src = clip.url;
  v.oncanplay = () => {
    v.oncanplay = null;
    v.play().catch(() => {});
    v.classList.add('show');
    old.classList.remove('show');
    $('#sv-art').classList.remove('show');
    setTimeout(() => {
      if (old.classList.contains('show')) return;
      old.pause();
      old.removeAttribute('src');
      old.load();
    }, 3000);
    $('#sv-place').textContent = clip.label;
    cur = nextIdx;
  };
  v.onended = next;
  v.onerror = () => {
    setTimeout(next, 1000);
  };
  clearTimeout(clipTimer);
  clipTimer = setTimeout(next, CLIP_MS);
}

/** Told when the screensaver comes up (true) or goes away (false). */
let onChange: (on: boolean) => void = () => {};

function start() {
  if (active || document.hidden) return;
  active = true;
  onChange(true);
  overlay();
  saver.hidden = false;
  requestAnimationFrame(() => saver.classList.add('on'));
  next();
}

function stop() {
  if (active) onChange(false);
  active = false;
  clearTimeout(clipTimer);
  if (theme) {
    theme = null;
    list = playlist(aerials);
    idx = 0;
  }
  saver.classList.remove('on');
  setTimeout(() => {
    if (active) return;
    saver.hidden = true;
    vids.forEach((v) => {
      v.pause();
      v.classList.remove('show');
      v.removeAttribute('src');
      v.load();
    });
  }, 1200);
}

function poke() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(start, IDLE_MS);
}

/** `saver` plays the mix; `saver:<theme>` plays only that theme; `wake` dismisses. */
export function saverCommand(cmd: string) {
  if (cmd === 'wake') {
    stop();
    poke();
    return;
  }
  if (!cmd.startsWith('saver')) return;
  const t = cmd.split(':')[1];
  theme = isTheme(t) ? t : null;
  list = playlist(forTheme(theme));
  idx = 0;
  shown = 0;
  if (active) next();
  else start();
}

export function startSaver(changed: (on: boolean) => void) {
  onChange = changed;
  api
    .aerials()
    .then((a) => {
      aerials = a;
      list = playlist(a);
    })
    .catch(() => {});
  api
    .art()
    .then((a) => {
      art = shuffle(a);
    })
    .catch(() => {});

  document.addEventListener(
    'keydown',
    (e) => {
      if (active) {
        stop();
        e.stopImmediatePropagation();
        e.preventDefault();
      }
      poke();
    },
    true,
  );
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else poke();
  });
  setInterval(() => {
    if (active) overlay();
  }, 1000);
  poke();
}
