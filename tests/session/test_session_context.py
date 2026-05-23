"""Tests for session creation and async context handling."""

import unittest

from complier.contract.model import Contract
from complier.verification import ModelVerifier
from complier.session import Session, get_current_session


class SessionCreationTests(unittest.TestCase):
    def test_contract_create_session_returns_session_bound_to_contract(self) -> None:
        contract = Contract(name="demo")
        session = contract.create_session()

        self.assertIsInstance(session, Session)
        self.assertIs(session.contract, contract)
        self.assertIsNone(session.state.active_workflow)

    def test_contract_create_session_binds_verifiers(self) -> None:
        contract = Contract(name="demo")
        model = ModelVerifier(verify_fn=lambda p, v, c: True)
        session = contract.create_session(verifiers=[model])
        self.assertIn(model, session.verifiers)


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
