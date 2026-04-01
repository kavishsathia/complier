"""Errors raised when a tool call is blocked by the contract."""

from __future__ import annotations

from dataclasses import dataclass

from complier.session.decisions import Decision


@dataclass(slots=True)
class BlockedToolCall(Exception):
    """Raised when a tool call is blocked by contract enforcement."""

    tool_name: str
    decision: Decision

    def __str__(self) -> str:
        return f"Tool '{self.tool_name}' was blocked by the active contract."
