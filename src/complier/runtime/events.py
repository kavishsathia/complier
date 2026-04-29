"""Structured runtime events recorded during a session."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class RuntimeEvent:
    """Base class for structured session events."""

    name: str
    payload: dict[str, Any]
