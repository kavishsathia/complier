"""Async-safe context for the active session."""

from __future__ import annotations

from contextlib import asynccontextmanager
from contextvars import ContextVar, Token
from typing import TYPE_CHECKING, AsyncIterator

if TYPE_CHECKING:
    from .session import Session


_CURRENT_SESSION: ContextVar["Session | None"] = ContextVar("complier_current_session", default=None)


def get_current_session() -> "Session | None":
    """Return the active session for the current async context."""
    return _CURRENT_SESSION.get()


def set_current_session(session: "Session") -> Token["Session | None"]:
    """Set the active session for the current async context."""
    return _CURRENT_SESSION.set(session)


def reset_current_session(token: Token["Session | None"]) -> None:
    """Reset the active session using a previously returned token."""
    _CURRENT_SESSION.reset(token)


@asynccontextmanager
async def activate_session(session: "Session") -> AsyncIterator["Session"]:
    """Activate a session for the duration of an async context."""
    token = set_current_session(session)
    try:
        yield session
    finally:
        reset_current_session(token)
