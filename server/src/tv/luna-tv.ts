import fs from 'node:fs';
import zlib from 'node:zlib';
import type { Logger } from 'pino';
import { call, subscribe } from '../luna/luna.js';
import {
  ForegroundReply,
  ListAppsReply,
  OkReply,
  PictureStateSchema,
  PowerStateReply,
  RawInputStatusSchema,
  ScreenSaverRequest,
  VolumeReply,
  type RawInputStatus,
  type Tv,
} from './types.js';

const APP_MANAGER = 'luna://com.webos.applicationManager';
const EIM = 'luna://com.webos.service.eim';
const AUDIO = 'luna://com.webos.service.audio/master';
const SETTINGS = 'luna://com.webos.settingsservice';
const POWER = 'luna://com.webos.service.tvpower/power';
const CLIENT = 'tvhome';

export class LunaTv implements Tv {
  constructor(private readonly log: Logger) {}

  async listApps() {
    return (await call(`${APP_MANAGER}/listApps`, {}, ListAppsReply)).apps;
  }

  inputStatus() {
    return call(`${EIM}/getAllInputStatus`, {}, RawInputStatusSchema);
  }

  onInputStatus(cb: (s: RawInputStatus) => void) {
    const sub = subscribe(`${EIM}/getAllInputStatus`, {}, RawInputStatusSchema, cb, this.log);
    return () => {
      sub.close();
    };
  }

  async foregroundApp() {
    return (await call(`${APP_MANAGER}/getForegroundAppInfo`, {}, ForegroundReply)).appId || undefined;
  }

  onForegroundApp(cb: (appId: string | undefined) => void) {
    const sub = subscribe(
      `${APP_MANAGER}/getForegroundAppInfo`,
      {},
      ForegroundReply,
      (m) => {
        if (m.appId !== undefined) cb(m.appId || undefined);
      },
      this.log,
    );
    return () => {
      sub.close();
    };
  }

  async launch(id: string) {
    await call(`${APP_MANAGER}/launch`, { id }, OkReply);
  }

  async getVolume() {
    return (await call(`${AUDIO}/getVolume`, {}, VolumeReply)).volumeStatus?.volume;
  }

  async setVolume(volume: number) {
    await call(`${AUDIO}/setVolume`, { volume }, OkReply);
  }

  getPicture(keys: string[]) {
    return call(`${SETTINGS}/getSystemSettings`, { category: 'picture', keys }, PictureStateSchema);
  }

  async setPicture(settings: Record<string, string>) {
    await call(`${SETTINGS}/setSystemSettings`, { category: 'picture', settings }, OkReply);
  }

  onScreenSaverRequest(cb: (timestamp: string) => void) {
    const sub = subscribe(
      `${POWER}/registerScreenSaverRequest`,
      { clientName: CLIENT },
      ScreenSaverRequest,
      (m) => {
        if (m.timestamp != null) cb(m.timestamp);
      },
      this.log,
    );
    return () => {
      sub.close();
    };
  }

  async respondScreenSaver(allow: boolean, timestamp: string) {
    await call(`${POWER}/responseScreenSaverRequest`, { clientName: CLIENT, ack: allow, timestamp }, OkReply);
  }

  onPowerState(cb: (state: string) => void) {
    const sub = subscribe(
      `${POWER}/getPowerState`,
      {},
      PowerStateReply,
      (m) => {
        if (m.state) cb(m.state);
      },
      this.log,
    );
    return () => {
      sub.close();
    };
  }

  async powerLogs() {
    // syslog rotates every few KB, so the previous file is read too.
    const [previous, messages, cec] = await Promise.all([
      fs.promises.readFile(`${MESSAGES}.0.gz`).then((b) => zlib.gunzipSync(b).toString('utf8'), () => ''),
      fs.promises.readFile(MESSAGES, 'utf8').catch(() => ''),
      tail(CEC_MESSAGES, CEC_TAIL),
    ]);
    return { messages: previous + messages, cec };
  }

  async readCecLog(from?: number) {
    try {
      const handle = await fs.promises.open(CEC_MESSAGES);
      try {
        const { size } = await handle.stat();
        const start = from === undefined ? Math.max(0, size - CEC_TAIL) : from > size ? 0 : from;
        const length = Math.min(size - start, CEC_TAIL);
        const buf = Buffer.alloc(length);
        await handle.read(buf, 0, length, start);
        return { text: buf.toString('utf8'), end: start + length };
      } finally {
        await handle.close();
      }
    } catch {
      return { text: '', end: from ?? 0 };
    }
  }
}

const CEC_TAIL = 512 * 1024;

const MESSAGES = '/var/log/messages';
const CEC_MESSAGES = '/var/log/cecmessages';

/** The last `bytes` of a file, or '' if it can't be read. */
async function tail(file: string, bytes: number): Promise<string> {
  try {
    const handle = await fs.promises.open(file);
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, bytes);
      const buf = Buffer.alloc(length);
      await handle.read(buf, 0, length, size - length);
      return buf.toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return '';
  }
}
