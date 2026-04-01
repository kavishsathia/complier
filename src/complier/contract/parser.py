"""Parser entry points for authored contract specs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class ContractParser:
    """Parses source text into an intermediate contract representation."""

    def parse(self, source: str) -> dict[str, Any]:
        """Return a parsed representation of the source contract."""
        if not isinstance(source, str):
            raise TypeError("Contract source must be a string.")

        return {
            "source": source,
        }
