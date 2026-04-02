"""Local stdio MCP proxy implemented with the official MCP Python SDK."""

from __future__ import annotations

import argparse
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

import anyio
import mcp.types as types
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.server import NotificationOptions, Server
from mcp.server.stdio import stdio_server

from .local_mcp import normalize_tool_name


@dataclass(slots=True)
class ProxyState:
    """Shared tool mapping state for the stdio proxy."""

    namespace: str
    exposed_to_downstream: dict[str, str] = field(default_factory=dict)


def main(argv: list[str] | None = None) -> int:
    """Run the local stdio MCP proxy."""
    anyio.run(_run_proxy, argv)
    return 0


async def _run_proxy(argv: list[str] | None) -> None:
    args = _parse_args(argv)
    server = Server("complier-local-mcp-proxy")
    state = ProxyState(namespace=args.namespace)

    @asynccontextmanager
    async def lifespan(_: Server):
        session_context = stdio_client(_build_server_params(args.downstream_command))
        async with session_context as (read_stream, write_stream):
            session = ClientSession(read_stream, write_stream)
            async with session:
                await session.initialize()
                yield session

    server = Server("complier-local-mcp-proxy", lifespan=lifespan)

    @server.list_tools()
    async def list_tools() -> list[types.Tool]:
        ctx = server.request_context
        return await _list_tools(ctx.lifespan_context, state)

    @server.call_tool(validate_input=False)
    async def call_tool(name: str, arguments: dict[str, Any]) -> types.CallToolResult:
        ctx = server.request_context
        session = ctx.lifespan_context
        tool_name = await _resolve_downstream_tool_name(session, state, name)
        return await session.call_tool(tool_name, arguments)

    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(NotificationOptions()),
        )


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a local namespaced stdio MCP proxy.")
    parser.add_argument("--namespace", required=True)
    parser.add_argument(
        "downstream_command",
        nargs=argparse.REMAINDER,
        help="Command used to start the downstream stdio MCP server.",
    )
    args = parser.parse_args(argv)
    if args.downstream_command and args.downstream_command[0] == "--":
        args.downstream_command = args.downstream_command[1:]
    if not args.downstream_command:
        parser.error("a downstream MCP command is required")
    return args


def _build_server_params(downstream_command: list[str]) -> StdioServerParameters:
    return StdioServerParameters(
        command=downstream_command[0],
        args=downstream_command[1:],
    )


async def _list_tools(session: ClientSession, state: ProxyState) -> list[types.Tool]:
    result = await session.list_tools()
    rewritten_tools: list[types.Tool] = []
    state.exposed_to_downstream.clear()

    for tool in result.tools:
        exposed_name = normalize_tool_name(state.namespace, tool.name)
        state.exposed_to_downstream[exposed_name] = tool.name
        rewritten_tools.append(
            tool.model_copy(
                update={
                    "name": exposed_name,
                    "title": tool.title or tool.name,
                }
            )
        )

    return rewritten_tools


async def _resolve_downstream_tool_name(
    session: ClientSession,
    state: ProxyState,
    exposed_name: str,
) -> str:
    original_name = state.exposed_to_downstream.get(exposed_name)
    if original_name is not None:
        return original_name

    await _list_tools(session, state)
    original_name = state.exposed_to_downstream.get(exposed_name)
    if original_name is None:
        raise ValueError(f"Unknown wrapped tool: {exposed_name}")
    return original_name


if __name__ == "__main__":
    raise SystemExit(main())
