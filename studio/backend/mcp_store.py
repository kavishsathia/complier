"""MCP server configuration persistence."""

from __future__ import annotations

import json
from pathlib import Path


DEFAULT_PATH = Path.home() / ".complier-studio" / "mcp-servers.json"


class MCPConfigStore:
    def __init__(self, path: Path = DEFAULT_PATH) -> None:
        self._path = path
        self._path.parent.mkdir(parents=True, exist_ok=True)
        if not self._path.exists():
            self._path.write_text("[]")

    def _read(self) -> list[dict]:
        try:
            return json.loads(self._path.read_text())
        except Exception:
            return []

    def _write(self, configs: list[dict]) -> None:
        self._path.write_text(json.dumps(configs, indent=2))

    def list(self) -> list[dict]:
        return self._read()

    def save(self, config: dict) -> None:
        configs = self._read()
        for i, c in enumerate(configs):
            if c.get("id") == config.get("id"):
                configs[i] = config
                self._write(configs)
                return
        configs.append(config)
        self._write(configs)

    def delete(self, config_id: str) -> None:
        configs = [c for c in self._read() if c.get("id") != config_id]
        self._write(configs)
