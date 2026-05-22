"""Tests for function wrappers."""

import unittest

from complier.contract.model import Contract
from complier.session.decisions import BlockedToolResponse, Decision, Remediation
from complier.wrappers.function import wrap_function


class FunctionWrapperTests(unittest.TestCase):
    def test_wrap_function_allows_and_records_sync_calls(self) -> None:
        session = Contract(name="demo").create_session()

        def search_web(query: str) -> str:
            return f"results for {query}"

        wrapped = wrap_function(session, search_web)
        result = wrapped("agent workflows")

        self.assertEqual(result, "results for agent workflows")
        self.assertEqual(len(session.state.history), 2)
        self.assertEqual(session.state.history[0]["event"], "tool_call_allowed")
        self.assertEqual(session.state.history[0]["tool_name"], "search_web")
        self.assertEqual(session.state.history[1]["event"], "tool_result_recorded")
        self.assertEqual(session.state.history[1]["result"], result)

    def test_session_wrap_delegates_to_function_wrapper(self) -> None:
        session = Contract(name="demo").create_session()

        def send_report() -> str:
            return "sent"

        wrapped = session.wrap(send_report)
        result = wrapped()

        self.assertEqual(result, "sent")
        self.assertEqual(session.state.history[0]["tool_name"], "send_report")

    def test_wrapped_function_stores_session_metadata(self) -> None:
        session = Contract(name="demo").create_session()

        def search_web(query: str) -> str:
            return f"results for {query}"

        wrapped = wrap_function(session, search_web)

        self.assertIs(wrapped.__complier_session__, session)
        self.assertIs(wrapped.__complier_original__, search_web)
        self.assertEqual(wrapped.__complier_tool_name__, "search_web")

    def test_wrap_function_returns_blocked_response_when_disallowed(self) -> None:
        class BlockingSession:
            def __init__(self) -> None:
                self.history = []

            def check_tool_call(self, tool_name, args, kwargs):
                return Decision(
                    allowed=False,
                    reason="blocked",
                    remediation=Remediation(
                        message="This action is not allowed.",
                        allowed_next_actions=["search_web"],
                    ),
                )

            def record_blocked_call(self, tool_name, decision):
                self.history.append(("blocked", tool_name, decision))

        session = BlockingSession()

        def delete_everything() -> None:
            raise AssertionError("wrapped function should never execute")

        wrapped = wrap_function(session, delete_everything)

        response = wrapped()

        self.assertIsInstance(response, BlockedToolResponse)
        self.assertEqual(response.tool_name, "delete_everything")
        self.assertFalse(response.allowed)
        self.assertEqual(response.reason, "blocked")
        self.assertIsNotNone(response.remediation)
        self.assertEqual(response.remediation.message, "This action is not allowed.")
        self.assertEqual(response.remediation.allowed_next_actions, ["search_web"])
        self.assertEqual(session.history[0][0], "blocked")
        self.assertEqual(session.history[0][1], "delete_everything")

    def test_wrap_function_passes_choice_to_session_but_not_tool(self) -> None:
        captured = {}

        class ChoiceSession:
            def check_tool_call(self, tool_name, args, kwargs, choice=None):
                captured["tool_name"] = tool_name
                captured["args"] = args
                captured["kwargs"] = dict(kwargs)
                captured["choice"] = choice
                return Decision(allowed=True)

            def record_allowed_call(self, tool_name, args, kwargs):
                return None

            def record_result(self, tool_name, result):
                return None

        session = ChoiceSession()

        def search_web(query: str, **kwargs) -> str:
            captured["tool_kwargs"] = dict(kwargs)
            return f"results for {query}"

        wrapped = wrap_function(session, search_web)
        result = wrapped("agent workflows", choice="technical")

        self.assertEqual(result, "results for agent workflows")
        self.assertEqual(captured["choice"], "technical")
        self.assertEqual(captured["kwargs"], {})
        self.assertEqual(captured["tool_kwargs"], {})

class AsyncFunctionWrapperTests(unittest.IsolatedAsyncioTestCase):
    async def test_wrap_function_allows_and_records_async_calls(self) -> None:
        session = Contract(name="demo").create_session()

        async def search_web(query: str) -> str:
            return f"results for {query}"

        wrapped = wrap_function(session, search_web)
        result = await wrapped("agent workflows")

        self.assertEqual(result, "results for agent workflows")
        self.assertEqual(len(session.state.history), 2)
        self.assertEqual(session.state.history[0]["event"], "tool_call_allowed")
        self.assertEqual(session.state.history[1]["event"], "tool_result_recorded")

    async def test_async_wrap_function_returns_blocked_response_when_disallowed(self) -> None:
        class BlockingSession:
            def __init__(self) -> None:
                self.history = []

            def check_tool_call(self, tool_name, args, kwargs):
                return Decision(
                    allowed=False,
                    reason="blocked",
                    remediation=Remediation(
                        message="Try another action.",
                        allowed_next_actions=["search_web"],
                    ),
                )

            def record_blocked_call(self, tool_name, decision):
                self.history.append(("blocked", tool_name, decision))

        session = BlockingSession()

        async def delete_everything() -> None:
            raise AssertionError("wrapped function should never execute")

        wrapped = wrap_function(session, delete_everything)
        response = await wrapped()

        self.assertIsInstance(response, BlockedToolResponse)
        self.assertEqual(response.tool_name, "delete_everything")
        self.assertEqual(response.remediation.allowed_next_actions, ["search_web"])
        self.assertEqual(session.history[0][1], "delete_everything")

    async def test_async_wrap_function_passes_choice_to_session_but_not_tool(self) -> None:
        captured = {}

        class ChoiceSession:
            def check_tool_call(self, tool_name, args, kwargs, choice=None):
                captured["tool_name"] = tool_name
                captured["args"] = args
                captured["kwargs"] = dict(kwargs)
                captured["choice"] = choice
                return Decision(allowed=True)

            def record_allowed_call(self, tool_name, args, kwargs):
                return None

            def record_result(self, tool_name, result):
                return None

        session = ChoiceSession()

        async def search_web(query: str, **kwargs) -> str:
            captured["tool_kwargs"] = dict(kwargs)
            return f"results for {query}"

        wrapped = wrap_function(session, search_web)
        result = await wrapped("agent workflows", choice="technical")

        self.assertEqual(result, "results for agent workflows")
        self.assertEqual(captured["choice"], "technical")
        self.assertEqual(captured["kwargs"], {})
        self.assertEqual(captured["tool_kwargs"], {})
