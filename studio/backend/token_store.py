"""File-based token storage for MCP OAuth tokens."""

from __future__ import annotations

import json
from pathlib import Path

from mcp.shared.auth import OAuthClientInformationFull, OAuthToken


DEFAULT_DIR = Path.home() / ".complier-studio" / "tokens"


class FileTokenStorage:
    """Persists OAuth tokens and client info as JSON files per MCP server."""

    def __init__(self, server_id: str, directory: Path = DEFAULT_DIR) -> None:
        self._dir = directory
        self._dir.mkdir(parents=True, exist_ok=True)
        safe_id = "".join(c if c.isalnum() or c in "-_" else "_" for c in server_id)
        self._token_path = self._dir / f"{safe_id}_tokens.json"
        self._client_path = self._dir / f"{safe_id}_client.json"

    async def get_tokens(self) -> OAuthToken | None:
        if not self._token_path.exists():
            return None
        try:
            data = json.loads(self._token_path.read_text())
            return OAuthToken.model_validate(data)
        except Exception:
            return None

    async def set_tokens(self, tokens: OAuthToken) -> None:
        self._token_path.write_text(tokens.model_dump_json(indent=2))

    async def get_client_info(self) -> OAuthClientInformationFull | None:
        if not self._client_path.exists():
            return None
        try:
            data = json.loads(self._client_path.read_text())
            return OAuthClientInformationFull.model_validate(data)
        except Exception:
            return None

    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None:
        self._client_path.write_text(client_info.model_dump_json(indent=2))

    def clear(self) -> None:
        """Remove stored tokens and client info."""
        if self._token_path.exists():
            self._token_path.unlink()
        if self._client_path.exists():
            self._client_path.unlink()
