"""Tests for the verifier abstraction."""

import unittest

from complier import Verifier


class VerifierTests(unittest.TestCase):
    def test_verify_returns_structured_output(self) -> None:
        class StubVerifier(Verifier):
            def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, object]:
                self.prompt = prompt
                self.output_schema = output_schema
                return {"passed": True, "reason": "ok"}

        verifier = StubVerifier()
        result = verifier.verify(
            "Check whether this query is safe.",
            {"passed": bool, "reason": str},
        )

        self.assertEqual(verifier.prompt, "Check whether this query is safe.")
        self.assertEqual(verifier.output_schema, {"passed": bool, "reason": str})
        self.assertEqual(result, {"passed": True, "reason": "ok"})

    def test_base_verifier_verify_is_not_implemented(self) -> None:
        with self.assertRaises(NotImplementedError):
            Verifier().verify("prompt", {"passed": bool})
