"""Session orchestration for contract enforcement."""

from __future__ import annotations

from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
import subprocess
from typing import TYPE_CHECKING, Any

from complier.contract.evaluator import evaluate_constraint
from complier.contract.ast import RetryPolicy
from complier.contract.runtime import (
    BranchBackNode,
    BranchNode,
    EndNode,
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
from .server import SessionServer
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
    server: SessionServer = field(init=False)
    _managed_processes: list[subprocess.Popen[str]] = field(init=False, default_factory=list, repr=False)
    _remote_wrapper_base_url: str | None = field(init=False, default=None, repr=False)

    def __post_init__(self) -> None:
        """Detach session-owned memory from the caller's original instance."""
        if self.memory is not None:
            self.memory = Memory(checks=dict(self.memory.checks))
        self.server = SessionServer(self)

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
        if self.state.terminated:
            return Decision(
                allowed=False,
                reason="The session has been halted.",
            )
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

        if len(matching_name_nodes) > 1:
            return Decision(
                allowed=False,
                reason=f"Tool '{tool_name}' requires a choice before it can run.",
                remediation=Remediation(
                    message="Retry this action with a choice to select the intended branch or unordered step.",
                    allowed_next_actions=[tool_name],
                ),
            )

        valid_node = matching_name_nodes[0]
        evaluation = self._params_match(valid_node, kwargs)
        if not evaluation.passed:
            return self._decision_for_failed_constraint(
                workflow_name,
                valid_node,
                tool_name,
                evaluation,
                choice,
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

    def register_managed_process(self, process: subprocess.Popen[str]) -> None:
        self._managed_processes.append(process)

    def close(self) -> None:
        for process in reversed(self._managed_processes):
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        self._managed_processes.clear()
        self._remote_wrapper_base_url = None
        self.server.close()

    def handle_server_request(self, request: dict[str, Any]) -> dict[str, Any]:
        method = request.get("method")
        params = request.get("params", {})

        try:
            if method == "check_tool_call":
                decision = self.check_tool_call(
                    str(params["tool_name"]),
                    tuple(params.get("args", [])),
                    dict(params.get("kwargs", {})),
                    choice=params.get("choice"),
                )
                if decision.allowed:
                    self.record_allowed_call(
                        str(params["tool_name"]),
                        tuple(params.get("args", [])),
                        dict(params.get("kwargs", {})),
                    )
                return {"decision": decision.to_dict()}

            if method == "record_blocked_call":
                decision = Decision.from_dict(dict(params["decision"]))
                self.record_blocked_call(str(params["tool_name"]), decision)
                return {"ok": True}

            if method == "record_result":
                self.record_result(str(params["tool_name"]), params.get("result"))
                return {"ok": True}
        except Exception as exc:
            return {"error": str(exc)}

        return {"error": f"Unknown session server method: {method}"}

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

    def _params_match(self, node: ToolNode, kwargs: dict[str, Any]):
        for name, constraint in node.params.items():
            if name not in kwargs:
                from complier.contract.evaluator import EvaluationResult

                return EvaluationResult(
                    passed=False,
                    reasons=[f"Missing required param '{name}'."],
                )
            result = evaluate_constraint(
                constraint,
                kwargs[name],
                model=self.model,
                human=self.human,
                memory=self.memory,
            )
            if not result.passed:
                return result
        from complier.contract.evaluator import EvaluationResult

        return EvaluationResult(passed=True)

    def _decision_for_failed_constraint(
        self,
        workflow_name: str,
        node: ToolNode,
        tool_name: str,
        evaluation: Any,
        choice: str | None,
    ) -> Decision:
        reasons = [] if evaluation is None else evaluation.reasons
        policy = None if evaluation is None else evaluation.policy

        if policy == "skip":
            self._advance_past_node(workflow_name, node.id)
            return Decision(
                allowed=False,
                reason=f"Tool '{tool_name}' was skipped after a failed constraint.",
                remediation=Remediation(
                    message="This step was skipped. Continue with one of the next allowed actions.",
                    allowed_next_actions=self._next_actions_after_node(workflow_name, node.id, choice),
                    missing_requirements=reasons,
                ),
            )

        if policy == "halt":
            self.state.terminated = True
            return Decision(
                allowed=False,
                reason=f"Tool '{tool_name}' failed a halt policy check.",
                remediation=Remediation(
                    message="The session has been halted.",
                    missing_requirements=reasons,
                ),
            )

        if isinstance(policy, RetryPolicy):
            retry_key = f"{workflow_name}:{node.id}:{tool_name}"
            attempt = self.state.retry_counts.get(retry_key, 0) + 1
            self.state.retry_counts[retry_key] = attempt
            remaining = max(policy.attempts - attempt, 0)
            if remaining == 0:
                self.state.terminated = True
                return Decision(
                    allowed=False,
                    reason=f"Tool '{tool_name}' exhausted its retry policy.",
                    remediation=Remediation(
                        message="No retries remain. The session has been halted.",
                        missing_requirements=reasons,
                    ),
                )
            return Decision(
                allowed=False,
                reason=f"Tool '{tool_name}' failed a retryable constraint.",
                remediation=Remediation(
                    message=f"Retry this action. {remaining} retries remain.",
                    allowed_next_actions=[tool_name],
                    missing_requirements=reasons,
                ),
            )

        return Decision(
            allowed=False,
            reason=f"Tool '{tool_name}' did not satisfy the declared param constraints.",
            remediation=Remediation(
                message="Fix the failed constraint and try again.",
                missing_requirements=reasons,
            ),
        )

    def _advance_past_node(self, workflow_name: str, node_id: str) -> None:
        self.state.active_workflow = workflow_name
        self.state.active_step = node_id
        self.state.completed_steps.append(node_id)

    def _next_actions_after_node(
        self,
        workflow_name: str,
        node_id: str,
        choice: str | None,
    ) -> list[str]:
        workflow = self.contract.workflows[workflow_name]
        pending = list(workflow.nodes[node_id].next_ids)
        seen: set[str] = set()
        actions: list[str] = []

        while pending:
            current_id = pending.pop(0)
            if current_id in seen:
                continue
            seen.add(current_id)
            current = workflow.nodes[current_id]

            if isinstance(current, ToolNode):
                actions.append(current.tool_name)
                continue
            if isinstance(current, EndNode):
                continue
            if isinstance(current, (StartNode, BranchBackNode, UnorderedBackNode, JoinNode)):
                pending.extend(current.next_ids)
                continue
            if isinstance(current, BranchNode):
                if choice is not None:
                    if choice == "else" and current.else_node_id is not None:
                        pending.append(current.else_node_id)
                    elif choice in current.arms:
                        pending.append(current.arms[choice])
                else:
                    pending.extend(current.arms.values())
                    if current.else_node_id is not None:
                        pending.append(current.else_node_id)
                continue
            if isinstance(current, UnorderedNode):
                if choice is not None and choice in current.case_entry_ids:
                    pending.append(current.case_entry_ids[choice])
                else:
                    pending.extend(current.case_entry_ids.values())
                continue
            pending.extend(current.next_ids)

        return sorted(set(actions))
