"""Memory model for learned checks."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(slots=True)
class Memory:
    """Persistent learned knowledge across sessions."""

    checks: dict[str, str] = field(default_factory=dict)

    @classmethod
    def empty(cls) -> "Memory":
        """Return an empty memory object."""
        return cls()

    @classmethod
    def from_source(cls, source: str) -> "Memory":
        """Load memory from a JSON source string."""
        if not isinstance(source, str):
            raise TypeError("Memory source must be a string.")
        if not source.strip():
            return cls.empty()

        payload = json.loads(source)
        cls._validate_payload(payload)
        return cls(checks=dict(payload.get("checks", {})))

    @classmethod
    def from_file(cls, path: str | Path) -> "Memory":
        """Load memory from disk."""
        source_path = Path(path)
        source = source_path.read_text(encoding="utf-8")
        return cls.from_source(source)

    @classmethod
    def load(cls, path: str | Path) -> "Memory":
        """Backward-compatible alias for loading memory from disk."""
        return cls.from_file(path)

    def get_check(self, name: str) -> str:
        """Return the stored learned state for a named check."""
        return self.checks.get(name, "")

    def update_check(self, name: str, value: str) -> None:
        """Persist updated learned state for a named check."""
        self.checks[name] = value

    def to_dict(self) -> dict[str, dict[str, str]]:
        """Return the serialized memory payload."""
        return {"checks": dict(self.checks)}

    def to_json(self) -> str:
        """Return the serialized memory as JSON."""
        return json.dumps(self.to_dict(), indent=2, sort_keys=True)

    def save(self, path: str | Path) -> None:
        """Persist memory to disk."""
        target_path = Path(path)
        target_path.write_text(f"{self.to_json()}\n", encoding="utf-8")

    @staticmethod
    def _validate_payload(payload: object) -> None:
        if not isinstance(payload, dict):
            raise ValueError("Memory payload must be a JSON object.")

        checks = payload.get("checks", {})
        if not isinstance(checks, dict):
            raise ValueError("Memory 'checks' field must be an object.")

        for name, value in checks.items():
            if not isinstance(name, str):
                raise ValueError("Memory check names must be strings.")
            if not isinstance(value, str):
                raise ValueError("Memory check values must be strings.")
