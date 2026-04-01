"""Session orchestration for contract enforcement."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from complier.contract.model import Contract
from complier.memory.model import Memory

from .decisions import Decision
from .state import SessionState


@dataclass(slots=True)
class Session:
    """One live execution session against a contract and memory."""

    contract: Contract
    memory: Memory | None = None
    state: SessionState = field(default_factory=SessionState)

    def wrap(self, func: Any) -> Any:
        """Bind a callable into this session's enforcement flow."""
        raise NotImplementedError

    def check_tool_call(self, tool_name: str, args: tuple[Any, ...], kwargs: dict[str, Any]) -> Decision:
        """Evaluate whether a tool call is allowed in the current state."""
        raise NotImplementedError

    def record_allowed_call(self, tool_name: str, args: tuple[Any, ...], kwargs: dict[str, Any]) -> None:
        """Record that a tool call was allowed."""
        raise NotImplementedError

    def record_result(self, tool_name: str, result: Any) -> None:
        """Record the result of an executed tool call."""
        raise NotImplementedError

    def record_blocked_call(self, tool_name: str, decision: Decision) -> None:
        """Record that a tool call was blocked."""
        raise NotImplementedError

    def snapshot_memory(self) -> Memory:
        """Produce the updated memory after a session run."""
        raise NotImplementedError
