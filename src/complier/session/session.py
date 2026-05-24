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
    HumanNode,
    JoinNode,
    StartNode,
    ToolNode,
    UnorderedBackNode,
    UnorderedNode,
)
from complier.verification import Verifier, default_verifiers

from .context import activate_session
from .decisions import (
    Decision,
    HumanAction,
    NextActionDescriptor,
    NextActions,
    NextActionsFormatter,
    Remediation,
    default_next_actions_formatter,
)
from .server import SessionServer
from .state import SessionState

if TYPE_CHECKING:
    from complier.contract.model import Contract


@dataclass(slots=True)
class Session:
    """One live execution session against a contract."""

    contract: "Contract"
    workflow: str | None = None
    verifiers: list[Verifier] = field(default_factory=default_verifiers)
    formatter: NextActionsFormatter = field(default=default_next_actions_formatter)
    state: SessionState = field(default_factory=SessionState)
    server: SessionServer = field(init=False)
    _managed_processes: list[subprocess.Popen[str]] = field(init=False, default_factory=list, repr=False)
    _remote_wrapper_base_url: str | None = field(init=False, default=None, repr=False)

    def __post_init__(self) -> None:
        if self.workflow is not None:
            if self.workflow not in self.contract.workflows:
                available = ", ".join(self.contract.workflows)
                raise ValueError(f"Unknown workflow {self.workflow!r}. Available: {available}")
            self.state.active_workflow = self.workflow
        self.server = SessionServer(self)

    def kickoff(self) -> str:
        """Return a formatted string describing what the agent can do first."""
        workflow_name = self._get_or_choose_workflow()
        if workflow_name is None:
            raise RuntimeError("Multiple workflows defined — call select_workflow() first.")
        start_node_id = self.contract.workflows[workflow_name].start_node_id
        return self._hint(workflow_name, start_node_id, None)

    def _hint(self, workflow_name: str, node_id: str, choice: str | None) -> str:
        return "\n".join(self._next_actions_after_node(workflow_name, node_id, choice))


    def activate(self) -> AbstractAsyncContextManager["Session"]:
        """Register this session as active within the current async context."""
        return activate_session(self)

    def wrap(self, func: Any) -> Any:
        """Bind a callable into this session's enforcement flow."""
        from complier.integration.function import wrap_function

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

        if tool_name in workflow.ambient:
            frontier, _ = self._collect_frontier(workflow_name, choice)
            next_actions = sorted({node.tool_name for node in frontier})
            return Decision(
                allowed=True,
                remediation=Remediation(
                    message="Ambient tool call. Workflow position unchanged.",
                    allowed_next_actions=next_actions,
                ) if next_actions else None,
            )

        candidate_nodes, pending_humans = self._collect_frontier(workflow_name, choice)

        if pending_humans:
            human_hint = self.formatter(NextActions(
                humans=[HumanAction(prompt=h.prompt) for h in pending_humans],
            ))
            return Decision(
                allowed=False,
                reason=f"Tool '{tool_name}' blocked — an @human step is pending.",
                remediation=Remediation(
                    message="Satisfy the pending @human step before any further tool call.",
                    allowed_next_actions=human_hint,
                ),
            )

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

        next_actions = self._next_actions_after_node(workflow_name, valid_node.id, choice)
        return Decision(
            allowed=True,
            remediation=Remediation(
                message="Proceed with one of the next allowed actions.",
                allowed_next_actions=next_actions,
            ) if next_actions else None,
        )

    def satisfy_human_step(self, *, choice: str | None = None) -> tuple[str, str]:
        """Advance state past the next pending @human step. Returns
        (prompt, hint) where hint is the post-advance next-action string.

        Raises ValueError if there's no pending @human node to satisfy
        (the caller is invoking this at the wrong time).
        """
        if self.state.terminated:
            raise ValueError("session has been halted")
        if not self.contract.workflows:
            raise ValueError("no workflows in contract")
        workflow_name = self._get_or_choose_workflow()
        if workflow_name is None:
            raise ValueError("no active workflow")

        _, humans = self._collect_frontier(workflow_name, choice)
        if not humans:
            raise ValueError("no pending @human step to satisfy")

        node = humans[0]
        workflow = self.contract.workflows[workflow_name]
        self.state.active_workflow = workflow.name
        self.state.active_step = node.id
        self.state.completed_steps.append(node.id)
        self.state.history.append(
            {
                "event": "human_step_satisfied",
                "prompt": node.prompt,
            }
        )
        return node.prompt, self._hint(workflow_name, node.id, choice)

    def record_tool_call(
        self,
        tool_name: str,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        result: Any,
        *,
        choice: str | None = None,
    ) -> str:
        """Log a completed tool call and advance state past the matched node.

        Returns the post-advance next-action hint as a single newline-joined string.
        Trusts the caller to only invoke this after a successful check_tool_call.
        """
        self.state.history.append(
            {
                "event": "tool_call_completed",
                "tool_name": tool_name,
                "args": args,
                "kwargs": kwargs,
                "result": result,
            }
        )

        if self.state.terminated or not self.contract.workflows:
            return ""

        workflow_name = self._get_or_choose_workflow()
        if workflow_name is None:
            return ""

        workflow = self.contract.workflows[workflow_name]

        if tool_name in workflow.ambient:
            node_id = self.state.active_step or workflow.start_node_id
            return self._hint(workflow_name, node_id, choice)

        candidate_nodes = self._collect_next_tool_nodes(workflow_name, choice)
        matching = [n for n in candidate_nodes if n.tool_name == tool_name]
        if len(matching) != 1:
            node_id = self.state.active_step or workflow.start_node_id
            return self._hint(workflow_name, node_id, choice)

        node = matching[0]
        self.state.active_workflow = workflow.name
        self.state.active_step = node.id
        self.state.completed_steps.append(node.id)
        return self._hint(workflow_name, node.id, choice)

    def record_blocked_call(self, tool_name: str, decision: Decision) -> None:
        """Record that a tool call was blocked."""
        self.state.history.append(
            {
                "event": "tool_call_blocked",
                "tool_name": tool_name,
                "decision": decision,
            }
        )

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
                return {"decision": decision.to_dict()}

            if method == "record_blocked_call":
                decision = Decision.from_dict(dict(params["decision"]))
                self.record_blocked_call(str(params["tool_name"]), decision)
                return {"ok": True}

            if method == "record_tool_call":
                hint = self.record_tool_call(
                    str(params["tool_name"]),
                    tuple(params.get("args", [])),
                    dict(params.get("kwargs", {})),
                    params.get("result"),
                    choice=params.get("choice"),
                )
                return {"hint": hint}
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
        return self._collect_frontier(workflow_name, choice)[0]

    def _collect_pending_humans(
        self,
        workflow_name: str,
        choice: str | None,
    ) -> list[HumanNode]:
        return self._collect_frontier(workflow_name, choice)[1]

    def _collect_frontier(
        self,
        workflow_name: str,
        choice: str | None,
    ) -> tuple[list[ToolNode], list[HumanNode]]:
        """Find the reachable executable frontier from the current cursor.

        Returns (tool_candidates, pending_humans). Traversal stops at any
        executable (tool or @human); HumanNode is no longer pass-through.
        """
        workflow = self.contract.workflows[workflow_name]
        if self.state.active_step is None:
            frontier = [workflow.start_node_id]
        else:
            frontier = [self.state.active_step]

        pending: list[str] = []
        for node_id in frontier:
            pending.extend(workflow.nodes[node_id].next_ids)

        seen: set[str] = set()
        tools: list[ToolNode] = []
        humans: list[HumanNode] = []

        while pending:
            node_id = pending.pop(0)
            if node_id in seen:
                continue
            seen.add(node_id)

            node = workflow.nodes[node_id]
            if isinstance(node, ToolNode):
                tools.append(node)
                continue

            if isinstance(node, HumanNode):
                humans.append(node)
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

        return tools, humans

    def _params_match(self, node: ToolNode, kwargs: dict[str, Any]):
        for name, constraint in node.params.items():
            if name not in kwargs:
                from complier.verification import EvaluationResult

                return EvaluationResult(
                    passed=False,
                    reasons=[f"Missing required param '{name}'."],
                )
            result = evaluate_constraint(
                constraint,
                kwargs[name],
                verifiers=self.verifiers,
                context=kwargs,
            )
            if not result.passed:
                return result
        from complier.verification import EvaluationResult

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
        pending: list[tuple[str, str | None, bool, bool]] = [
            (nid, None, False, False) for nid in workflow.nodes[node_id].next_ids
        ]
        seen: set[str] = set()
        descriptors: list[NextActionDescriptor] = []
        humans: list[HumanAction] = []
        is_branch_possible = False
        is_unordered_possible = False

        while pending:
            current_id, choice_label, in_branch, in_unordered = pending.pop(0)
            if current_id in seen:
                continue
            seen.add(current_id)
            current = workflow.nodes[current_id]

            if isinstance(current, ToolNode):
                descriptors.append(NextActionDescriptor(
                    tool_name=current.tool_name,
                    params=dict(current.params),
                    guards=list(current.guards),
                    choice_label=choice_label,
                ))
                continue
            if isinstance(current, HumanNode):
                humans.append(HumanAction(prompt=current.prompt))
                continue
            if isinstance(current, EndNode):
                continue
            if isinstance(current, (StartNode, BranchBackNode, UnorderedBackNode, JoinNode)):
                for nid in current.next_ids:
                    pending.append((nid, choice_label, in_branch, in_unordered))
                continue
            if isinstance(current, BranchNode):
                is_branch_possible = True
                if choice is not None:
                    if choice == "else" and current.else_node_id is not None:
                        pending.append((current.else_node_id, "else", True, in_unordered))
                    elif choice in current.arms:
                        pending.append((current.arms[choice], choice, True, in_unordered))
                else:
                    for label, arm_id in current.arms.items():
                        pending.append((arm_id, label, True, in_unordered))
                    if current.else_node_id is not None:
                        pending.append((current.else_node_id, "else", True, in_unordered))
                continue
            if isinstance(current, UnorderedNode):
                is_unordered_possible = True
                if choice is not None and choice in current.case_entry_ids:
                    pending.append((current.case_entry_ids[choice], choice, in_branch, True))
                else:
                    for label, case_id in current.case_entry_ids.items():
                        pending.append((case_id, label, in_branch, True))
                continue
            for nid in current.next_ids:
                pending.append((nid, choice_label, in_branch, in_unordered))

        next_actions = NextActions(
            actions=descriptors,
            humans=humans,
            is_branch_possible=is_branch_possible,
            is_unordered_possible=is_unordered_possible,
        )
        return self.formatter(next_actions)
