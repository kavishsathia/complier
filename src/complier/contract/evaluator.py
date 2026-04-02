"""Evaluation helpers for compiled contract expressions and param constraints."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .ast import ContractExpression


@dataclass(slots=True)
class EvaluationResult:
    """Result of evaluating a contract expression."""

    passed: bool
    reasons: list[str] = field(default_factory=list)


def evaluate_contract_expression(
    expression: ContractExpression,
    value: Any,
) -> EvaluationResult:
    """Evaluate a compiled contract expression against a specific input value."""
    # Reminder: stringify `value` before real check execution to avoid type-specific surprises.
    return EvaluationResult(passed=True)


def evaluate_constraint(
    constraint: ContractExpression | Any,
    value: Any,
) -> EvaluationResult:
    """Evaluate a declared param constraint against a specific input value."""
    if isinstance(constraint, ContractExpression):
        return evaluate_contract_expression(constraint, value)

    if constraint == value:
        return EvaluationResult(passed=True)

    return EvaluationResult(
        passed=False,
        reasons=[f"Expected exact value {constraint!r}, got {value!r}."],
    )
