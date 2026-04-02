"""Tests for session creation and async context handling."""

import unittest

from complier.contract.model import Contract
from complier.integration import Integration
from complier.memory.model import Memory
from complier.session import Session, get_current_session


class SessionCreationTests(unittest.TestCase):
    def test_contract_create_session_binds_contract_and_memory(self) -> None:
        contract = Contract(name="demo")
        memory = Memory(checks={"polite": "Use a polite tone."})

        session = contract.create_session(memory=memory)

        self.assertIsInstance(session, Session)
        self.assertIs(session.contract, contract)
        self.assertIs(session.memory, memory)
        self.assertIsNone(session.state.active_workflow)

    def test_contract_create_session_binds_integrations(self) -> None:
        contract = Contract(name="demo")

        class StubIntegration(Integration):
            def verify(self, prompt: str, output_schema: dict[str, type]) -> dict[str, object]:
                return {}

        model = StubIntegration()
        human = StubIntegration()

        session = contract.create_session(model=model, human=human)

        self.assertIs(session.model, model)
        self.assertIs(session.human, human)

    def test_snapshot_memory_copies_current_memory(self) -> None:
        contract = Contract(name="demo")
        memory = Memory(checks={"polite": "Use a polite tone."})
        session = contract.create_session(memory=memory)

        snapshot = session.snapshot_memory()

        self.assertEqual(snapshot.checks, memory.checks)
        self.assertIsNot(snapshot, memory)

    def test_snapshot_memory_returns_empty_when_no_memory_present(self) -> None:
        session = Contract(name="demo").create_session()
        self.assertEqual(session.snapshot_memory().checks, {})


class SessionActivationTests(unittest.IsolatedAsyncioTestCase):
    async def test_activate_registers_current_session(self) -> None:
        session = Contract(name="demo").create_session()

        self.assertIsNone(get_current_session())

        async with session.activate():
            self.assertIs(get_current_session(), session)

        self.assertIsNone(get_current_session())

    async def test_nested_activation_restores_previous_session(self) -> None:
        outer = Contract(name="outer").create_session()
        inner = Contract(name="inner").create_session()

        async with outer.activate():
            self.assertIs(get_current_session(), outer)

            async with inner.activate():
                self.assertIs(get_current_session(), inner)

            self.assertIs(get_current_session(), outer)

        self.assertIsNone(get_current_session())
