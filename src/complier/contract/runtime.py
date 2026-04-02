"""Runtime graph model for compiled contracts."""

from __future__ import annotations

from dataclasses import dataclass, field

from .ast import ContractExpressionWithPolicy, ParamValue


@dataclass(slots=True)
class CompiledWorkflow:
    """Compiled runtime workflow graph."""

    name: str
    start_node_id: str
    end_node_id: str
    nodes: dict[str, RuntimeNode] = field(default_factory=dict)


@dataclass(slots=True)
class RuntimeNode:
    """Base runtime node."""

    id: str
    next_ids: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ExecutableNode(RuntimeNode):
    """Base node for executable steps."""

    guards: list[ContractExpressionWithPolicy] = field(default_factory=list)


@dataclass(slots=True)
class StartNode(RuntimeNode):
    """Workflow entrypoint."""


@dataclass(slots=True)
class EndNode(RuntimeNode):
    """Workflow exit point."""


@dataclass(slots=True)
class ToolNode(ExecutableNode):
    """Tool call node."""

    tool_name: str = ""
    params: dict[str, ParamValue] = field(default_factory=dict)


@dataclass(slots=True)
class HumanNode(ExecutableNode):
    """Human prompt node."""

    prompt: str = ""


@dataclass(slots=True)
class LLMNode(ExecutableNode):
    """LLM prompt node."""

    prompt: str = ""


@dataclass(slots=True)
class CallNode(ExecutableNode):
    """Subworkflow invocation node."""

    call_type: str = ""
    workflow_name: str = ""


@dataclass(slots=True)
class ForkNode(ExecutableNode):
    """Fork subworkflow node."""

    fork_id: str = ""
    call_type: str = ""
    workflow_name: str = ""


@dataclass(slots=True)
class JoinNode(ExecutableNode):
    """Join subworkflow node."""

    fork_id: str = ""


@dataclass(slots=True)
class BranchNode(RuntimeNode):
    """Branch dispatch node."""

    arms: dict[str, str] = field(default_factory=dict)
    else_node_id: str | None = None
    branch_back_id: str | None = None
    mode: str = "branch"
    loop_until: str | None = None


@dataclass(slots=True)
class BranchBackNode(RuntimeNode):
    """Branch merge node."""


@dataclass(slots=True)
class UnorderedNode(RuntimeNode):
    """Dispatch node for unordered labeled cases."""

    case_entry_ids: dict[str, str] = field(default_factory=dict)
    back_node_id: str | None = None


@dataclass(slots=True)
class UnorderedBackNode(RuntimeNode):
    """Merge node after unordered cases."""
