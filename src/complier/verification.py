"""Verifier abstractions for resolving contract constraints at runtime.

A ``Verifier`` decides whether a single typed constraint is satisfied
by a tool call's parameter value. Three concrete verifiers ship in
core, one per delimiter form in the DSL:

- ``ModelVerifier`` handles ``ModelPrompt`` — square-bracket ``[prompt]``
  values, intended for semantic checks evaluated by a model backend.
- ``HumanVerifier`` handles ``HumanPrompt`` — curly-brace ``{prompt}``
  values, intended for human review.
- ``CelVerifier`` handles ``CelExpression`` — backtick `` `expr` ``
  values, deterministic CEL evaluation in-process.

``HintPrompt`` (paren-delimited ``(prompt)`` values) is guidance shown
to the agent without verification; the evaluator handles it directly
without consulting any verifier.

Sessions hold an ordered list of verifiers and dispatch by walking
the list and asking each ``handles(constraint)``. Verifiers never
compose — each constraint is one type, evaluated by one verifier.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Protocol

from complier.contract.ast import (
    CelExpression,
    HumanPrompt,
    ModelPrompt,
    Policy,
    RetryPolicy,
)


@dataclass(slots=True)
class EvaluationResult:
    """Result of evaluating a single constraint."""

    passed: bool
    reasons: list[str] = field(default_factory=list)
    policy: Policy | None = None


class Verifier(Protocol):
    """A verifier knows how to evaluate one constraint type."""

    def handles(self, constraint: Any) -> bool:
        """Return True if this verifier evaluates ``constraint``."""
        ...

    def evaluate(
        self,
        constraint: Any,
        value: Any,
        *,
        context: Mapping[str, Any],
    ) -> EvaluationResult:
        """Evaluate ``constraint`` against ``value`` with sibling ``context``."""
        ...


ModelVerifyFn = Callable[[str, Any, Mapping[str, Any]], bool]
HumanVerifyFn = Callable[[str, Any, Mapping[str, Any]], bool]


@dataclass
class ModelVerifier:
    """Verifier for ``[prompt]`` model-style constraints.

    Takes a ``verify_fn(prompt, value, context) -> bool``. The user
    plugs in their LLM client; this class doesn't ship a model.
    """

    verify_fn: ModelVerifyFn

    def handles(self, constraint: Any) -> bool:
        return isinstance(constraint, ModelPrompt)

    def evaluate(
        self,
        constraint: ModelPrompt,
        value: Any,
        *,
        context: Mapping[str, Any],
    ) -> EvaluationResult:
        try:
            passed = self.verify_fn(constraint.text, value, dict(context))
        except Exception as exc:
            return EvaluationResult(
                passed=False,
                reasons=[f"Model verifier raised: {exc}"],
                policy=constraint.policy,
            )
        if passed:
            return EvaluationResult(passed=True)
        return EvaluationResult(
            passed=False,
            reasons=[f"Model rejected: [{constraint.text}]"],
            policy=constraint.policy,
        )


@dataclass
class HumanVerifier:
    """Verifier for ``{prompt}`` human-review constraints.

    Takes a ``verify_fn(prompt, value, context) -> bool``. The user
    plugs in their UI / approval flow; this class doesn't ship one.
    """

    verify_fn: HumanVerifyFn

    def handles(self, constraint: Any) -> bool:
        return isinstance(constraint, HumanPrompt)

    def evaluate(
        self,
        constraint: HumanPrompt,
        value: Any,
        *,
        context: Mapping[str, Any],
    ) -> EvaluationResult:
        try:
            passed = self.verify_fn(constraint.text, value, dict(context))
        except Exception as exc:
            return EvaluationResult(
                passed=False,
                reasons=[f"Human verifier raised: {exc}"],
                policy=constraint.policy,
            )
        if passed:
            return EvaluationResult(passed=True)
        return EvaluationResult(
            passed=False,
            reasons=[f"Human rejected: {{{constraint.text}}}"],
            policy=constraint.policy,
        )


@dataclass
class CelVerifier:
    """Deterministic CEL expression evaluator.

    Programs compile lazily and cache per expression text. Plain
    Python dicts work as context.
    """

    _cache: dict[str, Any] = field(default_factory=dict, init=False, repr=False)
    _env: Any = field(default=None, init=False, repr=False)

    def _environment(self) -> Any:
        if self._env is None:
            import celpy

            self._env = celpy.Environment()
        return self._env

    def handles(self, constraint: Any) -> bool:
        return isinstance(constraint, CelExpression)

    def evaluate(
        self,
        constraint: CelExpression,
        value: Any,
        *,
        context: Mapping[str, Any],
    ) -> EvaluationResult:
        try:
            passed = self._evaluate_expression(constraint.text, dict(context))
        except ValueError as exc:
            return EvaluationResult(
                passed=False,
                reasons=[str(exc)],
                policy=constraint.policy,
            )
        if passed:
            return EvaluationResult(passed=True)
        return EvaluationResult(
            passed=False,
            reasons=[f"CEL expression returned false: `{constraint.text}`"],
            policy=constraint.policy,
        )

    def _evaluate_expression(self, expression: str, context: dict[str, Any]) -> bool:
        program = self._cache.get(expression)
        if program is None:
            env = self._environment()
            try:
                ast = env.compile(expression)
            except Exception as exc:
                raise ValueError(
                    f"CEL expression failed to compile: {expression!r}: {exc}"
                ) from exc
            program = env.program(ast)
            self._cache[expression] = program

        try:
            result = program.evaluate(context)
        except Exception as exc:
            raise ValueError(
                f"CEL expression failed at runtime: {expression!r}: {exc}"
            ) from exc
        return bool(result)


def default_verifiers() -> list[Verifier]:
    """Built-in verifier set: just CEL.

    Model and Human verifiers require user-supplied callbacks (LLM
    client, UI hook) so they aren't instantiated by default.
    """
    return [CelVerifier()]
