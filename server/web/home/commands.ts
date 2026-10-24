// Polls the server's one-slot command mailbox (GET /api/cmd) and hands each command to every handler.
import { api } from '../lib/api.js';

const CMD_POLL_MS = 2000;

export function startCommands(...handlers: ((cmd: string) => void)[]) {
  setInterval(() => {
    api
      .cmd()
      .then(({ cmd }) => {
        if (cmd)
          handlers.forEach((h) => {
            h(cmd);
          });
      })
      .catch(() => {});
  }, CMD_POLL_MS);
}
