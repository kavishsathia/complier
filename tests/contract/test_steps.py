"""Tests for workflow step parsing."""

import unittest

from complier.contract.ast import (
    BranchStep,
    ForkStep,
    HumanStep,
    JoinStep,
    LlmStep,
    LoopStep,
    SubworkflowStep,
    ToolStep,
    UnorderedStep,
    Workflow,
)

from .helpers import parse_program


class WorkflowStepParsingTests(unittest.TestCase):
    def test_parses_basic_inline_steps(self) -> None:
        program = parse_program(
            """
workflow "ops" @always safe @always approved
    | @human "What happened?"
    | @llm "Summarize incident"
    | search_logs
    | @call triage
    | @fork refs @call collect_refs
    | @join refs
"""
        )

        workflow = program.items[0]
        self.assertIsInstance(workflow, Workflow)
        self.assertEqual(workflow.name, "ops")
        self.assertEqual(workflow.always, ["safe", "approved"])
        self.assertIsInstance(workflow.steps[0], HumanStep)
        self.assertIsInstance(workflow.steps[1], LlmStep)
        self.assertIsInstance(workflow.steps[2], ToolStep)
        self.assertIsInstance(workflow.steps[3], SubworkflowStep)
        self.assertIsInstance(workflow.steps[4], ForkStep)
        self.assertIsInstance(workflow.steps[5], JoinStep)

    def test_parses_use_inline_and_fork_join_details(self) -> None:
        program = parse_program(
            """
workflow "ops"
    | @use triage
    | @inline summarize
    | @fork refs @inline collect_refs
    | @join refs
"""
        )

        workflow = program.items[0]
        self.assertIsInstance(workflow.steps[0], SubworkflowStep)
        self.assertEqual(workflow.steps[0].call_type, "@use")
        self.assertEqual(workflow.steps[0].workflow_name, "triage")

        self.assertIsInstance(workflow.steps[1], SubworkflowStep)
        self.assertEqual(workflow.steps[1].call_type, "@inline")
        self.assertEqual(workflow.steps[1].workflow_name, "summarize")

        self.assertIsInstance(workflow.steps[2], ForkStep)
        self.assertEqual(workflow.steps[2].fork_id, "refs")
        self.assertEqual(workflow.steps[2].target.call_type, "@inline")
        self.assertEqual(workflow.steps[2].target.workflow_name, "collect_refs")

        self.assertIsInstance(workflow.steps[3], JoinStep)
        self.assertEqual(workflow.steps[3].fork_id, "refs")

    def test_parses_branch_loop_and_unordered_blocks(self) -> None:
        program = parse_program(
            """
workflow "research"
    | @branch
        -when "technical"
            | @llm "Write detailed analysis"
            | @loop
                | @human "Continue?"
                -until "yes"
        -else
            | @llm "Write overview"
    | @unordered
        -step "format citations"
            | format_citations
        -step "generate bibliography"
            | generate_bibliography
"""
        )

        workflow = program.items[0]
        self.assertIsInstance(workflow.steps[0], BranchStep)
        self.assertIsInstance(workflow.steps[1], UnorderedStep)

        branch = workflow.steps[0]
        self.assertEqual(len(branch.when_arms), 1)
        self.assertEqual(branch.when_arms[0].condition, "technical")
        self.assertIsInstance(branch.when_arms[0].steps[0], LlmStep)
        self.assertIsInstance(branch.when_arms[0].steps[1], LoopStep)
        self.assertEqual(branch.when_arms[0].steps[1].until, "yes")
        self.assertIsNotNone(branch.else_arm)
        self.assertIsInstance(branch.else_arm.steps[0], LlmStep)

        unordered = workflow.steps[1]
        self.assertEqual(len(unordered.cases), 2)
        self.assertEqual(unordered.cases[0].label, "format citations")
        self.assertIsInstance(unordered.cases[0].steps[0], ToolStep)
        self.assertEqual(unordered.cases[1].label, "generate bibliography")

    def test_preserves_unordered_case_labels_and_steps(self) -> None:
        program = parse_program(
            """
workflow "research"
    | @unordered
        -step "first pass"
            | collect_sources
        -step "fact check"
            | verify_sources
"""
        )

        unordered = program.items[0].steps[0]
        self.assertIsInstance(unordered, UnorderedStep)
        self.assertEqual([case.label for case in unordered.cases], ["first pass", "fact check"])
        self.assertEqual(unordered.cases[0].steps[0].name, "collect_sources")
        self.assertEqual(unordered.cases[1].steps[0].name, "verify_sources")
