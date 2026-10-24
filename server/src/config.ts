// config.json: user-editable settings, validated on read. Re-read when the file changes, so edits apply without a
// restart. Anything left out falls back to the defaults below.
import fs from 'node:fs';
import { z } from 'zod';

const hour = z.number().int().min(0).max(23);

export const ConfigSchema = z.object({
  /** App ids in launcher order; unlisted apps follow alphabetically. */
  pinned: z.array(z.string()).default([]),
  hidden: z.array(z.string()).default([]),
  /**
   * Where the weather is for. Weather is off unless this is set. Coordinates are rounded to one decimal (~10 km)
   * before they leave the TV; `timezone` is an IANA name, or `auto` to let Open-Meteo pick it from the coordinates.
   */
  home: z
    .object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      timezone: z.string().default('auto'),
    })
    .optional(),
  night: z
    .object({
      start: hour,
      end: hour,
      backlight: z.number().int().min(0).max(100),
      /** Brighter floor for picture modes that are already dim (HDR game mode). */
      backlightByMode: z.record(z.string(), z.number().int().min(0).max(100)).default({}),
    })
    .optional(),
  artQueries: z
    .array(z.string())
    .default(['landscape', 'sea', 'night', 'city', 'garden', 'mountains', 'river', 'snow']),
});

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigFile {
  private cached?: { mtimeMs: number; config: Config };

  constructor(private readonly file: string) {}

  get(): Config {
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(this.file).mtimeMs;
    } catch {
      return ConfigSchema.parse({});
    }
    if (this.cached?.mtimeMs !== mtimeMs) {
      const raw: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.cached = { mtimeMs, config: ConfigSchema.parse(raw) };
    }
    return this.cached.config;
  }
}
