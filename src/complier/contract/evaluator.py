"""Evaluation helpers for compiled prose guards and param constraints."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from complier.memory.model import Memory

from .ast import HumanCheck, LearnedCheck, ModelCheck, Policy, ProseGuard

if TYPE_CHECKING:
    from complier.integration import Integration


@dataclass(slots=True)
class EvaluationResult:
    """Result of evaluating a prose guard."""

    passed: bool
    reasons: list[str] = field(default_factory=list)
    policy: Policy | None = None


def evaluate_contract_expression(
    expression: ProseGuard,
    value: Any,
    *,
    model: "Integration | None" = None,
    human: "Integration | None" = None,
    memory: Memory | None = None,
) -> EvaluationResult:
    """Evaluate a prose guard against a specific input value."""
    model_checks = [c for c in expression.checks if isinstance(c, ModelCheck)]
    human_checks = [c for c in expression.checks if isinstance(c, HumanCheck)]
    learned_checks = [c for c in expression.checks if isinstance(c, LearnedCheck)]

    model_results, model_reasons = _run_model_checks(model_checks, expression.prose, value, model)
    human_results, human_reasons = _run_human_checks(human_checks, expression.prose, value, human)
    learned_results, learned_reasons = _run_learned_checks(
        learned_checks, expression.prose, value, model=model, human=human, memory=memory
    )

    all_results = {**model_results, **human_results, **learned_results}
    passed = all(all_results.get(c.name, False) for c in expression.checks) if expression.checks else True

    return EvaluationResult(
        passed=passed,
        reasons=[*model_reasons, *human_reasons, *learned_reasons],
        policy=None if passed else expression.policy,
    )


def evaluate_constraint(
    constraint: ProseGuard | Any,
    value: Any,
    *,
    model: "Integration | None" = None,
    human: "Integration | None" = None,
    memory: Memory | None = None,
) -> EvaluationResult:
    """Evaluate a declared param constraint against a specific input value."""
    if isinstance(constraint, ProseGuard):
        return evaluate_contract_expression(constraint, value, model=model, human=human, memory=memory)

    if constraint == value:
        return EvaluationResult(passed=True)

    return EvaluationResult(
        passed=False,
        reasons=[f"Expected exact value {constraint!r}, got {value!r}."],
    )


def _run_model_checks(
    checks: list[ModelCheck],
    prose: str,
    value: Any,
    model: "Integration | None",
) -> tuple[dict[str, bool], list[str]]:
    if not checks:
        return {}, []
    if model is None:
        return {}, ["Model integration is required for model checks."]

    schema = {c.name: bool for c in checks}
    prompt = f"Criteria: {prose}\nValue: {value!r}"
    response = model.verify(prompt, schema)
    return {name: bool(response.get(name, False)) for name in schema}, []


def _run_human_checks(
    checks: list[HumanCheck],
    prose: str,
    value: Any,
    human: "Integration | None",
) -> tuple[dict[str, bool], list[str]]:
    if not checks:
        return {}, []
    if human is None:
        return {}, ["Human integration is required for human checks."]

    schema = {c.name: bool for c in checks}
    prompt = f"Criteria: {prose}\nValue: {value!r}"
    response = human.verify(prompt, schema)
    return {name: bool(response.get(name, False)) for name in schema}, []


def _run_learned_checks(
    checks: list[LearnedCheck],
    prose: str,
    value: Any,
    *,
    model: "Integration | None",
    human: "Integration | None",
    memory: Memory | None,
) -> tuple[dict[str, bool], list[str]]:
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
            f"Criteria: {prose}\nReview for '{check.name}'.\nValue: {value!r}",
            {"comments": str, "edited": str},
        )
        memory_value = "" if memory is None else memory.get_check(check.name)
        model_result = model.verify(
            (
                f"Criteria: {prose}\n"
                f"Use learned-check memory and human feedback to evaluate '{check.name}'.\n"
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
