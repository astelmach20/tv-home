// tv-home server entry. Runs as root on the TV (started by /var/lib/webosbrew/init.d/70-tvhome).
// TVHOME_MOCK=<dir> runs locally against fixture data instead of the TV.
import path from 'node:path';
import { createApp, defaultPaths } from './app.js';
import { createLogger } from './lib/logging.js';
import { buildServer } from './http/server.js';

const PORT = Number(process.env.TVHOME_PORT ?? 8765);
const HOST = process.env.TVHOME_HOST ?? '127.0.0.1';

// The bundle lives in <root>/dist; data, config and the UI sit next to it.
const root = process.env.TVHOME_ROOT ?? path.resolve(__dirname, '..');
async function main() {
  const paths = defaultPaths(root);
  const log = await createLogger(paths.logs);
  const app = createApp(paths, log, process.env.TVHOME_MOCK);
  // Start watching the TV only once the port is ours, so a second copy exits without touching anything.
  try {
    const server = await buildServer(app, log);
    await server.listen({ port: PORT, host: HOST });
    app.start();
  } catch (err) {
    log.fatal({ err }, 'server failed to start');
    process.exit(1);
  }
}

void main();
