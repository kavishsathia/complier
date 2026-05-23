"""Evaluation helpers for compiled prose guards and param constraints."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .ast import CelExpression, HumanCheck, ModelCheck, Policy, ProseGuard

if TYPE_CHECKING:
    from complier.verification import CelVerifier, Verifier


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
    model: "Verifier | None" = None,
    human: "Verifier | None" = None,
) -> EvaluationResult:
    """Evaluate a prose guard against a specific input value."""
    model_checks = [c for c in expression.checks if isinstance(c, ModelCheck)]
    human_checks = [c for c in expression.checks if isinstance(c, HumanCheck)]

    model_results, model_reasons = _run_model_checks(model_checks, expression.prose, value, model)
    human_results, human_reasons = _run_human_checks(human_checks, expression.prose, value, human)

    all_results = {**model_results, **human_results}
    passed = all(all_results.get(c.name, False) for c in expression.checks) if expression.checks else True

    return EvaluationResult(
        passed=passed,
        reasons=[*model_reasons, *human_reasons],
        policy=None if passed else expression.policy,
    )


def evaluate_constraint(
    constraint: ProseGuard | Any,
    value: Any,
    *,
    model: "Verifier | None" = None,
    human: "Verifier | None" = None,
    cel: "CelVerifier | None" = None,
    context: dict[str, Any] | None = None,
) -> EvaluationResult:
    """Evaluate a declared param constraint against a specific input value.

    For CEL expressions, ``context`` (all sibling kwargs) is the variable
    binding; the expression can reference any kwarg by name.
    """
    if isinstance(constraint, ProseGuard):
        return evaluate_contract_expression(constraint, value, model=model, human=human)

    if isinstance(constraint, CelExpression):
        if cel is None:
            return EvaluationResult(
                passed=False,
                reasons=["CEL verifier is required for backtick expressions."],
            )
        try:
            passed = cel.evaluate(constraint.text, dict(context or {}))
        except ValueError as exc:
            return EvaluationResult(passed=False, reasons=[str(exc)])
        if passed:
            return EvaluationResult(passed=True)
        return EvaluationResult(
            passed=False,
            reasons=[f"CEL expression returned false: `{constraint.text}`"],
        )

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
    model: "Verifier | None",
) -> tuple[dict[str, bool], list[str]]:
    if not checks:
        return {}, []
    if model is None:
        return {}, ["Model verifier is required for model checks."]

    schema = {c.name: bool for c in checks}
    prompt = f"Criteria: {prose}\nValue: {value!r}"
    response = model.verify(prompt, schema)
    return {name: bool(response.get(name, False)) for name in schema}, []


def _run_human_checks(
    checks: list[HumanCheck],
    prose: str,
    value: Any,
    human: "Verifier | None",
) -> tuple[dict[str, bool], list[str]]:
    if not checks:
        return {}, []
    if human is None:
        return {}, ["Human verifier is required for human checks."]

    schema = {c.name: bool for c in checks}
    prompt = f"Criteria: {prose}\nValue: {value!r}"
    response = human.verify(prompt, schema)
    return {name: bool(response.get(name, False)) for name in schema}, []


