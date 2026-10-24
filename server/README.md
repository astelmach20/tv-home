# tv-home server

Runs as root on the LG TV (Node 20), bound to `127.0.0.1:8765`. Hosts the launcher UI and keeps the TV behaving:
switches to a device's input when it turns on, restores each source's volume, dims the picture at night, and swaps
LG's screensaver for the aerial one while Home is open.

## Layout

| Path | What |
| --- | --- |
| `src/index.ts` | Entry: logger, app, HTTP server |
| `src/app.ts` | Composition root: builds every service from paths and env |
| `src/config.ts` | `config.json` schema (zod), re-read when the file changes |
| `src/luna/` | `luna-send` client: one-shot calls and subscriptions, replies validated with zod |
| `src/tv/` | The `Tv` interface, its Luna and mock implementations, input/app parsing |
| `src/home/` | `TvState` (live inputs + foreground app) and the services built on it |
| `src/data/` | Weather (optional) and screensaver paintings |
| `src/http/` | Fastify routes and the API response types shared with `web/` |
| `web/` | Browser code (TypeScript), bundled into `public/js/` |
| `public/` | HTML, CSS and the built bundles |
| `data/` | Static data: `aerials.json` (tagged by theme) |
| `state/` (on the TV) | Learned state: per-source volume, saved daytime picture settings |

## Scripts

```bash
npm run check   # tsc + eslint (strict type-checked) + vitest
npm run build   # dist/server.cjs and public/js/*.js
npm run dev     # build, then serve on :8765 against ../mock fixtures
```

Deploy with `../deploy.sh`: it runs `check` and `build`, then replaces `/home/root/tv-home` on the TV, keeping `state/`.
Set `TV` to the TV's SSH destination first, e.g. `TV=root@lgtv.lan ../deploy.sh` (default `root@lgtv.lan`).

## config.json

Every key is optional; edits apply without a restart.

| Key | What |
| --- | --- |
| `pinned` | App ids shown first in the launcher, in this order; the rest follow alphabetically |
| `hidden` | App ids never shown in the launcher |
| `night` | `{ start, end, backlight, backlightByMode }`: hours (0-23) and the backlight to use overnight |
| `home` | `{ lat, lon, timezone? }`: turns on weather (Open-Meteo, no key). Leave it out and weather stays off. The coordinates are rounded to one decimal before they are sent; `timezone` defaults to `auto` |
| `artQueries` | Search terms for the art screensaver's paintings |

## How input switching works

`TvState` subscribes to `getAllInputStatus` and the foreground app (with a 3s poll as a backstop). Each HDMI-CEC
device is classified by its CEC device type: playback devices (Apple TV, PS5) can take the screen; audio systems
(the Sonos) never do. When a watchable device goes from off to on, the TV switches to its input. It only reacts to
that change, so choosing another input yourself is never overridden.
