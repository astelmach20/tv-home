// Thin client for webOS Luna services via the luna-send CLI. Every reply is validated against a zod schema.
// luna-send drops its output when stdout is a pipe, so calls write to a temp file instead.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Logger } from 'pino';
import { z } from 'zod';

const ErrorReply = z.object({ returnValue: z.literal(false), errorText: z.string().optional() });

const tmpFile = (tag: string) =>
  path.join(
    os.tmpdir(),
    `tvhome-${tag}-${String(process.pid)}-${String(Date.now())}-${Math.random().toString(36).slice(2)}.json`,
  );

/** Parse one reply: a Luna error becomes an Error, anything else must match `schema`. */
function decode<S extends z.ZodType>(uri: string, text: string, schema: S): z.output<S> {
  const json: unknown = JSON.parse(text);
  const err = ErrorReply.safeParse(json);
  if (err.success) throw new Error(`${uri}: ${err.data.errorText ?? 'returnValue false'}`);
  return schema.parse(json);
}

/** One request, one reply. */
export function call<S extends z.ZodType>(
  uri: string,
  payload: object,
  schema: S,
  timeoutMs = 8000,
): Promise<z.output<S>> {
  return new Promise((resolve, reject) => {
    const out = tmpFile('call');
    const fd = fs.openSync(out, 'w');
    const child = spawn('luna-send', ['-n', '1', uri, JSON.stringify(payload)], { stdio: ['ignore', fd, fd] });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      fs.closeSync(fd);
    };
    child.on('error', (e) => {
      cleanup();
      fs.rm(out, () => {});
      reject(e);
    });
    child.on('close', (code) => {
      cleanup();
      let text = '';
      try {
        text = fs.readFileSync(out, 'utf8');
      } catch {
        /* no output */
      }
      fs.rm(out, () => {});
      if (!text) {
        reject(new Error(`luna-send exited ${String(code)} with no reply for ${uri}`));
        return;
      }
      try {
        resolve(decode(uri, text, schema));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  });
}

export interface Subscription {
  close(): void;
}

// luna-send children outlive the server unless killed, and each one holds a subscription on the bus.
const running = new Set<ChildProcess>();
process.on('exit', () => {
  for (const child of running) child.kill();
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => process.exit(0));

/**
 * Long-lived subscription (`luna-send -i`): one JSON reply per line, read from the temp file as lines arrive.
 * The process is restarted if it exits, until `close()` is called.
 */
export function subscribe<S extends z.ZodType>(
  uri: string,
  payload: object,
  schema: S,
  onMessage: (msg: z.output<S>) => void,
  log: Logger,
  { pollMs = 200, restartMs = 5000 } = {},
): Subscription {
  let closed = false;
  let kill = () => {};

  const start = () => {
    const out = tmpFile('sub');
    const fd = fs.openSync(out, 'w');
    const child = spawn('luna-send', ['-i', uri, JSON.stringify({ subscribe: true, ...payload })], {
      stdio: ['ignore', fd, fd],
    });
    running.add(child);
    let readPos = 0;
    let partial = '';
    const timer = setInterval(() => {
      let chunk: Buffer;
      try {
        const buf = fs.readFileSync(out);
        chunk = buf.subarray(readPos);
        readPos = buf.length;
      } catch {
        return;
      }
      if (!chunk.length) return;
      const lines = (partial + chunk.toString('utf8')).split('\n');
      partial = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: z.output<S>;
        try {
          msg = decode(uri, line, schema);
        } catch (err) {
          log.warn({ uri, err, line: line.slice(0, 200) }, 'luna subscription: unusable reply');
          continue;
        }
        onMessage(msg);
      }
    }, pollMs);
    child.on('error', (err) => {
      log.error({ uri, err }, 'luna subscription failed to start');
    });
    child.on('close', (code) => {
      running.delete(child);
      clearInterval(timer);
      fs.closeSync(fd);
      fs.rm(out, () => {});
      if (closed) return;
      log.warn({ uri, code }, 'luna subscription ended; restarting');
      setTimeout(() => {
        if (!closed) start();
      }, restartMs);
    });
    kill = () => child.kill();
  };

  start();
  return {
    close() {
      closed = true;
      kill();
    },
  };
}
