"""Integration abstraction for external verification processes."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class Integration:
    """Base interface for structured verification integrations."""

    def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, Any]:
        """Return structured data matching the requested output schema."""
        raise NotImplementedError
