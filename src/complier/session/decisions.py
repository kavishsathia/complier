"""Decision objects returned during runtime enforcement."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class Remediation:
    """Guidance returned when a call is blocked or needs correction."""

    message: str
    allowed_next_actions: list[str] = field(default_factory=list)
    missing_requirements: list[str] = field(default_factory=list)


@dataclass(slots=True)
class Decision:
    """Result of evaluating whether a runtime action complies."""

    allowed: bool
    reason: str | None = None
    remediation: Remediation | None = None


@dataclass(slots=True)
class BlockedToolResponse:
    """Structured response returned to an agent when a tool call is blocked."""

    tool_name: str
    allowed: bool = False
    reason: str | None = None
    remediation: Remediation | None = None
