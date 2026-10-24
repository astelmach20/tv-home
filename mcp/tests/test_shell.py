"""Unit tests for run_command's pure helpers. The wrapped scripts are also run
with a local sh to check that the markers round-trip through a real shell."""

import subprocess

import pytest

from tv_home_mcp.server import mcp_names, tool_name
from tv_home_mcp.shell import (
    MAX_OUTPUT_CHARS,
    build_bg_poll_script,
    build_script,
    filter_ssh_stderr,
    parse_bg_poll,
    parse_output,
    remote_invocation,
    truncate,
)

TOKEN = "__TVMCP_0123456789abcdef"


def run_local(command: str, cwd: str, home: str) -> str:
    """Run the wrapped script the way the TV would (via remote_invocation under sh)."""
    script = build_script(command, cwd, TOKEN, home=home)
    return subprocess.run(
        ["sh", "-c", remote_invocation(script)], capture_output=True, text=True, timeout=10
    ).stdout


def test_parse_simple():
    raw = f"{TOKEN}:pid:42\nhello\n\n{TOKEN}:end:0:/home/root\n"
    p = parse_output(raw, TOKEN)
    assert (p.output, p.exit_code, p.cwd, p.pid) == ("hello\n", 0, "/home/root", 42)


def test_parse_missing_end_marker():
    p = parse_output(f"{TOKEN}:pid:7\npartial", TOKEN)
    assert (p.output, p.exit_code, p.cwd, p.pid) == ("partial", None, None, 7)


def test_parse_cwd_with_colons_and_spaces():
    p = parse_output(f"{TOKEN}:pid:1\n\n{TOKEN}:end:3:/tmp/a b:c\n", TOKEN)
    assert (p.output, p.exit_code, p.cwd) == ("", 3, "/tmp/a b:c")


def test_parse_ignores_other_tokens():
    other = "__TVMCP_ffffffffffffffff"
    raw = f"{TOKEN}:pid:1\n{other}:end:9:/x\n\n{TOKEN}:end:0:/y\n"
    p = parse_output(raw, TOKEN)
    assert p.output == f"{other}:end:9:/x\n"
    assert (p.exit_code, p.cwd) == (0, "/y")


def test_script_roundtrip_cd_and_exit_code(tmp_path):
    sub = tmp_path / "sub dir"
    sub.mkdir()
    p = parse_output(run_local(f"cd '{sub}' && echo moved", str(tmp_path), str(tmp_path)), TOKEN)
    assert p.output == "moved\n"
    assert p.exit_code == 0
    assert p.cwd == str(sub.resolve()) or p.cwd == str(sub)
    assert p.pid and p.pid > 0

    p = parse_output(run_local("pwd; false", str(sub), str(tmp_path)), TOKEN)
    assert p.output.strip() in (str(sub), str(sub.resolve()))
    assert p.exit_code == 1


def test_script_interleaves_stderr(tmp_path):
    p = parse_output(run_local("echo a; echo b >&2; echo c", str(tmp_path), str(tmp_path)), TOKEN)
    assert p.output == "a\nb\nc\n"


def test_script_quoting(tmp_path):
    cmd = """printf '%s\\n' "it's" '$HOME' "a\\"b"; echo $((2+3))"""
    p = parse_output(run_local(cmd, str(tmp_path), str(tmp_path)), TOKEN)
    assert p.output == "it's\n$HOME\na\"b\n5\n"


def test_script_missing_cwd_falls_back_to_home(tmp_path):
    p = parse_output(run_local("pwd", str(tmp_path / "gone"), str(tmp_path)), TOKEN)
    assert "no longer exists" in p.output
    assert p.cwd in (str(tmp_path), str(tmp_path.resolve()))


def test_script_exit_skips_end_marker(tmp_path):
    p = parse_output(run_local("echo x; exit 5", str(tmp_path), str(tmp_path)), TOKEN)
    assert p.output == "x\n"
    assert p.exit_code is None  # caller falls back to ssh's exit status


def test_truncate_short_untouched():
    assert truncate("abc") == "abc"
    s = "x" * MAX_OUTPUT_CHARS
    assert truncate(s) == s


def test_truncate_keeps_head_and_tail():
    s = "H" * 20_000 + "M" * 10_000 + "T" * 20_000
    out = truncate(s)
    assert out.startswith("H" * 15_000)
    assert out.endswith("T" * 15_000)
    assert "20000 characters omitted" in out
    assert len(out) < MAX_OUTPUT_CHARS + 100


def test_filter_ssh_stderr():
    err = (
        "** WARNING: connection is not using a post-quantum key exchange algorithm.\n"
        "** This session may be vulnerable to \"store now, decrypt later\" attacks.\n"
        "** The server may need to be upgraded. See https://openssh.com/pq.html\n"
        "Connection refused\n"
    )
    assert filter_ssh_stderr(err) == "Connection refused"


@pytest.mark.parametrize(
    ("raw", "running", "pid", "code", "data"),
    [
        (f"{TOKEN}:state:running:12:\nabc".encode(), True, 12, None, b"abc"),
        (f"{TOKEN}:state:exited:12:3\n".encode(), False, 12, 3, b""),
        (f"{TOKEN}:state:exited:12:\nlast\n".encode(), False, 12, None, b"last\n"),
    ],
)
def test_parse_bg_poll(raw, running, pid, code, data):
    st = parse_bg_poll(raw, TOKEN)
    assert (st.running, st.pid, st.exit_code, st.data) == (running, pid, code, data)


def test_parse_bg_poll_missing():
    assert parse_bg_poll(f"{TOKEN}:missing\n".encode(), TOKEN).missing


def test_bg_poll_script_offset():
    assert "tail -c +101 /tmp/mcp-bg-abcd0123.log" in build_bg_poll_script("abcd0123", 100, TOKEN)


def test_tool_names():
    assert tool_name("listApps") == "list_apps"
    assert tool_name("getWeather") == "get_weather"
    assert tool_name("sendLauncherCommand") == "send_launcher_command"
    assert tool_name("launch") == "launch_app"
    spec = {"paths": {"/a": {"get": {"operationId": "getStatus"}, "parameters": []}}}
    assert mcp_names(spec) == {"getStatus": "get_status"}
