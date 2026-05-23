"""Tests for guarantee and prose guard parsing."""

import unittest

from complier.contract.ast import (
    Guarantee,
    HumanCheck,
    ModelCheck,
    ProseGuard,
    RetryPolicy,
)

from .helpers import parse_program


class GuaranteeParsingTests(unittest.TestCase):
    def test_parses_multiple_guarantee_check_kinds(self) -> None:
        program = parse_program(
            """
guarantee safe '[no_harmful_content]':halt
guarantee approved '{editor_signed_off}':skip
"""
        )

        self.assertEqual(len(program.items), 2)
        self.assertIsInstance(program.items[0], Guarantee)
        self.assertEqual(program.items[0].name, "safe")
        self.assertEqual(program.items[1].name, "approved")

        safe_expr = program.items[0].expression
        approved_expr = program.items[1].expression

        self.assertIsInstance(safe_expr, ProseGuard)
        self.assertIsInstance(safe_expr.checks[0], ModelCheck)
        self.assertEqual(safe_expr.checks[0].name, "no_harmful_content")
        self.assertEqual(safe_expr.policy, "halt")

        self.assertIsInstance(approved_expr, ProseGuard)
        self.assertIsInstance(approved_expr.checks[0], HumanCheck)
        self.assertEqual(approved_expr.checks[0].name, "editor_signed_off")
        self.assertEqual(approved_expr.policy, "skip")

    def test_parses_mixed_check_kinds_in_prose(self) -> None:
        program = parse_program(
            """
guarantee gate 'must be [relevant] and {approved}':3
"""
        )

        expr = program.items[0].expression
        self.assertIsInstance(expr, ProseGuard)
        self.assertIsInstance(expr.policy, RetryPolicy)
        self.assertEqual(expr.policy.attempts, 3)
        self.assertEqual(len(expr.checks), 2)
        self.assertIsInstance(expr.checks[0], ModelCheck)
        self.assertEqual(expr.checks[0].name, "relevant")
        self.assertIsInstance(expr.checks[1], HumanCheck)
        self.assertEqual(expr.checks[1].name, "approved")

    def test_parses_prose_guard_without_policy_defaults_to_retry_3(self) -> None:
        program = parse_program(
            """
guarantee safe 'must be [no_harmful_content]'
"""
        )

        expr = program.items[0].expression
        self.assertIsInstance(expr, ProseGuard)
        self.assertIsInstance(expr.policy, RetryPolicy)
        self.assertEqual(expr.policy.attempts, 3)

    def test_parses_halt_and_skip_policies(self) -> None:
        program = parse_program(
            """
guarantee a '[check_a]':halt
guarantee b '[check_b]':skip
"""
        )

        self.assertEqual(program.items[0].expression.policy, "halt")
        self.assertEqual(program.items[1].expression.policy, "skip")
