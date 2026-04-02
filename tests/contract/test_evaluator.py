"""Tests for contract expression evaluation."""

import unittest

from complier.contract.ast import ModelCheck
from complier.contract.evaluator import EvaluationResult, evaluate_contract_expression


class ContractEvaluatorTests(unittest.TestCase):
    def test_evaluate_contract_expression_returns_positive_stub_result_for_tool_input(self) -> None:
        result = evaluate_contract_expression(
            ModelCheck(name="safe"),
            "latest ai agent safety papers",
        )

        self.assertIsInstance(result, EvaluationResult)
        self.assertTrue(result.passed)
        self.assertEqual(result.reasons, [])
