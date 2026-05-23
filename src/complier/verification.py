"""Verifier abstractions for resolving contract checks at runtime.

complier exposes three verification channels:

- ``Verifier`` — abstract base for fuzzy semantic checks. Implementations
  call an LLM (model verifier) or surface a question to a human (human
  verifier). Used by ``[name]``, ``{name}``, and ``#{name}`` checks.

- ``CelVerifier`` — concrete, deterministic CEL evaluator for mechanical
  constraints (string ops, regex, set membership, boolean composition).
  Used for backtick-delimited inline expressions, e.g.
  ``command=`command.startsWith("grep ")```. Built in; requires no API
  key or external service.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class Verifier:
    """Base interface for structured verification backends."""

    def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, Any]:
        """Return structured data matching the requested output schema."""
        raise NotImplementedError


@dataclass
class CelVerifier:
    """Deterministic CEL expression evaluator.

    CEL (Common Expression Language) provides safe, side-effect-free
    boolean expressions over context data. Used for mechanical param
    constraints where an LLM call would be overkill.

    Programs are compiled lazily and cached per expression text.
    """

    _cache: dict[str, Any] = field(default_factory=dict, init=False, repr=False)
    _env: Any = field(default=None, init=False, repr=False)

    def _environment(self) -> Any:
        if self._env is None:
            import celpy

            self._env = celpy.Environment()
        return self._env

    def evaluate(self, expression: str, context: dict[str, Any]) -> bool:
        """Evaluate ``expression`` against ``context``; return a Python bool."""
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
