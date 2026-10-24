import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LAUNCHER_ID, TvState } from '../src/home/tv-state.js';
import { autoInput, homeButton, LG_HOME_ID, volumePerSource, type VolumeState } from '../src/home/services.js';
import type { Store } from '../src/lib/json-store.js';
import { FakeTv } from './fake-tv.js';
import { silentLog, withPower } from './helpers.js';

const HDMI1 = 'com.webos.app.hdmi1';
const allOff = { 'Apple TV': 'Off', 'PlayStation 5': 'Off', 'Arc Ultra': 'Off' } as const;

class MemoryStore implements Store<VolumeState> {
  constructor(public data: VolumeState = {}) {}
  read() {
    return { ...this.data };
  }
  write(d: VolumeState) {
    this.data = d;
  }
}

describe('TvState + services', () => {
  let tv: FakeTv;
  let state: TvState;

  beforeEach(() => {
    vi.useFakeTimers();
    tv = new FakeTv();
    tv.inputs = withPower(allOff);
    state = new TvState(tv, silentLog);
  });
  afterEach(() => {
    state.stop();
    vi.useRealTimers();
  });

  it('switches to HDMI 1 when the Apple TV turns on, and reports it as what is being watched', async () => {
    autoInput(state, tv, silentLog);
    state.start();
    await vi.advanceTimersByTimeAsync(0);
    tv.setInputs(withPower({ ...allOff, 'Arc Ultra': 'On' }));
    tv.setInputs(withPower({ ...allOff, 'Arc Ultra': 'On', 'Apple TV': 'On' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(tv.launched).toEqual([HDMI1]);
    expect(state.watching()).toBe(`${HDMI1}|Apple TV`);
  });

  it('opens the launcher whenever LG Home comes up, and leaves other apps alone', async () => {
    homeButton(state, tv, silentLog);
    state.start();
    await vi.advanceTimersByTimeAsync(0);
    tv.setForeground('netflix');
    tv.setForeground(LG_HOME_ID);
    await vi.advanceTimersByTimeAsync(0);
    expect(tv.launched).toEqual([LAUNCHER_ID]);
  });

  it('restores each source’s volume and learns changes without mixing sources up', async () => {
    const store = new MemoryStore({ [`${HDMI1}|PlayStation 5`]: 50, netflix: 20 });
    volumePerSource(state, tv, store, silentLog, 2000);
    state.start();
    await vi.advanceTimersByTimeAsync(0);

    tv.setForeground('netflix');
    await vi.advanceTimersByTimeAsync(0);
    expect(tv.volume).toBe(20);

    tv.volume = 24; // you turn Netflix up
    await vi.advanceTimersByTimeAsync(4000);
    expect(store.data.netflix).toBe(24);

    tv.setInputs(withPower({ ...allOff, 'PlayStation 5': 'On' }));
    tv.setForeground(HDMI1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(tv.volume).toBe(50);
    expect(store.data).toEqual({ [`${HDMI1}|PlayStation 5`]: 50, netflix: 24 });
  });
});
