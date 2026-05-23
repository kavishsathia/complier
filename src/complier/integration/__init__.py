"""Tool integrations: function and MCP wrappers.

These are for the harness-integration path, where a developer is
building the harness and wraps individual tools with contract
enforcement.

MCP integration lives under `complier.integration.mcp` and is gated
behind the `mcp` optional dependency. Import it explicitly:

    from complier.integration.mcp import wrap_local_mcp
"""

from .function import FunctionWrapper, wrap_function

__all__ = [
    "FunctionWrapper",
    "wrap_function",
]
