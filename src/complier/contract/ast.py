"""AST model for authored contracts."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TypeAlias


@dataclass(slots=True)
class Program:
    """Top-level parsed contract program."""

    items: list[Item] = field(default_factory=list)


@dataclass(slots=True)
class Guarantee:
    """Named reusable contract expression."""

    name: str
    expression: ContractExpression


@dataclass(slots=True)
class Workflow:
    """Named workflow definition."""

    name: str
    always: list[str] = field(default_factory=list)
    steps: list[Step] = field(default_factory=list)


Item: TypeAlias = Guarantee | Workflow


@dataclass(slots=True)
class LlmStep:
    """Prompt an LLM."""

    prompt: str


@dataclass(slots=True)
class HumanStep:
    """Prompt a human."""

    prompt: str


@dataclass(slots=True)
class SubworkflowStep:
    """Invoke another workflow."""

    call_type: CallType
    workflow_name: str


@dataclass(slots=True)
class ForkStep:
    """Fork a named parallel branch."""

    fork_id: str
    target: SubworkflowStep


@dataclass(slots=True)
class JoinStep:
    """Join a named parallel branch."""

    fork_id: str


@dataclass(slots=True)
class Param:
    """Named input argument for a tool call."""

    name: str
    value: ParamValue


@dataclass(slots=True)
class ToolStep:
    """Invoke a tool by name."""

    name: str
    params: list[Param] = field(default_factory=list)


@dataclass(slots=True)
class WhenArm:
    """A single branch arm."""

    condition: str
    steps: list[Step] = field(default_factory=list)


@dataclass(slots=True)
class ElseArm:
    """Fallback branch arm."""

    steps: list[Step] = field(default_factory=list)


@dataclass(slots=True)
class BranchStep:
    """Conditional branching block."""

    when_arms: list[WhenArm] = field(default_factory=list)
    else_arm: ElseArm | None = None


@dataclass(slots=True)
class LoopStep:
    """Loop until a condition string is satisfied."""

    steps: list[Step] = field(default_factory=list)
    until: str = ""


@dataclass(slots=True)
class UnorderedCase:
    """A labeled case inside an unordered block."""

    label: str
    steps: list[Step] = field(default_factory=list)


@dataclass(slots=True)
class UnorderedStep:
    """A set of labeled steps whose execution order does not matter."""

    cases: list[UnorderedCase] = field(default_factory=list)


Step: TypeAlias = (
    LlmStep
    | HumanStep
    | SubworkflowStep
    | ForkStep
    | JoinStep
    | ToolStep
    | BranchStep
    | LoopStep
    | UnorderedStep
)


@dataclass(slots=True)
class RetryPolicy:
    """Retry a fixed number of times."""

    attempts: int


Policy: TypeAlias = str | RetryPolicy


@dataclass(slots=True)
class ModelCheck:
    """Square-bracket check."""

    name: str
    policy: Policy | None = None


@dataclass(slots=True)
class HumanCheck:
    """Curly-brace check."""

    name: str
    policy: Policy | None = None


@dataclass(slots=True)
class LearnedCheck:
    """Memory-backed check."""

    name: str
    policy: Policy | None = None


@dataclass(slots=True)
class GuaranteeRef:
    """Reference to a named guarantee."""

    name: str


@dataclass(slots=True)
class NotExpression:
    """Negated contract expression."""

    expression: ContractExpression


@dataclass(slots=True)
class AndExpression:
    """Logical conjunction."""

    left: ContractExpression
    right: ContractExpression


@dataclass(slots=True)
class OrExpression:
    """Logical disjunction."""

    left: ContractExpression
    right: ContractExpression


ContractAtom: TypeAlias = ModelCheck | HumanCheck | LearnedCheck | GuaranteeRef
ContractExpression: TypeAlias = ContractAtom | NotExpression | AndExpression | OrExpression
ParamValue: TypeAlias = str | ContractExpression
CallType: TypeAlias = str
