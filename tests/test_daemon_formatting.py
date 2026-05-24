"""Tests for daemon.formatting.cli_choose_formatter."""

import unittest

from complier.contract.model import Contract
from daemon.formatting import cli_choose_formatter


class CliChooseFormatterTests(unittest.TestCase):
    def test_linear_workflow_renders_plainly(self) -> None:
        session = Contract.from_source(
            """
workflow "research"
    | search_web
    | summarize
"""
        ).create_session(formatter=cli_choose_formatter)

        hint = session.kickoff()

        self.assertEqual(hint, "search_web")
        self.assertNotIn("complier choose", hint)

    def test_branch_prepends_choose_instruction(self) -> None:
        session = Contract.from_source(
            """
workflow "research"
    | @branch
        -when "technical"
            | finalize_technical
        -else
            | finalize_overview
"""
        ).create_session(formatter=cli_choose_formatter)

        hint = session.kickoff()

        self.assertIn("branch ahead", hint)
        self.assertIn("complier choose <arm>", hint)
        self.assertIn('arm "technical": finalize_technical', hint)
        self.assertIn('arm "else": finalize_overview', hint)

    def test_unordered_prepends_choose_instruction(self) -> None:
        session = Contract.from_source(
            """
workflow "research"
    | @unordered
        -step "citations"
            | format_citations
        -step "bibliography"
            | generate_bibliography
"""
        ).create_session(formatter=cli_choose_formatter)

        hint = session.kickoff()

        self.assertIn("unordered block ahead", hint)
        self.assertIn("complier choose <arm>", hint)


if __name__ == "__main__":
    unittest.main()
