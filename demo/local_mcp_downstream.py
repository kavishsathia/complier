"""Demo downstream local stdio MCP server."""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP


server = FastMCP("demo-downstream")


@server.tool(name="Create Page", title="Create Page", description="Create a page in the demo server.")
def create_page(title: str) -> str:
    return f"created:{title}"


@server.tool(name="Read Vault's Details", title="Read Vault's Details", description="Read demo details.")
def read_vault_details() -> str:
    return "vault:demo"


@server.tool(name="Archive Page", title="Archive Page", description="Archive a page in the demo server.")
def archive_page(page_id: str) -> str:
    return f"archived:{page_id}"


if __name__ == "__main__":
    server.run("stdio")
