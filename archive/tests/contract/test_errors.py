"""Tests for parser failure behavior."""

import unittest

from lark.exceptions import UnexpectedInput

from complier.contract.parser import ContractParser


class ParserErrorTests(unittest.TestCase):
    def test_rejects_non_string_source(self) -> None:
        parser = ContractParser()

        with self.assertRaises(TypeError):
            parser.parse(None)  # type: ignore[arg-type]

    def test_rejects_empty_source(self) -> None:
        parser = ContractParser()

        with self.assertRaises(ValueError):
            parser.parse("")

    def test_rejects_whitespace_only_source(self) -> None:
        parser = ContractParser()

        with self.assertRaises(ValueError):
            parser.parse("   \n\t  ")

    def test_rejects_llm_contract_attachments(self) -> None:
        parser = ContractParser()

        with self.assertRaises(UnexpectedInput):
            parser.parse(
                """
workflow "bad"
    | @llm "Summarize" [relevant:3]
"""
            )

    def test_rejects_legacy_end_markers(self) -> None:
        parser = ContractParser()

        with self.assertRaises(UnexpectedInput):
            parser.parse(
                """
workflow "bad"
    | @loop
        | @human "Continue?"
        -until "yes"
    -end
"""
            )

    def test_accepts_source_without_trailing_newline(self) -> None:
        parser = ContractParser()

        parsed = parser.parse('workflow "ok"\n    | search_web')

        self.assertEqual(parsed.program.items[0].name, "ok")
