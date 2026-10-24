// Sonos players on the LAN, found by discovery. Read-only for now: what each one is playing and from where.
import type { Logger } from 'pino';
import { every } from '../lib/every.js';
import { deviceField, discover, EventServer, lastChange, soap, type Subscription, ZONE_PLAYER } from './upnp.js';

const AV = {
  path: '/MediaRenderer/AVTransport/Control',
  events: '/MediaRenderer/AVTransport/Event',
  service: 'urn:schemas-upnp-org:service:AVTransport:1',
};

export const SONOS_SOURCES = ['tv', 'spotify', 'airplay', 'line-in', 'grouped', 'app', 'none'] as const;
export type SonosSource = (typeof SONOS_SOURCES)[number];

/** Where a player's audio comes from, judged by its current transport URI. */
export function classifySource(uri: string): SonosSource {
  if (!uri) return 'none';
  if (uri.startsWith('x-sonos-htastream:')) return 'tv';
  if (uri.startsWith('x-rincon:')) return 'grouped';
  if (uri.startsWith('x-rincon-stream:')) return 'line-in';
  if (uri.startsWith('x-sonos-vli:')) {
    if (uri.includes(',spotify:')) return 'spotify';
    if (uri.includes(',airplay:')) return 'airplay';
  }
  return 'app';
}

export interface SonosNow {
  source: SonosSource;
  /** PLAYING, PAUSED_PLAYBACK, STOPPED, TRANSITIONING */
  state: string;
  uri: string;
}

export interface SonosStatus extends SonosNow {
  uuid: string;
  room: string;
  model: string | undefined;
  url: string;
  /** When the source or state last changed. */
  since: string;
}

export class SonosPlayer {
  constructor(
    readonly url: string,
    /** RINCON_… id, stable across IP changes. */
    readonly uuid: string,
    readonly room: string,
    readonly model: string | undefined,
  ) {}

  static async at(url: string): Promise<SonosPlayer> {
    const res = await fetch(`${url}/xml/device_description.xml`, { signal: AbortSignal.timeout(4000) });
    const text = await res.text();
    const host = new URL(url).hostname;
    const uuid = deviceField(text, 'UDN')?.replace(/^uuid:/, '') ?? host;
    return new SonosPlayer(url, uuid, deviceField(text, 'roomName') ?? host, deviceField(text, 'modelName'));
  }

  async now(): Promise<SonosNow> {
    const [media, transport] = await Promise.all([
      soap(this.url, AV.path, AV.service, 'GetMediaInfo', { InstanceID: 0 }),
      soap(this.url, AV.path, AV.service, 'GetTransportInfo', { InstanceID: 0 }),
    ]);
    const uri = media.CurrentURI ?? '';
    return { source: classifySource(uri), state: transport.CurrentTransportState ?? 'UNKNOWN', uri };
  }
}

interface Watched {
  player: SonosPlayer;
  sub: Subscription;
  renewAt: number;
}

export interface SonosWatchOptions {
  /** Port the TV listens on for the players' event callbacks (on every interface, so the players can reach it). */
  eventPort: number;
  /** How often to check renewals and rediscovery. */
  tickMs?: number;
  rediscoverMs?: number;
  /** Subscription length asked for; it's renewed at half that, which doubles as the players' heartbeat. */
  subscribeS?: number;
}

/**
 * Keep each Sonos player's source and state current from its AVTransport events (UPnP GENA subscriptions, pushed by
 * the player) and log every change, so it lines up with the TV's own events in the log (e.g. "TV on" followed by the
 * Arc switching from Spotify to TV audio). A player that fails a renewal is dropped and players are rediscovered.
 * Only source/state changes are logged, not every track.
 */
export class SonosWatcher {
  private watched: Watched[] = [];
  private lastDiscovery = 0;
  private readonly latest = new Map<string, SonosStatus>();

  constructor(private readonly log: Logger) {}

  /** What each known player is playing from, and since when. */
  status() {
    return [...this.latest.values()];
  }

  start({ eventPort, tickMs = 15_000, rediscoverMs = 60_000, subscribeS = 120 }: SonosWatchOptions): () => void {
    const events = new EventServer(eventPort);
    const listening = events.listen();
    const stop = every(tickMs, 'sonos', this.log, async () => {
      await listening;
      if (!this.watched.length && Date.now() - this.lastDiscovery > rediscoverMs)
        await this.discover(events, subscribeS);
      for (const w of this.watched) {
        if (Date.now() < w.renewAt) continue;
        try {
          await w.sub.renew();
          w.renewAt = renewAt(w.sub);
        } catch (err) {
          this.log.warn({ room: w.player.room, err }, 'sonos player not answering');
          await this.drop();
          return;
        }
      }
    });
    return () => {
      stop();
      void this.drop().then(() => events.close());
    };
  }

  private async discover(events: EventServer, subscribeS: number) {
    this.lastDiscovery = Date.now();
    const urls = await discover(ZONE_PLAYER);
    const players = (await Promise.allSettled(urls.map((u) => SonosPlayer.at(u))))
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);
    for (const player of players) {
      const heard = { event: false };
      try {
        const sub = await events.subscribe(
          player.url + AV.events,
          (body) => {
            heard.event = true;
            this.apply(player, lastChange(body));
          },
          subscribeS,
        );
        this.watched.push({ player, sub, renewAt: renewAt(sub) });
        // The subscription's first event carries the full state; ask directly in case it didn't make it.
        if (!heard.event) this.update(player, await player.now());
      } catch (err) {
        this.log.warn({ room: player.room, err }, 'sonos subscribe failed');
      }
    }
    const found = this.watched.map((w) => ({ room: w.player.room, url: w.player.url }));
    this.log.info({ players: found }, 'sonos players found');
  }

  private async drop() {
    const watched = this.watched;
    this.watched = [];
    await Promise.all(watched.map((w) => w.sub.cancel()));
  }

  /** Apply an event's changed variables on top of what's known. */
  private apply(player: SonosPlayer, vars: Record<string, string>) {
    const prev = this.latest.get(player.url);
    const state = vars.TransportState ?? prev?.state;
    const uri = vars.AVTransportURI ?? prev?.uri;
    if (state === undefined || uri === undefined) return;
    this.update(player, { source: classifySource(uri), state, uri });
  }

  private update(player: SonosPlayer, now: SonosNow) {
    const prev = this.latest.get(player.url);
    if (prev?.source === now.source && prev.state === now.state) return;
    this.latest.set(player.url, {
      ...now,
      uuid: player.uuid,
      room: player.room,
      model: player.model,
      url: player.url,
      since: new Date().toISOString(),
    });
    this.log.info({ room: player.room, source: now.source, state: now.state, uri: now.uri }, 'sonos changed');
  }
}

const renewAt = (sub: Subscription) => Date.now() + (sub.timeoutS * 1000) / 2;
