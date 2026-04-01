"""Per-run execution state."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class SessionState:
    """Mutable runtime state for a single execution session."""

    active_workflow: str | None = None
    active_step: str | None = None
    completed_steps: list[str] = field(default_factory=list)
    branches: dict[str, str] = field(default_factory=dict)
    history: list[Any] = field(default_factory=list)
