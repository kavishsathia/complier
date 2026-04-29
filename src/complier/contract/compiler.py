"""Compiler from parsed contract specs to runtime contract objects."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

from .ast import (
    BranchStep,
    ElseArm,
    ForkStep,
    Guarantee,
    HumanStep,
    JoinStep,
    LlmStep,
    LoopStep,
    Param,
    ParamValue,
    Program,
    ProseGuard,
    Step,
    SubworkflowStep,
    ToolStep,
    UnorderedCase,
    UnorderedStep,
    WhenArm,
    Workflow,
)
from .model import Contract
from .parser import ParsedContract
from .runtime import (
    BranchBackNode,
    BranchNode,
    CallNode,
    CompiledWorkflow,
    EndNode,
    ForkNode,
    HumanNode,
    JoinNode,
    LLMNode,
    StartNode,
    ToolNode,
    UnorderedBackNode,
    UnorderedNode,
)


@dataclass(slots=True)
class CompileResult:
    """Entry and exit points for a compiled step sequence."""

    entry_id: str
    exit_ids: list[str]


@dataclass(slots=True)
class WorkflowCompiler:
    """Compiles workflow AST nodes into runtime graphs."""

    guarantees: dict[str, ProseGuard]
    workflow_name: str
    nodes: dict[str, object] = field(default_factory=dict)
    counter: int = 0

    def compile_workflow(self, workflow: Workflow) -> CompiledWorkflow:
        inherited_guards = [self._resolve_guarantee(name) for name in workflow.always]

        start = self._add_node(StartNode(id=self._new_id("start")))
        end = self._add_node(EndNode(id=self._new_id("end")))

        if workflow.steps:
            compiled = self._compile_steps(workflow.steps, inherited_guards)
            start.next_ids.append(compiled.entry_id)
            for exit_id in compiled.exit_ids:
                self.nodes[exit_id].next_ids.append(end.id)
        else:
            start.next_ids.append(end.id)

        return CompiledWorkflow(
            name=workflow.name,
            start_node_id=start.id,
            end_node_id=end.id,
            nodes=self.nodes,
        )

    def _compile_steps(
        self, steps: list[Step], inherited_guards: list[ProseGuard]
    ) -> CompileResult:
        compiled_steps = [self._compile_step(step, inherited_guards) for step in steps]

        entry_id = compiled_steps[0].entry_id
        pending = deque(compiled_steps[0].exit_ids)
        for compiled in compiled_steps[1:]:
            while pending:
                self.nodes[pending.popleft()].next_ids.append(compiled.entry_id)
            pending.extend(compiled.exit_ids)

        return CompileResult(entry_id=entry_id, exit_ids=list(pending))

    def _compile_step(
        self, step: Step, inherited_guards: list[ProseGuard]
    ) -> CompileResult:
        if isinstance(step, ToolStep):
            node = self._add_node(
                ToolNode(
                    id=self._new_id("tool"),
                    tool_name=step.name,
                    params={param.name: self._resolve_param_value(param.value) for param in step.params},
                    guards=list(inherited_guards),
                )
            )
            return CompileResult(entry_id=node.id, exit_ids=[node.id])

        if isinstance(step, HumanStep):
            node = self._add_node(
                HumanNode(
                    id=self._new_id("human"),
                    prompt=step.prompt,
                    guards=list(inherited_guards),
                )
            )
            return CompileResult(entry_id=node.id, exit_ids=[node.id])

        if isinstance(step, LlmStep):
            node = self._add_node(
                LLMNode(
                    id=self._new_id("llm"),
                    prompt=step.prompt,
                    guards=list(inherited_guards),
                )
            )
            return CompileResult(entry_id=node.id, exit_ids=[node.id])

        if isinstance(step, SubworkflowStep):
            node = self._add_node(
                CallNode(
                    id=self._new_id("call"),
                    call_type=step.call_type,
                    workflow_name=step.workflow_name,
                    guards=list(inherited_guards),
                )
            )
            return CompileResult(entry_id=node.id, exit_ids=[node.id])

        if isinstance(step, ForkStep):
            node = self._add_node(
                ForkNode(
                    id=self._new_id("fork"),
                    fork_id=step.fork_id,
                    call_type=step.target.call_type,
                    workflow_name=step.target.workflow_name,
                    guards=list(inherited_guards),
                )
            )
            return CompileResult(entry_id=node.id, exit_ids=[node.id])

        if isinstance(step, JoinStep):
            node = self._add_node(
                JoinNode(
                    id=self._new_id("join"),
                    fork_id=step.fork_id,
                    guards=list(inherited_guards),
                )
            )
            return CompileResult(entry_id=node.id, exit_ids=[node.id])

        if isinstance(step, BranchStep):
            return self._compile_branch(step, inherited_guards)

        if isinstance(step, LoopStep):
            return self._compile_loop(step, inherited_guards)

        if isinstance(step, UnorderedStep):
            return self._compile_unordered(step, inherited_guards)

        raise TypeError(f"Unsupported step type: {type(step)!r}")

    def _compile_branch(
        self, step: BranchStep, inherited_guards: list[ProseGuard]
    ) -> CompileResult:
        back = self._add_node(BranchBackNode(id=self._new_id("branch_back")))
        branch = self._add_node(
            BranchNode(
                id=self._new_id("branch"),
                branch_back_id=back.id,
            )
        )

        for arm in step.when_arms:
            compiled = self._compile_steps(arm.steps, inherited_guards)
            branch.arms[arm.condition] = compiled.entry_id
            for exit_id in compiled.exit_ids:
                self.nodes[exit_id].next_ids.append(back.id)

        if step.else_arm is not None:
            compiled_else = self._compile_steps(step.else_arm.steps, inherited_guards)
            branch.else_node_id = compiled_else.entry_id
            for exit_id in compiled_else.exit_ids:
                self.nodes[exit_id].next_ids.append(back.id)
        else:
            branch.else_node_id = back.id

        return CompileResult(entry_id=branch.id, exit_ids=[back.id])

    def _compile_loop(
        self, step: LoopStep, inherited_guards: list[ProseGuard]
    ) -> CompileResult:
        back = self._add_node(BranchBackNode(id=self._new_id("loop_back")))
        branch = self._add_node(
            BranchNode(
                id=self._new_id("loop_branch"),
                mode="loop",
                loop_until=step.until,
                branch_back_id=back.id,
            )
        )

        compiled_body = self._compile_steps(step.steps, inherited_guards)
        branch.arms[step.until] = back.id
        branch.else_node_id = compiled_body.entry_id

        for exit_id in compiled_body.exit_ids:
            self.nodes[exit_id].next_ids.append(branch.id)

        return CompileResult(entry_id=branch.id, exit_ids=[back.id])

    def _compile_unordered(
        self, step: UnorderedStep, inherited_guards: list[ProseGuard]
    ) -> CompileResult:
        back = self._add_node(UnorderedBackNode(id=self._new_id("unordered_back")))
        unordered = self._add_node(
            UnorderedNode(
                id=self._new_id("unordered"),
                back_node_id=back.id,
            )
        )

        for case in step.cases:
            compiled = self._compile_steps(case.steps, inherited_guards)
            unordered.case_entry_ids[case.label] = compiled.entry_id
            for exit_id in compiled.exit_ids:
                self.nodes[exit_id].next_ids.append(back.id)

        return CompileResult(entry_id=unordered.id, exit_ids=[back.id])

    def _resolve_param_value(self, value: ParamValue) -> ParamValue:
        if isinstance(value, (str, int, bool)) or value is None:
            return value
        return value  # ProseGuard — no resolution needed

    def _resolve_guarantee(self, name: str) -> ProseGuard:
        if name not in self.guarantees:
            raise ValueError(f"Unknown guarantee reference: {name}")
        return self.guarantees[name]

    def _new_id(self, prefix: str) -> str:
        self.counter += 1
        return f"{self.workflow_name}:{prefix}:{self.counter}"

    def _add_node(self, node: object) -> object:
        self.nodes[node.id] = node
        return node


@dataclass(slots=True)
class ContractCompiler:
    """Compiles parsed contract data into a runtime-ready contract."""

    def compile(self, parsed: ParsedContract) -> Contract:
        """Build the runtime contract from a parsed representation."""
        if not isinstance(parsed, ParsedContract):
            raise TypeError("Parsed contract must be a ParsedContract instance.")

        program = parsed.program
        if not isinstance(program, Program):
            raise TypeError("Parsed contract must contain a Program AST.")

        guarantees = {
            item.name: item.expression
            for item in program.items
            if isinstance(item, Guarantee)
        }
        workflows = [
            item
            for item in program.items
            if isinstance(item, Workflow)
        ]

        compiled_workflows = {
            workflow.name: WorkflowCompiler(
                guarantees=guarantees,
                workflow_name=workflow.name,
            ).compile_workflow(workflow)
            for workflow in workflows
        }

        return Contract(
            name="anonymous",
            workflows=compiled_workflows,
            guarantees=guarantees,
            metadata={
                "source": parsed.source,
                "parse_tree": parsed.tree,
                "program": program,
            },
        )
