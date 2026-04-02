"""Tests for guarantee and expression parsing."""

import unittest

from complier.contract.ast import (
    AndExpression,
    ContractExpressionWithPolicy,
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
guarantee safe [no_harmful_content]:halt
guarantee approved {editor_signed_off}:skip
guarantee quality #{quality_model}:3
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

        self.assertIsInstance(safe_expr, ContractExpressionWithPolicy)
        self.assertIsInstance(safe_expr.expression, ModelCheck)
        self.assertEqual(safe_expr.expression.name, "no_harmful_content")
        self.assertEqual(safe_expr.policy, "halt")

        self.assertIsInstance(approved_expr, ContractExpressionWithPolicy)
        self.assertIsInstance(approved_expr.expression, HumanCheck)
        self.assertEqual(approved_expr.expression.name, "editor_signed_off")
        self.assertEqual(approved_expr.policy, "skip")

        self.assertIsInstance(quality_expr, ContractExpressionWithPolicy)
        self.assertIsInstance(quality_expr.expression, LearnedCheck)
        self.assertEqual(quality_expr.expression.name, "quality_model")
        self.assertIsInstance(quality_expr.policy, RetryPolicy)
        self.assertEqual(quality_expr.policy.attempts, 3)

    def test_parses_nested_boolean_contract_expressions(self) -> None:
        program = parse_program(
            """
guarantee gate (([relevant] && !{approved}) || safe):3
"""
        )

        expr = program.items[0].expression
        self.assertIsInstance(expr, ContractExpressionWithPolicy)
        self.assertIsInstance(expr.policy, RetryPolicy)
        self.assertEqual(expr.policy.attempts, 3)
        self.assertIsInstance(expr.expression, OrExpression)
        self.assertIsInstance(expr.expression.left, AndExpression)
        self.assertIsInstance(expr.expression.right, GuaranteeRef)
        self.assertEqual(expr.expression.right.name, "safe")

        and_expr = expr.expression.left
        self.assertIsInstance(and_expr.left, ModelCheck)
        self.assertEqual(and_expr.left.name, "relevant")

        self.assertIsInstance(and_expr.right, NotExpression)
        self.assertIsInstance(and_expr.right.expression, HumanCheck)
        self.assertEqual(and_expr.right.expression.name, "approved")

    def test_parses_expression_shapes_and_check_variants(self) -> None:
        program = parse_program(
            """
guarantee blocked !safe
guarantee fallback safe || [relevant]
guarantee grouped ((!safe && ({editor_review} || #{tone})):halt)
"""
        )

        blocked_expr = program.items[0].expression
        fallback_expr = program.items[1].expression
        grouped_expr = program.items[2].expression

        self.assertIsInstance(blocked_expr, ContractExpressionWithPolicy)
        self.assertIsInstance(blocked_expr.expression, NotExpression)
        self.assertIsInstance(blocked_expr.expression.expression, GuaranteeRef)
        self.assertEqual(blocked_expr.expression.expression.name, "safe")
        self.assertIsInstance(blocked_expr.policy, RetryPolicy)
        self.assertEqual(blocked_expr.policy.attempts, 3)

        self.assertIsInstance(fallback_expr, ContractExpressionWithPolicy)
        self.assertIsInstance(fallback_expr.expression, OrExpression)
        self.assertIsInstance(fallback_expr.expression.left, GuaranteeRef)
        self.assertEqual(fallback_expr.expression.left.name, "safe")
        self.assertIsInstance(fallback_expr.expression.right, ModelCheck)
        self.assertEqual(fallback_expr.expression.right.name, "relevant")

        self.assertIsInstance(grouped_expr, ContractExpressionWithPolicy)
        self.assertEqual(grouped_expr.policy, "halt")
        self.assertIsInstance(grouped_expr.expression, AndExpression)
        self.assertIsInstance(grouped_expr.expression.left, NotExpression)
        self.assertIsInstance(grouped_expr.expression.left.expression, GuaranteeRef)
        self.assertEqual(grouped_expr.expression.left.expression.name, "safe")
        self.assertIsInstance(grouped_expr.expression.right, OrExpression)
        self.assertIsInstance(grouped_expr.expression.right.left, HumanCheck)
        self.assertEqual(grouped_expr.expression.right.left.name, "editor_review")
        self.assertIsInstance(grouped_expr.expression.right.right, LearnedCheck)
        self.assertEqual(grouped_expr.expression.right.right.name, "tone")
