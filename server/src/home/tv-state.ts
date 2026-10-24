// Live view of what the TV is showing: HDMI sources, the foreground app, and which device on a shared port is the
// one being watched. Fed by Luna subscriptions, with a slow poll as a backstop in case a subscription goes quiet.
// Services listen for changes instead of each polling the TV themselves.
import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';
import { every } from '../lib/every.js';
import { initialAutoInput, onSources, type AutoInputState } from './auto-input.js';
import { isWatchable, parseInputs, type Source } from '../tv/inputs.js';
import type { RawInputStatus, Tv } from '../tv/types.js';

export const LAUNCHER_ID = 'org.tvhome.launcher';
const isHdmiApp = (appId: string) => /^com\.webos\.app\.hdmi\d$/.test(appId);

interface Events {
  /** A watchable source just turned on. */
  woke: [Source];
  /** The thing being watched changed (app, or device on an HDMI input). */
  watching: [string | undefined];
}

export class TvState extends EventEmitter<Events> {
  sources: Source[] = [];
  foreground: string | undefined;
  private autoInput: AutoInputState = initialAutoInput;
  /** HDMI app id -> key of the device on that port that woke most recently. */
  private readonly lastWoken = new Map<string, string>();
  private lastWatching: string | undefined;
  private stops: (() => void)[] = [];

  constructor(
    private readonly tv: Tv,
    private readonly log: Logger,
  ) {
    super();
  }

  start({ backstopMs = 3000 } = {}) {
    this.stops.push(
      this.tv.onInputStatus((s) => this.applyInputs(s, 'event')),
      this.tv.onForegroundApp((appId) => this.applyForeground(appId)),
      every(backstopMs, 'input poll', this.log, async () => {
        this.applyInputs(await this.tv.inputStatus(), 'poll');
        this.applyForeground(await this.tv.foregroundApp());
      }),
    );
  }

  stop() {
    this.stops.forEach((s) => s());
    this.stops = [];
  }

  /** What is being watched: the foreground app id, or `<hdmi app>|<device name>` on an HDMI input. */
  watching(): string | undefined {
    const appId = this.foreground;
    if (!appId || !isHdmiApp(appId)) return appId;
    const on = this.sources.filter((s) => s.appId === appId && s.on && isWatchable(s));
    const device = on.find((s) => s.key === this.lastWoken.get(appId)) ?? on[0];
    return device && device.physicalAddress != null ? `${appId}|${device.name}` : appId;
  }

  private applyInputs(status: RawInputStatus, via: 'event' | 'poll') {
    const before = new Map(this.sources.map((s) => [s.key, s.on]));
    this.sources = parseInputs(status);
    // Every device's power change goes in the log (soundbars too), so it reads as a timeline of the room.
    for (const s of this.sources) {
      const was = before.get(s.key);
      if (was !== undefined && was !== s.on) {
        this.log.info({ device: s.name, kind: s.kind, on: s.on, via }, s.on ? 'device on' : 'device off');
      }
    }
    const { state, woke } = onSources(this.autoInput, this.sources);
    this.autoInput = state;
    if (woke) {
      this.lastWoken.set(woke.appId, woke.key);
      this.log.info({ source: woke.name, input: woke.appId, via }, 'source turned on');
      this.emit('woke', woke);
    }
    this.checkWatching();
  }

  private applyForeground(appId: string | undefined) {
    if (appId === this.foreground) return;
    this.foreground = appId;
    this.checkWatching();
  }

  private checkWatching() {
    const now = this.watching();
    if (now === this.lastWatching) return;
    this.lastWatching = now;
    this.log.info({ watching: now }, 'now watching');
    this.emit('watching', now);
  }
}
