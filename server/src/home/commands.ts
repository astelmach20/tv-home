/**
 * One-slot mailbox from the server (or SSH: `POST /api/cmd`) to the launcher UI, which polls it.
 * Commands: `saver`, `saver:<theme>` (ocean, nature, space), `wake`.
 */
export class Commands {
  private pending: string | null = null;

  push(cmd: string) {
    this.pending = cmd;
  }

  take(): string | null {
    const c = this.pending;
    this.pending = null;
    return c;
  }
}
