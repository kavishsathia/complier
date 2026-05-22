"""Helpers for constructing agent-facing remediation messages."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class StructuredMessage:
    """Structured guidance returned to an agent after a blocked action."""

    summary: str
    details: list[str] = field(default_factory=list)
    allowed_next_actions: list[str] = field(default_factory=list)
