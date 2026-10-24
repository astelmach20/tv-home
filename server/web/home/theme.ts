// Launcher theme: the Wii Menu, or the classic rails. Kept in this browser's localStorage, which webOS clears when
// deploy.sh reinstalls the launcher app, so the Wii Menu is what comes back then. Switched with the remote's blue
// button, the `theme:<name>` launcher command, or `?theme=<name>` in the URL.
import { keyCode } from '../lib/dom.js';

export type Theme = 'wii' | 'classic';
const THEMES: readonly Theme[] = ['wii', 'classic'];
const DEFAULT_THEME: Theme = 'wii';
const isTheme = (s: string | null | undefined): s is Theme => THEMES.some((t) => t === s);

const STORE = 'tvhome.theme';
/** The blue button on the LG remote. */
const KEY_BLUE = 406;

const listeners: ((t: Theme) => void)[] = [];

function stored(): Theme {
  const fromUrl = new URLSearchParams(location.search).get('theme');
  if (isTheme(fromUrl)) return fromUrl;
  try {
    const t = localStorage.getItem(STORE);
    return isTheme(t) ? t : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

let current: Theme = stored();
export const theme = () => current;

/** Runs `fn` now with the current theme and again on every change. */
export function onTheme(fn: (t: Theme) => void) {
  listeners.push(fn);
  fn(current);
}

export function setTheme(t: Theme) {
  try {
    localStorage.setItem(STORE, t);
  } catch {
    /* still switch for this session */
  }
  if (t === current) return;
  current = t;
  document.body.dataset.theme = t;
  listeners.forEach((fn) => {
    fn(t);
  });
}

/** `theme:wii`, `theme:classic`. */
export function themeCommand(cmd: string) {
  const [verb, name] = cmd.split(':');
  if (verb === 'theme' && isTheme(name)) setTheme(name);
}

export function startTheme() {
  document.body.dataset.theme = current;
  document.addEventListener('keydown', (e) => {
    if (keyCode(e) !== KEY_BLUE) return;
    setTheme(current === 'wii' ? 'classic' : 'wii');
    e.preventDefault();
  });
}
