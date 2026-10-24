// Wii Menu sounds and music (MIT remakes from wii-tv; see public/wii/CREDITS.md). Nothing plays while audio is off:
// `wii-audio:off` (kept in localStorage) or `?audio=off` for one page load. Effects are decoded once and played
// through Web Audio, since each new <audio> element sets up a media pipeline on webOS and that lags key presses.

export type Sound = 'move' | 'select' | 'page' | 'back' | 'big_buttons' | 'start' | 'woop';

const STORE = 'tvhome.wii.audio';
/** Quiet next to TV shows: the soundbar is set for those, and menu sounds are mastered loud. */
const EFFECT_VOLUME = 0.2;
const MUSIC_VOLUME = 0.12;
/** The menu music comes in this long after the jingle starts, as on the console. */
const MUSIC_DELAY_MS = 1000;

const SOUNDS: readonly Sound[] = ['move', 'select', 'page', 'back', 'big_buttons', 'start', 'woop'];

const src = (name: string) => `/wii/${name}.ogg`;
const effects = new Map<Sound, Promise<AudioBuffer | null>>();
let ctx: AudioContext | null = null;
let gain: GainNode | null = null;
let music: HTMLAudioElement | null = null;
let musicTimer: ReturnType<typeof setTimeout> | undefined;
/** The browser refused to start audio before a key press; start the music on the next one. */
let blocked = false;
let wanted = false;

function enabled(): boolean {
  if (new URLSearchParams(location.search).get('audio') === 'off') return false;
  try {
    return localStorage.getItem(STORE) !== 'off';
  } catch {
    return true;
  }
}

function play(el: HTMLAudioElement): Promise<void> {
  if (!enabled()) return Promise.resolve();
  return el.play();
}

function output(): [AudioContext, GainNode] {
  ctx ??= new AudioContext();
  if (!gain) {
    gain = ctx.createGain();
    gain.gain.value = EFFECT_VOLUME;
    gain.connect(ctx.destination);
  }
  return [ctx, gain];
}

function effect(name: Sound): Promise<AudioBuffer | null> {
  let buf = effects.get(name);
  if (!buf) {
    const [c] = output();
    buf = fetch(src(name))
      .then((r) => r.arrayBuffer())
      .then((data) => c.decodeAudioData(data))
      .catch(() => null);
    effects.set(name, buf);
  }
  return buf;
}

/** Fetches and decodes every effect ahead of the first key press. */
export function preloadSounds() {
  if (enabled()) SOUNDS.forEach((s) => void effect(s));
}

export function sound(name: Sound) {
  if (!enabled()) return;
  void effect(name).then((buf) => {
    if (!buf || !enabled()) return;
    const [c, out] = output();
    if (c.state === 'suspended') void c.resume();
    // A new source each time, so quick presses overlap instead of cutting each other off.
    const s = c.createBufferSource();
    s.buffer = buf;
    s.connect(out);
    s.start();
  });
}

function startLoop() {
  music ??= Object.assign(new Audio(src('menu_music')), { loop: true, preload: 'auto', volume: MUSIC_VOLUME });
  play(music).catch(() => {
    blocked = true;
  });
}

/** Starts the menu music, after the start jingle when `withJingle`. */
export function startMusic(withJingle: boolean) {
  wanted = true;
  clearTimeout(musicTimer);
  if (withJingle) {
    sound('start');
    musicTimer = setTimeout(startLoop, MUSIC_DELAY_MS);
  } else {
    startLoop();
  }
}

export function stopMusic() {
  wanted = false;
  clearTimeout(musicTimer);
  music?.pause();
}

/** `wii-audio:on`, `wii-audio:off`. */
export function audioCommand(cmd: string) {
  const [verb, state] = cmd.split(':');
  if (verb !== 'wii-audio' || (state !== 'on' && state !== 'off')) return;
  try {
    localStorage.setItem(STORE, state);
  } catch {
    /* ignore */
  }
  if (state === 'off') music?.pause();
  else if (wanted) startLoop();
}

/** Call on every key press: retries music the browser blocked before the first user gesture. */
export function unblock() {
  if (ctx?.state === 'suspended' && enabled()) void ctx.resume();
  if (!blocked || !wanted) return;
  blocked = false;
  startLoop();
}
