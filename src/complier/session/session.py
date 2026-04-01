"""Session orchestration for contract enforcement."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from complier.memory.model import Memory

from .context import activate_session
from .decisions import Decision
from .state import SessionState

if TYPE_CHECKING:
    from complier.contract.model import Contract


@dataclass(slots=True)
class Session:
    """One live execution session against a contract and memory."""

    contract: "Contract"
    memory: Memory | None = None
    state: SessionState = field(default_factory=SessionState)

    def activate(self) -> AbstractAsyncContextManager["Session"]:
        """Register this session as active within the current async context."""
        return activate_session(self)

    def wrap(self, func: Any) -> Any:
        """Bind a callable into this session's enforcement flow."""
        return func

    def check_tool_call(self, tool_name: str, args: tuple[Any, ...], kwargs: dict[str, Any]) -> Decision:
        """Evaluate whether a tool call is allowed in the current state."""
        return Decision(allowed=True)

    def record_allowed_call(self, tool_name: str, args: tuple[Any, ...], kwargs: dict[str, Any]) -> None:
        """Record that a tool call was allowed."""
        self.state.history.append(
            {
                "event": "tool_call_allowed",
                "tool_name": tool_name,
                "args": args,
                "kwargs": kwargs,
            }
        )

    def record_result(self, tool_name: str, result: Any) -> None:
        """Record the result of an executed tool call."""
        self.state.history.append(
            {
                "event": "tool_result_recorded",
                "tool_name": tool_name,
                "result": result,
            }
        )

    def record_blocked_call(self, tool_name: str, decision: Decision) -> None:
        """Record that a tool call was blocked."""
        self.state.history.append(
            {
                "event": "tool_call_blocked",
                "tool_name": tool_name,
                "decision": decision,
            }
        )

    def snapshot_memory(self) -> Memory:
        """Produce the updated memory after a session run."""
        if self.memory is None:
            return Memory.empty()

        return Memory(checks=dict(self.memory.checks))
