// Every device the server can see, in one shape, whatever it's seen through. A soundbar can show up twice (as an
// HDMI-CEC device and as a Sonos player): `via` says which view each entry is.
import { z } from 'zod';
import { SONOS_SOURCES, type SonosStatus } from '../sonos/sonos.js';
import type { Source } from '../tv/inputs.js';

const base = {
  id: z.string().describe('Stable id: cec-<physical address>, hdmi-<port>, or sonos-<RINCON id>'),
  name: z.string(),
  on: z.boolean().nullable().describe("null when the device can't say"),
};

const CecDeviceSchema = z.object({
  ...base,
  via: z.literal('hdmi-cec'),
  kind: z.enum(['playback', 'audio', 'other']),
  input: z.string().describe('Input app that shows this device (com.webos.app.hdmi1)'),
  port: z.number().describe('HDMI port'),
  watching: z.boolean().describe('On screen now'),
});

const SonosDeviceSchema = z.object({
  ...base,
  via: z.literal('sonos'),
  kind: z.literal('speaker'),
  model: z.string().optional(),
  source: z.enum(SONOS_SOURCES).describe('Where its audio comes from'),
  state: z.string().describe('PLAYING, PAUSED_PLAYBACK, STOPPED or TRANSITIONING'),
  uri: z.string().describe('Current transport URI'),
  since: z.string().describe('When the source or state last changed (ISO)'),
  url: z.string().describe('Local control URL'),
});

export const DeviceSchema = z.discriminatedUnion('via', [CecDeviceSchema, SonosDeviceSchema]);
export type Device = z.infer<typeof DeviceSchema>;
type CecDevice = z.infer<typeof CecDeviceSchema>;
type SonosDevice = z.infer<typeof SonosDeviceSchema>;

export function listDevices(sources: Source[], sonos: SonosStatus[], watching: string | undefined): Device[] {
  const cec = sources.map((s): CecDevice => ({
    id: s.physicalAddress != null ? `cec-${s.physicalAddress}` : `hdmi-${s.port}`,
    name: s.name,
    on: s.on,
    via: 'hdmi-cec',
    kind: s.kind,
    input: s.appId,
    port: s.port,
    // A bare input id means no device on that port is known to be on, so only a port without CEC devices matches it.
    watching: watching === `${s.appId}|${s.name}` || (watching === s.appId && s.physicalAddress == null),
  }));
  const speakers = sonos.map((p): SonosDevice => ({
    id: `sonos-${p.uuid}`,
    name: p.room,
    on: p.state === 'PLAYING' || p.state === 'TRANSITIONING',
    via: 'sonos',
    kind: 'speaker',
    ...(p.model ? { model: p.model } : {}),
    source: p.source,
    state: p.state,
    uri: p.uri,
    since: p.since,
    url: p.url,
  }));
  return [...cec, ...speakers];
}
