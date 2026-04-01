"""Persistence adapter for memory."""

from __future__ import annotations

from dataclasses import dataclass

from .model import Memory


@dataclass(slots=True)
class MemoryStore:
    """Loads and saves memory from a storage backend."""

    def load(self, path: str) -> Memory:
        """Load memory from the given location."""
        raise NotImplementedError

    def save(self, memory: Memory, path: str) -> None:
        """Save memory to the given location."""
        raise NotImplementedError
