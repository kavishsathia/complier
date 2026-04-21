"""Persistence adapter for memory."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .model import Memory


@dataclass(slots=True)
class MemoryStore:
    """Loads and saves memory from a storage backend."""

    def load(self, path: str | Path) -> Memory:
        """Load memory from the given location."""
        return Memory.from_file(path)

    def save(self, memory: Memory, path: str | Path) -> None:
        """Save memory to the given location."""
        memory.save(path)
