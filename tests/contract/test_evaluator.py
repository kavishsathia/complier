"""Tests for evaluator dispatch over typed param values."""

import unittest

from complier import ModelVerifier, HumanVerifier
from complier.contract.ast import (
    CelExpression,
    HintPrompt,
    HumanPrompt,
    ModelPrompt,
    RetryPolicy,
)
from complier.contract.evaluator import evaluate_constraint
from complier.verification import CelVerifier, EvaluationResult


class HintPromptTests(unittest.TestCase):
    def test_hint_prompt_always_passes_regardless_of_value(self) -> None:
        result = evaluate_constraint(HintPrompt(text="should be safe"), "anything")
        self.assertIsInstance(result, EvaluationResult)
        self.assertTrue(result.passed)


class LiteralTests(unittest.TestCase):
    def test_literal_match_passes(self) -> None:
        result = evaluate_constraint("hello", "hello")
        self.assertTrue(result.passed)

    def test_literal_mismatch_fails(self) -> None:
        result = evaluate_constraint("hello", "world")
        self.assertFalse(result.passed)


class ModelPromptTests(unittest.TestCase):
    def test_model_prompt_dispatches_to_model_verifier(self) -> None:
        calls = []

        def verify(prompt, value, context):
            calls.append((prompt, value, dict(context)))
            return True

        verifier = ModelVerifier(verify_fn=verify)
        result = evaluate_constraint(
            ModelPrompt(text="must be safe"),
            "agent compliance",
            verifiers=[verifier],
            context={"sibling": 1},
        )
        self.assertTrue(result.passed)
        self.assertEqual(calls[0][0], "must be safe")
        self.assertEqual(calls[0][1], "agent compliance")
        self.assertEqual(calls[0][2], {"sibling": 1})

    def test_model_prompt_fails_with_policy_when_verifier_returns_false(self) -> None:
        verifier = ModelVerifier(verify_fn=lambda p, v, c: False)
        result = evaluate_constraint(
            ModelPrompt(text="must be safe", policy="halt"),
            "anything",
            verifiers=[verifier],
        )
        self.assertFalse(result.passed)
        self.assertEqual(result.policy, "halt")

    def test_model_prompt_without_matching_verifier_fails_cleanly(self) -> None:
        result = evaluate_constraint(
            ModelPrompt(text="must be safe"),
            "anything",
            verifiers=[],
        )
        self.assertFalse(result.passed)
        self.assertIn("No verifier registered for ModelPrompt", result.reasons[0])


class HumanPromptTests(unittest.TestCase):
    def test_human_prompt_dispatches_to_human_verifier(self) -> None:
        verifier = HumanVerifier(verify_fn=lambda p, v, c: True)
        result = evaluate_constraint(
            HumanPrompt(text="editor approved"),
            "draft",
            verifiers=[verifier],
        )
        self.assertTrue(result.passed)

    def test_human_prompt_without_verifier_fails(self) -> None:
        result = evaluate_constraint(
            HumanPrompt(text="editor approved"),
            "draft",
            verifiers=[],
        )
        self.assertFalse(result.passed)


class CelExpressionTests(unittest.TestCase):
    def test_cel_expression_passes_when_predicate_true(self) -> None:
        result = evaluate_constraint(
            CelExpression(text='command.startsWith("grep ")'),
            "grep -n foo bar",
            verifiers=[CelVerifier()],
            context={"command": "grep -n foo bar"},
        )
        self.assertTrue(result.passed)

    def test_cel_expression_fails_when_predicate_false(self) -> None:
        result = evaluate_constraint(
            CelExpression(text='command.startsWith("grep ")'),
            "cat foo",
            verifiers=[CelVerifier()],
            context={"command": "cat foo"},
        )
        self.assertFalse(result.passed)


class VerifierDispatchTests(unittest.TestCase):
    def test_dispatch_picks_the_first_handling_verifier(self) -> None:
        model = ModelVerifier(verify_fn=lambda p, v, c: True)
        result = evaluate_constraint(
            ModelPrompt(text="x"),
            "y",
            verifiers=[CelVerifier(), model],
        )
        self.assertTrue(result.passed)

    def test_default_policy_is_retry_3_when_unspecified(self) -> None:
        prompt = ModelPrompt(text="x")
        self.assertIsInstance(prompt.policy, RetryPolicy)
        self.assertEqual(prompt.policy.attempts, 3)
