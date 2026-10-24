// Local preview without a TV: apps and inputs come from a fixture directory, writes are no-ops.
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { RawInputStatusSchema, type PictureState, type RawApp, type Tv } from './types.js';

const FixtureSchema = z.object({
  apps: z.array(z.object({ id: z.string(), title: z.string(), color: z.string().optional() })),
  inputStatus: RawInputStatusSchema,
});
type Fixture = z.infer<typeof FixtureSchema>;

export class MockTv implements Tv {
  private readonly fx: Fixture;
  private volume = 20;

  constructor(private readonly dir: string) {
    this.fx = FixtureSchema.parse(JSON.parse(fs.readFileSync(path.join(dir, 'fixture.json'), 'utf8')));
  }

  async listApps(): Promise<RawApp[]> {
    const icons = path.join(this.dir, 'icons');
    return this.fx.apps.map((a) => ({
      id: a.id,
      title: a.title,
      iconColor: a.color,
      folderPath: icons,
      icon: `${a.id}.png`,
    }));
  }
  async inputStatus() {
    return this.fx.inputStatus;
  }
  onInputStatus() {
    return () => {};
  }
  async foregroundApp() {
    return 'org.tvhome.launcher';
  }
  onForegroundApp() {
    return () => {};
  }
  async launch() {}
  async getVolume() {
    return this.volume;
  }
  async setVolume(v: number) {
    this.volume = v;
  }
  async getPicture(): Promise<PictureState> {
    return {
      dimension: { input: 'default', pictureMode: 'filmMaker' },
      settings: { backlight: '80', eyeComfortMode: 'off' },
    };
  }
  async setPicture() {}
  onScreenSaverRequest() {
    return () => {};
  }
  async respondScreenSaver() {}
  onPowerState() {
    return () => {};
  }
  async powerLogs() {
    return { messages: '', cec: '' };
  }
  async readCecLog() {
    return { text: '', end: 0 };
  }
}
