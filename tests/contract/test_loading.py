"""Tests for contract loading entry points."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from complier.contract.model import Contract


class ContractLoadingTests(unittest.TestCase):
    def test_contract_from_source_returns_compiled_contract(self) -> None:
        contract = Contract.from_source(
            """
guarantee safe [no_harmful_content]:halt

workflow "research" @always safe
    | search_web
"""
        )

        self.assertEqual(contract.name, "anonymous")
        self.assertIn("source", contract.metadata)
        self.assertIn("parse_tree", contract.metadata)

    def test_contract_from_file_sets_source_path_metadata(self) -> None:
        source = """
workflow "research"
    | search_web
"""

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "research.cpl"
            path.write_text(source, encoding="utf-8")

            contract = Contract.from_file(path)

        self.assertEqual(contract.metadata["source_path"], str(path))
        self.assertIn("source", contract.metadata)

    def test_contract_load_alias_uses_file_loading(self) -> None:
        source = """
workflow "research"
    | search_web
"""

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "research.cpl"
            path.write_text(source, encoding="utf-8")

            contract = Contract.load(path)

        self.assertEqual(contract.metadata["source_path"], str(path))
