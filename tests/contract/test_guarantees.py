"""Tests for guarantee and expression parsing."""

import unittest

from complier.contract.ast import (
    AndExpression,
    Guarantee,
    GuaranteeRef,
    HumanCheck,
    LearnedCheck,
    ModelCheck,
    NotExpression,
    OrExpression,
    RetryPolicy,
)

from .helpers import parse_program


class GuaranteeParsingTests(unittest.TestCase):
    def test_parses_multiple_guarantee_check_kinds(self) -> None:
        program = parse_program(
            """
guarantee safe [no_harmful_content:halt]
guarantee approved {editor_signed_off:skip}
guarantee quality #{quality_model:3}
"""
        )

        self.assertEqual(len(program.items), 3)
        self.assertIsInstance(program.items[0], Guarantee)
        self.assertEqual(program.items[0].name, "safe")
        self.assertEqual(program.items[1].name, "approved")
        self.assertEqual(program.items[2].name, "quality")

        safe_expr = program.items[0].expression
        approved_expr = program.items[1].expression
        quality_expr = program.items[2].expression

        self.assertIsInstance(safe_expr, ModelCheck)
        self.assertEqual(safe_expr.name, "no_harmful_content")
        self.assertEqual(safe_expr.policy, "halt")

        self.assertIsInstance(approved_expr, HumanCheck)
        self.assertEqual(approved_expr.name, "editor_signed_off")
        self.assertEqual(approved_expr.policy, "skip")

        self.assertIsInstance(quality_expr, LearnedCheck)
        self.assertEqual(quality_expr.name, "quality_model")
        self.assertIsInstance(quality_expr.policy, RetryPolicy)
        self.assertEqual(quality_expr.policy.attempts, 3)

    def test_parses_nested_boolean_contract_expressions(self) -> None:
        program = parse_program(
            """
guarantee gate ([relevant:2] && !{approved:skip}) || safe
"""
        )

        expr = program.items[0].expression
        self.assertIsInstance(expr, OrExpression)
        self.assertIsInstance(expr.left, AndExpression)
        self.assertIsInstance(expr.right, GuaranteeRef)
        self.assertEqual(expr.right.name, "safe")

        and_expr = expr.left
        self.assertIsInstance(and_expr.left, ModelCheck)
        self.assertEqual(and_expr.left.name, "relevant")
        self.assertIsInstance(and_expr.left.policy, RetryPolicy)
        self.assertEqual(and_expr.left.policy.attempts, 2)

        self.assertIsInstance(and_expr.right, NotExpression)
        self.assertIsInstance(and_expr.right.expression, HumanCheck)
        self.assertEqual(and_expr.right.expression.name, "approved")
        self.assertEqual(and_expr.right.expression.policy, "skip")

    def test_parses_expression_shapes_and_check_variants(self) -> None:
        program = parse_program(
            """
guarantee blocked !safe
guarantee fallback safe || [relevant]
guarantee grouped (!safe && ({editor_review} || #{tone:halt}))
"""
        )

        blocked_expr = program.items[0].expression
        fallback_expr = program.items[1].expression
        grouped_expr = program.items[2].expression

        self.assertIsInstance(blocked_expr, NotExpression)
        self.assertIsInstance(blocked_expr.expression, GuaranteeRef)
        self.assertEqual(blocked_expr.expression.name, "safe")

        self.assertIsInstance(fallback_expr, OrExpression)
        self.assertIsInstance(fallback_expr.left, GuaranteeRef)
        self.assertEqual(fallback_expr.left.name, "safe")
        self.assertIsInstance(fallback_expr.right, ModelCheck)
        self.assertEqual(fallback_expr.right.name, "relevant")
        self.assertIsNone(fallback_expr.right.policy)

        self.assertIsInstance(grouped_expr, AndExpression)
        self.assertIsInstance(grouped_expr.left, NotExpression)
        self.assertIsInstance(grouped_expr.left.expression, GuaranteeRef)
        self.assertEqual(grouped_expr.left.expression.name, "safe")
        self.assertIsInstance(grouped_expr.right, OrExpression)
        self.assertIsInstance(grouped_expr.right.left, HumanCheck)
        self.assertEqual(grouped_expr.right.left.name, "editor_review")
        self.assertIsNone(grouped_expr.right.left.policy)
        self.assertIsInstance(grouped_expr.right.right, LearnedCheck)
        self.assertEqual(grouped_expr.right.right.name, "tone")
        self.assertEqual(grouped_expr.right.right.policy, "halt")
