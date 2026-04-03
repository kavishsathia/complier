"""Helpers for wrapping remote HTTP MCP servers."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

from complier.session.session import Session


@dataclass(slots=True)
class RemoteMCPDetails:
    """Launch and connection details for a wrapped remote HTTP MCP server."""

    namespace: str
    url: str
    command: list[str]
    env: dict[str, str] | None = None


def wrap_remote_mcp(
    session: Session,
    namespace: str,
    url: str,
    *,
    host: str = "127.0.0.1",
    port: int = 8766,
) -> RemoteMCPDetails:
    """Return launch details for a namespaced remote HTTP MCP wrapper."""
    from .local_mcp import _normalize_namespace

    normalized_namespace = _normalize_namespace(namespace)
    server_details = session.server.to_dict()
    wrapper_command = [
        sys.executable,
        "-m",
        "complier.wrappers.remote_http_proxy",
        "--namespace",
        normalized_namespace,
        "--session-host",
        str(server_details["host"]),
        "--session-port",
        str(server_details["port"]),
        "--downstream-url",
        url,
        "--host",
        host,
        "--port",
        str(port),
    ]
    src_path = Path(__file__).resolve().parents[3] / "src"
    return RemoteMCPDetails(
        namespace=normalized_namespace,
        url=f"http://{host}:{port}/mcp",
        command=wrapper_command,
        env={"PYTHONPATH": str(src_path)},
    )
