"""MCP wrappers for contract-aware tool execution."""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from complier.session.session import Session


@dataclass(slots=True)
class LocalMCPDetails:
    """Launch details for a wrapped local stdio MCP server."""

    namespace: str
    command: list[str]
    env: dict[str, str] | None = None


def wrap_local_mcp(session: Session, namespace: str, command: str | Sequence[str]) -> LocalMCPDetails:
    """Return launch details for a namespaced local stdio MCP wrapper."""
    normalized_namespace = _normalize_namespace(namespace)
    downstream_command = _coerce_command(command)
    server_details = session.server.to_dict()
    wrapper_command = [
        sys.executable,
        "-m",
        "complier.wrappers.local_stdio_proxy",
        "--namespace",
        normalized_namespace,
        "--session-host",
        str(server_details["host"]),
        "--session-port",
        str(server_details["port"]),
        "--",
        *downstream_command,
    ]
    src_path = Path(__file__).resolve().parents[3] / "src"
    return LocalMCPDetails(
        namespace=normalized_namespace,
        command=wrapper_command,
        env={"PYTHONPATH": str(src_path)},
    )


def _coerce_command(command: str | Sequence[str]) -> list[str]:
    if isinstance(command, str):
        command = command.strip()
        if not command:
            raise ValueError("Local MCP command cannot be empty.")
        return [command]

    parts = [part for part in command if str(part).strip()]
    if not parts:
        raise ValueError("Local MCP command cannot be empty.")
    return [str(part) for part in parts]


def _normalize_namespace(namespace: str) -> str:
    normalized = _normalize_machine_name(namespace)
    if not normalized:
        raise ValueError("Namespace must contain at least one letter or digit.")
    return normalized


def normalize_tool_name(namespace: str, tool_name: str) -> str:
    """Return the wrapper-exposed tool name for a downstream MCP tool."""
    normalized_tool_name = _normalize_machine_name(tool_name)
    if not normalized_tool_name:
        raise ValueError("Tool name must contain at least one letter or digit.")
    return f"{_normalize_namespace(namespace)}.{normalized_tool_name}"


def _normalize_machine_name(value: str) -> str:
    lowered = value.strip().lower()
    lowered = lowered.replace("'", "")
    lowered = re.sub(r"[^a-z0-9._/-]+", "_", lowered)
    lowered = re.sub(r"_+", "_", lowered)
    return lowered.strip("._/-")
