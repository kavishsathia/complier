"""Tests for the CelVerifier (deterministic CEL evaluation)."""

import unittest

from complier import CelVerifier


class CelVerifierTests(unittest.TestCase):
    def test_starts_with_predicate(self) -> None:
        v = CelVerifier()
        self.assertTrue(v.evaluate('command.startsWith("grep ")', {"command": "grep -n foo bar"}))
        self.assertFalse(v.evaluate('command.startsWith("grep ")', {"command": "cat foo"}))

    def test_regex_matches(self) -> None:
        v = CelVerifier()
        self.assertTrue(v.evaluate('file_path.matches("^src/.*\\\\.py$")', {"file_path": "src/foo.py"}))
        self.assertFalse(v.evaluate('file_path.matches("^src/.*\\\\.py$")', {"file_path": "lib/foo.py"}))

    def test_set_membership(self) -> None:
        v = CelVerifier()
        self.assertTrue(v.evaluate('to in ["a@x", "b@x"]', {"to": "a@x"}))
        self.assertFalse(v.evaluate('to in ["a@x", "b@x"]', {"to": "c@x"}))

    def test_boolean_composition(self) -> None:
        v = CelVerifier()
        # For substring checks, use regex .matches() — celpy's .contains and
        # `in` on strings don't behave like the CEL spec on this version.
        expr = 'command.startsWith("grep ") && !command.matches(".*rm.*")'
        self.assertTrue(v.evaluate(expr, {"command": "grep foo bar"}))
        self.assertFalse(v.evaluate(expr, {"command": "grep rm foo"}))

    def test_program_cache(self) -> None:
        v = CelVerifier()
        v.evaluate("x > 0", {"x": 1})
        v.evaluate("x > 0", {"x": 2})
        self.assertIn("x > 0", v._cache)
        self.assertEqual(len(v._cache), 1)

    def test_compile_error_is_descriptive(self) -> None:
        v = CelVerifier()
        with self.assertRaises(ValueError) as caught:
            v.evaluate("this is (not valid", {})
        self.assertIn("failed to compile", str(caught.exception))

    def test_runtime_error_is_descriptive(self) -> None:
        v = CelVerifier()
        # `undeclared.foo` raises a runtime evaluation error in CEL.
        with self.assertRaises(ValueError) as caught:
            v.evaluate("undeclared.foo", {})
        self.assertIn("failed at runtime", str(caught.exception))
