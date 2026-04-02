"""Tests for small runtime and error support modules."""

import unittest

from complier.errors import BlockedToolCall
from complier.runtime.events import RuntimeEvent
from complier.runtime.remediation import StructuredMessage
from complier.session.decisions import Decision


class RuntimeAndErrorTests(unittest.TestCase):
    def test_blocked_tool_call_stringifies_with_tool_name(self) -> None:
        error = BlockedToolCall(tool_name="search_web", decision=Decision(allowed=False))

        self.assertEqual(
            str(error),
            "Tool 'search_web' was blocked by the active contract.",
        )

    def test_runtime_event_stores_name_and_payload(self) -> None:
        event = RuntimeEvent(name="tool_call_allowed", payload={"tool_name": "search_web"})

        self.assertEqual(event.name, "tool_call_allowed")
        self.assertEqual(event.payload, {"tool_name": "search_web"})

    def test_structured_message_defaults_optional_lists(self) -> None:
        message = StructuredMessage(summary="Blocked action")

        self.assertEqual(message.summary, "Blocked action")
        self.assertEqual(message.details, [])
        self.assertEqual(message.allowed_next_actions, [])
