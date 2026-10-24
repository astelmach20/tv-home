import { describe, expect, it } from 'vitest';
import { initialAutoInput, onSources, type AutoInputState } from '../src/home/auto-input.js';
import { parseInputs } from '../src/tv/inputs.js';
import { withPower } from './helpers.js';

/** Feed a sequence of snapshots and collect what woke at each step. */
function run(steps: Record<string, 'On' | 'Off'>[]) {
  let state: AutoInputState = initialAutoInput;
  return steps.map((power) => {
    const r = onSources(state, parseInputs(withPower(power)));
    state = r.state;
    return r.woke?.name;
  });
}

const allOff = { 'Apple TV': 'Off', 'PlayStation 5': 'Off', 'Arc Ultra': 'Off' } as const;

describe('auto input switch', () => {
  it('does nothing on the first snapshot, even with a device already on', () => {
    expect(run([{ ...allOff, 'Apple TV': 'On' }])).toEqual([undefined]);
  });

  it('switches to the Apple TV, not the Sonos, when the Sonos wakes first', () => {
    expect(run([allOff, { ...allOff, 'Arc Ultra': 'On' }, { ...allOff, 'Arc Ultra': 'On', 'Apple TV': 'On' }])).toEqual(
      [undefined, undefined, 'Apple TV'],
    );
  });

  it('never switches for the Sonos alone (music from the Sonos app)', () => {
    expect(run([allOff, { ...allOff, 'Arc Ultra': 'On' }, allOff, { ...allOff, 'Arc Ultra': 'On' }])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('switches once per power-on, so a manual input change is never overridden', () => {
    const on = { ...allOff, 'Apple TV': 'On' } as const;
    expect(run([allOff, on, on, on])).toEqual([undefined, 'Apple TV', undefined, undefined]);
  });

  it('switches to the PS5 when it turns on while the Apple TV is already on', () => {
    const atv = { ...allOff, 'Apple TV': 'On' } as const;
    expect(run([atv, { ...atv, 'PlayStation 5': 'On' }])).toEqual([undefined, 'PlayStation 5']);
  });
});
