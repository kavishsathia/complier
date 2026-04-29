"""Validation for parsed and compiled contracts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class ContractValidator:
    """Validates contract structure before runtime use."""

    def validate(self, contract: Any) -> None:
        """Raise if the contract is invalid."""
        if contract is None:
            raise ValueError("Contract cannot be None.")
