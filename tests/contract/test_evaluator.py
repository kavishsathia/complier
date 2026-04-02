"""Tests for contract expression evaluation."""

import unittest

from complier import Integration
from complier.contract.ast import AndExpression, LearnedCheck, ModelCheck
from complier.contract.evaluator import EvaluationResult, evaluate_contract_expression
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
            AndExpression(
                left=ModelCheck(name="safe"),
                right=ModelCheck(name="relevant"),
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
            LearnedCheck(name="tone"),
            "draft answer",
            model=model,
            human=human,
            memory=memory,
        )

        self.assertTrue(result.passed)
        self.assertEqual(human.calls[0][1], {"comments": str, "edited": str})
        self.assertEqual(model.calls[0][1], {"passed": bool, "memory": str})
        self.assertEqual(memory.get_check("tone"), "Updated learned preference")
