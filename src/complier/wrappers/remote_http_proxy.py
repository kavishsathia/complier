"""Shared remote HTTP MCP proxy host."""

from __future__ import annotations

import argparse
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

import anyio
import httpx
import mcp.types as types
import uvicorn
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.server import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from mcp.shared.exceptions import McpError

from complier.session.decisions import BlockedToolResponse
from complier.session.server import SessionServerClient

from .local_stdio_proxy import _resolve_downstream_tool_name, _tool_update, ProxyState
from .local_mcp import normalize_tool_name, public_tool_name


@dataclass(slots=True)
class RemoteRegistry:
    session_client: SessionServerClient
    namespaces: dict[str, str] = field(default_factory=dict)
    tool_maps: dict[str, dict[str, str]] = field(default_factory=dict)
    auth_tokens: dict[str, str] = field(default_factory=dict)


def main(argv: list[str] | None = None) -> int:
    anyio.run(_run_proxy, argv)
    return 0


async def _run_proxy(argv: list[str] | None) -> None:
    args = _parse_args(argv)
    registry = RemoteRegistry(
        session_client=SessionServerClient(args.session_host, args.session_port),
    )
    server = Server("complier-remote-mcp-host")

    @server.list_tools()
    async def list_tools() -> list[types.Tool]:
        namespace = _namespace_from_request(server.request_context.request)
        downstream_url = _downstream_url(registry, namespace)
        auth_header = _resolve_auth(registry, namespace, server.request_context.request)

        try:
            async with _downstream_session(downstream_url, auth_header) as session:
                result = await session.list_tools()
        except BaseException as exc:
            raise McpError(error=types.ErrorData(
                code=-32000,
                message=_unwrap(exc),
            )) from None

        rewritten_tools: list[types.Tool] = []
        tool_map: dict[str, str] = {}
        for tool in result.tools:
            exposed_name = public_tool_name(tool.name)
            tool_map[exposed_name] = tool.name
            rewritten_tools.append(tool.model_copy(update=_tool_update(exposed_name, tool)))
        registry.tool_maps[namespace] = tool_map
        return rewritten_tools

    @server.call_tool(validate_input=False)
    async def call_tool(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        namespace = _namespace_from_request(server.request_context.request)
        downstream_url = _downstream_url(registry, namespace)
        forwarded_arguments = dict(arguments or {})
        choice = forwarded_arguments.pop("choice", None)
        state = ProxyState(namespace=namespace, exposed_to_downstream=registry.tool_maps.get(namespace, {}))
        auth_header = _resolve_auth(registry, namespace, server.request_context.request)

        try:
            async with _downstream_session(downstream_url, auth_header) as session:
                downstream_tool_name = await _resolve_downstream_tool_name(session, state, name)
                internal_tool_name = normalize_tool_name(namespace, downstream_tool_name)
                decision = registry.session_client.check_tool_call(
                    internal_tool_name,
                    (),
                    forwarded_arguments,
                    choice=choice,
                )
                if not decision.allowed:
                    registry.session_client.record_blocked_call(internal_tool_name, decision)
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
                result = await session.call_tool(downstream_tool_name, forwarded_arguments)
        except BaseException as exc:
            raise McpError(error=types.ErrorData(
                code=-32000,
                message=_unwrap(exc),
            )) from None
        registry.tool_maps[namespace] = state.exposed_to_downstream
        registry.session_client.record_result(internal_tool_name, result.model_dump(mode="json"))
        if decision.remediation and decision.remediation.allowed_next_actions:
            next_hint = "Next allowed actions: " + ", ".join(decision.remediation.allowed_next_actions)
            result = result.model_copy(update={
                "content": list(result.content) + [types.TextContent(type="text", text=next_hint)],
            })
        return result

    manager = StreamableHTTPSessionManager(app=server)

    async def setup(request: Request) -> JSONResponse:
        payload = await request.json()
        namespace = str(payload["namespace"])
        downstream_url = str(payload["downstream_url"])
        registry.namespaces[namespace] = downstream_url
        auth_token = payload.get("auth_token")
        if auth_token:
            registry.auth_tokens[namespace] = str(auth_token)
        return JSONResponse({"ok": True, "namespace": namespace, "url": f"/mcp/{namespace}/"})

    async def mcp_app(scope: Any, receive: Any, send: Any) -> None:
        await manager.handle_request(scope, receive, send)

    app = Starlette(
        routes=[
            Route("/setup", endpoint=setup, methods=["POST"]),
            Mount("/mcp", app=mcp_app),
        ],
        lifespan=lambda app: manager.run(),
    )
    config = uvicorn.Config(app, host=args.host, port=args.port, log_level="warning")
    await uvicorn.Server(config).serve()


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the shared remote HTTP MCP proxy host.")
    parser.add_argument("--session-host", required=True)
    parser.add_argument("--session-port", required=True, type=int)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", required=True, type=int)
    return parser.parse_args(argv)


def _namespace_from_request(request: Request | None) -> str:
    if request is None:
        raise ValueError("Missing HTTP request context.")
    path = request.url.path.rstrip("/")
    prefix = "/mcp/"
    if not path.startswith(prefix):
        raise ValueError(f"Unexpected MCP path: {request.url.path}")
    namespace = path[len(prefix):]
    if not namespace:
        raise ValueError("Missing MCP namespace.")
    return namespace


def _downstream_url(registry: RemoteRegistry, namespace: str) -> str:
    if namespace not in registry.namespaces:
        raise ValueError(f"Unknown namespace: {namespace}")
    return registry.namespaces[namespace]


def _authorization_header(request: Request | None) -> str | None:
    if request is None:
        return None
    return request.headers.get("authorization")


def _resolve_auth(registry: RemoteRegistry, namespace: str, request: Request | None) -> str | None:
    """Return the auth header: prefer the stored token, fall back to the request header."""
    stored = registry.auth_tokens.get(namespace)
    if stored:
        return f"Bearer {stored}"
    return _authorization_header(request)


def _unwrap(exc: BaseException) -> str:
    if isinstance(exc, BaseExceptionGroup):
        return "; ".join(_unwrap(e) for e in exc.exceptions)
    return str(exc)


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


if __name__ == "__main__":
    raise SystemExit(main())
