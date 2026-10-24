import fs from 'node:fs';
import path from 'node:path';
import { pino } from 'pino';
import { RawInputStatusSchema, type RawInputStatus } from '../src/tv/types.js';

export const silentLog = pino({ level: 'silent' });

/** Real `getAllInputStatus` reply from the TV: Apple TV on, PS5 off, Sonos Arc Ultra on eARC. */
export const realInputs = (): RawInputStatus =>
  RawInputStatusSchema.parse(
    JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/eim-appletv-on.json'), 'utf8')),
  );

/** The real reply with CEC power set per device name. */
export function withPower(power: Record<string, 'On' | 'Off'>): RawInputStatus {
  const status = realInputs();
  for (const d of status.devices)
    for (const s of d.subList) if (s.osdName && s.osdName in power) s.cecPower = power[s.osdName];
  return status;
}
