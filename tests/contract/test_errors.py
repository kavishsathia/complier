"""Tests for parser failure behavior."""

import unittest

from lark.exceptions import UnexpectedInput

from complier.contract.parser import ContractParser


class ParserErrorTests(unittest.TestCase):
    def test_rejects_empty_source(self) -> None:
        parser = ContractParser()

        with self.assertRaises(ValueError):
            parser.parse("")

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
