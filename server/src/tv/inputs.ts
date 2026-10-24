// HDMI inputs as a flat list of sources. Several devices can share a port (Apple TV + PS5 behind a Hue Sync Box),
// so a source is one HDMI-CEC device, or the bare port when nothing on it speaks CEC.
import type { RawInputStatus } from './types.js';

// HDMI-CEC device types (CEC 1.4 "Device Type" operand), as reported in eim's `cecpDevType`.
export const CEC_TYPE = { tv: 0, recorder: 1, tuner: 3, playback: 4, audioSystem: 5 } as const;

export type SourceKind = 'playback' | 'audio' | 'other';

export interface Source {
  /** Stable within a session: `<appId>|<physicalAddress>` for CEC devices, `<appId>` for a bare port. */
  key: string;
  appId: string;
  portId: string;
  port: number;
  name: string;
  kind: SourceKind;
  on: boolean;
  physicalAddress?: number;
}

const kindOf = (devType: number | undefined): SourceKind =>
  devType === CEC_TYPE.audioSystem
    ? 'audio'
    : devType === CEC_TYPE.playback || devType === CEC_TYPE.recorder || devType === CEC_TYPE.tuner
      ? 'playback'
      : 'other';

export function parseInputs(status: RawInputStatus): Source[] {
  const out: Source[] = [];
  for (const d of status.devices) {
    if (!d.connected || !d.appId) continue;
    const cec = d.subList.flatMap((s) => (s.id === 'SIMPLINK' && s.osdName ? [{ ...s, osdName: s.osdName }] : []));
    const base = { appId: d.appId, portId: d.id, port: d.port };
    if (!cec.length) {
      out.push({ ...base, key: d.appId, name: d.label, kind: 'other', on: !!d.hdmiSignalExist });
      continue;
    }
    for (const s of cec) {
      out.push({
        ...base,
        key: `${d.appId}|${String(s.physicalAddress)}`,
        name: s.osdName,
        kind: kindOf(s.cecpDevType),
        on: s.cecPower === 'On',
        physicalAddress: s.physicalAddress,
      });
    }
  }
  return out;
}

/** Something you can watch. Soundbars (CEC audio systems) only carry sound, so they never take the screen. */
export const isWatchable = (s: Source) => s.kind !== 'audio';
