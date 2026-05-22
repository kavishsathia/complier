"""Tests for prose guard evaluation."""

import unittest

from complier import Integration
from complier.contract.ast import (
    HumanCheck,
    LearnedCheck,
    ModelCheck,
    ProseGuard,
    RetryPolicy,
)
from complier.contract.evaluator import (
    EvaluationResult,
    evaluate_contract_expression,
)
from complier.memory.model import Memory


class ContractEvaluatorTests(unittest.TestCase):
    def test_evaluate_contract_expression_uses_model_integration_for_tool_input(self) -> None:
        class StubModel(Integration):
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

    def test_evaluate_contract_expression_uses_human_then_model_for_learned_check(self) -> None:
        class StubHuman(Integration):
            def __init__(self) -> None:
                self.calls = []

            def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, object]:
                self.calls.append((prompt, output_schema))
                return {"comments": "Looks good", "edited": "edited value"}

        class StubModel(Integration):
            def __init__(self) -> None:
                self.calls = []

            def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, object]:
                self.calls.append((prompt, output_schema))
                return {"passed": True, "memory": "Updated learned preference"}

        human = StubHuman()
        model = StubModel()
        memory = Memory(checks={"tone": "Prefer calm, concise answers."})
        result = evaluate_contract_expression(
            ProseGuard(
                prose="must match #{tone}",
                checks=[LearnedCheck(name="tone")],
                policy=RetryPolicy(attempts=3),
            ),
            "draft answer",
            model=model,
            human=human,
            memory=memory,
        )

        self.assertTrue(result.passed)
        self.assertEqual(human.calls[0][1], {"comments": str, "edited": str})
        self.assertEqual(model.calls[0][1], {"passed": bool, "memory": str})
        self.assertEqual(memory.get_check("tone"), "Updated learned preference")

    def test_model_checks_fail_cleanly_without_model_integration(self) -> None:
        result = evaluate_contract_expression(
            ProseGuard(
                prose="must be [safe]",
                checks=[ModelCheck(name="safe")],
                policy=RetryPolicy(attempts=3),
            ),
            "draft answer",
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.reasons, ["Model integration is required for model checks."])
        self.assertIsInstance(result.policy, RetryPolicy)

    def test_human_checks_fail_cleanly_without_human_integration(self) -> None:
        result = evaluate_contract_expression(
            ProseGuard(
                prose="must be {approved}",
                checks=[HumanCheck(name="approved")],
                policy="halt",
            ),
            "draft answer",
        )

        self.assertFalse(result.passed)
        self.assertEqual(result.reasons, ["Human integration is required for human checks."])
        self.assertEqual(result.policy, "halt")

    def test_learned_checks_report_missing_human_or_model(self) -> None:
        guard = ProseGuard(
            prose="must match #{tone}",
            checks=[LearnedCheck(name="tone")],
            policy=RetryPolicy(attempts=3),
        )
        missing_human = evaluate_contract_expression(guard, "draft answer", model=Integration())
        missing_model = evaluate_contract_expression(guard, "draft answer", human=Integration())

        self.assertIn("Human integration is required for learned checks.", missing_human.reasons)
        self.assertIn("Model integration is required for learned checks.", missing_model.reasons)

    def test_all_checks_must_pass(self) -> None:
        class StubModel(Integration):
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
