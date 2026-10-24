import fs from 'node:fs';
import path from 'node:path';
import { pino, type Logger } from 'pino';
import pinoRoll from 'pino-roll';
import { z } from 'zod';

const ROLL = { frequency: 'daily', size: '5m', keep: 6 } as const;

/**
 * Log to stdout and, when `dir` is given, to a file per day in `dir` (a new file early if one passes 5 MB; the
 * oldest is deleted once there are more than 7). `dir/current.log` always points at the file being written.
 */
export async function createLogger(dir?: string): Promise<Logger> {
  const opts = { base: undefined, timestamp: pino.stdTimeFunctions.isoTime };
  if (!dir) return pino(opts);
  const file = await pinoRoll({
    file: path.join(dir, 'tvhome'),
    extension: '.log',
    dateFormat: 'yyyy-MM-dd',
    frequency: ROLL.frequency,
    size: ROLL.size,
    limit: { count: ROLL.keep },
    symlink: true,
    mkdir: true,
  });
  return pino(opts, pino.multistream([{ stream: process.stdout }, { stream: file }]));
}

export const LogLine = z.looseObject({ time: z.string(), level: z.number(), msg: z.string().optional() });
export type LogLine = z.infer<typeof LogLine>;

/** The last `limit` entries from the current log, oldest first, optionally only those matching `filter`. */
export function readLog(dir: string, limit: number, filter: (line: LogLine) => boolean = () => true): LogLine[] {
  let text: string;
  try {
    text = fs.readFileSync(path.join(dir, 'current.log'), 'utf8');
  } catch {
    return [];
  }
  const out: LogLine[] = [];
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const raw = lines[i];
    if (!raw) continue;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }
    const parsed = LogLine.safeParse(json);
    if (parsed.success && filter(parsed.data)) out.push(parsed.data);
  }
  return out.reverse();
}
