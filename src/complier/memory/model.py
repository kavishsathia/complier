"""Memory model for learned checks and workflow fragments."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class Memory:
    """Persistent learned knowledge across sessions."""

    checks: dict[str, Any] = field(default_factory=dict)
    workflows: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def empty(cls) -> "Memory":
        """Return an empty memory object."""
        return cls()

    @classmethod
    def load(cls, path: str) -> "Memory":
        """Load memory from disk."""
        raise NotImplementedError

    def save(self, path: str) -> None:
        """Persist memory to disk."""
        raise NotImplementedError
