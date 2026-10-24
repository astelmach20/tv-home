import { describe, expect, it } from 'vitest';
import { isNight, nightSettings, type NightConfig } from '../src/home/night.js';

const night: NightConfig = { start: 22, end: 7, backlight: 35, backlightByMode: { hdrPersonalized: 60 } };
const picture = (pictureMode: string, backlight = '80') => ({
  dimension: { input: 'hdmi1', pictureMode },
  settings: { backlight, eyeComfortMode: 'off' },
});

describe('isNight', () => {
  it('wraps past midnight', () => {
    expect([21, 22, 23, 0, 6, 7].map((h) => isNight(h, night))).toEqual([false, true, true, true, true, false]);
  });
  it('handles a same-day window', () => {
    expect([12, 13, 17].map((h) => isNight(h, { start: 13, end: 17 }))).toEqual([false, true, false]);
  });
});

describe('nightSettings', () => {
  it('saves the daytime values and dims at night', () => {
    const r = nightSettings(night, picture('filmMaker'), 23, {});
    expect(r.settings).toEqual({ backlight: '35', eyeComfortMode: 'on' });
    expect(r.saved).toEqual({ 'hdmi1|filmMaker': { backlight: '80', eyeComfortMode: 'off' } });
  });

  it('uses the per-mode floor for HDR game mode', () => {
    expect(nightSettings(night, picture('hdrPersonalized', '100'), 23, {}).settings?.backlight).toBe('60');
  });

  it("doesn't overwrite saved daytime values with already-dimmed ones", () => {
    const saved = { 'hdmi1|filmMaker': { backlight: '80', eyeComfortMode: 'off' } };
    expect(nightSettings(night, picture('filmMaker', '35'), 1, saved).saved).toEqual(saved);
  });

  it('restores and forgets the saved values in the morning', () => {
    const saved = {
      'hdmi1|filmMaker': { backlight: '80', eyeComfortMode: 'off' },
      'dtv|personalized': { backlight: '50' },
    };
    const r = nightSettings(night, picture('filmMaker', '35'), 8, saved);
    expect(r.settings).toEqual({ backlight: '80', eyeComfortMode: 'off' });
    expect(r.saved).toEqual({ 'dtv|personalized': { backlight: '50' } });
  });

  it('changes nothing in the day when nothing was saved', () => {
    expect(nightSettings(night, picture('filmMaker'), 12, {}).settings).toBeNull();
  });
});
