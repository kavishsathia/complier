"""Tests for local MCP wrapper helpers."""

import socket
import sys
import unittest
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import mcp.types as types
from starlette.requests import Request

from complier.contract.model import Contract
from complier.session.decisions import Decision, Remediation
from complier.wrappers import local_stdio_proxy, remote_http_proxy, remote_mcp
from complier.wrappers.local_mcp import normalize_tool_name, public_tool_name, wrap_local_mcp
from complier.wrappers.local_stdio_proxy import (
    ProxyState,
    _build_server_params,
    _list_tools,
    _parse_args as parse_local_proxy_args,
    _resolve_downstream_tool_name,
    _with_choice_param,
)
from complier.wrappers.remote_http_proxy import (
    RemoteRegistry,
    _authorization_header,
    _downstream_url,
    _namespace_from_request,
    _parse_args as parse_remote_proxy_args,
)
from complier.wrappers.remote_mcp import wrap_remote_mcp


class FakeSession:
    def __init__(self, tools: list[types.Tool]) -> None:
        self._tools = tools
        self.list_tools_calls = 0

    async def list_tools(self) -> types.ListToolsResult:
        self.list_tools_calls += 1
        return types.ListToolsResult(tools=self._tools)


class MCPWrapperTests(unittest.TestCase):
    def test_wrap_local_mcp_returns_wrapper_launch_command(self) -> None:
        session = Contract(name="demo").create_session()
        details = wrap_local_mcp(session, "Notion", ["uvx", "mcp-notion"])

        self.assertEqual(details.namespace, "notion")
        self.assertEqual(
            details.command[:5],
            [
                sys.executable,
                "-m",
                "complier.wrappers.local_stdio_proxy",
                "--namespace",
                "notion",
            ],
        )
        self.assertEqual(details.command[5], "--session-host")
        self.assertEqual(details.command[7], "--session-port")
        self.assertEqual(details.command[9:], ["--", "uvx", "mcp-notion"])
        self.assertIn("PYTHONPATH", details.env)

    def test_normalize_tool_name_namespaces_human_label(self) -> None:
        self.assertEqual(
            normalize_tool_name("Notion", "Read Vault's Details"),
            "notion.read_vaults_details",
        )

    def test_public_tool_name_omits_namespace(self) -> None:
        self.assertEqual(
            public_tool_name("Read Vault's Details"),
            "read_vaults_details",
        )

    def test_wrap_remote_mcp_returns_wrapper_url(self) -> None:
        session = Contract(name="demo").create_session()
        with (
            patch("complier.wrappers.remote_mcp.subprocess.Popen") as popen,
            patch("complier.wrappers.remote_mcp._wait_for_port"),
            patch("complier.wrappers.remote_mcp.httpx.post") as post,
        ):
            process = MagicMock()
            popen.return_value = process
            response = MagicMock()
            post.return_value = response
            details = wrap_remote_mcp(
                session,
                "Notion",
                "https://downstream.example.com/mcp",
                port=9876,
            )
            session.close()

        self.assertEqual(details.namespace, "notion")
        self.assertEqual(details.url, "http://127.0.0.1:9876/mcp/notion/")
        popen.assert_called_once()
        post.assert_called_once()

    def test_wrap_local_mcp_rejects_empty_command(self) -> None:
        session = Contract(name="demo").create_session()
        with self.assertRaisesRegex(ValueError, "cannot be empty"):
            wrap_local_mcp(session, "notion", [])
        session.close()

    def test_normalize_tool_name_rejects_empty_tool(self) -> None:
        with self.assertRaisesRegex(ValueError, "Tool name"):
            normalize_tool_name("notion", "   ")

    def test_public_tool_name_rejects_empty_tool(self) -> None:
        with self.assertRaisesRegex(ValueError, "Tool name"):
            public_tool_name("   ")

    def test_wrap_remote_mcp_reuses_existing_wrapper_host(self) -> None:
        session = Contract(name="demo").create_session()
        session._remote_wrapper_base_url = "http://127.0.0.1:5555"
        with patch("complier.wrappers.remote_mcp.httpx.post") as post:
            details = wrap_remote_mcp(
                session,
                "Notion",
                "https://downstream.example.com/mcp",
                port=9876,
            )
        self.assertEqual(details.url, "http://127.0.0.1:5555/mcp/notion/")
        post.assert_called_once_with(
            "http://127.0.0.1:5555/setup",
            json={"namespace": "notion", "downstream_url": "https://downstream.example.com/mcp"},
            timeout=5.0,
        )
        session.close()

    def test_wait_for_port_raises_on_timeout(self) -> None:
        with self.assertRaises(TimeoutError):
            remote_mcp._wait_for_port("127.0.0.1", 9, timeout=0.01)


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

        self.assertEqual(tools[0].name, "create_page")
        self.assertEqual(tools[0].title, "Create Page")
        self.assertEqual(state.exposed_to_downstream["create_page"], "Create Page")
        self.assertIn("choice", tools[0].inputSchema["properties"])

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

        tool_name = await _resolve_downstream_tool_name(session, state, "create_page")

        self.assertEqual(tool_name, "Create Page")
        self.assertEqual(session.list_tools_calls, 1)

    def test_with_choice_param_adds_optional_choice_field(self) -> None:
        schema = _with_choice_param(
            {
                "type": "object",
                "properties": {"title": {"type": "string"}},
                "required": ["title"],
            }
        )

        self.assertIn("choice", schema["properties"])
        self.assertEqual(schema["required"], ["title"])

    def test_parse_local_proxy_args_strips_separator(self) -> None:
        args = parse_local_proxy_args(
            [
                "--namespace",
                "notion",
                "--session-host",
                "127.0.0.1",
                "--session-port",
                "9000",
                "--",
                "uvx",
                "mcp-notion",
            ]
        )

        self.assertEqual(args.namespace, "notion")
        self.assertEqual(args.downstream_command, ["uvx", "mcp-notion"])

    def test_parse_local_proxy_args_requires_downstream_command(self) -> None:
        with self.assertRaises(SystemExit):
            parse_local_proxy_args(
                [
                    "--namespace",
                    "notion",
                    "--session-host",
                    "127.0.0.1",
                    "--session-port",
                    "9000",
                ]
            )

    def test_build_server_params_splits_command_and_args(self) -> None:
        params = _build_server_params(["uvx", "mcp-notion", "--stdio"])

        self.assertEqual(params.command, "uvx")
        self.assertEqual(params.args, ["mcp-notion", "--stdio"])


class RemoteHttpProxyTests(unittest.IsolatedAsyncioTestCase):
    def test_parse_remote_proxy_args(self) -> None:
        args = parse_remote_proxy_args(
            [
                "--session-host",
                "127.0.0.1",
                "--session-port",
                "9000",
                "--port",
                "8766",
            ]
        )

        self.assertEqual(args.session_host, "127.0.0.1")
        self.assertEqual(args.session_port, 9000)
        self.assertEqual(args.host, "127.0.0.1")
        self.assertEqual(args.port, 8766)

    def test_namespace_from_request_reads_namespace(self) -> None:
        request = Request({"type": "http", "method": "POST", "path": "/mcp/notion/", "headers": []})
        self.assertEqual(_namespace_from_request(request), "notion")

    def test_namespace_from_request_rejects_missing_request(self) -> None:
        with self.assertRaisesRegex(ValueError, "Missing HTTP request context"):
            _namespace_from_request(None)

    def test_namespace_from_request_rejects_wrong_prefix(self) -> None:
        request = Request({"type": "http", "method": "POST", "path": "/other/notion/", "headers": []})
        with self.assertRaisesRegex(ValueError, "Unexpected MCP path"):
            _namespace_from_request(request)

    def test_downstream_url_requires_registered_namespace(self) -> None:
        registry = RemoteRegistry(session_client=MagicMock())
        with self.assertRaisesRegex(ValueError, "Unknown namespace"):
            _downstream_url(registry, "notion")

    def test_authorization_header_reads_header(self) -> None:
        request = Request(
            {
                "type": "http",
                "method": "POST",
                "path": "/mcp/notion/",
                "headers": [(b"authorization", b"Bearer demo-token")],
            }
        )
        self.assertEqual(_authorization_header(request), "Bearer demo-token")
        self.assertIsNone(_authorization_header(None))

    async def test_downstream_session_passes_authorization_header(self) -> None:
        captured: dict[str, object] = {}
        fake_read = object()
        fake_write = object()

        class FakeHttpClientContext:
            async def __aenter__(self):
                return "http-client"

            async def __aexit__(self, exc_type, exc, tb):
                return False

        @asynccontextmanager
        async def fake_streamable_http_client(url, http_client):
            captured["url"] = url
            captured["http_client"] = http_client
            yield fake_read, fake_write, lambda: None

        class FakeClientSession:
            def __init__(self, read_stream, write_stream):
                captured["read_stream"] = read_stream
                captured["write_stream"] = write_stream

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def initialize(self):
                captured["initialized"] = True

        def fake_async_client(*, headers=None):
            captured["headers"] = headers
            return FakeHttpClientContext()

        with (
            patch("complier.wrappers.remote_http_proxy.httpx.AsyncClient", side_effect=fake_async_client),
            patch("complier.wrappers.remote_http_proxy.streamable_http_client", side_effect=fake_streamable_http_client),
            patch("complier.wrappers.remote_http_proxy.ClientSession", FakeClientSession),
        ):
            async with remote_http_proxy._downstream_session(
                "https://downstream.example.com/mcp",
                "Bearer demo-token",
            ) as session:
                self.assertTrue(captured["initialized"])
                self.assertIsInstance(session, FakeClientSession)

        self.assertEqual(captured["headers"], {"Authorization": "Bearer demo-token"})
        self.assertEqual(captured["url"], "https://downstream.example.com/mcp")

    async def test_downstream_session_omits_headers_when_missing(self) -> None:
        captured: dict[str, object] = {}

        class FakeHttpClientContext:
            async def __aenter__(self):
                return "http-client"

            async def __aexit__(self, exc_type, exc, tb):
                return False

        @asynccontextmanager
        async def fake_streamable_http_client(url, http_client):
            yield object(), object(), lambda: None

        class FakeClientSession:
            def __init__(self, read_stream, write_stream):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def initialize(self):
                return None

        def fake_async_client(*, headers=None):
            captured["headers"] = headers
            return FakeHttpClientContext()

        with (
            patch("complier.wrappers.remote_http_proxy.httpx.AsyncClient", side_effect=fake_async_client),
            patch("complier.wrappers.remote_http_proxy.streamable_http_client", side_effect=fake_streamable_http_client),
            patch("complier.wrappers.remote_http_proxy.ClientSession", FakeClientSession),
        ):
            async with remote_http_proxy._downstream_session("https://downstream.example.com/mcp", None):
                pass

        self.assertIsNone(captured["headers"])
