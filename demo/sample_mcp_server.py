"""Sample local stdio MCP server for testing Studio MCP connections.

Run directly:
    python demo/sample_mcp_server.py

Then in Studio Settings, add a Local (stdio) MCP server with:
    Name:    Sample Tools
    Command: python demo/sample_mcp_server.py
"""

from __future__ import annotations

import random
from datetime import datetime

from mcp.server.fastmcp import FastMCP

server = FastMCP("sample-tools")


@server.tool(name="get_time", description="Get the current date and time.")
def get_time() -> str:
    return datetime.now().isoformat()


@server.tool(name="roll_dice", description="Roll a dice with the given number of sides.")
def roll_dice(sides: int = 6) -> str:
    return str(random.randint(1, sides))


@server.tool(name="echo", description="Echo back the given message.")
def echo(message: str) -> str:
    return f"Echo: {message}"


if __name__ == "__main__":
    server.run("stdio")
