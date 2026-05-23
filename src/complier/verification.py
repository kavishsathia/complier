"""Verifier abstraction for resolving contract checks at runtime."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class Verifier:
    """Base interface for structured verification backends."""

    def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, Any]:
        """Return structured data matching the requested output schema."""
        raise NotImplementedError
