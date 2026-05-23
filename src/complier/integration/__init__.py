"""Tool integrations: function and MCP wrappers.

These are for the harness-integration path, where a developer is
building the harness and wraps individual tools with contract
enforcement.
"""

from .function import FunctionWrapper, wrap_function
from .mcp import (
    LocalMCPDetails,
    RemoteMCPDetails,
    normalize_tool_name,
    wrap_local_mcp,
    wrap_remote_mcp,
)

__all__ = [
    "FunctionWrapper",
    "LocalMCPDetails",
    "RemoteMCPDetails",
    "normalize_tool_name",
    "wrap_function",
    "wrap_local_mcp",
    "wrap_remote_mcp",
]
