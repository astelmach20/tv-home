# tv-home-mcp

An MCP server (stdio) for the rooted LG TV. It exposes:

- every operation of the TV home server's HTTP API, generated from its OpenAPI spec with
  [FastMCP's OpenAPI integration](https://gofastmcp.com/integrations/openapi), and
- `run_command`, a **root shell on the TV** over SSH that behaves like Claude Code's Bash tool.

The home server listens on `127.0.0.1:8765` on the TV only. This server reaches it through an
SSH local port forward (`ssh -N -L <free port>:127.0.0.1:8765`) that it starts on launch,
restarts when it drops, and kills on shutdown. The same SSH connection is reused (as a
ControlMaster) by `run_command`, so shell calls skip the SSH handshake.

## Tools

API tools (names are the snake_cased `operationId`s; GETs are marked read-only, all are
idempotent). Each has an output schema from the server's zod response schemas, so results come
back as structured content.

| Tool | Endpoint | What it does |
| --- | --- | --- |
| `get_status` | GET /api/status | What the TV is showing right now |
| `list_devices` | GET /api/devices | Every device the TV can see (HDMI-CEC sources, Sonos speakers) and its state |
| `get_device` | GET /api/devices/{id} | One device by id (`cec-4864`, `sonos-RINCON_…`) |
| `list_apps` | GET /api/apps | Installed apps in launcher order |
| `get_weather` | GET /api/weather | Current weather and forecast (errors unless `home` is set in the server's `config.json`) |
| `list_aerials` | GET /api/aerials | Screensaver clips and their themes |
| `list_art` | GET /api/art | Paintings used by the art screensaver |
| `get_logs` | GET /api/logs | Recent server log entries (`limit`, `service`) |
| `get_client_error` | GET /api/log | Last error reported by the launcher page |
| `launch_app` | POST /api/launch | Open an app or switch input (changes the TV) |
| `send_launcher_command` | POST /api/cmd | Start or stop the screensaver (changes the TV) |

The list follows whatever the TV's `/openapi.json` publishes, so new endpoints show up after a
restart of this server.

Shell tools:

- `run_command(command, timeout?, description?, run_in_background?)`: runs `command` on the TV
  as root under bash (BusyBox userland). stdout and stderr are combined. The working directory
  persists between calls (starting in `/home/root`); environment and shell state do not. Non-zero
  exits come back as errors ending in `Exit code N`. `timeout` is in ms (default 120000, max
  600000); on timeout the command's process group is killed and the captured output returned.
  Output over 30000 characters keeps the head and tail. Long commands send progress
  notifications every 5 s with the latest output line; cancelling the call kills the command on
  the TV.
- `read_background_output(id)`: new output from a `run_in_background` command since the last
  read, and whether it is running or exited (with its exit code). Logs live in
  `/tmp/mcp-bg-<id>.log` on the TV.
- `stop_background_command(id)`: SIGTERM then SIGKILL to a background command's process group.
- `screenshot(size)`: a JPEG of what's on screen, HDMI video included (`small` 1280×720,
  `large` 1920×1080).

`get_status`, `list_devices` and `run_command` are marked `anthropic/alwaysLoad`, so Claude Code
loads them up front instead of deferring them behind tool search.

## Resources and prompts

- `tv://status`, `tv://devices`: the same data as `get_status` / `list_devices`, for clients
  that attach resources as context.
- `tv://logs/{service}`: the last 200 log entries for one service (`input`, `volume`, `night`,
  `screensaver`, `sonos`).
- Prompt `diagnose(problem)`: walks through status, devices, logs and a screenshot to explain
  something the TV did.

**`run_command` is an unrestricted root shell on the TV.** Anything that can call this MCP
server can do anything on the TV.

## Offline behaviour

On each start the spec is fetched from the TV and saved to `openapi.json` (committed). When the
TV is unreachable the saved copy is used, so the tool list stays the same; calls then fail with
a `TV unreachable: ...` error until the tunnel reconnects (it retries every few seconds).

## Config

Environment variables. Set `TVHOME_TV_HOST` to your TV; the rest are optional.

| Variable | Default | |
| --- | --- | --- |
| `TVHOME_TV_HOST` | `root@lgtv.lan` (placeholder) | SSH destination, e.g. `root@<the TV's IP>` |
| `TVHOME_SSH_KEY` | `~/.ssh/id_ed25519` | SSH private key |
| `TVHOME_REMOTE_PORT` | `8765` | Home server port on the TV |

## Register with Claude Code

```sh
claude mcp add tv-home --scope user -e TVHOME_TV_HOST=root@<the TV's IP> -- uv --directory <path to this repo>/mcp run tv-home-mcp
```

The screenshot tool calls `/home/root/tvctl.sh` on the TV, which `../deploy.sh` installs.

## Development

```sh
uv sync
uv run pytest                                   # unit tests
TVHOME_INTEGRATION=1 uv run pytest              # also runs read-only commands on the TV
```

Source: `src/tv_home_mcp/` (`server.py` builds the server, `tunnel.py` the SSH forward,
`shell.py` the `run_command` implementation).
