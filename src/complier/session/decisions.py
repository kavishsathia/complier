"""Decision objects returned during runtime enforcement."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class Remediation:
    """Guidance returned when a call is blocked or needs correction."""

    message: str
    allowed_next_actions: list[str] = field(default_factory=list)
    missing_requirements: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "message": self.message,
            "allowed_next_actions": list(self.allowed_next_actions),
            "missing_requirements": list(self.missing_requirements),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Remediation":
        return cls(
            message=str(data["message"]),
            allowed_next_actions=[str(item) for item in data.get("allowed_next_actions", [])],
            missing_requirements=[str(item) for item in data.get("missing_requirements", [])],
        )


@dataclass(slots=True)
class Decision:
    """Result of evaluating whether a runtime action complies."""

    allowed: bool
    reason: str | None = None
    remediation: Remediation | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "remediation": None if self.remediation is None else self.remediation.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Decision":
        remediation = data.get("remediation")
        return cls(
            allowed=bool(data["allowed"]),
            reason=data.get("reason"),
            remediation=None if remediation is None else Remediation.from_dict(remediation),
        )


@dataclass(slots=True)
class BlockedToolResponse:
    """Structured response returned to an agent when a tool call is blocked."""

    tool_name: str
    allowed: bool = False
    reason: str | None = None
    remediation: Remediation | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "tool_name": self.tool_name,
            "allowed": self.allowed,
            "reason": self.reason,
            "remediation": None if self.remediation is None else self.remediation.to_dict(),
        }
