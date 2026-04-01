"""MCP wrappers for contract-aware tool execution."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from complier.session.session import Session


@dataclass(slots=True)
class MCPWrapper:
    """Wraps an MCP client/server boundary for session-aware enforcement."""

    session: Session

    def wrap_client(self, client: Any) -> Any:
        """Return a client proxy bound to the current session."""
        raise NotImplementedError

    def wrap_server(self, server: Any) -> Any:
        """Return a server proxy bound to the current session."""
        raise NotImplementedError
