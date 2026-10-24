import { describe, expect, it } from 'vitest';
import { listDevices } from '../src/home/devices.js';
import { parseInputs } from '../src/tv/inputs.js';
import type { SonosStatus } from '../src/sonos/sonos.js';
import { realInputs } from './helpers.js';

const arc: SonosStatus = {
  uuid: 'RINCON_XXXXXXXXXXXX01400',
  room: 'Sonos Arc Ultra',
  model: 'Sonos Arc Ultra',
  url: 'http://192.0.2.10:1400',
  source: 'tv',
  state: 'PLAYING',
  uri: 'x-sonos-htastream:RINCON_XXXXXXXXXXXX01400:spdif',
  since: '2026-10-17T16:07:52.853Z',
};

describe('listDevices', () => {
  const devices = listDevices(parseInputs(realInputs()), [arc], 'com.webos.app.hdmi1|Apple TV');

  it('lists CEC devices and Sonos players with stable ids', () => {
    expect(devices.map((d) => [d.id, d.name, d.via])).toEqual([
      ['cec-4352', 'PlayStation 5', 'hdmi-cec'],
      ['cec-4864', 'Apple TV', 'hdmi-cec'],
      ['cec-8192', 'Arc Ultra', 'hdmi-cec'],
      ['sonos-RINCON_XXXXXXXXXXXX01400', 'Sonos Arc Ultra', 'sonos'],
    ]);
  });

  it('marks the device being watched', () => {
    expect(devices.filter((d) => d.via === 'hdmi-cec' && d.watching).map((d) => d.name)).toEqual(['Apple TV']);
  });

  it('marks no CEC device as watched when the input is on but none of its devices is', () => {
    const bare = listDevices(parseInputs(realInputs()), [], 'com.webos.app.hdmi1');
    expect(bare.filter((d) => d.via === 'hdmi-cec' && d.watching)).toEqual([]);
  });

  it('counts a playing speaker as on', () => {
    expect(devices.find((d) => d.via === 'sonos')).toMatchObject({ on: true, source: 'tv' });
  });
});
