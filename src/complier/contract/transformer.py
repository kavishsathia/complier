"""Lark transformer from parse trees to contract AST."""

from __future__ import annotations

import ast
from typing import Any

from lark import Token, Transformer

from .ast import (
    AndExpression,
    BranchStep,
    ElseArm,
    ForkStep,
    Guarantee,
    GuaranteeRef,
    HumanCheck,
    HumanStep,
    JoinStep,
    LearnedCheck,
    LlmStep,
    LoopStep,
    ModelCheck,
    NotExpression,
    OrExpression,
    Param,
    Program,
    RetryPolicy,
    SubworkflowStep,
    ToolStep,
    UnorderedCase,
    UnorderedStep,
    WhenArm,
    Workflow,
)


def _strip_string(token: str) -> str:
    return ast.literal_eval(token)


class ContractTransformer(Transformer[Token, Any]):
    """Transforms a parse tree into the contract AST."""

    @staticmethod
    def _without_tokens(items: list[Any], token_types: set[str]) -> list[Any]:
        return [
            item
            for item in items
            if not (isinstance(item, Token) and item.type in token_types)
        ]

    def start(self, items: list[Any]) -> Program:
        return Program(items=items)

    def item(self, items: list[Any]) -> Any:
        return items[0]

    def guarantee(self, items: list[Any]) -> Guarantee:
        name, expression = items
        return Guarantee(name=name, expression=expression)

    def workflow(self, items: list[Any]) -> Workflow:
        name = items[0]
        always = [item for item in items[1:] if isinstance(item, str)]
        steps = [item for item in items[1:] if not isinstance(item, str)]
        return Workflow(name=name, always=always, steps=steps)

    def always_clause(self, items: list[Any]) -> str:
        return items[0]

    def step(self, items: list[Any]) -> Any:
        filtered = self._without_tokens(items, {"PIPE"})
        return filtered[0]

    def inline_step(self, items: list[Any]) -> Any:
        return items[0]

    def block_step(self, items: list[Any]) -> Any:
        return items[0]

    def llm_step(self, items: list[Any]) -> LlmStep:
        return LlmStep(prompt=items[0])

    def human_step(self, items: list[Any]) -> HumanStep:
        return HumanStep(prompt=items[0])

    def subworkflow_step(self, items: list[Any]) -> SubworkflowStep:
        call_type, workflow_name = items
        return SubworkflowStep(call_type=call_type, workflow_name=workflow_name)

    def fork_step(self, items: list[Any]) -> ForkStep:
        fork_id, target = items
        return ForkStep(fork_id=fork_id, target=target)

    def join_step(self, items: list[Any]) -> JoinStep:
        return JoinStep(fork_id=items[0])

    def tool_step(self, items: list[Any]) -> ToolStep:
        name = items[0]
        params = items[1:]
        return ToolStep(name=name, params=params)

    def branch_block(self, items: list[Any]) -> BranchStep:
        when_arms = [item for item in items if isinstance(item, WhenArm)]
        else_arm = next((item for item in items if isinstance(item, ElseArm)), None)
        return BranchStep(when_arms=when_arms, else_arm=else_arm)

    def when_arm(self, items: list[Any]) -> WhenArm:
        filtered = self._without_tokens(items, {"WHEN"})
        condition = filtered[0]
        steps = filtered[1:]
        return WhenArm(condition=condition, steps=steps)

    def else_arm(self, items: list[Any]) -> ElseArm:
        filtered = self._without_tokens(items, {"ELSE"})
        return ElseArm(steps=filtered)

    def loop_block(self, items: list[Any]) -> LoopStep:
        until = items[-1]
        steps = items[:-1]
        return LoopStep(steps=steps, until=until)

    def until_clause(self, items: list[Any]) -> str:
        filtered = self._without_tokens(items, {"UNTIL"})
        return filtered[0]

    def unordered_block(self, items: list[Any]) -> UnorderedStep:
        return UnorderedStep(cases=items)

    def unordered_step(self, items: list[Any]) -> UnorderedCase:
        filtered = self._without_tokens(items, {"STEP_KW"})
        label = filtered[0]
        steps = filtered[1:]
        return UnorderedCase(label=label, steps=steps)

    def param(self, items: list[Any]) -> Param:
        name, value = items
        return Param(name=name, value=value)

    def number_value(self, items: list[Any]) -> int:
        return int(items[0])

    def true_value(self, _items: list[Any]) -> bool:
        return True

    def false_value(self, _items: list[Any]) -> bool:
        return False

    def null_value(self, _items: list[Any]) -> None:
        return None

    def model_check(self, items: list[Any]) -> ModelCheck:
        name = items[0]
        policy = items[1] if len(items) > 1 else None
        return ModelCheck(name=name, policy=policy)

    def human_check(self, items: list[Any]) -> HumanCheck:
        name = items[0]
        policy = items[1] if len(items) > 1 else None
        return HumanCheck(name=name, policy=policy)

    def learned_check(self, items: list[Any]) -> LearnedCheck:
        name = items[0]
        policy = items[1] if len(items) > 1 else None
        return LearnedCheck(name=name, policy=policy)

    def check_name(self, items: list[Any]) -> str:
        return items[0]

    def check_suffix(self, items: list[Any]) -> Any:
        return items[0]

    def halt_policy(self, _items: list[Any]) -> str:
        return "halt"

    def skip_policy(self, _items: list[Any]) -> str:
        return "skip"

    def retry_policy(self, items: list[Any]) -> RetryPolicy:
        return RetryPolicy(attempts=int(items[0]))

    def guarantee_ref(self, items: list[Any]) -> GuaranteeRef:
        return GuaranteeRef(name=items[0])

    def not_expr(self, items: list[Any]) -> NotExpression:
        filtered = self._without_tokens(items, {"NOT"})
        return NotExpression(expression=filtered[0])

    def and_expr(self, items: list[Any]) -> AndExpression:
        filtered = self._without_tokens(items, {"AND"})
        return AndExpression(left=filtered[0], right=filtered[1])

    def or_expr(self, items: list[Any]) -> OrExpression:
        filtered = self._without_tokens(items, {"OR"})
        return OrExpression(left=filtered[0], right=filtered[1])

    def call_type(self, items: list[Any]) -> str:
        return str(items[0])

    def IDENT(self, token: Token) -> str:
        return str(token)

    def STRING(self, token: Token) -> str:
        return _strip_string(str(token))

    def CALL(self, token: Token) -> Token:
        return token

    def USE(self, token: Token) -> Token:
        return token

    def INLINE(self, token: Token) -> Token:
        return token
