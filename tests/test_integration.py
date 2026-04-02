"""Tests for the integration abstraction."""

import unittest

from complier import Integration


class IntegrationTests(unittest.TestCase):
    def test_integration_verify_returns_structured_output(self) -> None:
        class StubIntegration(Integration):
            def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, object]:
                self.prompt = prompt
                self.output_schema = output_schema
                return {"passed": True, "reason": "ok"}

        integration = StubIntegration()
        result = integration.verify(
            "Check whether this query is safe.",
            {"passed": bool, "reason": str},
        )

        self.assertEqual(integration.prompt, "Check whether this query is safe.")
        self.assertEqual(integration.output_schema, {"passed": bool, "reason": str})
        self.assertEqual(result, {"passed": True, "reason": "ok"})

    def test_base_integration_verify_is_not_implemented(self) -> None:
        with self.assertRaises(NotImplementedError):
            Integration().verify("prompt", {"passed": bool})
