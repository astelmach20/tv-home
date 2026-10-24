// HTTP API and static host for the launcher UI. Bound to localhost on the TV.
import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import fastifySwagger from '@fastify/swagger';
import Fastify, { LogController } from 'fastify';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { App } from '../app.js';
import { responses } from './api.js';
import { launcherApps, launcherInputs } from '../tv/apps.js';
import { parseInputs } from '../tv/inputs.js';
import { LAUNCHER_ID } from '../home/tv-state.js';
import { weather } from '../data/weather.js';
import { paintings } from '../data/art.js';
import { readLog } from '../lib/logging.js';
import { listDevices } from '../home/devices.js';

const AppId = z.string().regex(/^[\w.-]+$/);

/** Route metadata for the OpenAPI spec at /openapi.json, which the MCP server turns into tools. */
const doc = <R>(operationId: string, summary: string, response: R) => ({ operationId, summary, response });

export async function buildServer(app: App, log: Logger) {
  // The UI polls every couple of seconds, so per-request logs would drown everything else.
  const server = Fastify({
    loggerInstance: log,
    logController: new LogController({ disableRequestLogging: true }),
  }).withTypeProvider<ZodTypeProvider>();
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);
  // Bodies are always JSON, whatever the content type says: fetch without headers sends text/plain, `curl -d` over SSH
  // sends form-urlencoded. Replace Fastify's text/plain parser and catch everything else that isn't application/json.
  server.removeContentTypeParser('text/plain');
  server.addContentTypeParser(['text/plain', '*'], { parseAs: 'string' }, (_req, body, done) => {
    try {
      const text = typeof body === 'string' ? body : body.toString('utf8');
      const json: unknown = text ? JSON.parse(text) : {};
      done(null, json);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      done(Object.assign(new Error(`invalid JSON body: ${message}`), { statusCode: 400 }), undefined);
    }
  });
  server.addHook('onSend', async (_req, reply) => {
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
  });
  await server.register(fastifySwagger, {
    openapi: { info: { title: 'tv-home', description: 'LG TV home server', version: '2.0.0' } },
    transform: jsonSchemaTransform,
  });
  server.get('/openapi.json', { schema: { hide: true } }, async () => server.swagger());

  let icons = new Map<string, string>();
  let lastClientLog: Record<string, unknown> | null = null;
  const { tv, cache, config, commands, aerials } = app;

  server.get('/api/apps', { schema: doc('listApps', 'Installed apps in launcher order', responses.apps) }, async () => {
    const res = launcherApps(await tv.listApps(), config.get(), LAUNCHER_ID);
    icons = res.icons;
    return res.apps;
  });

  // Input tiles for the launcher; agents use /api/devices.
  server.get('/api/inputs', { schema: { hide: true } }, async () =>
    launcherInputs(parseInputs(await tv.inputStatus())),
  );

  server.get('/api/status', { schema: doc('getStatus', 'What the TV is showing right now', responses.status) }, () => ({
    foreground: app.state.foreground ?? null,
    watching: app.state.watching() ?? null,
  }));

  const devices = () => listDevices(app.state.sources, app.sonos.status(), app.state.watching());
  server.get(
    '/api/devices',
    {
      schema: doc(
        'listDevices',
        'Every device the TV can see (HDMI-CEC sources, Sonos speakers) and its state',
        responses.devices,
      ),
    },
    () => devices(),
  );
  const deviceParams = z.object({
    id: z.string().describe('Device id from listDevices, e.g. cec-4864 or sonos-RINCON_…'),
  });
  server.get(
    '/api/devices/:id',
    {
      schema: {
        ...doc('getDevice', 'One device and everything known about it', responses.device),
        params: deviceParams,
      },
    },
    async (req, reply) => {
      const device = devices().find((d) => d.id === req.params.id);
      return device ?? reply.code(404).send({ error: `no device ${req.params.id}` });
    },
  );

  const launchBody = z.object({ id: AppId.describe('App id (e.g. netflix) or HDMI input app (com.webos.app.hdmi1)') });
  server.post(
    '/api/launch',
    { schema: { ...doc('launch', 'Open an app or switch input', responses.ok), body: launchBody } },
    async (req) => {
      await tv.launch(req.body.id);
      return { ok: true };
    },
  );

  server.get('/icon', { schema: { hide: true, querystring: z.object({ id: AppId }) } }, async (req, reply) => {
    const file = icons.get(req.query.id);
    if (!file) return reply.code(404).send({ error: 'no icon' });
    return reply
      .type(path.extname(file) === '.jpg' ? 'image/jpeg' : 'image/png')
      .header('Cache-Control', 'max-age=86400')
      .send(fs.createReadStream(file));
  });

  server.get(
    '/api/weather',
    {
      schema: doc(
        'getWeather',
        'Current weather and forecast at home (404 when config.json has no home location)',
        responses.weather,
      ),
    },
    async (_req, reply) => {
      const { home } = config.get();
      if (!home) return reply.code(404).send({ error: 'weather is off: set home.lat and home.lon in config.json' });
      return weather(cache, home);
    },
  );

  server.get(
    '/api/aerials',
    { schema: doc('listAerials', 'Screensaver video clips and their themes', responses.aerials) },
    async () => aerials,
  );
  server.get('/api/art', { schema: doc('listArt', 'Paintings used by the art screensaver', responses.art) }, async () =>
    paintings(cache, config.get().artQueries, log),
  );

  // The launcher page polls GET /api/cmd for commands pushed by the server or by POST.
  server.get('/api/cmd', { schema: { hide: true } }, async () => ({ cmd: commands.take() }));
  const cmdBody = z.object({
    cmd: z.string().min(1).describe('saver, saver:<ocean|nature|space|favorite|art>, or wake'),
  });
  server.post(
    '/api/cmd',
    {
      schema: {
        ...doc('sendLauncherCommand', 'Start or stop the screensaver on the launcher', responses.ok),
        body: cmdBody,
      },
    },
    async (req) => {
      commands.push(req.body.cmd);
      return { ok: true };
    },
  );

  const logsQuery = z.object({
    limit: z.coerce.number().int().min(1).max(2000).default(200).describe('How many entries, newest last'),
    service: z.string().optional().describe('Only entries from this service: input, volume, night, screensaver, sonos'),
  });
  server.get(
    '/api/logs',
    {
      schema: {
        ...doc('getLogs', 'Recent server log entries (persisted across reboots)', responses.logs),
        querystring: logsQuery,
      },
    },
    async (req) => {
      const { limit, service } = req.query;
      return readLog(app.paths.logs, limit, (line) => !service || line.service === service);
    },
  );

  // Client-side errors from the launcher, readable over SSH.
  server.get(
    '/api/log',
    { schema: doc('getClientError', 'Last error reported by the launcher page', responses.clientError) },
    async () => lastClientLog,
  );
  server.post('/api/log', { schema: { hide: true, body: z.record(z.string(), z.unknown()) } }, async (req) => {
    lastClientLog = { ...req.body, at: new Date().toISOString() };
    return { ok: true };
  });

  void server.register(fastifyStatic, { root: app.paths.public, cacheControl: false });
  return server;
}
