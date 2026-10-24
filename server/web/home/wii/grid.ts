// Slot arithmetic of the Wii Menu theme, ported from wii-tv's WiiGrid.java and WiiMenuView.move (MIT, MauroProto):
// twelve slots to a page in four columns and three rows, and the three buttons under the grid.

export const COLS = 4;
export const ROWS = 3;
export const PER_PAGE = COLS * ROWS;
export const MIN_PAGES = 4;

/** Focus values below 0 are the buttons along the bottom, left to right. */
export const BTN_SETTINGS = -1;
export const BTN_SD = -2;
export const BTN_INPUTS = -3;
export type Button = typeof BTN_SETTINGS | typeof BTN_SD | typeof BTN_INPUTS;
export const isButton = (f: number): f is Button => f === BTN_SETTINGS || f === BTN_SD || f === BTN_INPUTS;

export const pageCount = (channels: number) => Math.max(MIN_PAGES, Math.ceil(channels / PER_PAGE));

/**
 * The slot an arrow leads to from this one, or -1 past the grid's edge. Right from the last column goes on to the
 * same row of the next page, left from the first column back to the previous page's last column.
 */
export function neighbor(slot: number, dx: number, dy: number, pages: number): number {
  const pg = Math.floor(slot / PER_PAGE);
  const i = slot % PER_PAGE;
  const row = Math.floor(i / COLS);
  const col = i % COLS;
  if (dx < 0) {
    if (col > 0) return slot - 1;
    return pg > 0 ? (pg - 1) * PER_PAGE + row * COLS + COLS - 1 : -1;
  }
  if (dx > 0) {
    if (col < COLS - 1) return slot + 1;
    return pg < pages - 1 ? (pg + 1) * PER_PAGE + row * COLS : -1;
  }
  if (dy < 0) return row > 0 ? slot - COLS : -1;
  if (dy > 0) return row < ROWS - 1 ? slot + COLS : -1;
  return -1;
}

export interface Nav {
  focus: number;
  page: number;
}

/** Where an arrow key takes the focus. Down off the bottom row lands on the button under that column. */
export function move({ focus, page }: Nav, dx: number, dy: number, pages: number): Nav {
  if (focus >= 0) {
    const next = neighbor(focus, dx, dy, pages);
    if (next >= 0) return { focus: next, page: Math.floor(next / PER_PAGE) };
    if (dy > 0) {
      const col = focus % COLS;
      return { focus: col === 0 ? BTN_SETTINGS : col === 1 ? BTN_SD : BTN_INPUTS, page };
    }
    return { focus, page };
  }
  if (dy < 0) {
    const col = focus === BTN_SETTINGS ? 0 : focus === BTN_SD ? 1 : 3;
    return { focus: page * PER_PAGE + (ROWS - 1) * COLS + col, page };
  }
  const order: Button[] = [BTN_SETTINGS, BTN_SD, BTN_INPUTS];
  const at = order.indexOf(focus as Button);
  const next = order[at + Math.sign(dx)];
  return { focus: next ?? focus, page };
}

/** A whole page at a time; the focus keeps its place in the grid (or stays on its button). */
export function turnPage({ focus, page }: Nav, dir: number, pages: number): Nav {
  const to = page + dir;
  if (to < 0 || to >= pages) return { focus, page };
  return { focus: focus >= 0 ? to * PER_PAGE + (focus % PER_PAGE) : focus, page: to };
}
