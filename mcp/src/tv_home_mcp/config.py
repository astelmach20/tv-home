"""Settings read from the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

# mcp/openapi.json: the last spec fetched from the TV, committed so the tool
# list stays stable when the TV is off.
SPEC_PATH = Path(__file__).resolve().parents[2] / "openapi.json"


@dataclass(frozen=True)
class Config:
    # Placeholder: set TVHOME_TV_HOST to your TV's SSH destination (e.g. root@<the TV's IP>).
    host: str = "root@lgtv.lan"
    ssh_key: str = "~/.ssh/id_ed25519"
    remote_port: int = 8765
    spec_path: Path = field(default=SPEC_PATH)

    @classmethod
    def from_env(cls) -> Config:
        return cls(
            host=os.environ.get("TVHOME_TV_HOST") or cls.host,
            ssh_key=os.environ.get("TVHOME_SSH_KEY") or cls.ssh_key,
            remote_port=int(os.environ.get("TVHOME_REMOTE_PORT") or cls.remote_port),
        )

    def ssh_base(self) -> list[str]:
        """ssh argv up to (not including) the destination options."""
        return [
            "ssh",
            "-i",
            os.path.expanduser(self.ssh_key),
            "-o", "IdentitiesOnly=yes",
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=8",
            "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=3",
            # Hides the "post-quantum key exchange" warnings the TV's sshd triggers.
            "-o", "LogLevel=ERROR",
        ]
