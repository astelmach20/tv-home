import fs from 'node:fs';
import path from 'node:path';
import type { z } from 'zod';

export interface Store<T> {
  read(): T;
  write(data: T): void;
}

/**
 * A small JSON file of learned state, validated with `schema` on read (a missing or invalid file reads as `empty`).
 * Writes are atomic (temp file + rename) so a power cut can't leave half a file.
 */
export class JsonStore<S extends z.ZodType<object>> implements Store<z.output<S>> {
  constructor(
    private readonly file: string,
    private readonly schema: S,
    private readonly empty: () => z.output<S>,
  ) {}

  read(): z.output<S> {
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return this.empty();
    }
    const parsed = this.schema.safeParse(raw);
    return parsed.success ? parsed.data : this.empty();
  }

  write(data: z.output<S>): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.file);
  }
}
