import type { PictureState, RawApp, RawInputStatus, Tv } from '../src/tv/types.js';

/** In-memory TV: tests push events and inspect what the services did. */
export class FakeTv implements Tv {
  volume = 30;
  foreground: string | undefined = 'org.tvhome.launcher';
  inputs: RawInputStatus = { devices: [] };
  picture: PictureState = {
    dimension: { input: 'default', pictureMode: 'filmMaker' },
    settings: { backlight: '80', eyeComfortMode: 'off' },
  };
  readonly launched: string[] = [];
  readonly volumeSets: number[] = [];
  private inputListeners: ((s: RawInputStatus) => void)[] = [];
  private foregroundListeners: ((appId: string | undefined) => void)[] = [];
  private powerListeners: ((state: string) => void)[] = [];
  logs = { messages: '', cec: '' };

  setInputs(s: RawInputStatus) {
    this.inputs = s;
    this.inputListeners.forEach((l) => {
      l(s);
    });
  }

  setForeground(appId: string | undefined) {
    this.foreground = appId;
    this.foregroundListeners.forEach((l) => {
      l(appId);
    });
  }

  async listApps(): Promise<RawApp[]> {
    return [];
  }
  async inputStatus() {
    return this.inputs;
  }
  onInputStatus(cb: (s: RawInputStatus) => void) {
    this.inputListeners.push(cb);
    return () => {};
  }
  async foregroundApp() {
    return this.foreground;
  }
  onForegroundApp(cb: (appId: string | undefined) => void) {
    this.foregroundListeners.push(cb);
    return () => {};
  }
  async launch(id: string) {
    this.launched.push(id);
    this.setForeground(id);
  }
  async getVolume() {
    return this.volume;
  }
  async setVolume(v: number) {
    this.volume = v;
    this.volumeSets.push(v);
  }
  async getPicture() {
    return this.picture;
  }
  async setPicture(settings: Record<string, string>) {
    this.picture = { ...this.picture, settings: { ...this.picture.settings, ...settings } };
  }
  onScreenSaverRequest() {
    return () => {};
  }
  async respondScreenSaver() {}

  setPower(state: string) {
    this.powerListeners.forEach((l) => {
      l(state);
    });
  }
  onPowerState(cb: (state: string) => void) {
    this.powerListeners.push(cb);
    return () => {};
  }
  async powerLogs() {
    return this.logs;
  }
  /** The CEC log as it grows; tests append to it. */
  cecLog = '';
  async readCecLog(from?: number) {
    const start = from === undefined ? 0 : from > this.cecLog.length ? 0 : from;
    return { text: this.cecLog.slice(start), end: this.cecLog.length };
  }
}
