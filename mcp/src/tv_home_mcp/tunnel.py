"""SSH local port forward to the TV's home server (which listens on 127.0.0.1 only)."""

from __future__ import annotations

import asyncio
import os
import socket
import subprocess
import sys
import time

from .config import Config


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def log(msg: str) -> None:
    # stdout is the MCP stdio transport; diagnostics go to stderr.
    print(f"[tv-home-mcp] {msg}", file=sys.stderr, flush=True)


class Tunnel:
    """`ssh -N -L <local>:127.0.0.1:<remote>` kept alive for the server's lifetime.

    The local port is chosen once so the HTTP client's base URL never changes
    across restarts.
    """

    def __init__(self, cfg: Config, local_port: int | None = None):
        self.cfg = cfg
        self.local_port = local_port or free_port()
        self.proc: subprocess.Popen[bytes] | None = None
        # The tunnel doubles as an ssh ControlMaster so run_command calls reuse
        # its connection instead of doing a full handshake each time. Short
        # fixed path: unix socket paths are capped at ~104 bytes on macOS.
        self.control_path = f"/tmp/tvhome-mcp-{os.getpid()}.sock"

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.local_port}"

    def argv(self) -> list[str]:
        return [
            *self.cfg.ssh_base(),
            "-N",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "ControlMaster=yes",
            "-o", f"ControlPath={self.control_path}",
            "-L", f"127.0.0.1:{self.local_port}:127.0.0.1:{self.cfg.remote_port}",
            self.cfg.host,
        ]

    def alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def start(self) -> None:
        self.stop()
        self._remove_socket()
        # Never inherit stdin/stdout: they carry the MCP protocol.
        self.proc = subprocess.Popen(
            self.argv(),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    def listening(self) -> bool:
        try:
            with socket.create_connection(("127.0.0.1", self.local_port), timeout=0.5):
                return True
        except OSError:
            return False

    def wait_ready(self, timeout: float = 10.0) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if not self.alive():
                return False
            if self.listening():
                return True
            time.sleep(0.1)
        return False

    def _remove_socket(self) -> None:
        try:
            os.unlink(self.control_path)
        except FileNotFoundError:
            pass

    def stop(self) -> None:
        proc, self.proc = self.proc, None
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        self._remove_socket()

    async def watchdog(self, interval: float = 5.0) -> None:
        """Restart the tunnel whenever ssh exits (TV slept, Wi-Fi blip, reboot)."""
        backoff = interval
        while True:
            await asyncio.sleep(backoff)
            if self.alive():
                backoff = interval
                continue
            log(f"tunnel to {self.cfg.host} is down; restarting")
            self.start()
            ready = await asyncio.to_thread(self.wait_ready)
            if ready:
                log(f"tunnel up on {self.base_url}")
                backoff = interval
            else:
                backoff = min(backoff * 2, 60.0)
