"""Runtime wrappers for functions and MCP tools."""

from .function import FunctionWrapper, wrap_function
from .local_mcp import LocalMCPDetails, normalize_tool_name, wrap_local_mcp
from .remote_mcp import RemoteMCPDetails, wrap_remote_mcp

__all__ = [
    "FunctionWrapper",
    "LocalMCPDetails",
    "RemoteMCPDetails",
    "normalize_tool_name",
    "wrap_function",
    "wrap_local_mcp",
    "wrap_remote_mcp",
]
