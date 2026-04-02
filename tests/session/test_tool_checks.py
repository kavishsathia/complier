"""Tests for session-level tool call validation."""

import unittest

from complier.contract.model import Contract
from complier.integration import Integration


class SessionToolCheckTests(unittest.TestCase):
    def test_rejects_when_multiple_workflows_exist_without_active_workflow(self) -> None:
        session = Contract.from_source(
            """
workflow "research"
    | search_web

workflow "publish"
    | publish_post
"""
        ).create_session()

        decision = session.check_tool_call("search_web", (), {})

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "No active workflow is available.")

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

    def test_missing_required_param_blocks_validation(self) -> None:
        session = Contract.from_source(
            """
workflow "publish"
    | publish_post channel="blog"
"""
        ).create_session()

        decision = session.check_tool_call("publish_post", (), {})

        self.assertFalse(decision.allowed)
        self.assertEqual(
            decision.reason,
            "Tool 'publish_post' did not satisfy the declared param constraints.",
        )
        self.assertEqual(decision.remediation.missing_requirements, ["Missing required param 'channel'."])

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

    def test_ambiguous_same_tool_requires_choice(self) -> None:
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

        decision = session.check_tool_call("search_web", (), {"query": "papers"})

        self.assertFalse(decision.allowed)
        self.assertEqual(
            decision.reason,
            "Tool 'search_web' requires a choice before it can run.",
        )
        self.assertEqual(
            decision.remediation.message,
            "Retry this action with a choice to select the intended branch or unordered step.",
        )

    def test_invalid_choice_leaves_tool_unavailable(self) -> None:
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

        decision = session.check_tool_call(
            "search_web",
            (),
            {"query": "papers"},
            choice="unknown",
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "Tool 'search_web' is not allowed next.")

    def test_retry_policy_tracks_attempts_and_blocks_until_exhausted(self) -> None:
        class RejectingModel(Integration):
            def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, object]:
                return {"safe": False}

        session = Contract.from_source(
            """
workflow "research"
    | search_web query=[safe]:2
"""
        ).create_session(model=RejectingModel())

        first = session.check_tool_call("search_web", (), {"query": "bad query"})

        self.assertFalse(first.allowed)
        self.assertEqual(first.remediation.message, "Retry this action. 1 retries remain.")
        self.assertEqual(len(first.remediation.allowed_next_actions), 1)
        self.assertEqual(list(session.state.retry_counts.values()), [1])

        second = session.check_tool_call("search_web", (), {"query": "bad query"})

        self.assertFalse(second.allowed)
        self.assertEqual(second.reason, "Tool 'search_web' exhausted its retry policy.")
        self.assertTrue(session.state.terminated)

    def test_halt_policy_terminates_session(self) -> None:
        class RejectingModel(Integration):
            def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, object]:
                return {"safe": False}

        session = Contract.from_source(
            """
workflow "research"
    | search_web query=[safe]:halt
"""
        ).create_session(model=RejectingModel())

        decision = session.check_tool_call("search_web", (), {"query": "bad query"})

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "Tool 'search_web' failed a halt policy check.")
        self.assertTrue(session.state.terminated)

    def test_halted_session_blocks_future_calls_immediately(self) -> None:
        class RejectingModel(Integration):
            def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, object]:
                return {"safe": False}

        session = Contract.from_source(
            """
workflow "research"
    | search_web query=[safe]:halt
"""
        ).create_session(model=RejectingModel())

        session.check_tool_call("search_web", (), {"query": "bad query"})
        decision = session.check_tool_call("search_web", (), {"query": "bad query"})

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.reason, "The session has been halted.")

    def test_skip_policy_advances_past_node_and_uses_branch_choice(self) -> None:
        class RejectingModel(Integration):
            def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, object]:
                return {"safe": False}

        session = Contract.from_source(
            """
workflow "research"
    | @branch
        -when "technical"
            | search_web query=[safe]:skip
            | finalize_technical
        -else
            | search_web query="overview"
            | finalize_overview
"""
        ).create_session(model=RejectingModel())

        decision = session.check_tool_call(
            "search_web",
            (),
            {"query": "bad query"},
            choice="technical",
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(
            decision.reason,
            "Tool 'search_web' was skipped after a failed constraint.",
        )
        self.assertEqual(decision.remediation.allowed_next_actions, ["finalize_technical"])

    def test_skip_policy_on_unordered_step_uses_choice_for_next_actions(self) -> None:
        class RejectingModel(Integration):
            def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, object]:
                return {"safe": False}

        session = Contract.from_source(
            """
workflow "research"
    | @unordered
        -step "first"
            | search_web query=[safe]:skip
            | finalize_first
        -step "second"
            | search_web query="ok"
            | finalize_second
"""
        ).create_session(model=RejectingModel())

        decision = session.check_tool_call(
            "search_web",
            (),
            {"query": "bad query"},
            choice="first",
        )

        self.assertFalse(decision.allowed)
        self.assertEqual(decision.remediation.allowed_next_actions, ["finalize_first"])
