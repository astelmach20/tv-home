// pino-roll ships no typings; this covers the options we use.
declare module 'pino-roll' {
  import type { SonicBoom, SonicBoomOpts } from 'sonic-boom';

  export interface PinoRollOptions extends Omit<SonicBoomOpts, 'dest'> {
    /** Base path; the date and a number are appended (`tvhome.2026-10-17.1.log`). */
    file: string;
    /** Start a new file once this one reaches the size (`'5m'`, `'500k'`). */
    size?: string | number;
    /** Start a new file every day or hour (`'daily'`, `'hourly'`) or every N ms. */
    frequency?: 'daily' | 'hourly' | number;
    extension?: string;
    /** Keep `current.log` pointing at the file being written. */
    symlink?: boolean;
    /** How many old files to keep besides the current one. */
    limit?: { count?: number; removeOtherLogFiles?: boolean };
    dateFormat?: string;
  }

  export default function pinoRoll(options: PinoRollOptions): Promise<SonicBoom>;
}
