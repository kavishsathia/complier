"""Tests for tool parameter value parsing."""

import unittest

from complier.contract.parser import ContractParser
from complier.contract.ast import (
    ModelCheck,
    Param,
    ProseGuard,
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

    def test_parses_prose_guard_as_param_value(self) -> None:
        program = parse_program(
            """
workflow "checks"
    | classify gate='must be [relevant] and [concise]':halt
"""
        )

        tool = program.items[0].steps[0]
        self.assertIsInstance(tool, ToolStep)
        self.assertEqual(len(tool.params), 1)

        gate = tool.params[0]
        self.assertIsInstance(gate, Param)
        self.assertEqual(gate.name, "gate")
        self.assertIsInstance(gate.value, ProseGuard)
        self.assertEqual(gate.value.policy, "halt")
        self.assertEqual(len(gate.value.checks), 2)
        self.assertIsInstance(gate.value.checks[0], ModelCheck)
        self.assertIsInstance(gate.value.checks[1], ModelCheck)
        self.assertEqual(gate.value.checks[0].name, "relevant")
        self.assertEqual(gate.value.checks[1].name, "concise")

    def test_prose_guards_default_to_retry_three_policy(self) -> None:
        program = parse_program(
            """
workflow "checks"
    | classify gate='must be [relevant]'
"""
        )

        gate = program.items[0].steps[0].params[0]
        self.assertIsInstance(gate.value, ProseGuard)
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
