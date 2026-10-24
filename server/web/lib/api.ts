// Typed client for the local server API. Response types come from the server (src/http/api.ts).
import type { Aerial, CmdResponse, LauncherApp, LauncherInput, Painting, Weather } from '../../src/http/api.js';

export type * from '../../src/http/api.js';

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${String(r.status)}`);
  return (await r.json()) as T;
}

async function post(path: string, body: object): Promise<void> {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path}: HTTP ${String(r.status)}`);
}

export const api = {
  apps: () => get<LauncherApp[]>('/api/apps'),
  inputs: () => get<LauncherInput[]>('/api/inputs'),
  launch: (id: string) => post('/api/launch', { id }),
  /** 404 when weather is off (no `home` in config.json). */
  weather: () => get<Weather>('/api/weather'),
  aerials: () => get<Aerial[]>('/api/aerials'),
  art: () => get<Painting[]>('/api/art'),
  cmd: () => get<CmdResponse>('/api/cmd'),
};
