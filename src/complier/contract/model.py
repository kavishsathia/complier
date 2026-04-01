"""Compiled contract model."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class Contract:
    """Runtime-ready contract compiled from the authored spec."""

    name: str
    workflows: dict[str, Any] = field(default_factory=dict)
    guarantees: dict[str, Any] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_source(cls, source: str) -> "Contract":
        """Parse and compile an authored contract source string."""
        raise NotImplementedError

    @classmethod
    def load(cls, path: str) -> "Contract":
        """Load a contract from disk and compile it."""
        raise NotImplementedError
