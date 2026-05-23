"""Tests for the CelVerifier (deterministic CEL evaluation)."""

import unittest

from complier import CelVerifier
from complier.contract.ast import CelExpression


def _eval(verifier: CelVerifier, expression: str, context: dict) -> bool:
    """Evaluate via the Verifier protocol and return the bool result."""
    result = verifier.evaluate(
        CelExpression(text=expression),
        context.get(next(iter(context), None)) if context else None,
        context=context,
    )
    return result.passed


class CelVerifierTests(unittest.TestCase):
    def test_starts_with_predicate(self) -> None:
        v = CelVerifier()
        self.assertTrue(_eval(v, 'command.startsWith("grep ")', {"command": "grep -n foo bar"}))
        self.assertFalse(_eval(v, 'command.startsWith("grep ")', {"command": "cat foo"}))

    def test_regex_matches(self) -> None:
        v = CelVerifier()
        self.assertTrue(_eval(v, 'file_path.matches("^src/.*\\\\.py$")', {"file_path": "src/foo.py"}))
        self.assertFalse(_eval(v, 'file_path.matches("^src/.*\\\\.py$")', {"file_path": "lib/foo.py"}))

    def test_set_membership(self) -> None:
        v = CelVerifier()
        self.assertTrue(_eval(v, 'to in ["a@x", "b@x"]', {"to": "a@x"}))
        self.assertFalse(_eval(v, 'to in ["a@x", "b@x"]', {"to": "c@x"}))

    def test_boolean_composition(self) -> None:
        v = CelVerifier()
        # Substring via .matches() — celpy's .contains is broken on plain strs.
        expr = 'command.startsWith("grep ") && !command.matches(".*rm.*")'
        self.assertTrue(_eval(v, expr, {"command": "grep foo bar"}))
        self.assertFalse(_eval(v, expr, {"command": "grep rm foo"}))

    def test_program_cache(self) -> None:
        v = CelVerifier()
        _eval(v, "x > 0", {"x": 1})
        _eval(v, "x > 0", {"x": 2})
        self.assertIn("x > 0", v._cache)
        self.assertEqual(len(v._cache), 1)

    def test_compile_error_is_surfaced_in_reasons(self) -> None:
        v = CelVerifier()
        result = v.evaluate(
            CelExpression(text="this is (not valid"),
            None,
            context={},
        )
        self.assertFalse(result.passed)
        self.assertTrue(any("failed to compile" in r for r in result.reasons))

    def test_runtime_error_is_surfaced_in_reasons(self) -> None:
        v = CelVerifier()
        result = v.evaluate(
            CelExpression(text="undeclared.foo"),
            None,
            context={},
        )
        self.assertFalse(result.passed)
        self.assertTrue(any("failed at runtime" in r for r in result.reasons))
