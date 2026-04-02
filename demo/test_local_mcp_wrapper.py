"""End-to-end demo for wrapping a local stdio MCP server."""

from __future__ import annotations

import anyio
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

from complier.wrappers.local_mcp import wrap_local_mcp


async def main() -> None:
    details = wrap_local_mcp(
        "notion",
        ["./.venv/bin/python", "demo/local_mcp_downstream.py"],
    )
    server = StdioServerParameters(
        command=details.command[0],
        args=details.command[1:],
        env=details.env,
    )

    async with stdio_client(server) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:
            await session.initialize()

            tools = await session.list_tools()
            print("tools:", [tool.name for tool in tools.tools])

            result = await session.call_tool("notion.create_page", {"title": "hello"})
            print("result:", result.content[0].text)


if __name__ == "__main__":
    anyio.run(main)
