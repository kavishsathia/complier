"""Per-run execution state."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class SessionState:
    """Mutable runtime state for a single execution session."""

    active_workflow: str | None = None
    active_step: str | None = None
    terminated: bool = False
    completed_steps: list[str] = field(default_factory=list)
    branches: dict[str, str] = field(default_factory=dict)
    retry_counts: dict[str, int] = field(default_factory=dict)
    history: list[Any] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "active_workflow": self.active_workflow,
            "active_step": self.active_step,
            "terminated": self.terminated,
            "completed_steps": list(self.completed_steps),
            "branches": dict(self.branches),
            "retry_counts": dict(self.retry_counts),
            "history": list(self.history),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "SessionState":
        return cls(
            active_workflow=data.get("active_workflow"),
            active_step=data.get("active_step"),
            terminated=bool(data.get("terminated", False)),
            completed_steps=[str(item) for item in data.get("completed_steps", [])],
            branches={str(key): str(value) for key, value in data.get("branches", {}).items()},
            retry_counts={str(key): int(value) for key, value in data.get("retry_counts", {}).items()},
            history=list(data.get("history", [])),
        )
