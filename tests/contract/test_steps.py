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
