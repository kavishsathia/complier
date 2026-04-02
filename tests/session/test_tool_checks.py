"""Tests for session-level tool call validation."""

import unittest

from complier.contract.model import Contract
from complier.integration import Integration


class SessionToolCheckTests(unittest.TestCase):
    def test_allows_next_tool_when_name_matches(self) -> None:
        session = Contract.from_source(
            """
workflow "research"
    | search_web
"""
        ).create_session()

        decision = session.check_tool_call("search_web", (), {})

        self.assertTrue(decision.allowed)
        self.assertEqual(session.state.active_workflow, "research")
        self.assertIsNotNone(session.state.active_step)

    def test_rejects_tool_that_is_not_allowed_next(self) -> None:
        session = Contract.from_source(
            """
workflow "research"
    | search_web
"""
        ).create_session()

        decision = session.check_tool_call("send_email", (), {})

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "Tool 'send_email' is not allowed next.")

    def test_requires_declared_exact_match_param_values(self) -> None:
        session = Contract.from_source(
            """
workflow "publish"
    | publish_post channel="blog"
"""
        ).create_session()

        allowed = session.check_tool_call("publish_post", (), {"channel": "blog"})
        blocked = session.check_tool_call("publish_post", (), {"channel": "social"})

        self.assertTrue(allowed.allowed)
        self.assertFalse(blocked.allowed)

    def test_undeclared_params_are_treated_as_unconstrained(self) -> None:
        session = Contract.from_source(
            """
workflow "research"
    | search_web
"""
        ).create_session()

        decision = session.check_tool_call(
            "search_web",
            (),
            {"query": "agent compliance", "limit": 5},
        )

        self.assertTrue(decision.allowed)

    def test_expression_params_use_integrations_during_validation(self) -> None:
        class StubModel(Integration):
            def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, object]:
                return {"safe": True}

        session = Contract.from_source(
            """
workflow "research"
    | search_web query=[safe]
"""
        ).create_session(model=StubModel())

        decision = session.check_tool_call(
            "search_web",
            (),
            {"query": "agent compliance"},
        )

        self.assertTrue(decision.allowed)

    def test_branch_choice_selects_matching_arm(self) -> None:
        session = Contract.from_source(
            """
workflow "research"
    | @branch
        -when "technical"
            | search_web query="papers"
        -else
            | search_web query="overview"
"""
        ).create_session()

        technical = session.check_tool_call(
            "search_web",
            (),
            {"query": "papers"},
            choice="technical",
        )

        other = Contract.from_source(
            """
workflow "research"
    | @branch
        -when "technical"
            | search_web query="papers"
        -else
            | search_web query="overview"
"""
        ).create_session().check_tool_call(
            "search_web",
            (),
            {"query": "overview"},
            choice="else",
        )

        self.assertTrue(technical.allowed)
        self.assertTrue(other.allowed)
