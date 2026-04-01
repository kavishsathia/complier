"""Compiler from parsed contract specs to runtime contract objects."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .model import Contract


@dataclass(slots=True)
class ContractCompiler:
    """Compiles parsed contract data into a runtime-ready contract."""

    def compile(self, parsed: Any) -> Contract:
        """Build the runtime contract from a parsed representation."""
        raise NotImplementedError
