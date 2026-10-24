import { describe, expect, it } from 'vitest';
import {
  BTN_INPUTS,
  BTN_SD,
  BTN_SETTINGS,
  move,
  neighbor,
  pageCount,
  PER_PAGE,
  turnPage,
} from '../web/home/wii/grid.js';

describe('wii grid', () => {
  it('keeps at least four pages', () => {
    expect(pageCount(0)).toBe(4);
    expect(pageCount(48)).toBe(4);
    expect(pageCount(49)).toBe(5);
  });

  it('walks off a page edge onto the same row of the next or previous page', () => {
    expect(neighbor(3, 1, 0, 4)).toBe(PER_PAGE); // row 0, last column -> page 1, first column
    expect(neighbor(7, 1, 0, 4)).toBe(PER_PAGE + 4);
    expect(neighbor(PER_PAGE + 4, -1, 0, 4)).toBe(7);
    expect(neighbor(0, -1, 0, 4)).toBe(-1);
    expect(neighbor(3 * PER_PAGE + 3, 1, 0, 4)).toBe(-1);
  });

  it('stops at the top row and falls through the bottom row onto the buttons', () => {
    expect(neighbor(2, 0, -1, 4)).toBe(-1);
    expect(move({ focus: 8, page: 0 }, 0, 1, 4).focus).toBe(BTN_SETTINGS);
    expect(move({ focus: 9, page: 0 }, 0, 1, 4).focus).toBe(BTN_SD);
    expect(move({ focus: 10, page: 0 }, 0, 1, 4).focus).toBe(BTN_INPUTS);
    expect(move({ focus: PER_PAGE + 11, page: 1 }, 0, 1, 4)).toEqual({ focus: BTN_INPUTS, page: 1 });
  });

  it('moves between the buttons and back up into the page on screen', () => {
    expect(move({ focus: BTN_SETTINGS, page: 0 }, 1, 0, 4).focus).toBe(BTN_SD);
    expect(move({ focus: BTN_SD, page: 0 }, 1, 0, 4).focus).toBe(BTN_INPUTS);
    expect(move({ focus: BTN_INPUTS, page: 0 }, 1, 0, 4).focus).toBe(BTN_INPUTS);
    expect(move({ focus: BTN_SETTINGS, page: 0 }, -1, 0, 4).focus).toBe(BTN_SETTINGS);
    expect(move({ focus: BTN_INPUTS, page: 2 }, 0, -1, 4)).toEqual({ focus: 2 * PER_PAGE + 11, page: 2 });
    expect(move({ focus: BTN_SD, page: 1 }, 0, -1, 4)).toEqual({ focus: PER_PAGE + 9, page: 1 });
  });

  it('turns whole pages, keeping the slot', () => {
    expect(turnPage({ focus: 5, page: 0 }, 1, 4)).toEqual({ focus: PER_PAGE + 5, page: 1 });
    expect(turnPage({ focus: 5, page: 0 }, -1, 4)).toEqual({ focus: 5, page: 0 });
    expect(turnPage({ focus: BTN_SD, page: 0 }, 1, 4)).toEqual({ focus: BTN_SD, page: 1 });
  });
});
