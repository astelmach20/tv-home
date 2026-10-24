import { z } from 'zod';
import type { Config } from '../config.js';
import type { PictureState } from '../tv/types.js';

export type NightConfig = NonNullable<Config['night']>;
/** Daytime picture settings saved per `<input>|<picture mode>` while night settings are applied. */
export const NightStateSchema = z.record(
  z.string(),
  z.record(z.string(), z.union([z.string(), z.number()]).transform(String)),
);
export type NightState = z.output<typeof NightStateSchema>;

export function isNight(hour: number, { start, end }: Pick<NightConfig, 'start' | 'end'>): boolean {
  return start > end ? hour >= start || hour < end : hour >= start && hour < end;
}

/**
 * What to apply for the current picture mode. At night: save the daytime values (once) and dim. In the day: put the
 * saved values back. `key` identifies the decision so it's applied once per mode and time of day.
 */
export function nightSettings(night: NightConfig, picture: PictureState, hour: number, saved: NightState) {
  const mode = `${picture.dimension.input}|${picture.dimension.pictureMode}`;
  const dark = isNight(hour, night);
  const key = `${mode}|${dark ? 'night' : 'day'}`;
  if (dark) {
    const level = night.backlightByMode[picture.dimension.pictureMode] ?? night.backlight;
    return {
      key,
      settings: { backlight: String(level), eyeComfortMode: 'on' },
      saved: { ...saved, [mode]: saved[mode] ?? picture.settings },
    };
  }
  const rest = Object.fromEntries(Object.entries(saved).filter(([m]) => m !== mode));
  return { key, settings: saved[mode] ?? null, saved: rest };
}
