// Auto input switch. The Hue Sync Box doesn't pass the Apple TV's CEC "active source" message through, so the TV
// never switches by itself. We switch on the rising edge: a watchable source going from off to on.
//
// Edge-triggered on purpose: once a device is on, we never switch to it again, so picking another input yourself
// is never overridden. The first snapshot is only a baseline, so restarting with a device already on does nothing.
import { isWatchable, type Source } from '../tv/inputs.js';

export interface AutoInputState {
  /** Power state per source key from the previous snapshot; null until the first snapshot. */
  seen: ReadonlyMap<string, boolean> | null;
}

export const initialAutoInput: AutoInputState = { seen: null };

const PRIORITY: Record<Source['kind'], number> = { playback: 0, other: 1, audio: 2 };

export function onSources(state: AutoInputState, sources: Source[]): { state: AutoInputState; woke?: Source } {
  const watchable = sources.filter(isWatchable);
  const seen = new Map(watchable.map((s) => [s.key, s.on]));
  if (!state.seen) return { state: { seen } };
  const prev = state.seen;
  const woke = watchable
    .filter((s) => s.on && prev.get(s.key) === false)
    .sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind])[0];
  return { state: { seen }, woke };
}
