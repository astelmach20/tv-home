import type { Logger } from 'pino';

/** Run `fn` now and then every `ms` after each run finishes. Errors are logged, never thrown. Returns a stop function. */
export function every(ms: number, name: string, log: Logger, fn: () => Promise<void> | void): () => void {
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  const tick = async () => {
    try {
      await fn();
    } catch (err) {
      log.warn({ err }, `${name} failed`);
    }
    if (!stopped) timer = setTimeout(() => void tick(), ms);
  };
  void tick();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
