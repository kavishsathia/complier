"""Session orchestration for contract enforcement."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from complier.contract.evaluator import evaluate_constraint
from complier.contract.runtime import (
    BranchBackNode,
    BranchNode,
    JoinNode,
    StartNode,
    ToolNode,
    UnorderedBackNode,
    UnorderedNode,
)
from complier.integration import Integration
from complier.memory.model import Memory

from .context import activate_session
from .decisions import Decision, Remediation
from .state import SessionState

if TYPE_CHECKING:
    from complier.contract.model import Contract


@dataclass(slots=True)
class Session:
    """One live execution session against a contract and memory."""

    contract: "Contract"
    memory: Memory | None = None
    model: Integration | None = None
    human: Integration | None = None
    state: SessionState = field(default_factory=SessionState)

    def __post_init__(self) -> None:
        """Detach session-owned memory from the caller's original instance."""
        if self.memory is not None:
            self.memory = Memory(checks=dict(self.memory.checks))

    def activate(self) -> AbstractAsyncContextManager["Session"]:
        """Register this session as active within the current async context."""
        return activate_session(self)

    def wrap(self, func: Any) -> Any:
        """Bind a callable into this session's enforcement flow."""
        from complier.wrappers.function import wrap_function

        return wrap_function(self, func)

    def check_tool_call(
        self,
        tool_name: str,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        choice: str | None = None,
    ) -> Decision:
        """Evaluate whether a tool call is allowed in the current state."""
        if not self.contract.workflows:
            return Decision(allowed=True)

        workflow_name = self._get_or_choose_workflow()
        if workflow_name is None:
            return Decision(
                allowed=False,
                reason="No active workflow is available.",
            )

        workflow = self.contract.workflows[workflow_name]
        candidate_nodes = self._collect_next_tool_nodes(workflow_name, choice)

        matching_name_nodes = [
            node
            for node in candidate_nodes
            if node.tool_name == tool_name
        ]
        if not matching_name_nodes:
            return Decision(
                allowed=False,
                reason=f"Tool '{tool_name}' is not allowed next.",
                remediation=Remediation(
                    message="Choose one of the next allowed tool actions.",
                    allowed_next_actions=sorted({node.tool_name for node in candidate_nodes}),
                ),
            )

        valid_node = self._find_valid_tool_node(matching_name_nodes, kwargs)
        if valid_node is None:
            return Decision(
                allowed=False,
                reason=f"Tool '{tool_name}' did not satisfy the declared param constraints.",
            )

        self.state.active_workflow = workflow.name
        self.state.active_step = valid_node.id
        self.state.completed_steps.append(valid_node.id)
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

    def get_memory(self) -> str:
        """Return the current session memory as a serialized string."""
        return self.snapshot_memory().to_json()

    def visualize(self, host: str = "127.0.0.1", port: int = 8765):
        """Start a local visualizer server for this live session."""
        from complier.visualizer import serve_contract

        return serve_contract(self.contract, host=host, port=port)

    def _get_or_choose_workflow(self) -> str | None:
        if self.state.active_workflow is not None:
            return self.state.active_workflow
        if len(self.contract.workflows) == 1:
            return next(iter(self.contract.workflows))
        return None

    def _collect_next_tool_nodes(
        self,
        workflow_name: str,
        choice: str | None,
    ) -> list[ToolNode]:
        workflow = self.contract.workflows[workflow_name]
        if self.state.active_step is None:
            frontier = [workflow.start_node_id]
        else:
            frontier = [self.state.active_step]

        pending: list[str] = []
        for node_id in frontier:
            pending.extend(workflow.nodes[node_id].next_ids)

        seen: set[str] = set()
        candidates: list[ToolNode] = []

        while pending:
            node_id = pending.pop(0)
            if node_id in seen:
                continue
            seen.add(node_id)

            node = workflow.nodes[node_id]
            if isinstance(node, ToolNode):
                candidates.append(node)
                continue

            if isinstance(node, (StartNode, BranchBackNode, UnorderedBackNode, JoinNode)):
                pending.extend(node.next_ids)
                continue

            if isinstance(node, BranchNode):
                if choice is not None:
                    if choice == "else":
                        if node.else_node_id is not None:
                            pending.append(node.else_node_id)
                    elif choice in node.arms:
                        pending.append(node.arms[choice])
                else:
                    pending.extend(node.arms.values())
                    if node.else_node_id is not None:
                        pending.append(node.else_node_id)
                continue

            if isinstance(node, UnorderedNode):
                if choice is not None:
                    if choice in node.case_entry_ids:
                        pending.append(node.case_entry_ids[choice])
                else:
                    pending.extend(node.case_entry_ids.values())
                continue

            pending.extend(node.next_ids)

        return candidates

    def _find_valid_tool_node(
        self,
        nodes: list[ToolNode],
        kwargs: dict[str, Any],
    ) -> ToolNode | None:
        for node in nodes:
            if self._params_match(node, kwargs):
                return node
        return None

    def _params_match(self, node: ToolNode, kwargs: dict[str, Any]) -> bool:
        for name, constraint in node.params.items():
            if name not in kwargs:
                return False
            result = evaluate_constraint(
                constraint,
                kwargs[name],
                model=self.model,
                human=self.human,
                memory=self.memory,
            )
            if not result.passed:
                return False
        return True
