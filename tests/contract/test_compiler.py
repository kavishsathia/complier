"""Tests for contract compilation into runtime workflows."""

import unittest

from complier.contract.ast import AndExpression, ContractExpressionWithPolicy, ModelCheck, RetryPolicy
from complier.contract.compiler import ContractCompiler, WorkflowCompiler
from complier.contract.parser import ParsedContract
from complier.contract.model import Contract
from complier.contract.runtime import (
    BranchBackNode,
    BranchNode,
    CallNode,
    EndNode,
    ForkNode,
    HumanNode,
    JoinNode,
    LLMNode,
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

    def test_inlines_always_guarantees_into_executable_nodes(self) -> None:
        contract = Contract.from_source(
            """
guarantee safe [no_harmful_content]:halt

workflow "research" @always safe
    | search_web
"""
        )

        workflow = contract.workflows["research"]
        start = workflow.nodes[workflow.start_node_id]
        tool = workflow.nodes[start.next_ids[0]]

        self.assertIsInstance(tool, ToolNode)
        self.assertEqual(len(tool.guards), 1)
        self.assertIsInstance(tool.guards[0], ContractExpressionWithPolicy)
        self.assertIsInstance(tool.guards[0].expression, ModelCheck)
        self.assertEqual(tool.guards[0].expression.name, "no_harmful_content")
        self.assertEqual(tool.guards[0].policy, "halt")

    def test_inlines_guarantee_references_inside_param_expressions(self) -> None:
        contract = Contract.from_source(
            """
guarantee safe [no_harmful_content]:halt

workflow "research"
    | review gate=(safe && [relevant]):2
"""
        )

        workflow = contract.workflows["research"]
        start = workflow.nodes[workflow.start_node_id]
        tool = workflow.nodes[start.next_ids[0]]

        self.assertIsInstance(tool, ToolNode)
        gate = tool.params["gate"]
        self.assertIsInstance(gate, ContractExpressionWithPolicy)
        self.assertIsInstance(gate.policy, RetryPolicy)
        self.assertEqual(gate.policy.attempts, 2)
        self.assertIsInstance(gate.expression, AndExpression)
        self.assertIsInstance(gate.expression.left, ModelCheck)
        self.assertEqual(gate.expression.left.name, "no_harmful_content")
        self.assertIsInstance(gate.expression.right, ModelCheck)
        self.assertEqual(gate.expression.right.name, "relevant")

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

    def test_compiles_multiple_workflows_in_one_contract(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | search_web

workflow "publish"
    | publish_post
"""
        )

        self.assertEqual(set(contract.workflows), {"research", "publish"})
        self.assertNotEqual(
            contract.workflows["research"].start_node_id,
            contract.workflows["publish"].start_node_id,
        )

    def test_compiles_subworkflow_fork_and_join_nodes(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | @call gather_sources
    | @fork refs @call verify_sources
    | @join refs
"""
        )

        workflow = contract.workflows["research"]
        nodes = list(workflow.nodes.values())

        self.assertTrue(any(isinstance(node, CallNode) for node in nodes))
        self.assertTrue(any(isinstance(node, ForkNode) for node in nodes))
        self.assertTrue(any(isinstance(node, JoinNode) for node in nodes))

        call = next(node for node in nodes if isinstance(node, CallNode))
        fork = next(node for node in nodes if isinstance(node, ForkNode))
        join = next(node for node in nodes if isinstance(node, JoinNode))

        self.assertEqual(call.call_type, "@call")
        self.assertEqual(call.workflow_name, "gather_sources")
        self.assertEqual(fork.fork_id, "refs")
        self.assertEqual(fork.call_type, "@call")
        self.assertEqual(fork.workflow_name, "verify_sources")
        self.assertEqual(join.fork_id, "refs")

    def test_keeps_linear_step_order_through_mixed_node_types(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | @human "What topic?"
    | @llm "Classify"
    | search_web
"""
        )

        workflow = contract.workflows["research"]
        start = workflow.nodes[workflow.start_node_id]
        first = workflow.nodes[start.next_ids[0]]
        second = workflow.nodes[first.next_ids[0]]
        third = workflow.nodes[second.next_ids[0]]
        end = workflow.nodes[third.next_ids[0]]

        self.assertIsInstance(first, HumanNode)
        self.assertIsInstance(second, LLMNode)
        self.assertIsInstance(third, ToolNode)
        self.assertIsInstance(end, EndNode)

    def test_branch_back_reconnects_to_following_step(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | @branch
        -when "technical"
            | detailed_review
        -else
            | overview
    | finalize
"""
        )

        workflow = contract.workflows["research"]
        branch_back = next(
            node for node in workflow.nodes.values() if isinstance(node, BranchBackNode)
        )
        next_node = workflow.nodes[branch_back.next_ids[0]]

        self.assertIsInstance(next_node, ToolNode)
        self.assertEqual(next_node.tool_name, "finalize")

    def test_unordered_back_reconnects_to_following_step(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | @unordered
        -step "first"
            | first_step
        -step "second"
            | second_step
    | finalize
"""
        )

        workflow = contract.workflows["research"]
        back = next(node for node in workflow.nodes.values() if isinstance(node, UnorderedBackNode))
        next_node = workflow.nodes[back.next_ids[0]]

        self.assertIsInstance(next_node, ToolNode)
        self.assertEqual(next_node.tool_name, "finalize")

    def test_workflow_compiler_rejects_unknown_step_type(self) -> None:
        compiler = WorkflowCompiler(guarantees={}, workflow_name="demo")

        with self.assertRaises(TypeError):
            compiler._compile_step(object(), [])  # type: ignore[arg-type]

    def test_inlines_nested_guarantee_references_globally(self) -> None:
        contract = Contract.from_source(
            """
guarantee safe [no_harmful_content]:halt
guarantee reviewed ((safe && [quality]):2)

workflow "research"
    | publish gate=reviewed
"""
        )

        expression = contract.guarantees["reviewed"]
        self.assertIsInstance(expression, ContractExpressionWithPolicy)
        self.assertIsInstance(expression.policy, RetryPolicy)
        self.assertEqual(expression.policy.attempts, 2)
        self.assertIsInstance(expression.expression, AndExpression)
        self.assertIsInstance(expression.expression.left, ModelCheck)
        self.assertEqual(expression.expression.left.name, "no_harmful_content")
        self.assertIsInstance(expression.expression.right, ModelCheck)
        self.assertEqual(expression.expression.right.name, "quality")

    def test_applies_inherited_guards_to_all_executable_step_types(self) -> None:
        contract = Contract.from_source(
            """
guarantee safe [no_harmful_content]:halt

workflow "research" @always safe
    | @human "What topic?"
    | @llm "Classify"
    | search_web
    | @call gather_sources
    | @fork refs @call verify_sources
    | @join refs
"""
        )

        workflow = contract.workflows["research"]
        executable_nodes = [
            node
            for node in workflow.nodes.values()
            if isinstance(node, (HumanNode, LLMNode, ToolNode, CallNode, ForkNode, JoinNode))
        ]

        self.assertTrue(executable_nodes)
        for node in executable_nodes:
            self.assertEqual(len(node.guards), 1)
            self.assertIsInstance(node.guards[0], ContractExpressionWithPolicy)
            self.assertIsInstance(node.guards[0].expression, ModelCheck)
            self.assertEqual(node.guards[0].expression.name, "no_harmful_content")
            self.assertEqual(node.guards[0].policy, "halt")

    def test_contract_compiler_rejects_non_parsed_contract_input(self) -> None:
        with self.assertRaises(TypeError):
            ContractCompiler().compile(object())  # type: ignore[arg-type]

    def test_contract_compiler_rejects_missing_program_ast(self) -> None:
        parsed = ParsedContract(source="workflow \"x\"\n    | search_web", tree=object(), program=object())  # type: ignore[arg-type]

        with self.assertRaises(TypeError):
            ContractCompiler().compile(parsed)

    def test_compiled_workflow_node_ids_are_unique(self) -> None:
        contract = Contract.from_source(
            """
workflow "research"
    | @human "What topic?"
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
    | finalize
"""
        )

        workflow = contract.workflows["research"]
        node_ids = list(workflow.nodes)

        self.assertEqual(len(node_ids), len(set(node_ids)))
