"""Tests for Session.kickoff() and workflow selection."""

import unittest

from complier.contract.model import Contract
from complier.session.decisions import NextActions, NextActionDescriptor
from complier.contract.ast import ProseGuard, ModelCheck, RetryPolicy


def _session(source: str, **kwargs):
    return Contract.from_source(source).create_session(**kwargs)


class KickoffTests(unittest.TestCase):
    def test_kickoff_lists_first_tool(self) -> None:
        session = _session(
            """
workflow "research"
    | search_web
"""
        )
        result = session.kickoff()
        self.assertIn("search_web", result)

    def test_kickoff_includes_param_prose(self) -> None:
        session = _session(
            """
workflow "research"
    | search_web query='must return [verified sources]'
"""
        )
        result = session.kickoff()
        self.assertIn("search_web", result)
        self.assertIn("verified sources", result)
        self.assertNotIn("[", result)

    def test_kickoff_includes_workflow_guard_prose(self) -> None:
        session = _session(
            """
guarantee safe 'must not contain [harmful content]':halt

workflow "research" @always safe
    | search_web
"""
        )
        result = session.kickoff()
        self.assertIn("search_web", result)
        self.assertIn("harmful content", result)
        self.assertNotIn("[", result)

    def test_kickoff_lists_all_branch_arms(self) -> None:
        session = _session(
            """
workflow "research"
    | @branch
        -when "morning"
            | search_web
        -when "evening"
            | read_cache
"""
        )
        result = session.kickoff()
        self.assertIn("search_web", result)
        self.assertIn("read_cache", result)

    def test_kickoff_includes_choice_label_for_branch(self) -> None:
        session = _session(
            """
workflow "research"
    | @branch
        -when "morning"
            | search_web
        -when "evening"
            | read_cache
"""
        )
        result = session.kickoff()
        self.assertIn("morning", result)
        self.assertIn("evening", result)

    def test_kickoff_raises_when_multiple_workflows_and_none_selected(self) -> None:
        session = _session(
            """
workflow "research"
    | search_web

workflow "publish"
    | publish_post
"""
        )
        with self.assertRaises(RuntimeError):
            session.kickoff()

    def test_kickoff_works_when_workflow_preselected(self) -> None:
        session = _session(
            """
workflow "research"
    | search_web

workflow "publish"
    | publish_post
""",
            workflow="research",
        )
        result = session.kickoff()
        self.assertIn("search_web", result)
        self.assertNotIn("publish_post", result)


class WorkflowSelectionTests(unittest.TestCase):
    def test_workflow_param_sets_active_workflow(self) -> None:
        session = _session(
            """
workflow "research"
    | search_web

workflow "publish"
    | publish_post
""",
            workflow="research",
        )
        self.assertEqual(session.state.active_workflow, "research")

    def test_unknown_workflow_raises_on_creation(self) -> None:
        with self.assertRaises(ValueError):
            _session(
                """
workflow "research"
    | search_web
""",
                workflow="nonexistent",
            )

    def test_single_workflow_needs_no_selection(self) -> None:
        session = _session(
            """
workflow "research"
    | search_web
"""
        )
        result = session.kickoff()
        self.assertIn("search_web", result)


class CustomFormatterTests(unittest.TestCase):
    def test_custom_formatter_receives_next_actions_struct(self) -> None:
        received = []

        def my_formatter(next_actions: NextActions) -> list[str]:
            received.append(next_actions)
            return [f"do: {d.tool_name}" for d in next_actions.actions]

        session = _session(
            """
workflow "research"
    | search_web
""",
            formatter=my_formatter,
        )
        result = session.kickoff()

        self.assertEqual(len(received), 1)
        self.assertIsInstance(received[0], NextActions)
        self.assertEqual(result, "do: search_web")

    def test_custom_formatter_receives_is_branch_possible(self) -> None:
        received = []

        def my_formatter(next_actions: NextActions) -> list[str]:
            received.append(next_actions)
            return []

        session = _session(
            """
workflow "research"
    | @branch
        -when "a"
            | search_web
        -when "b"
            | read_cache
""",
            formatter=my_formatter,
        )
        session.kickoff()

        self.assertTrue(received[0].is_branch_possible)
        self.assertFalse(received[0].is_unordered_possible)

    def test_custom_formatter_receives_is_unordered_possible(self) -> None:
        received = []

        def my_formatter(next_actions: NextActions) -> list[str]:
            received.append(next_actions)
            return []

        session = _session(
            """
workflow "research"
    | @unordered
        -step "fetch"
            | search_web
        -step "cache"
            | read_cache
""",
            formatter=my_formatter,
        )
        session.kickoff()

        self.assertFalse(received[0].is_branch_possible)
        self.assertTrue(received[0].is_unordered_possible)

    def test_custom_formatter_descriptor_has_choice_label(self) -> None:
        received = []

        def my_formatter(next_actions: NextActions) -> list[str]:
            received.append(next_actions)
            return []

        session = _session(
            """
workflow "research"
    | @branch
        -when "morning"
            | search_web
""",
            formatter=my_formatter,
        )
        session.kickoff()

        desc = received[0].actions[0]
        self.assertIsInstance(desc, NextActionDescriptor)
        self.assertEqual(desc.tool_name, "search_web")
        self.assertEqual(desc.choice_label, "morning")
