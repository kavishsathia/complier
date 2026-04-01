"""Function wrappers for contract-aware tool execution."""

from __future__ import annotations

from dataclasses import dataclass
from functools import wraps
from inspect import iscoroutinefunction
from typing import Any, Callable

from complier.session.decisions import BlockedToolResponse
from complier.session.session import Session


@dataclass(slots=True)
class FunctionWrapper:
    """Wraps a Python callable for session-aware enforcement."""

    session: Session

    @staticmethod
    def _attach_metadata(
        wrapped: Callable[..., Any],
        original: Callable[..., Any],
        session: Session,
    ) -> Callable[..., Any]:
        wrapped.__complier_session__ = session
        wrapped.__complier_original__ = original
        wrapped.__complier_tool_name__ = original.__name__
        return wrapped

    def wrap(self, func: Callable[..., Any]) -> Callable[..., Any]:
        """Return a wrapped function bound to the current session."""
        if iscoroutinefunction(func):
            return self._wrap_async(func)

        return self._wrap_sync(func)

    def _wrap_sync(self, func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        def wrapped(*args: Any, **kwargs: Any) -> Any:
            decision = self.session.check_tool_call(func.__name__, args, kwargs)
            if not decision.allowed:
                self.session.record_blocked_call(func.__name__, decision)
                return BlockedToolResponse(
                    tool_name=func.__name__,
                    reason=decision.reason,
                    remediation=decision.remediation,
                )

            self.session.record_allowed_call(func.__name__, args, kwargs)
            result = func(*args, **kwargs)
            self.session.record_result(func.__name__, result)
            return result

        return self._attach_metadata(wrapped, func, self.session)

    def _wrap_async(self, func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        async def wrapped(*args: Any, **kwargs: Any) -> Any:
            decision = self.session.check_tool_call(func.__name__, args, kwargs)
            if not decision.allowed:
                self.session.record_blocked_call(func.__name__, decision)
                return BlockedToolResponse(
                    tool_name=func.__name__,
                    reason=decision.reason,
                    remediation=decision.remediation,
                )

            self.session.record_allowed_call(func.__name__, args, kwargs)
            result = await func(*args, **kwargs)
            self.session.record_result(func.__name__, result)
            return result

        return self._attach_metadata(wrapped, func, self.session)


def wrap_function(session: Session, func: Callable[..., Any]) -> Callable[..., Any]:
    """Convenience helper for wrapping a callable with a session."""
    return FunctionWrapper(session=session).wrap(func)
