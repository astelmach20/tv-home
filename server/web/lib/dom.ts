// Small DOM helpers shared by the launcher pages.

type ElementClass<E extends Element> = abstract new (...args: never[]) => E;

/**
 * The element matching `selector`, checked to be an instance of `type` (default HTMLElement). Throws if the page is
 * missing it or it's the wrong kind of element, so a typo fails loudly instead of as a null deref later.
 */
export function $(selector: string): HTMLElement;
export function $<E extends Element>(selector: string, type: ElementClass<E>): E;
export function $(selector: string, type: ElementClass<Element> = HTMLElement): Element {
  const el = document.querySelector(selector);
  if (!(el instanceof type)) throw new Error(`missing or wrong element: ${selector}`);
  return el;
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
export const esc = (s: string | number) => String(s).replace(/[&<>"]/g, (c) => ENTITIES[c] ?? c);

/** Restart a CSS animation on `el` by toggling `cls` (reading layout in between forces a reflow). */
export function replay(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  el.getBoundingClientRect();
  el.classList.add(cls);
}

/** webOS remote key codes. */
export const KEY = { ENTER: 13, ESC: 27, LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, BACK: 461 } as const;

/**
 * The key code of a remote/keyboard event. The webOS remote's Back button has no standard `key` value, only
 * keyCode 461, so key codes are the one consistent way to read the remote.
 */
// eslint-disable-next-line @typescript-eslint/no-deprecated
export const keyCode = (e: KeyboardEvent): number => e.keyCode;
