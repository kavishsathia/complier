"""Tests for guarantee parsing (verified-constraint bodies)."""

import unittest

from complier.contract.ast import (
    CelExpression,
    Guarantee,
    HumanPrompt,
    ModelPrompt,
    RetryPolicy,
)

from .helpers import parse_program


class GuaranteeParsingTests(unittest.TestCase):
    def test_parses_each_verified_constraint_form(self) -> None:
        program = parse_program(
            """
guarantee safe [must not contain harmful content]:halt
guarantee approved {editor signed off}:skip
guarantee shape `args.size() > 0`:3
"""
        )

        self.assertEqual(len(program.items), 3)
        for item in program.items:
            self.assertIsInstance(item, Guarantee)

        safe, approved, shape = program.items

        self.assertEqual(safe.name, "safe")
        self.assertIsInstance(safe.expression, ModelPrompt)
        self.assertEqual(safe.expression.text, "must not contain harmful content")
        self.assertEqual(safe.expression.policy, "halt")

        self.assertEqual(approved.name, "approved")
        self.assertIsInstance(approved.expression, HumanPrompt)
        self.assertEqual(approved.expression.text, "editor signed off")
        self.assertEqual(approved.expression.policy, "skip")

        self.assertEqual(shape.name, "shape")
        self.assertIsInstance(shape.expression, CelExpression)
        self.assertEqual(shape.expression.text, "args.size() > 0")
        self.assertIsInstance(shape.expression.policy, RetryPolicy)
        self.assertEqual(shape.expression.policy.attempts, 3)

    def test_guarantee_without_policy_defaults_to_retry_3(self) -> None:
        program = parse_program(
            """
guarantee safe [must not contain harmful content]
"""
        )
        expr = program.items[0].expression
        self.assertIsInstance(expr, ModelPrompt)
        self.assertIsInstance(expr.policy, RetryPolicy)
        self.assertEqual(expr.policy.attempts, 3)
