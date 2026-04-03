"""Demo downstream remote HTTP MCP server."""

from __future__ import annotations

import argparse

import anyio
import mcp.types as types
import uvicorn
from mcp.server import Server
from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.applications import Starlette
from starlette.routing import Mount


def main(argv: list[str] | None = None) -> int:
    anyio.run(_run, argv)
    return 0


async def _run(argv: list[str] | None) -> None:
    args = _parse_args(argv)
    server = Server("demo-remote-downstream")

    @server.list_tools()
    async def list_tools() -> list[types.Tool]:
        return [
            types.Tool(
                name="Create Page",
                title="Create Page",
                description="Create a page and echo the auth header.",
                inputSchema={
                    "type": "object",
                    "properties": {"title": {"type": "string"}},
                    "required": ["title"],
                },
            ),
            types.Tool(
                name="Read Vault's Details",
                title="Read Vault's Details",
                description="Read details and echo the auth header.",
                inputSchema={"type": "object", "properties": {}},
            ),
        ]

    @server.call_tool(validate_input=False)
    async def call_tool(name: str, arguments: dict[str, object]) -> dict[str, object]:
        request = server.request_context.request
        auth_header = None if request is None else request.headers.get("authorization")

        if name == "Create Page":
            return {
                "tool": name,
                "title": arguments.get("title"),
                "authorization": auth_header,
            }
        if name == "Read Vault's Details":
            return {
                "tool": name,
                "authorization": auth_header,
            }
        raise ValueError(f"Unknown tool: {name}")

    manager = StreamableHTTPSessionManager(app=server)

    async def mcp_app(scope, receive, send) -> None:
        await manager.handle_request(scope, receive, send)

    app = Starlette(
        routes=[Mount("/mcp", app=mcp_app)],
        lifespan=lambda app: manager.run(),
    )
    config = uvicorn.Config(app, host=args.host, port=args.port, log_level="warning")
    await uvicorn.Server(config).serve()


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the demo downstream remote MCP server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=9001)
    return parser.parse_args(argv)


if __name__ == "__main__":
    raise SystemExit(main())
