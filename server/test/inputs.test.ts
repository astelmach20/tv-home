import { describe, expect, it } from 'vitest';
import { isWatchable, parseInputs } from '../src/tv/inputs.js';
import { launcherInputs } from '../src/tv/apps.js';
import { realInputs } from './helpers.js';

describe('parseInputs', () => {
  const sources = parseInputs(realInputs());

  it('lists each CEC device once, classified by CEC device type', () => {
    expect(sources.map((s) => [s.name, s.kind, s.on])).toEqual([
      ['PlayStation 5', 'playback', false],
      ['Apple TV', 'playback', true],
      ['Arc Ultra', 'audio', true],
    ]);
  });

  it('ignores the IR remote profile and unplugged ports', () => {
    expect(sources.every((s) => s.appId === 'com.webos.app.hdmi1' || s.appId === 'com.webos.app.hdmi2')).toBe(true);
  });

  it('treats the soundbar as not watchable', () => {
    expect(sources.filter(isWatchable).map((s) => s.name)).toEqual(['PlayStation 5', 'Apple TV']);
  });

  it('falls back to the bare port when nothing on it speaks CEC', () => {
    const [s] = parseInputs({
      devices: [
        {
          id: 'HDMI_3',
          label: 'HDMI 3',
          port: 3,
          appId: 'com.webos.app.hdmi3',
          connected: true,
          hdmiSignalExist: true,
          subList: [],
        },
      ],
    });
    expect(s).toMatchObject({ key: 'com.webos.app.hdmi3', name: 'HDMI 3', kind: 'other', on: true });
  });
});

describe('launcherInputs', () => {
  it('gives the UI one tile per watchable device', () => {
    expect(launcherInputs(parseInputs(realInputs()))).toEqual([
      { id: 'HDMI_1:4352', appId: 'com.webos.app.hdmi1', port: 'HDMI 1', label: 'PlayStation 5', on: false },
      { id: 'HDMI_1:4864', appId: 'com.webos.app.hdmi1', port: 'HDMI 1', label: 'Apple TV', on: true },
    ]);
  });
});
