"""Tests for local MCP wrapper helpers."""

import sys
import unittest

import mcp.types as types

from complier.wrappers.local_mcp import normalize_tool_name, wrap_local_mcp
from complier.wrappers.local_stdio_proxy import ProxyState, _list_tools, _resolve_downstream_tool_name


class FakeSession:
    def __init__(self, tools: list[types.Tool]) -> None:
        self._tools = tools
        self.list_tools_calls = 0

    async def list_tools(self) -> types.ListToolsResult:
        self.list_tools_calls += 1
        return types.ListToolsResult(tools=self._tools)


class MCPWrapperTests(unittest.TestCase):
    def test_wrap_local_mcp_returns_wrapper_launch_command(self) -> None:
        details = wrap_local_mcp("Notion", ["uvx", "mcp-notion"])

        self.assertEqual(details.namespace, "notion")
        self.assertEqual(
            details.command,
            [
                sys.executable,
                "-m",
                "complier.wrappers.local_stdio_proxy",
                "--namespace",
                "notion",
                "--",
                "uvx",
                "mcp-notion",
            ],
        )
        self.assertIn("PYTHONPATH", details.env)

    def test_normalize_tool_name_namespaces_human_label(self) -> None:
        self.assertEqual(
            normalize_tool_name("Notion", "Read Vault's Details"),
            "notion.read_vaults_details",
        )


class LocalStdioProxyTests(unittest.IsolatedAsyncioTestCase):
    async def test_list_tools_prefixes_and_preserves_title(self) -> None:
        state = ProxyState(namespace="notion")
        session = FakeSession(
            [
                types.Tool(
                    name="Create Page",
                    title=None,
                    description="Create a new page.",
                    inputSchema={"type": "object", "properties": {}},
                )
            ]
        )

        tools = await _list_tools(session, state)

        self.assertEqual(tools[0].name, "notion.create_page")
        self.assertEqual(tools[0].title, "Create Page")
        self.assertEqual(state.exposed_to_downstream["notion.create_page"], "Create Page")

    async def test_resolve_downstream_tool_name_refreshes_mapping(self) -> None:
        state = ProxyState(namespace="notion")
        session = FakeSession(
            [
                types.Tool(
                    name="Create Page",
                    title=None,
                    description="Create a new page.",
                    inputSchema={"type": "object", "properties": {}},
                )
            ]
        )

        tool_name = await _resolve_downstream_tool_name(session, state, "notion.create_page")

        self.assertEqual(tool_name, "Create Page")
        self.assertEqual(session.list_tools_calls, 1)
