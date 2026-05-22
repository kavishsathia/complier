"""Tests for memory store convenience methods."""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from complier.memory.model import Memory
from complier.memory.store import MemoryStore


class MemoryStoreTests(unittest.TestCase):
    def test_load_delegates_to_memory_from_file(self) -> None:
        store = MemoryStore()

        with patch("complier.memory.store.Memory.from_file", return_value=Memory.empty()) as load_mock:
            result = store.load("memory.cplm")

        self.assertEqual(result.checks, {})
        load_mock.assert_called_once_with("memory.cplm")

    def test_save_delegates_to_memory_save(self) -> None:
        store = MemoryStore()
        memory = Memory(checks={"polite": "Use a polite tone."})

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "memory.cplm"

            with patch("complier.memory.model.Memory.save") as save_mock:
                store.save(memory, path)

        save_mock.assert_called_once_with(path)
