"""Tests for memory loading and saving."""

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from complier.memory.model import Memory


class MemoryLoadingTests(unittest.TestCase):
    def test_memory_from_source_loads_checks(self) -> None:
        memory = Memory.from_source(
            """
{"checks": {"polite": "Use a polite tone.", "concise": "Keep responses brief."}}
"""
        )

        self.assertEqual(
            memory.checks,
            {
                "polite": "Use a polite tone.",
                "concise": "Keep responses brief.",
            },
        )

    def test_memory_from_source_returns_empty_for_blank_input(self) -> None:
        memory = Memory.from_source("   ")
        self.assertEqual(memory.checks, {})

    def test_memory_from_file_and_load_alias_work(self) -> None:
        source = '{"checks": {"polite": "Use a polite tone."}}'

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "memory.cplm"
            path.write_text(source, encoding="utf-8")

            direct = Memory.from_file(path)
            alias = Memory.load(path)

        self.assertEqual(direct.checks, {"polite": "Use a polite tone."})
        self.assertEqual(alias.checks, {"polite": "Use a polite tone."})

    def test_memory_save_round_trips(self) -> None:
        memory = Memory(checks={"polite": "Use a polite tone."})

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "memory.cplm"
            memory.save(path)
            loaded = Memory.from_file(path)

        self.assertEqual(loaded.checks, {"polite": "Use a polite tone."})

    def test_memory_to_dict_and_json_serialize_expected_payload(self) -> None:
        memory = Memory(checks={"concise": "Keep responses brief.", "polite": "Use a polite tone."})

        self.assertEqual(
            memory.to_dict(),
            {
                "checks": {
                    "concise": "Keep responses brief.",
                    "polite": "Use a polite tone.",
                }
            },
        )
        self.assertEqual(json.loads(memory.to_json()), memory.to_dict())

    def test_memory_requires_json_object_payload(self) -> None:
        with self.assertRaises(ValueError):
            Memory.from_source('["not", "an", "object"]')

    def test_memory_requires_checks_to_be_object(self) -> None:
        with self.assertRaises(ValueError):
            Memory.from_source('{"checks": "wrong"}')

    def test_memory_requires_string_values(self) -> None:
        with self.assertRaises(ValueError):
            Memory.from_source('{"checks": {"polite": 3}}')

    def test_memory_requires_source_string(self) -> None:
        with self.assertRaises(TypeError):
            Memory.from_source(None)  # type: ignore[arg-type]
