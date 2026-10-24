// Luna replies we read, as zod schemas: every reply is validated, so the types below hold at runtime.
// Only the fields we use are listed; unknown fields are dropped.
import { z } from 'zod';

export const RawAppSchema = z.object({
  id: z.string(),
  title: z.string(),
  visible: z.boolean().optional(),
  class: z.object({ hidden: z.boolean().optional() }).optional(),
  iconColor: z.string().optional(),
  folderPath: z.string(),
  icon: z.string().optional(),
  largeIcon: z.string().optional(),
});
export type RawApp = z.infer<typeof RawAppSchema>;
export const ListAppsReply = z.object({ apps: z.array(RawAppSchema).default([]) });

export const RawCecDeviceSchema = z.object({
  /** "SIMPLINK" for HDMI-CEC devices, "URCU" for IR remote profiles. */
  id: z.string(),
  osdName: z.string().optional(),
  physicalAddress: z.number().optional(),
  vendorId: z.number().optional(),
  cecpDevType: z.number().optional(),
  cecPower: z.string().optional(),
});
export type RawCecDevice = z.infer<typeof RawCecDeviceSchema>;

export const RawInputPortSchema = z.object({
  /** "HDMI_1" */
  id: z.string(),
  label: z.string(),
  port: z.number(),
  appId: z.string().optional(),
  connected: z.boolean(),
  hdmiSignalExist: z.boolean().optional(),
  subList: z.array(RawCecDeviceSchema).default([]),
});
export type RawInputPort = z.infer<typeof RawInputPortSchema>;

export const RawInputStatusSchema = z.object({ devices: z.array(RawInputPortSchema).default([]) });
export type RawInputStatus = z.infer<typeof RawInputStatusSchema>;

export const ForegroundReply = z.object({ appId: z.string().optional() });
export const VolumeReply = z.object({ volumeStatus: z.object({ volume: z.number() }).optional() });
// The reply must echo `timestamp` exactly as sent (a string); a number is rejected as missing.
export const ScreenSaverRequest = z.object({ timestamp: z.string().optional() });
export const OkReply = z.object({ returnValue: z.boolean().optional() });
/** "Active", "Active Standby", "Suspend", "Screen Off", … */
export const PowerStateReply = z.object({ state: z.string().optional() });

export const PictureStateSchema = z.object({
  dimension: z.object({ input: z.string(), pictureMode: z.string() }),
  settings: z.record(z.string(), z.string()),
});
export type PictureState = z.infer<typeof PictureStateSchema>;

/** Everything the services need from the TV. LunaTv talks to the real TV; MockTv backs local development. */
export interface Tv {
  listApps(): Promise<RawApp[]>;
  inputStatus(): Promise<RawInputStatus>;
  onInputStatus(cb: (s: RawInputStatus) => void): () => void;
  foregroundApp(): Promise<string | undefined>;
  onForegroundApp(cb: (appId: string | undefined) => void): () => void;
  launch(id: string): Promise<void>;
  getVolume(): Promise<number | undefined>;
  setVolume(volume: number): Promise<void>;
  getPicture(keys: string[]): Promise<PictureState>;
  setPicture(settings: Record<string, string>): Promise<void>;
  /** LG asks before starting its own screensaver; reply with `respondScreenSaver`. */
  onScreenSaverRequest(cb: (timestamp: string) => void): () => void;
  respondScreenSaver(allow: boolean, timestamp: string): Promise<void>;
  /** The TV's power state, now and on every change. */
  onPowerState(cb: (state: string) => void): () => void;
  /** The recent part of the TV's syslog and CEC log, which say why its power changed (see power-log.ts). */
  powerLogs(): Promise<{ messages: string; cec: string }>;
  /**
   * The CEC log from byte `from` to its end (from the start if the log rotated since), or its last part when `from`
   * is undefined. `end` is where the next read starts.
   */
  readCecLog(from?: number): Promise<{ text: string; end: number }>;
}
