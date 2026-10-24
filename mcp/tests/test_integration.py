"""Opt-in tests against the real TV: TVHOME_INTEGRATION=1 uv run pytest.

Only read-only commands are run (plus a cd and a sleep).
"""

import asyncio
import os

import pytest

from tv_home_mcp.config import Config
from tv_home_mcp.server import create
from tv_home_mcp.shell import RemoteShell

pytestmark = pytest.mark.skipif(
    not os.environ.get("TVHOME_INTEGRATION"), reason="set TVHOME_INTEGRATION=1 to run against the TV"
)


@pytest.fixture
def shell():
    return RemoteShell(Config.from_env())


async def test_echo(shell):
    assert await shell.run("echo hi") == ("hi", False)


async def test_cwd_persists(shell):
    assert await shell.run("cd /tmp") == ("", False)
    assert await shell.run("pwd") == ("/tmp", False)
    assert shell.cwd == "/tmp"


async def test_nonzero_exit(shell):
    out, is_error = await shell.run("echo oops >&2; exit 7")
    assert is_error
    assert out == "oops\nExit code 7"


async def test_timeout(shell):
    out, is_error = await shell.run("echo started; sleep 30", timeout_ms=1500)
    assert is_error
    assert out.startswith("Command timed out after 1.5s")
    assert "started" in out
    left, _ = await shell.run("ps | grep '[s]leep 30' || echo none")
    assert left == "none"


async def test_cancel_kills_remote_command(shell):
    task = asyncio.create_task(shell.run("sleep 41"))
    await asyncio.sleep(2)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    left, _ = await shell.run("ps | grep '[s]leep 41' || echo none")
    assert left == "none"


async def test_progress_reports_last_line(shell):
    seen: list[tuple[float, str]] = []

    async def on_progress(elapsed: float, line: str) -> None:
        seen.append((elapsed, line))

    out, is_error = await shell.run("echo one; sleep 6; echo two", on_progress=on_progress)
    assert (out, is_error) == ("one\ntwo", False)
    assert seen and seen[0][1] == "one" and seen[0][0] >= 4


async def test_screenshot_is_jpeg(shell):
    data = await shell.screenshot(1280, 720)
    assert data[:3] == b"\xff\xd8\xff"


async def test_mcp_end_to_end():
    from fastmcp import Client

    mcp, tunnel = create()
    try:
        async with Client(mcp) as client:
            devices = await client.call_tool("list_devices", {})
            assert "sonos-" in devices.content[0].text
            shot = await client.call_tool("screenshot", {})
            assert shot.content[0].mime_type == "image/jpeg"
            status = await client.read_resource("tv://status")
            assert "watching" in status[0].text
            logs = await client.read_resource("tv://logs/sonos")
            assert logs[0].text.startswith("[")
    finally:
        tunnel.stop()
