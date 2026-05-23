"""Constraint evaluation: dispatch a typed value to its verifier."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Mapping, Sequence

from .ast import (
    CelExpression,
    HintPrompt,
    HumanPrompt,
    ModelPrompt,
    ParamValue,
)

if TYPE_CHECKING:
    from complier.verification import EvaluationResult, Verifier


def evaluate_constraint(
    constraint: ParamValue,
    value: Any,
    *,
    verifiers: "Sequence[Verifier]" = (),
    context: Mapping[str, Any] | None = None,
) -> "EvaluationResult":
    """Evaluate a single typed constraint against a value.

    Dispatch by constraint type:
      - HintPrompt: always passes (guidance, no verification)
      - ModelPrompt / HumanPrompt / CelExpression: walk ``verifiers``,
        ask the first verifier that ``handles()`` the constraint.
      - literal (str/int/bool/None): exact equality.
    """
    from complier.verification import EvaluationResult

    ctx = dict(context or {})

    if isinstance(constraint, HintPrompt):
        return EvaluationResult(passed=True)

    if isinstance(constraint, (ModelPrompt, HumanPrompt, CelExpression)):
        for verifier in verifiers:
            if verifier.handles(constraint):
                return verifier.evaluate(constraint, value, context=ctx)
        return EvaluationResult(
            passed=False,
            reasons=[
                f"No verifier registered for {type(constraint).__name__}; "
                f"add one to Session.verifiers."
            ],
            policy=constraint.policy,
        )

    if constraint == value:
        return EvaluationResult(passed=True)

    return EvaluationResult(
        passed=False,
        reasons=[f"Expected exact value {constraint!r}, got {value!r}."],
    )
