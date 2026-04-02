"""End-to-end demo for wrapping a local stdio MCP server."""

from __future__ import annotations

import anyio
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

from complier.contract.model import Contract
from complier.wrappers.local_mcp import wrap_local_mcp


async def main() -> None:
    contract_session = Contract.from_source(
        """
workflow "notion"
    | notion.create_page
"""
    ).create_session()
    details = wrap_local_mcp(
        contract_session,
        "notion",
        ["./.venv/bin/python", "demo/local_mcp_downstream.py"],
    )
    server = StdioServerParameters(
        command=details.command[0],
        args=details.command[1:],
        env=details.env,
    )

    async with stdio_client(server) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as client_session:
            await client_session.initialize()

            tools = await client_session.list_tools()
            print("tools:", [tool.name for tool in tools.tools])

            allowed = await client_session.call_tool("notion.create_page", {"title": "hello"})
            print("allowed_is_error:", allowed.isError)
            print("allowed_result:", allowed.content[0].text)

            blocked = await client_session.call_tool("notion.read_vaults_details", {})
            print("blocked_is_error:", blocked.isError)
            print("blocked_result:", blocked.structuredContent)


if __name__ == "__main__":
    anyio.run(main)
