"""Demo downstream local stdio MCP server."""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP


server = FastMCP("demo-downstream")


@server.tool(name="Read Local Vault Details", title="Read Local Vault Details", description="Read demo details.")
def read_vault_details() -> str:
    return "vault:demo"


if __name__ == "__main__":
    server.run("stdio")
