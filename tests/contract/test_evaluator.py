"""Tests for prose guard evaluation."""

import unittest

from complier import Verifier
from complier.contract.ast import (
    HumanCheck,
    ModelCheck,
    ProseGuard,
    RetryPolicy,
)
from complier.contract.evaluator import (
    EvaluationResult,
    evaluate_contract_expression,
)


class ContractEvaluatorTests(unittest.TestCase):
    def test_evaluate_contract_expression_uses_model_verifier_for_tool_input(self) -> None:
        class StubModel(Verifier):
            def __init__(self) -> None:
                self.calls = []

            def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, object]:
                self.calls.append((prompt, output_schema))
                return {"safe": True, "relevant": True}

        model = StubModel()
        result = evaluate_contract_expression(
            ProseGuard(
                prose="must be [safe] and [relevant]",
                checks=[ModelCheck(name="safe"), ModelCheck(name="relevant")],
                policy=RetryPolicy(attempts=3),
            ),
            "latest ai agent safety papers",
            model=model,
        )

        self.assertIsInstance(result, EvaluationResult)
        self.assertTrue(result.passed)
        self.assertEqual(result.reasons, [])
        self.assertEqual(len(model.calls), 1)
        self.assertEqual(model.calls[0][1], {"safe": bool, "relevant": bool})

    def test_model_checks_fail_cleanly_without_model_verifier(self) -> None:
        result = evaluate_contract_expression(
            ProseGuard(
                prose="must be [safe]",
                checks=[ModelCheck(name="safe")],
                policy=RetryPolicy(attempts=3),
            ),
            "draft answer",
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.reasons, ["Model verifier is required for model checks."])
        self.assertIsInstance(result.policy, RetryPolicy)

    def test_human_checks_fail_cleanly_without_human_verifier(self) -> None:
        result = evaluate_contract_expression(
            ProseGuard(
                prose="must be {approved}",
                checks=[HumanCheck(name="approved")],
                policy="halt",
            ),
            "draft answer",
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.reasons, ["Human verifier is required for human checks."])
        self.assertEqual(result.policy, "halt")

    def test_all_checks_must_pass(self) -> None:
        class StubModel(Verifier):
            def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, object]:
                return {"safe": True, "relevant": False}

        result = evaluate_contract_expression(
            ProseGuard(
                prose="must be [safe] and [relevant]",
                checks=[ModelCheck(name="safe"), ModelCheck(name="relevant")],
                policy="halt",
            ),
            "some value",
            model=StubModel(),
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.policy, "halt")

    def test_empty_checks_always_passes(self) -> None:
        result = evaluate_contract_expression(
            ProseGuard(prose="no checks here"),
            "anything",
        )
        self.assertTrue(result.passed)
