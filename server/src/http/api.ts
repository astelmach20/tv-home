// Response shapes of the HTTP API. The zod schemas validate what the server sends and become the OpenAPI response
// schemas (which the MCP server turns into tool output schemas); the browser code in web/ imports only the types.
import { z } from 'zod';
import { AerialSchema, type Aerial } from '../app.js';
import { PaintingSchema, type Painting } from '../data/art.js';
import { WeatherSchema, type Weather } from '../data/weather.js';
import { DeviceSchema, type Device } from '../home/devices.js';
import { LogLine } from '../lib/logging.js';
import { LauncherAppSchema, type LauncherApp, type LauncherInput } from '../tv/apps.js';

export type { Aerial, Device, LauncherApp, LauncherInput, Painting, Weather };

export interface CmdResponse {
  cmd: string | null;
}

const StatusSchema = z.object({
  foreground: z.string().nullable().describe('App id in front (com.webos.app.hdmi1 for HDMI 1)'),
  watching: z
    .string()
    .nullable()
    .describe('What is being watched: the app id, or "<input app>|<device name>" on an HDMI input'),
});

const OkSchema = z.object({ ok: z.boolean() });
const ErrorSchema = z.object({ error: z.string() });

/** Fastify `schema.response` maps, by route. */
export const responses = {
  apps: { 200: z.array(LauncherAppSchema) },
  status: { 200: StatusSchema },
  devices: { 200: z.array(DeviceSchema) },
  device: { 200: DeviceSchema, 404: ErrorSchema },
  ok: { 200: OkSchema },
  weather: { 200: WeatherSchema, 404: ErrorSchema },
  aerials: { 200: z.array(AerialSchema) },
  art: { 200: z.array(PaintingSchema) },
  logs: { 200: z.array(LogLine) },
  clientError: { 200: z.record(z.string(), z.unknown()).nullable() },
} as const;
