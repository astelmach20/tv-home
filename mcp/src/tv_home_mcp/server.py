"""MCP server: the TV home server's OpenAPI operations as tools, plus a root shell on the TV."""

from __future__ import annotations

import asyncio
import importlib.metadata
import json
import re
from collections.abc import AsyncIterator
from typing import Annotated, Any, Literal

import httpx2
from fastmcp import Context, FastMCP
from fastmcp.dependencies import CurrentContext
from fastmcp.exceptions import ResourceError, ToolError
from fastmcp.server.lifespan import lifespan
from fastmcp.server.providers.openapi import MCPType, RouteMap
from fastmcp.tools import ToolResult
from fastmcp.utilities.types import Image
from mcp.types import TextContent, ToolAnnotations
from pydantic import Field

from .config import Config
from .shell import DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, RemoteError, RemoteShell
from .tunnel import Tunnel, log

# Names that read better than the snake_cased operationId.
NAME_OVERRIDES = {"launch": "launch_app"}

# Claude Code loads these up front even with tool search on; everything else is found by search.
ALWAYS_LOAD = {"getStatus", "listDevices"}
ALWAYS_LOAD_META = {"anthropic/alwaysLoad": True}

LOG_SERVICES = ("input", "volume", "night", "screensaver", "sonos")

INSTRUCTIONS = """\
Controls and inspects a rooted LG webOS TV and the home server running on it.
Use these tools for anything about the TV or what's connected to it: what's on screen, HDMI devices
(e.g. an Apple TV or a console), a Sonos soundbar, apps and inputs, the screensaver, night mode,
per-source volume, the TV's logs, or the weather it shows (when a home location is configured).

- get_status: what's on screen now. list_devices / get_device: every HDMI-CEC device and Sonos
  speaker with its state (a soundbar appears both as a CEC device and as a Sonos player).
- get_logs(service=input|volume|night|screensaver|sonos): the server's persisted event log, e.g.
  why the input switched or when the Sonos changed source. Timestamps are UTC.
- screenshot: a picture of what's on screen right now.
- launch_app and send_launcher_command change what's on screen; everything else only reads.
- run_command is a root shell on the TV (BusyBox userland). The home server is at 127.0.0.1:8765
  there; its process log is /tmp/tvhome.log. If an API tool says "TV unreachable", the TV is off
  or asleep (it drops off the network in standby).
- Prompts: /diagnose investigates a problem from logs and device state."""

RUN_COMMAND_DESCRIPTION = f"""\
Run a shell command ON THE TV (an LG webOS TV, aarch64 Linux, BusyBox userland) as root, over SSH.

This is a root shell on the TV, not on the local machine. Anything it does happens on the TV:
avoid commands that reboot it, kill system services, or write outside /tmp unless asked to.

- The command runs under bash (falls back to sh). Most utilities are BusyBox versions with fewer
  flags than GNU coreutils; `curl` is available. The home server listens on 127.0.0.1:8765 on the TV.
- The working directory persists between calls (it starts in /home/root), so `cd /tmp` in one call
  means the next call runs in /tmp. Environment variables, aliases and other shell state do not
  persist. Prefer absolute paths.
- stdout and stderr are combined, interleaved as produced. stdin is empty.
- On a non-zero exit status the result is an error that ends with "Exit code N".
- timeout is in milliseconds: default {DEFAULT_TIMEOUT_MS} (2 minutes), max {MAX_TIMEOUT_MS} (10 minutes).
  On timeout, or if the call is cancelled, the remote process (and its process group) is killed;
  on timeout whatever output was captured is returned. Progress (elapsed time, last output line) is
  reported every few seconds while it runs.
- Output longer than 30000 characters is truncated, keeping the beginning and the end.
- run_in_background: true starts the command detached on the TV (survives disconnects) and returns
  immediately with an id, PID and log path (/tmp/mcp-bg-<id>.log). Read its output and exit status
  with read_background_output(id); stop it with stop_background_command(id). Use this for
  long-running things (watching logs, servers); do not append `&` yourself.
- description is a short human-readable summary of what the command does (informational only)."""


def tool_name(operation_id: str) -> str:
    """listApps -> list_apps."""
    if operation_id in NAME_OVERRIDES:
        return NAME_OVERRIDES[operation_id]
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", operation_id).lower()


def mcp_names(spec: dict[str, Any]) -> dict[str, str]:
    names = {}
    for ops in spec.get("paths", {}).values():
        for op in ops.values():
            if isinstance(op, dict) and op.get("operationId"):
                names[op["operationId"]] = tool_name(op["operationId"])
    return names


def annotate(route: Any, component: Any) -> None:
    """GETs are read-only; POSTs change what's on screen but repeating one changes nothing more."""
    method = route.method.upper()
    component.annotations = ToolAnnotations(
        title=route.summary or component.name,
        read_only_hint=method == "GET",
        destructive_hint=False,
        idempotent_hint=True,
        open_world_hint=False,
    )
    if route.operation_id in ALWAYS_LOAD:
        component.meta = {**(component.meta or {}), **ALWAYS_LOAD_META}
    component.description = f"{component.description}\n\n(TV home server: {method} {route.path})"


class TVClient(httpx2.AsyncClient):
    """HTTP client bound to the tunnel; turns connection failures into a clear error."""

    def __init__(self, tunnel: Tunnel, **kwargs: Any):
        super().__init__(base_url=tunnel.base_url, **kwargs)
        self.tunnel = tunnel

    async def send(self, request: httpx2.Request, **kwargs: Any) -> httpx2.Response:
        host = self.tunnel.cfg.host
        if not self.tunnel.alive():
            raise ToolError(
                f"TV unreachable: the SSH tunnel to {host} is down (it reconnects automatically "
                "every few seconds). The TV may be off, asleep or off the network."
            )
        try:
            return await super().send(request, **kwargs)
        except (httpx2.ConnectError, httpx2.RemoteProtocolError, httpx2.ReadError) as exc:
            raise ToolError(
                f"TV unreachable: the SSH tunnel to {host} is up but the home server on "
                f"127.0.0.1:{self.tunnel.cfg.remote_port} did not answer ({type(exc).__name__}). "
                "It may be restarting; check with run_command."
            ) from exc


def load_spec(cfg: Config, tunnel: Tunnel) -> dict[str, Any]:
    """Fetch /openapi.json through the tunnel and save it; else use the saved copy."""
    if tunnel.wait_ready(10):
        try:
            r = httpx2.get(f"{tunnel.base_url}/openapi.json", timeout=10)
            r.raise_for_status()
            spec = r.json()
            if not isinstance(spec, dict) or "paths" not in spec:
                raise ValueError("response is not an OpenAPI document")
            text = json.dumps(spec, indent=2) + "\n"
            try:
                old = cfg.spec_path.read_text()
            except FileNotFoundError:
                old = None
            if text != old:
                cfg.spec_path.write_text(text)
                log(f"saved updated spec to {cfg.spec_path}")
            return spec
        except Exception as exc:
            log(f"could not fetch /openapi.json from the TV ({exc}); using saved spec")
    else:
        log(f"TV unreachable at {cfg.host}; using saved spec")
    return json.loads(cfg.spec_path.read_text())


def build_server(cfg: Config, tunnel: Tunnel, spec: dict[str, Any]) -> FastMCP:
    shell = RemoteShell(cfg, control_path=tunnel.control_path)
    client = TVClient(tunnel, timeout=15)

    @lifespan
    async def tunnel_lifespan(_server: FastMCP) -> AsyncIterator[dict[str, Any]]:
        if not tunnel.alive():
            tunnel.start()
        watchdog = asyncio.create_task(tunnel.watchdog())
        try:
            yield {}
        finally:
            watchdog.cancel()
            tunnel.stop()

    mcp = FastMCP.from_openapi(
        openapi_spec=spec,
        client=client,
        name="tv-home",
        version=importlib.metadata.version("tv-home-mcp"),
        instructions=INSTRUCTIONS,
        route_maps=[
            RouteMap(pattern=r"^/(openapi\.json|docs)(/.*)?$", mcp_type=MCPType.EXCLUDE),
            # Every operation, GETs included, is a tool: the model calls these for live state. The
            # most useful GETs are also resources below, for @-mentioning.
            RouteMap(methods="*", pattern=r".*", mcp_type=MCPType.TOOL),
        ],
        mcp_names=mcp_names(spec),
        mcp_component_fn=annotate,
        lifespan=tunnel_lifespan,
        on_duplicate="error",
        # Lists change only when the TV's spec does; resource reads are live state, so keep it short.
        cache_ttl=30,
        cache_scope="private",
    )

    def text(body: str, is_error: bool = False) -> ToolResult:
        return ToolResult(content=[TextContent(type="text", text=body)], is_error=is_error)

    # ------------------------------------------------------------------ shell tools

    @mcp.tool(
        name="run_command",
        description=RUN_COMMAND_DESCRIPTION,
        output_schema=None,
        meta=ALWAYS_LOAD_META,
        annotations=ToolAnnotations(
            title="Run shell command on the TV",
            read_only_hint=False,
            destructive_hint=True,
            idempotent_hint=False,
            open_world_hint=True,
        ),
    )
    async def run_command(
        command: Annotated[str, Field(description="The shell command to run on the TV")],
        timeout: Annotated[
            float | None,
            Field(
                description=f"Optional timeout in milliseconds (max {MAX_TIMEOUT_MS})",
                gt=0,
                le=MAX_TIMEOUT_MS,
            ),
        ] = None,
        description: Annotated[
            str | None,
            Field(description="Clear, concise description of what this command does in 5-10 words"),
        ] = None,
        run_in_background: Annotated[
            bool | None,
            Field(
                description="Set to true to run this command in the background on the TV. "
                "Use read_background_output to read the output later."
            ),
        ] = None,
        ctx: Context = CurrentContext(),
    ) -> ToolResult:
        timeout_ms = int(timeout or DEFAULT_TIMEOUT_MS)

        async def progress(elapsed: float, line: str) -> None:
            await ctx.report_progress(elapsed, total=timeout_ms / 1000, message=line or "running")

        try:
            if run_in_background:
                return text(await shell.start_background(command))
            out, is_error = await shell.run(command, timeout_ms, progress)
            return text(out or "(no output)", is_error)
        except RemoteError as exc:
            raise ToolError(str(exc)) from exc

    @mcp.tool(
        name="read_background_output",
        description=(
            "Read new output from a command started on the TV with run_command(run_in_background=true), "
            "and whether it is still running or has exited (with its exit code). Each call returns only "
            "output produced since the previous call for that id."
        ),
        output_schema=None,
        annotations=ToolAnnotations(
            title="Read background command output",
            read_only_hint=True,
            open_world_hint=False,
        ),
    )
    async def read_background_output(
        id: Annotated[str, Field(description="The id returned by run_command")],
    ) -> ToolResult:
        try:
            return text(await shell.read_background(id))
        except RemoteError as exc:
            raise ToolError(str(exc)) from exc

    @mcp.tool(
        name="stop_background_command",
        description=(
            "Stop a command started on the TV with run_command(run_in_background=true): sends SIGTERM "
            "to its process group, then SIGKILL after a second. Its log file is kept."
        ),
        output_schema=None,
        annotations=ToolAnnotations(
            title="Stop background command",
            read_only_hint=False,
            destructive_hint=True,
            idempotent_hint=True,
            open_world_hint=False,
        ),
    )
    async def stop_background_command(
        id: Annotated[str, Field(description="The id returned by run_command")],
    ) -> ToolResult:
        try:
            return text(await shell.stop_background(id))
        except RemoteError as exc:
            raise ToolError(str(exc)) from exc

    @mcp.tool(
        name="screenshot",
        description=(
            "Take a picture of what's on the TV screen right now (apps, the launcher, and HDMI video from "
            "the Apple TV or PS5) as a JPEG. Use it to check what the TV is actually showing."
        ),
        annotations=ToolAnnotations(
            title="Screenshot the TV",
            read_only_hint=True,
            idempotent_hint=False,
            open_world_hint=False,
        ),
    )
    async def screenshot(
        size: Annotated[
            Literal["small", "large"],
            Field(description="small is 1280x720 (about 150 KB), large is 1920x1080"),
        ] = "small",
    ) -> Image:
        width, height = (1280, 720) if size == "small" else (1920, 1080)
        try:
            return Image(data=await shell.screenshot(width, height), format="jpeg")
        except RemoteError as exc:
            raise ToolError(str(exc)) from exc

    # ------------------------------------------------------------------ resources (@-mentions)

    async def api_json(path: str, params: dict[str, Any] | None = None) -> str:
        try:
            r = await client.get(path, params=params)
            r.raise_for_status()
        except (ToolError, httpx2.HTTPError) as exc:
            raise ResourceError(str(exc)) from exc
        return json.dumps(r.json(), indent=2)

    @mcp.resource("tv://status", name="TV status", mime_type="application/json")
    async def status_resource() -> str:
        """What the TV is showing right now."""
        return await api_json("/api/status")

    @mcp.resource("tv://devices", name="TV devices", mime_type="application/json")
    async def devices_resource() -> str:
        """Every HDMI-CEC device and Sonos speaker the TV can see, with its state."""
        return await api_json("/api/devices")

    @mcp.resource("tv://logs/{service}", name="TV logs by service", mime_type="application/json")
    async def logs_resource(service: str) -> str:
        """The last 200 log entries from one service: input, volume, night, screensaver or sonos."""
        if service not in LOG_SERVICES:
            raise ResourceError(f"unknown service {service!r}; one of {', '.join(LOG_SERVICES)}")
        return await api_json("/api/logs", {"service": service, "limit": 200})

    # ------------------------------------------------------------------ prompts

    @mcp.prompt(name="diagnose", title="Diagnose a TV problem")
    def diagnose(
        problem: Annotated[str, Field(description="What went wrong, e.g. 'Spotify stopped on the Sonos'")] = "",
    ) -> str:
        """Investigate a TV, input or audio problem from the logs and live device state."""
        about = f"The problem: {problem}\n\n" if problem else ""
        return (
            f"{about}Investigate this using the tv-home tools:\n"
            "1. get_status and list_devices for the current state; screenshot if what's on screen matters.\n"
            "2. get_logs (limit 300) for the recent timeline across all services, then get_logs for the most "
            f"relevant service ({', '.join(LOG_SERVICES)}). Times are UTC.\n"
            "3. get_client_error for errors from the launcher page.\n"
            "4. If something looks wrong with the server itself, run_command `tail -100 /tmp/tvhome.log` and "
            "`ps | grep -E 'node|luna-send'`.\n"
            "Line the events up in time, say what happened and why, and what (if anything) to change. "
            "Don't change TV state (launch apps, restart services) without asking."
        )

    return mcp


def create(cfg: Config | None = None) -> tuple[FastMCP, Tunnel]:
    cfg = cfg or Config.from_env()
    tunnel = Tunnel(cfg)
    tunnel.start()
    spec = load_spec(cfg, tunnel)
    return build_server(cfg, tunnel, spec), tunnel


def main() -> None:
    mcp, tunnel = create()
    try:
        mcp.run(show_banner=False)
    finally:
        tunnel.stop()
