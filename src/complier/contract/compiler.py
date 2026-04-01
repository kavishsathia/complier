"""Compiler from parsed contract specs to runtime contract objects."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .model import Contract
from .parser import ParsedContract


@dataclass(slots=True)
class ContractCompiler:
    """Compiles parsed contract data into a runtime-ready contract."""

    def compile(self, parsed: Any) -> Contract:
        """Build the runtime contract from a parsed representation."""
        if not isinstance(parsed, ParsedContract):
            raise TypeError("Parsed contract must be a ParsedContract instance.")

        return Contract(
            name="anonymous",
            metadata={
                "source": parsed.source,
                "parse_tree": parsed.tree,
            },
        )
