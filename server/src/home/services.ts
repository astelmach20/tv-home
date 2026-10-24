// Behaviours layered on TvState. Each one reacts to state changes and touches only its own settings.
import type { Logger } from 'pino';
import { z } from 'zod';
import type { ConfigFile } from '../config.js';
import { every } from '../lib/every.js';
import type { Store } from '../lib/json-store.js';
import type { Source } from '../tv/inputs.js';
import { cecEvents, cecWaker, powerChanges } from '../tv/power-log.js';
import type { Tv } from '../tv/types.js';
import { LAUNCHER_ID, type TvState } from './tv-state.js';
import { nightSettings, type NightState } from './night.js';
import type { Commands } from './commands.js';

/** Switch to a source's input when it turns on, unless it's already in front. */
export function autoInput(state: TvState, tv: Tv, log: Logger) {
  const switchTo = async (source: Source) => {
    if (state.foreground === source.appId) return;
    try {
      await tv.launch(source.appId);
      log.info({ input: source.appId, source: source.name }, 'switched input');
    } catch (err) {
      log.warn({ err, input: source.appId }, 'input switch failed');
    }
  };
  state.on('woke', (source) => void switchTo(source));
}

export const LG_HOME_ID = 'com.webos.app.home';

/** The remote's Home button opens LG's Home; send it on to the launcher, so Home always means tv-home. */
export function homeButton(state: TvState, tv: Tv, log: Logger) {
  state.on('watching', (watching) => {
    if (watching !== LG_HOME_ID) return;
    tv.launch(LAUNCHER_ID).then(
      () => log.info('LG Home replaced with the launcher'),
      (err: unknown) => log.warn({ err }, 'launcher open failed'),
    );
  });
}

export const VolumeStateSchema = z.record(z.string(), z.number().int().min(0).max(100));
export type VolumeState = z.output<typeof VolumeStateSchema>;

/**
 * Per-source volume: remember the level used for each app or HDMI device and restore it when you switch back, so
 * the PS5 doesn't play at the level set for Netflix. Learns from your own changes; nothing is preset.
 */
export function volumePerSource(state: TvState, tv: Tv, store: Store<VolumeState>, log: Logger, pollMs = 2000) {
  let current: string | undefined;
  let restoring: Promise<void> = Promise.resolve();
  let lastPolled: string | undefined;

  state.on('watching', (watching) => {
    current = watching;
    const saved = watching ? store.read()[watching] : undefined;
    if (saved == null) return;
    restoring = (async () => {
      const volume = await tv.getVolume();
      if (volume === saved) return;
      await tv.setVolume(saved);
      log.info({ watching, from: volume, to: saved }, 'restored volume');
    })().catch((err: unknown) => log.warn({ err }, 'volume restore failed'));
  });

  return every(pollMs, 'volume learn', log, async () => {
    await restoring;
    const watching = current;
    // Only learn once a source has been on screen for a full poll, so a switch never saves the old source's level.
    const settled = watching === lastPolled;
    lastPolled = watching;
    if (!watching || !settled) return;
    const volume = await tv.getVolume();
    if (volume == null || watching !== current) return;
    const saved = store.read();
    if (saved[watching] === volume) return;
    store.write({ ...saved, [watching]: volume });
  });
}

/** Dim the OLED and turn on eye comfort at night; put each picture mode back the way it was in the morning. */
export function nightMode(state: TvState, tv: Tv, config: ConfigFile, store: Store<NightState>, log: Logger) {
  let applied = '';
  const check = async () => {
    const night = config.get().night;
    if (!night) return;
    const picture = await tv.getPicture(['backlight', 'eyeComfortMode']);
    const plan = nightSettings(night, picture, new Date().getHours(), store.read());
    if (plan.key === applied) return;
    if (plan.settings) await tv.setPicture(plan.settings);
    store.write(plan.saved);
    applied = plan.key;
    log.info({ mode: plan.key, settings: plan.settings }, 'night mode');
  };
  // Picture settings are per input and picture mode, so re-check whenever what's on screen changes.
  state.on('watching', () => void check().catch((err: unknown) => log.warn({ err }, 'night mode failed')));
  return every(60_000, 'night mode', log, check);
}

/**
 * Log every TV power change with the reason the TV gives ("homekit", "hdmiCec", …) and, when an HDMI device woke it,
 * which one. The reasons only reach the TV's own logs, a moment after the change, so they're read after a delay; the
 * device that woke the TV repeats its claim several seconds after the wake, hence the longer wait then. The server is
 * frozen while the TV is suspended, so a wake arrives as one change from the state before the suspend.
 */
export function powerLog(tv: Tv, log: Logger, { delayMs = 3000, wakeDelayMs = 30_000 } = {}) {
  let current: string | undefined;
  const pending = new Set<NodeJS.Timeout>();

  const report = async (from: string, to: string, since: number) => {
    const { messages, cec } = await tv.powerLogs();
    const change = powerChanges(messages)
      .filter((c) => c.to === to && Date.parse(c.time) >= since - 60_000)
      .at(-1);
    const reason = change?.reason ?? 'unknown';
    const wokenBy = to === 'Active' && reason === 'hdmiCec' ? cecWaker(cec) : undefined;
    log.info({ from: change?.from ?? from, to, reason, ...(wokenBy ? { wokenBy } : {}) }, 'tv power');
  };

  const stop = tv.onPowerState((state) => {
    const from = current;
    current = state;
    if (from === undefined || from === state) return;
    const since = Date.now();
    const timer = setTimeout(
      () => {
        pending.delete(timer);
        report(from, state, since).catch((err: unknown) => log.warn({ err }, 'power reason lookup failed'));
      },
      state === 'Active' ? wakeDelayMs : delayMs,
    );
    pending.add(timer);
  });
  return () => {
    stop();
    pending.forEach(clearTimeout);
  };
}

/**
 * Log notable HDMI-CEC messages as the TV's CEC daemon writes them: a device turning the TV on or taking the screen,
 * standby. While the TV is suspended the server is frozen, so those messages are logged in a batch after the wake.
 */
export function cecLog(tv: Tv, log: Logger, pollMs = 2000) {
  const names = new Map<number, string>();
  let offset: number | undefined;
  return every(pollMs, 'cec log', log, async () => {
    const { text, end } = await tv.readCecLog(offset);
    // A line still being written is read again next time.
    const complete = text.slice(0, text.lastIndexOf('\n') + 1);
    const events = cecEvents(complete, names);
    // On the first read, only learn the device names; the messages in it are old.
    if (offset !== undefined) for (const e of events) log.info(e, 'cec');
    offset = end - Buffer.byteLength(text.slice(complete.length));
  });
}

/**
 * webOS 11's screensaver is a Flutter app that homebrew screensavers can't replace. While Home is in front, decline
 * LG's screensaver and start ours; anywhere else LG's runs as usual.
 */
export function screensaverGuard(state: TvState, tv: Tv, commands: Commands, log: Logger) {
  return tv.onScreenSaverRequest((timestamp) => {
    const onHome = state.foreground === LAUNCHER_ID;
    if (onHome) commands.push('saver');
    tv.respondScreenSaver(!onHome, timestamp).catch((err: unknown) => {
      log.warn({ err }, 'screensaver response failed');
    });
    log.info({ action: onHome ? 'replaced with aerials' : 'allowed' }, 'screensaver request');
  });
}
