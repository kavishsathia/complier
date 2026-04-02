"""Tests for MCP wrapper helpers and stubs."""

import sys
import unittest

from complier.wrappers.local_stdio_proxy import (
    ProxyState,
    _rewrite_client_message,
    _rewrite_server_message,
)
from complier.wrappers.local_mcp import normalize_tool_name, wrap_local_mcp


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

    def test_normalize_tool_name_namespaces_human_label(self) -> None:
        self.assertEqual(
            normalize_tool_name("Notion", "Read Vault's Details"),
            "notion.read_vaults_details",
        )

    def test_rewrite_server_message_prefixes_tool_names(self) -> None:
        state = ProxyState(namespace="notion")
        state.request_methods["1"] = "tools/list"
        payload = {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "tools": [
                    {"name": "Create Page", "description": "Create a new page."},
                ]
            },
        }

        rewritten = _rewrite_server_message(payload, state)

        self.assertEqual(
            rewritten["result"]["tools"][0]["name"],
            "notion.create_page",
        )
        self.assertEqual(
            rewritten["result"]["tools"][0]["title"],
            "Create Page",
        )
        self.assertEqual(
            state.exposed_to_downstream["notion.create_page"],
            "Create Page",
        )

    def test_rewrite_client_message_restores_downstream_name(self) -> None:
        state = ProxyState(
            namespace="notion",
            exposed_to_downstream={"notion.create_page": "Create Page"},
        )
        payload = {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {"name": "notion.create_page", "arguments": {"title": "Hello"}},
        }

        rewritten = _rewrite_client_message(payload, state)

        self.assertEqual(rewritten["params"]["name"], "Create Page")
