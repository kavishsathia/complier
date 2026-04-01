"""Compiled contract model."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from complier.memory.model import Memory


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
        from .compiler import ContractCompiler
        from .parser import ContractParser
        from .validation import ContractValidator

        parser = ContractParser()
        compiler = ContractCompiler()
        validator = ContractValidator()

        parsed = parser.parse(source)
        contract = compiler.compile(parsed)
        validator.validate(contract)
        return contract

    @classmethod
    def from_file(cls, path: str | Path) -> "Contract":
        """Load a contract from disk and compile it."""
        source_path = Path(path)
        source = source_path.read_text(encoding="utf-8")
        contract = cls.from_source(source)
        contract.metadata.setdefault("source_path", str(source_path))
        return contract

    @classmethod
    def load(cls, path: str | Path) -> "Contract":
        """Backward-compatible alias for loading a contract from disk."""
        return cls.from_file(path)

    def create_session(self, memory: Memory | None = None) -> "Session":
        """Create a stateful session for this contract and optional memory."""
        from complier.session.session import Session

        return Session(contract=self, memory=memory)
