"""Evaluation helpers for compiled contract expressions and param constraints."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from complier.memory.model import Memory

from .ast import (
    AndExpression,
    ContractExpression,
    GuaranteeRef,
    HumanCheck,
    LearnedCheck,
    ModelCheck,
    NotExpression,
    OrExpression,
)

if TYPE_CHECKING:
    from complier.integration import Integration


@dataclass(slots=True)
class EvaluationResult:
    """Result of evaluating a contract expression."""

    passed: bool
    reasons: list[str] = field(default_factory=list)


def evaluate_contract_expression(
    expression: ContractExpression,
    value: Any,
    *,
    model: "Integration | None" = None,
    human: "Integration | None" = None,
    memory: Memory | None = None,
) -> EvaluationResult:
    """Evaluate a compiled contract expression against a specific input value."""
    # Reminder: stringify `value` before real check execution to avoid type-specific surprises.
    model_results, model_reasons = _evaluate_model_checks(expression, value, model)
    human_results, human_reasons = _evaluate_human_checks(expression, value, human)
    learned_results, learned_reasons = _evaluate_learned_checks(
        expression,
        value,
        model=model,
        human=human,
        memory=memory,
    )

    passed = _evaluate_boolean_expression(
        expression,
        model_results=model_results,
        human_results=human_results,
        learned_results=learned_results,
    )
    return EvaluationResult(
        passed=passed,
        reasons=[*model_reasons, *human_reasons, *learned_reasons],
    )


def evaluate_constraint(
    constraint: ContractExpression | Any,
    value: Any,
    *,
    model: "Integration | None" = None,
    human: "Integration | None" = None,
    memory: Memory | None = None,
) -> EvaluationResult:
    """Evaluate a declared param constraint against a specific input value."""
    if isinstance(constraint, ContractExpression):
        return evaluate_contract_expression(
            constraint,
            value,
            model=model,
            human=human,
            memory=memory,
        )

    if constraint == value:
        return EvaluationResult(passed=True)

    return EvaluationResult(
        passed=False,
        reasons=[f"Expected exact value {constraint!r}, got {value!r}."],
    )


def _evaluate_model_checks(
    expression: ContractExpression,
    value: Any,
    model: "Integration | None",
) -> tuple[dict[str, bool], list[str]]:
    checks = _collect_checks(expression, ModelCheck)
    if not checks:
        return {}, []
    if model is None:
        return {}, ["Model integration is required for model checks."]

    schema = {check.name: bool for check in checks}
    prompt = f"Evaluate the following value against these model checks.\nValue: {value!r}"
    response = model.verify(prompt, schema)
    return {name: bool(response.get(name, False)) for name in schema}, []


def _evaluate_human_checks(
    expression: ContractExpression,
    value: Any,
    human: "Integration | None",
) -> tuple[dict[str, bool], list[str]]:
    checks = _collect_checks(expression, HumanCheck)
    if not checks:
        return {}, []
    if human is None:
        return {}, ["Human integration is required for human checks."]

    schema = {check.name: bool for check in checks}
    prompt = f"Evaluate the following value against these human checks.\nValue: {value!r}"
    response = human.verify(prompt, schema)
    return {name: bool(response.get(name, False)) for name in schema}, []


def _evaluate_learned_checks(
    expression: ContractExpression,
    value: Any,
    *,
    model: "Integration | None",
    human: "Integration | None",
    memory: Memory | None,
) -> tuple[dict[str, bool], list[str]]:
    checks = _collect_checks(expression, LearnedCheck)
    if not checks:
        return {}, []

    reasons: list[str] = []
    results: dict[str, bool] = {}
    for check in checks:
        if human is None:
            reasons.append("Human integration is required for learned checks.")
            results[check.name] = False
            continue
        if model is None:
            reasons.append("Model integration is required for learned checks.")
            results[check.name] = False
            continue

        human_feedback = human.verify(
            (
                f"Review the following value for learned check '{check.name}'.\n"
                f"Value: {value!r}"
            ),
            {"comments": str, "edited": str},
        )
        memory_value = "" if memory is None else memory.get_check(check.name)
        model_result = model.verify(
            (
                f"Use the learned-check memory and human feedback to evaluate '{check.name}'.\n"
                f"Value: {value!r}\n"
                f"Memory: {memory_value!r}\n"
                f"Human comments: {human_feedback.get('comments', '')!r}\n"
                f"Human edited: {human_feedback.get('edited', '')!r}"
            ),
            {"passed": bool, "memory": str},
        )
        results[check.name] = bool(model_result.get("passed", False))
        if memory is not None and "memory" in model_result:
            memory.update_check(check.name, str(model_result["memory"]))

    return results, reasons


def _evaluate_boolean_expression(
    expression: ContractExpression,
    *,
    model_results: dict[str, bool],
    human_results: dict[str, bool],
    learned_results: dict[str, bool],
) -> bool:
    if isinstance(expression, ModelCheck):
        return model_results.get(expression.name, False)
    if isinstance(expression, HumanCheck):
        return human_results.get(expression.name, False)
    if isinstance(expression, LearnedCheck):
        return learned_results.get(expression.name, False)
    if isinstance(expression, NotExpression):
        return not _evaluate_boolean_expression(
            expression.expression,
            model_results=model_results,
            human_results=human_results,
            learned_results=learned_results,
        )
    if isinstance(expression, AndExpression):
        return _evaluate_boolean_expression(
            expression.left,
            model_results=model_results,
            human_results=human_results,
            learned_results=learned_results,
        ) and _evaluate_boolean_expression(
            expression.right,
            model_results=model_results,
            human_results=human_results,
            learned_results=learned_results,
        )
    if isinstance(expression, OrExpression):
        return _evaluate_boolean_expression(
            expression.left,
            model_results=model_results,
            human_results=human_results,
            learned_results=learned_results,
        ) or _evaluate_boolean_expression(
            expression.right,
            model_results=model_results,
            human_results=human_results,
            learned_results=learned_results,
        )
    if isinstance(expression, GuaranteeRef):
        raise ValueError("Guarantee references should be resolved before evaluation.")
    raise TypeError(f"Unsupported contract expression: {type(expression)!r}")


def _collect_checks(
    expression: ContractExpression,
    kind: type[ModelCheck] | type[HumanCheck] | type[LearnedCheck],
) -> list[ModelCheck | HumanCheck | LearnedCheck]:
    found: dict[str, ModelCheck | HumanCheck | LearnedCheck] = {}

    def visit(node: ContractExpression) -> None:
        if isinstance(node, kind):
            found.setdefault(node.name, node)
            return
        if isinstance(node, NotExpression):
            visit(node.expression)
            return
        if isinstance(node, AndExpression | OrExpression):
            visit(node.left)
            visit(node.right)

    visit(expression)
    return list(found.values())
