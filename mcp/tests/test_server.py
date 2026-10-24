"""The server built from the saved spec, offline: which tools, resources and prompts it publishes and how
they're annotated. The tunnel only starts in the lifespan and isn't started here."""

import json

import pytest

from tv_home_mcp.config import Config
from tv_home_mcp.server import build_server
from tv_home_mcp.tunnel import Tunnel


@pytest.fixture
def server():
    cfg = Config.from_env()
    return build_server(cfg, Tunnel(cfg), json.loads(cfg.spec_path.read_text()))


async def test_tools_and_annotations(server):
    tools = {t.name: t for t in await server.list_tools()}
    assert {"get_status", "list_devices", "get_device", "get_logs", "launch_app", "run_command", "screenshot"} <= set(
        tools
    )
    assert "get_sonos" not in tools and "list_inputs" not in tools

    assert tools["get_status"].annotations.read_only_hint is True
    assert tools["launch_app"].annotations.read_only_hint is False
    assert tools["launch_app"].annotations.idempotent_hint is True
    assert tools["run_command"].annotations.destructive_hint is True
    assert tools["stop_background_command"].annotations.open_world_hint is False

    always = {name for name, t in tools.items() if (t.meta or {}).get("anthropic/alwaysLoad")}
    assert always == {"get_status", "list_devices", "run_command"}


async def test_protocol_listing():
    cfg = Config.from_env()
    mcp = build_server(cfg, Tunnel(cfg), json.loads(cfg.spec_path.read_text()))
    # Client(mcp) would run the lifespan (and start the tunnel), so list through the server object.
    resources = [str(r.uri) for r in await mcp.list_resources()]
    templates = [t.uri_template for t in await mcp.list_resource_templates()]
    prompts = [p.name for p in await mcp.list_prompts()]
    assert sorted(resources) == ["tv://devices", "tv://status"]
    assert templates == ["tv://logs/{service}"]
    assert prompts == ["diagnose"]


async def test_diagnose_prompt_includes_problem(server):
    result = await server.render_prompt("diagnose", {"problem": "Spotify stopped"})
    text = result.messages[0].content.text
    assert "Spotify stopped" in text and "get_logs" in text
