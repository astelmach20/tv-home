import path from 'node:path';
import { z } from 'zod';
import type { Config } from '../config.js';
import { isWatchable, type Source } from './inputs.js';
import type { RawApp } from './types.js';

export const LauncherAppSchema = z.object({
  id: z.string().describe('App id, for launchApp'),
  title: z.string(),
  color: z.string().nullable().describe('Icon background color'),
});
export type LauncherApp = z.infer<typeof LauncherAppSchema>;

export interface LauncherInput {
  id: string;
  appId: string;
  port: string;
  label: string;
  on: boolean;
}

/** Apps for the launcher rail: visible ones, pinned first in config order, then alphabetical. */
export function launcherApps(
  apps: RawApp[],
  { pinned, hidden }: Pick<Config, 'pinned' | 'hidden'>,
  selfId: string,
): { apps: LauncherApp[]; icons: Map<string, string> } {
  const visible = apps.filter(
    (a) => a.visible !== false && !a.class?.hidden && !hidden.includes(a.id) && a.id !== selfId,
  );
  const icons = new Map(visible.map((a) => [a.id, path.join(a.folderPath, a.largeIcon ?? a.icon ?? 'icon.png')]));
  const rank = (id: string) => {
    const i = pinned.indexOf(id);
    return i === -1 ? Infinity : i;
  };
  const sorted = visible
    .map((a) => ({ id: a.id, title: a.title, color: a.iconColor ?? null }))
    .sort((x, y) => rank(x.id) - rank(y.id) || x.title.localeCompare(y.title));
  return { apps: sorted, icons };
}

/** Input tiles: one per watchable device. */
export const launcherInputs = (sources: Source[]): LauncherInput[] =>
  sources.filter(isWatchable).map((s) => ({
    id: s.physicalAddress != null ? `${s.portId}:${s.physicalAddress}` : s.portId,
    appId: s.appId,
    port: `HDMI ${s.port}`,
    label: s.name,
    on: s.on,
  }));
