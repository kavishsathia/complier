"""MCP tool integration."""

from .local import LocalMCPDetails, normalize_tool_name, wrap_local_mcp
from .remote import RemoteMCPDetails, wrap_remote_mcp

__all__ = [
    "LocalMCPDetails",
    "RemoteMCPDetails",
    "normalize_tool_name",
    "wrap_local_mcp",
    "wrap_remote_mcp",
]
