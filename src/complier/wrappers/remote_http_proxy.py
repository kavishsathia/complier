"""Remote HTTP MCP proxy with session checks and Authorization pass-through."""

from __future__ import annotations

import argparse
from contextlib import asynccontextmanager
from typing import Any

import anyio
import httpx
import mcp.types as types
import uvicorn
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.server import NotificationOptions, Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.applications import Starlette
from starlette.routing import Route

from complier.session.decisions import BlockedToolResponse
from complier.session.server import SessionServerClient

from .local_stdio_proxy import (
    ProxyState,
    _resolve_downstream_tool_name,
    _tool_update,
    _with_choice_param,
)
from .local_mcp import normalize_tool_name


def main(argv: list[str] | None = None) -> int:
    anyio.run(_run_proxy, argv)
    return 0


async def _run_proxy(argv: list[str] | None) -> None:
    args = _parse_args(argv)
    state = ProxyState(namespace=args.namespace)
    state.session_client = SessionServerClient(args.session_host, args.session_port)
    server = Server("complier-remote-mcp-proxy")

    @server.list_tools()
    async def list_tools() -> list[types.Tool]:
        auth_header = _authorization_header(server)
        async with _downstream_session(args.downstream_url, auth_header) as session:
            result = await session.list_tools()
        rewritten_tools: list[types.Tool] = []
        state.exposed_to_downstream.clear()
        for tool in result.tools:
            exposed_name = normalize_tool_name(state.namespace, tool.name)
            state.exposed_to_downstream[exposed_name] = tool.name
            rewritten_tools.append(tool.model_copy(update=_tool_update(exposed_name, tool)))
        return rewritten_tools

    @server.call_tool(validate_input=False)
    async def call_tool(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        forwarded_arguments = dict(arguments or {})
        choice = forwarded_arguments.pop("choice", None)
        decision = state.session_client.check_tool_call(name, (), forwarded_arguments, choice=choice)
        if not decision.allowed:
            state.session_client.record_blocked_call(name, decision)
            blocked = BlockedToolResponse(
                tool_name=name,
                reason=decision.reason,
                remediation=decision.remediation,
            )
            return types.CallToolResult(
                content=[types.TextContent(type="text", text=str(blocked.to_dict()))],
                structuredContent=blocked.to_dict(),
                isError=True,
            )

        auth_header = _authorization_header(server)
        async with _downstream_session(args.downstream_url, auth_header) as session:
            tool_name = await _resolve_downstream_tool_name(session, state, name)
            result = await session.call_tool(tool_name, forwarded_arguments)
        state.session_client.record_result(name, result.model_dump(mode="json"))
        return result

    manager = StreamableHTTPSessionManager(app=server)

    async def mcp_app(scope: Any, receive: Any, send: Any) -> None:
        await manager.handle_request(scope, receive, send)

    app = Starlette(
        routes=[Route("/mcp", endpoint=mcp_app)],
        lifespan=lambda app: manager.run(),
    )
    config = uvicorn.Config(app, host=args.host, port=args.port, log_level="info")
    await uvicorn.Server(config).serve()


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a remote HTTP MCP proxy.")
    parser.add_argument("--namespace", required=True)
    parser.add_argument("--session-host", required=True)
    parser.add_argument("--session-port", required=True, type=int)
    parser.add_argument("--downstream-url", required=True)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", required=True, type=int)
    return parser.parse_args(argv)


def _authorization_header(server: Server[Any, Any]) -> str | None:
    request = server.request_context.request
    if request is None:
        return None
    return request.headers.get("authorization")


@asynccontextmanager
async def _downstream_session(url: str, authorization_header: str | None):
    headers = {}
    if authorization_header:
        headers["Authorization"] = authorization_header
    async with httpx.AsyncClient(headers=headers or None) as http_client:
        async with streamable_http_client(url, http_client=http_client) as transport:
            read_stream, write_stream, _get_session_id = transport
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                yield session


__all__ = ["_with_choice_param"]


if __name__ == "__main__":
    raise SystemExit(main())
