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
    | @branch
        -when "technical"
            | notion.read_vaults_details
        -else
            | notion.archive_page page_id="page-123"
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

            blocked_first = await client_session.call_tool("notion.read_vaults_details", {})
            print("blocked_first_is_error:", blocked_first.isError)
            print("blocked_first_result:", blocked_first.structuredContent)

            create_page = await client_session.call_tool("notion.create_page", {"title": "hello"})
            print("create_page_is_error:", create_page.isError)
            print("create_page_result:", create_page.content[0].text)

            read_details = await client_session.call_tool("notion.read_vaults_details", {})
            print("read_details_is_error:", read_details.isError)
            print("read_details_result:", read_details.content[0].text)

            archive_page = await client_session.call_tool("notion.archive_page", {"page_id": "page-123"})
            print("archive_page_is_error:", archive_page.isError)
            print("archive_page_result:", archive_page.structuredContent)


if __name__ == "__main__":
    anyio.run(main)
