"""run_command: a shell on the TV over SSH that behaves like Claude Code's Bash tool.

The pure helpers (script building, output parsing, truncation) are kept
separate from the subprocess plumbing so they can be unit tested.
"""

from __future__ import annotations

import asyncio
import json
import re
import secrets
import shlex
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from .config import Config

HOME = "/home/root"
DEFAULT_TIMEOUT_MS = 120_000
MAX_TIMEOUT_MS = 600_000
MAX_OUTPUT_CHARS = 30_000
PROGRESS_EVERY_S = 5.0

OnProgress = Callable[[float, str], Awaitable[None]]

# Lines ssh itself prints on stderr that are not worth reporting.
_SSH_NOISE = re.compile(
    r"post-quantum|store now, decrypt later|openssh\.com/pq\.html|server may need to be upgraded",
    re.IGNORECASE,
)


class RemoteError(Exception):
    """Raised for failures the model should see as a tool error."""


# ---------------------------------------------------------------- pure helpers


def new_token() -> str:
    return "__TVMCP_" + secrets.token_hex(8)


def remote_invocation(script: str) -> str:
    """The remote command line: run `script` under bash if the TV has it, else sh.

    root's login shell on the TV is /bin/sh, which ssh uses to interpret this
    line, so it must be POSIX. Inside the script, "$0" is the chosen shell.

    The shell is started with setsid so it leads its own process group: the
    TV runs dropbear, which leaves session shells in the per-connection
    process group, so without this a timeout kill could only reach the shell
    itself (and killing that group would drop every multiplexed session).
    The shell is never a group leader here, so setsid execs without forking.
    """
    q = shlex.quote(script)
    return (
        "if command -v bash >/dev/null 2>&1; then S=bash; else S=sh; fi; "
        "if command -v setsid >/dev/null 2>&1; "
        f'then exec setsid "$S" -c {q}; else exec "$S" -c {q}; fi'
    )


def build_script(command: str, cwd: str, token: str, home: str = HOME) -> str:
    """Wrap a user command so its pid, exit code and final cwd can be recovered.

    Output layout (stderr is merged into stdout so they interleave):
        <token>:pid:<pid>\\n
        <command output>
        \\n<token>:end:<exit code>:<pwd>\\n
    """
    qcwd, qhome = shlex.quote(cwd), shlex.quote(home)
    note = shlex.quote(f"(working directory {cwd} no longer exists; now in {home})")
    return "\n".join(
        [
            "exec 2>&1 </dev/null",
            f"printf '%s:pid:%s\\n' {token} \"$$\"",
            f"cd {qcwd} 2>/dev/null || {{ printf '%s\\n' {note}; cd {qhome}; }}",
            f"eval {shlex.quote(command)}",
            "__tvmcp_rc=$?",
            f"printf '\\n%s:end:%s:%s\\n' {token} \"$__tvmcp_rc\" \"$(pwd)\"",
            "",
        ]
    )


@dataclass
class Parsed:
    output: str
    exit_code: int | None = None  # None: the end marker never arrived
    cwd: str | None = None
    pid: int | None = None


def parse_output(raw: str, token: str) -> Parsed:
    """Strip the markers added by build_script and pull out pid/exit code/cwd."""
    pid = None
    body = raw
    m = re.search(rf"(?m)^{re.escape(token)}:pid:(\d+)\n", body)
    if m:
        pid = int(m.group(1))
        body = body[: m.start()] + body[m.end() :]

    end = f"\n{token}:end:"
    i = body.rfind(end)
    if i < 0:
        return Parsed(output=body, pid=pid)
    tail = body[i + len(end) :]
    body = body[:i]
    line = tail.split("\n", 1)[0]
    rc, _, cwd = line.partition(":")
    try:
        code = int(rc)
    except ValueError:
        code = None
    return Parsed(output=body, exit_code=code, cwd=cwd or None, pid=pid)


def truncate(text: str, limit: int = MAX_OUTPUT_CHARS) -> str:
    """Keep the head and tail of very long output, noting how much was cut."""
    if len(text) <= limit:
        return text
    half = limit // 2
    cut = len(text) - 2 * half
    return (
        f"{text[:half]}\n\n... [output truncated: {cut} characters omitted] ...\n\n"
        f"{text[-half:]}"
    )


def last_line(text: str, limit: int = 200) -> str:
    """The last non-empty line of output, for progress messages."""
    for line in reversed(text.splitlines()):
        if line.strip():
            return line.strip()[:limit]
    return ""


def filter_ssh_stderr(text: str) -> str:
    return "\n".join(
        line for line in text.splitlines() if line.strip() and not _SSH_NOISE.search(line)
    )


def kill_script(pid: int | str) -> str:
    """Kill a remote process and its process group (see remote_invocation: our
    shells lead their own group, so this reaches everything the command spawned)."""
    return (
        f"kill -TERM -{pid} 2>/dev/null; kill -TERM {pid} 2>/dev/null; sleep 1; "
        f"kill -KILL -{pid} 2>/dev/null; kill -KILL {pid} 2>/dev/null; true"
    )


def bg_paths(bg_id: str) -> tuple[str, str, str]:
    base = f"/tmp/mcp-bg-{bg_id}"
    return f"{base}.log", f"{base}.pid", f"{base}.exit"


def build_bg_script(command: str, cwd: str, bg_id: str, token: str, home: str = HOME) -> str:
    """Start `command` detached (own session, immune to hangup), output to a log file."""
    log, pidf, exitf = bg_paths(bg_id)
    # Subshell so an `exit` in the command still records its status.
    runner = shlex.quote('(eval "$1"); echo $? > "$2"')
    return "\n".join(
        [
            f"cd {shlex.quote(cwd)} 2>/dev/null || cd {shlex.quote(home)}",
            f"setsid nohup \"$0\" -c {runner} mcp-bg {shlex.quote(command)} {exitf} "
            f"> {log} 2>&1 < /dev/null &",
            f"echo $! > {pidf}",
            f"printf '%s:bg:%s\\n' {token} \"$!\"",
            "",
        ]
    )


def build_bg_poll_script(bg_id: str, offset: int, token: str) -> str:
    """Report state, then the log from byte `offset` on (state first, so an
    "exited" report always comes with the complete output)."""
    log, pidf, exitf = bg_paths(bg_id)
    return "\n".join(
        [
            f"[ -f {log} ] || {{ printf '%s:missing\\n' {token}; exit 0; }}",
            f"P=$(cat {pidf} 2>/dev/null)",
            'if [ -n "$P" ] && kill -0 "$P" 2>/dev/null; then R=running; else R=exited; fi',
            f"E=$(cat {exitf} 2>/dev/null)",
            f"printf '%s:state:%s:%s:%s\\n' {token} \"$R\" \"$P\" \"$E\"",
            f"tail -c +{offset + 1} {log}",
            "",
        ]
    )


@dataclass
class BgState:
    missing: bool = False
    running: bool = False
    pid: int | None = None
    exit_code: int | None = None
    data: bytes = b""


def parse_bg_poll(raw: bytes, token: str) -> BgState:
    head, sep, rest = raw.partition(b"\n")
    line = head.decode(errors="replace")
    if line == f"{token}:missing":
        return BgState(missing=True)
    prefix = f"{token}:state:"
    if not sep or not line.startswith(prefix):
        raise RemoteError(f"unexpected reply from TV: {raw[:200]!r}")
    state, pid, code = (line[len(prefix) :].split(":") + ["", "", ""])[:3]
    return BgState(
        running=state == "running",
        pid=int(pid) if pid.isdigit() else None,
        exit_code=int(code) if code.lstrip("-").isdigit() else None,
        data=rest,
    )


# ---------------------------------------------------------------- SSH plumbing


@dataclass
class _Bg:
    pid: int
    command: str
    offset: int = 0


@dataclass
class RemoteShell:
    cfg: Config
    control_path: str | None = None  # the tunnel's ControlMaster socket, if any
    cwd: str = HOME
    _bg: dict[str, _Bg] = field(default_factory=dict)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def _argv(self, remote: str) -> list[str]:
        argv = [*self.cfg.ssh_base()]
        if self.control_path:
            # Reuse the tunnel's connection when it is up; ssh falls back to a
            # fresh connection when the socket is missing.
            argv += ["-o", "ControlMaster=no", "-o", f"ControlPath={self.control_path}"]
        return [*argv, self.cfg.host, remote]

    async def _spawn(self, script: str) -> asyncio.subprocess.Process:
        return await asyncio.create_subprocess_exec(
            *self._argv(remote_invocation(script)),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

    async def _exec(self, script: str, timeout: float = 30) -> tuple[bytes, str, int]:
        proc = await self._spawn(script)
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout)
        except TimeoutError:
            proc.kill()
            await proc.wait()
            raise RemoteError(f"TV unreachable: ssh to {self.cfg.host} timed out")
        return out, filter_ssh_stderr(err.decode(errors="replace")), proc.returncode or 0

    async def screenshot(self, width: int, height: int) -> bytes:
        """JPEG of what's on screen (apps and HDMI video), via webOS's capture service."""
        path = f"/tmp/mcp-shot-{secrets.token_hex(4)}.jpg"
        payload = json.dumps({"path": path, "method": "DISPLAY", "format": "JPG", "width": width, "height": height})
        script = "\n".join(
            [
                "cd /tmp",
                f"r=$(/home/root/tvctl.sh luna://com.webos.service.capture/executeOneShot {shlex.quote(payload)})",
                'case "$r" in *\'"returnValue":true\'*) ;; *) echo "$r" >&2; exit 1;; esac',
                f"cat {path}; rc=$?; rm -f {path}; exit $rc",
            ]
        )
        out, err, code = await self._exec(script, timeout=20)
        if code == 255 and not out:
            raise self._unreachable(err)
        if code != 0 or not out:
            raise RemoteError(f"screen capture failed: {err or f'exit code {code}'}")
        return out

    def _unreachable(self, stderr: str) -> RemoteError:
        detail = f": {stderr}" if stderr else ""
        return RemoteError(f"TV unreachable: could not ssh to {self.cfg.host}{detail}")

    async def run(
        self, command: str, timeout_ms: int = DEFAULT_TIMEOUT_MS, on_progress: OnProgress | None = None
    ) -> tuple[str, bool]:
        """Run in the foreground. Returns (text, is_error). `on_progress(elapsed_s, last_line)` is called every
        few seconds while the command runs."""
        async with self._lock:  # cwd is shared state; keep calls ordered
            return await self._run(command, timeout_ms, on_progress)

    async def _stop(
        self, proc: asyncio.subprocess.Process, tasks: list[asyncio.Task[Any]], pid: int | None
    ) -> None:
        """Kill the local ssh and the remote command's process group."""
        proc.kill()
        for task in tasks:
            task.cancel()
        await proc.wait()
        if pid:
            try:
                await self._exec(kill_script(pid), timeout=15)
            except RemoteError:
                pass

    async def _run(self, command: str, timeout_ms: int, on_progress: OnProgress | None) -> tuple[str, bool]:
        token = new_token()
        proc = await self._spawn(build_script(command, self.cwd, token))
        buf = bytearray()

        async def pump() -> None:
            assert proc.stdout
            while chunk := await proc.stdout.read(65536):
                buf.extend(chunk)

        reader = asyncio.create_task(pump())
        errs = asyncio.create_task(proc.stderr.read()) if proc.stderr else None
        tasks = [t for t in (reader, errs) if t]
        loop = asyncio.get_running_loop()
        started = loop.time()
        deadline = started + timeout_ms / 1000
        timed_out = False
        try:
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    raise TimeoutError
                try:
                    await asyncio.wait_for(asyncio.shield(reader), min(remaining, PROGRESS_EVERY_S))
                    break
                except TimeoutError:
                    if loop.time() >= deadline:
                        raise
                    if on_progress:
                        output = parse_output(buf.decode(errors="replace"), token).output
                        await on_progress(loop.time() - started, last_line(output))
            await proc.wait()
        except TimeoutError:
            timed_out = True
        except asyncio.CancelledError:
            # The client stopped the call: don't leave the command running on the TV.
            pid = parse_output(buf.decode(errors="replace"), token).pid
            await asyncio.shield(self._stop(proc, tasks, pid))
            raise
        stderr = filter_ssh_stderr((await errs).decode(errors="replace")) if errs and not timed_out else ""
        parsed = parse_output(buf.decode(errors="replace"), token)

        if timed_out:
            await self._stop(proc, tasks, parsed.pid)
            out = truncate(parsed.output.rstrip("\n"))
            secs = timeout_ms / 1000
            msg = f"Command timed out after {secs:g}s and was killed."
            return (f"{msg}\n{out}" if out else msg), True

        if parsed.cwd:
            self.cwd = parsed.cwd
        out = parsed.output
        code = parsed.exit_code
        if code is None:
            # No end marker: the command called `exit`, or ssh itself failed.
            if parsed.pid is None and proc.returncode == 255:
                raise self._unreachable(stderr)
            code = proc.returncode or 0
        if stderr:
            out = f"{out}\n{stderr}" if out else stderr
        out = truncate(out.rstrip("\n"))
        if code != 0:
            return (f"{out}\nExit code {code}" if out else f"Exit code {code}"), True
        return out, False

    async def start_background(self, command: str) -> str:
        bg_id = secrets.token_hex(4)
        token = new_token()
        out, err, rc = await self._exec(build_bg_script(command, self.cwd, bg_id, token))
        m = re.search(rf"{re.escape(token)}:bg:(\d+)", out.decode(errors="replace"))
        if not m:
            if rc == 255:
                raise self._unreachable(err)
            raise RemoteError(f"failed to start background command: {out.decode(errors='replace')}{err}")
        pid = int(m.group(1))
        self._bg[bg_id] = _Bg(pid=pid, command=command)
        log = bg_paths(bg_id)[0]
        return (
            f"Started in background on the TV.\nid: {bg_id}\npid: {pid}\nlog: {log}\n"
            f"Use read_background_output(id=\"{bg_id}\") to read its output and exit status."
        )

    async def read_background(self, bg_id: str) -> str:
        if not re.fullmatch(r"[0-9a-f]{8}", bg_id):
            raise RemoteError(f"invalid background id {bg_id!r}")
        job = self._bg.get(bg_id)
        offset = job.offset if job else 0
        token = new_token()
        out, err, rc = await self._exec(build_bg_poll_script(bg_id, offset, token))
        if rc == 255 and not out:
            raise self._unreachable(err)
        st = parse_bg_poll(out, token)
        if st.missing:
            raise RemoteError(f"no background command with id {bg_id} (log file is gone)")
        if job:
            job.offset += len(st.data)
        else:
            self._bg[bg_id] = _Bg(pid=st.pid or 0, command="?", offset=len(st.data))
        if st.running:
            status = f"Status: running (pid {st.pid})"
        elif st.exit_code is not None:
            status = f"Status: exited with code {st.exit_code}"
        else:
            status = "Status: exited (killed; no exit code recorded)"
        text = st.data.decode(errors="replace")
        body = truncate(text.rstrip("\n")) if text else "(no new output)"
        return f"{status}\n{body}"

    async def stop_background(self, bg_id: str) -> str:
        if not re.fullmatch(r"[0-9a-f]{8}", bg_id):
            raise RemoteError(f"invalid background id {bg_id!r}")
        _, pidf, _ = bg_paths(bg_id)
        token = new_token()
        script = (
            f"P=$(cat {pidf} 2>/dev/null); [ -n \"$P\" ] || {{ echo {token}:missing; exit 0; }}\n"
            f"kill -0 \"$P\" 2>/dev/null || {{ echo {token}:done; exit 0; }}\n"
            f"{kill_script('$P')}\n"
            f"echo {token}:killed\n"
        )
        out, err, rc = await self._exec(script)
        text = out.decode(errors="replace")
        if f"{token}:missing" in text:
            raise RemoteError(f"no background command with id {bg_id}")
        if f"{token}:done" in text:
            return f"Background command {bg_id} had already exited."
        if f"{token}:killed" in text:
            return f"Stopped background command {bg_id}."
        if rc == 255:
            raise self._unreachable(err)
        raise RemoteError(f"unexpected reply from TV: {text}{err}")
