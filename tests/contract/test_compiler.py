"""Tests for contract compilation into runtime workflows."""

import unittest

from complier.contract.ast import AndExpression, ModelCheck, RetryPolicy
from complier.contract.model import Contract
from complier.contract.runtime import (
    BranchBackNode,
    BranchNode,
    EndNode,
    StartNode,
    ToolNode,
    UnorderedBackNode,
    UnorderedNode,
)


class ContractCompilerTests(unittest.TestCase):
    def test_compiles_workflow_with_start_and_end_nodes(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | search_web
"""
        )

        workflow = contract.workflows["research"]
        start = workflow.nodes[workflow.start_node_id]
        end = workflow.nodes[workflow.end_node_id]

        self.assertIsInstance(start, StartNode)
        self.assertIsInstance(end, EndNode)
        self.assertEqual(len(start.next_ids), 1)

        tool = workflow.nodes[start.next_ids[0]]
        self.assertIsInstance(tool, ToolNode)
        self.assertEqual(tool.tool_name, "search_web")
        self.assertEqual(tool.next_ids, [end.id])

    def test_inlines_always_guarantees_into_executable_nodes(self) -> None:
        contract = Contract.from_source(
            """
guarantee safe [no_harmful_content:halt]

workflow "research" @always safe
    | search_web
"""
        )

        workflow = contract.workflows["research"]
        start = workflow.nodes[workflow.start_node_id]
        tool = workflow.nodes[start.next_ids[0]]

        self.assertIsInstance(tool, ToolNode)
        self.assertEqual(len(tool.guards), 1)
        self.assertIsInstance(tool.guards[0], ModelCheck)
        self.assertEqual(tool.guards[0].name, "no_harmful_content")
        self.assertEqual(tool.guards[0].policy, "halt")

    def test_inlines_guarantee_references_inside_param_expressions(self) -> None:
        contract = Contract.from_source(
            """
guarantee safe [no_harmful_content:halt]

workflow "research"
    | review gate=(safe && [relevant:2])
"""
        )

        workflow = contract.workflows["research"]
        start = workflow.nodes[workflow.start_node_id]
        tool = workflow.nodes[start.next_ids[0]]

        self.assertIsInstance(tool, ToolNode)
        gate = tool.params["gate"]
        self.assertIsInstance(gate, AndExpression)
        self.assertIsInstance(gate.left, ModelCheck)
        self.assertEqual(gate.left.name, "no_harmful_content")
        self.assertEqual(gate.left.policy, "halt")
        self.assertIsInstance(gate.right, ModelCheck)
        self.assertIsInstance(gate.right.policy, RetryPolicy)
        self.assertEqual(gate.right.policy.attempts, 2)

    def test_compiles_branch_and_unordered_control_flow_nodes(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | @branch
        -when "technical"
            | detailed_review
        -else
            | overview
    | @unordered
        -step "first"
            | first_step
        -step "second"
            | second_step
"""
        )

        workflow = contract.workflows["research"]
        nodes = workflow.nodes.values()

        self.assertTrue(any(isinstance(node, BranchNode) and node.mode == "branch" for node in nodes))
        self.assertTrue(any(isinstance(node, BranchBackNode) for node in nodes))
        self.assertTrue(any(isinstance(node, UnorderedNode) for node in nodes))
        self.assertTrue(any(isinstance(node, UnorderedBackNode) for node in nodes))

    def test_compiles_loops_as_branch_exit_plus_else_body(self) -> None:
        contract = Contract.from_source(
            """
workflow "review"
    | @loop
        | ask_human
        -until "yes"
"""
        )

        workflow = contract.workflows["review"]
        loop_branch = next(
            node
            for node in workflow.nodes.values()
            if isinstance(node, BranchNode) and node.mode == "loop"
        )
        loop_back = workflow.nodes[loop_branch.branch_back_id]
        body_entry = workflow.nodes[loop_branch.else_node_id]

        self.assertIsInstance(loop_back, BranchBackNode)
        self.assertEqual(loop_branch.arms["yes"], loop_back.id)
        self.assertIsInstance(body_entry, ToolNode)
        self.assertEqual(body_entry.tool_name, "ask_human")
        self.assertEqual(body_entry.next_ids, [loop_branch.id])
