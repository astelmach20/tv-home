interface Entry<T> {
  at: number;
  value?: T;
  pending?: Promise<T>;
}

/** TTL cache for upstream fetches. Concurrent callers share one in-flight request; a failure isn't cached. */
export class TtlCache {
  private readonly entries = new Map<string, Entry<unknown>>();

  async get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const e = this.entries.get(key) as Entry<T> | undefined;
    if (e?.pending) return e.pending;
    if (e && 'value' in e && Date.now() - e.at < ttlMs) return e.value as T;
    const pending = load().then(
      (value) => (this.entries.set(key, { at: Date.now(), value }), value),
      (err: unknown) => {
        if (e && 'value' in e) this.entries.set(key, e);
        else this.entries.delete(key);
        throw err;
      },
    );
    this.entries.set(key, { ...e, at: e?.at ?? 0, pending });
    return pending;
  }
}
