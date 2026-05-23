"""Tests for the Verifier protocol and built-in verifier hierarchy."""

import unittest

from complier import CelVerifier, HumanVerifier, ModelVerifier, Verifier
from complier.contract.ast import CelExpression, HumanPrompt, ModelPrompt
from complier.verification import default_verifiers


class VerifierProtocolTests(unittest.TestCase):
    def test_model_verifier_satisfies_protocol(self) -> None:
        verifier: Verifier = ModelVerifier(verify_fn=lambda p, v, c: True)
        self.assertTrue(verifier.handles(ModelPrompt(text="x")))
        self.assertFalse(verifier.handles(HumanPrompt(text="x")))
        self.assertFalse(verifier.handles(CelExpression(text="x")))

    def test_human_verifier_satisfies_protocol(self) -> None:
        verifier: Verifier = HumanVerifier(verify_fn=lambda p, v, c: True)
        self.assertTrue(verifier.handles(HumanPrompt(text="x")))
        self.assertFalse(verifier.handles(ModelPrompt(text="x")))

    def test_cel_verifier_satisfies_protocol(self) -> None:
        verifier: Verifier = CelVerifier()
        self.assertTrue(verifier.handles(CelExpression(text="x")))
        self.assertFalse(verifier.handles(ModelPrompt(text="x")))

    def test_default_verifiers_includes_cel_only(self) -> None:
        verifiers = default_verifiers()
        self.assertEqual(len(verifiers), 1)
        self.assertIsInstance(verifiers[0], CelVerifier)


class ModelVerifierTests(unittest.TestCase):
    def test_model_verifier_passes_when_callback_returns_true(self) -> None:
        v = ModelVerifier(verify_fn=lambda prompt, value, context: True)
        result = v.evaluate(
            ModelPrompt(text="must be safe"),
            "anything",
            context={},
        )
        self.assertTrue(result.passed)

    def test_model_verifier_captures_callback_exception(self) -> None:
        def boom(prompt, value, context):
            raise RuntimeError("LLM unreachable")

        v = ModelVerifier(verify_fn=boom)
        result = v.evaluate(ModelPrompt(text="x"), "y", context={})
        self.assertFalse(result.passed)
        self.assertTrue(any("LLM unreachable" in r for r in result.reasons))


class HumanVerifierTests(unittest.TestCase):
    def test_human_verifier_blocks_with_policy_when_rejected(self) -> None:
        v = HumanVerifier(verify_fn=lambda p, v, c: False)
        result = v.evaluate(HumanPrompt(text="approve?", policy="halt"), "draft", context={})
        self.assertFalse(result.passed)
        self.assertEqual(result.policy, "halt")
