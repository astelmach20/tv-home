// Composition root: builds every service from paths + environment, so modules never reach for globals.
import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';
import { ConfigFile } from './config.js';
import { TtlCache } from './lib/cache.js';
import { JsonStore } from './lib/json-store.js';
import { Commands } from './home/commands.js';
import { TvState } from './home/tv-state.js';
import {
  autoInput,
  homeButton,
  cecLog,
  nightMode,
  powerLog,
  screensaverGuard,
  volumePerSource,
  VolumeStateSchema,
} from './home/services.js';
import { NightStateSchema } from './home/night.js';
import { SonosWatcher } from './sonos/sonos.js';
import { LunaTv } from './tv/luna-tv.js';
import { MockTv } from './tv/mock-tv.js';
import type { Tv } from './tv/types.js';

export interface Paths {
  /** config.json */
  config: string;
  /** Static data shipped with the app (aerials.json). */
  data: string;
  /** Learned state written at runtime. */
  state: string;
  /** Rotated log files (`current.log` is the live one). */
  logs: string;
  /** Launcher UI. */
  public: string;
}

/** Screensaver themes; `favorite` clips come up twice as often. */
export const AerialTag = z.enum(['ocean', 'nature', 'space', 'favorite']);
export const AerialSchema = z.object({ label: z.string(), url: z.url(), tags: z.array(AerialTag).default([]) });
export type Aerial = z.infer<typeof AerialSchema>;
const AerialsSchema = z.array(AerialSchema);

export function defaultPaths(root: string, env = process.env): Paths {
  return {
    config: path.join(root, 'config.json'),
    data: path.join(root, 'data'),
    state: env.TVHOME_STATE ? path.resolve(env.TVHOME_STATE) : path.join(root, 'state'),
    logs: env.TVHOME_LOGS ? path.resolve(env.TVHOME_LOGS) : path.join(root, 'logs'),
    public: path.join(root, 'public'),
  };
}

export function createApp(paths: Paths, log: Logger, mockDir?: string) {
  const tv: Tv = mockDir ? new MockTv(mockDir) : new LunaTv(log);
  const config = new ConfigFile(paths.config);
  const cache = new TtlCache();
  const commands = new Commands();
  const state = new TvState(tv, log);
  const sonos = new SonosWatcher(log.child({ service: 'sonos' }));

  const aerials: Aerial[] = AerialsSchema.parse(
    JSON.parse(fs.readFileSync(path.join(paths.data, 'aerials.json'), 'utf8')),
  );

  const start = () => {
    autoInput(state, tv, log.child({ service: 'input' }));
    homeButton(state, tv, log.child({ service: 'home' }));
    const volumeStore = new JsonStore(path.join(paths.state, 'volume.json'), VolumeStateSchema, () => ({}));
    const nightStore = new JsonStore(path.join(paths.state, 'night.json'), NightStateSchema, () => ({}));
    volumePerSource(state, tv, volumeStore, log.child({ service: 'volume' }));
    nightMode(state, tv, config, nightStore, log.child({ service: 'night' }));
    screensaverGuard(state, tv, commands, log.child({ service: 'screensaver' }));
    powerLog(tv, log.child({ service: 'power' }));
    cecLog(tv, log.child({ service: 'cec' }));
    state.start();
    // In mock mode this would watch the real speakers on whatever network the dev machine is on.
    if (!mockDir) sonos.start({ eventPort: Number(process.env.TVHOME_EVENT_PORT ?? 8766) });
  };

  return {
    paths,
    tv,
    config,
    cache,
    commands,
    state,
    sonos,
    aerials,
    start,
  };
}

export type App = ReturnType<typeof createApp>;
