"""Tests for tool parameter value parsing."""

import unittest

from complier.contract.parser import ContractParser
from complier.contract.ast import (
    CelExpression,
    HintPrompt,
    HumanPrompt,
    ModelPrompt,
    Param,
    RetryPolicy,
    ToolStep,
)

from .helpers import parse_program


class ParamValueParsingTests(unittest.TestCase):
    def test_parses_scalar_param_values(self) -> None:
        program = parse_program(
            """
workflow "params"
    | tool text="hello" count=3 enabled=true disabled=false reviewer=null
"""
        )

        tool = program.items[0].steps[0]
        self.assertIsInstance(tool, ToolStep)
        params = {param.name: param.value for param in tool.params}

        self.assertEqual(params["text"], "hello")
        self.assertEqual(params["count"], 3)
        self.assertIs(params["enabled"], True)
        self.assertIs(params["disabled"], False)
        self.assertIsNone(params["reviewer"])

    def test_parses_hint_prompt_as_param_value(self) -> None:
        program = parse_program(
            """
workflow "hints"
    | classify gate=(must be relevant and concise)
"""
        )
        gate = program.items[0].steps[0].params[0]
        self.assertIsInstance(gate, Param)
        self.assertEqual(gate.name, "gate")
        self.assertIsInstance(gate.value, HintPrompt)
        self.assertEqual(gate.value.text, "must be relevant and concise")

    def test_parses_model_prompt_with_policy(self) -> None:
        program = parse_program(
            """
workflow "checks"
    | classify gate=[must be relevant and concise]:halt
"""
        )
        gate = program.items[0].steps[0].params[0]
        self.assertIsInstance(gate.value, ModelPrompt)
        self.assertEqual(gate.value.text, "must be relevant and concise")
        self.assertEqual(gate.value.policy, "halt")

    def test_parses_human_prompt_with_default_retry(self) -> None:
        program = parse_program(
            """
workflow "checks"
    | publish gate={editor approved this}
"""
        )
        gate = program.items[0].steps[0].params[0]
        self.assertIsInstance(gate.value, HumanPrompt)
        self.assertEqual(gate.value.text, "editor approved this")
        self.assertIsInstance(gate.value.policy, RetryPolicy)
        self.assertEqual(gate.value.policy.attempts, 3)

    def test_parses_cel_expression_with_policy(self) -> None:
        program = parse_program(
            """
workflow "explore"
    | Bash command=`command.startsWith("grep ")`:halt
"""
        )
        command = program.items[0].steps[0].params[0]
        self.assertIsInstance(command.value, CelExpression)
        self.assertEqual(command.value.text, 'command.startsWith("grep ")')
        self.assertEqual(command.value.policy, "halt")

    def test_prompt_constraints_default_to_retry_three(self) -> None:
        program = parse_program(
            """
workflow "checks"
    | classify gate=[must be relevant]
"""
        )
        gate = program.items[0].steps[0].params[0]
        self.assertIsInstance(gate.value, ModelPrompt)
        self.assertIsInstance(gate.value.policy, RetryPolicy)
        self.assertEqual(gate.value.policy.attempts, 3)

    def test_public_parser_round_trips_scalar_param_values_without_trailing_newline(self) -> None:
        parsed = ContractParser().parse(
            'workflow "params"\n    | tool count=3 enabled=true disabled=false reviewer=null'
        )

        tool = parsed.program.items[0].steps[0]
        self.assertIsInstance(tool, ToolStep)
        params = {param.name: param.value for param in tool.params}

        self.assertEqual(params["count"], 3)
        self.assertIs(params["enabled"], True)
        self.assertIs(params["disabled"], False)
        self.assertIsNone(params["reviewer"])
