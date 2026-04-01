"""Function wrappers for contract-aware tool execution."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from complier.session.session import Session


@dataclass(slots=True)
class FunctionWrapper:
    """Wraps a Python callable for session-aware enforcement."""

    session: Session

    def wrap(self, func: Callable[..., Any]) -> Callable[..., Any]:
        """Return a wrapped function bound to the current session."""
        raise NotImplementedError


def wrap_function(session: Session, func: Callable[..., Any]) -> Callable[..., Any]:
    """Convenience helper for wrapping a callable with a session."""
    raise NotImplementedError
