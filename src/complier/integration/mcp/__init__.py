"""MCP tool integration.

Requires the `mcp` optional dependency. Install with:

    pip install complier[mcp]
"""

try:
    import mcp  # noqa: F401
except ModuleNotFoundError as exc:  # pragma: no cover - exercised via install path
    raise ModuleNotFoundError(
        "complier.integration.mcp requires the optional 'mcp' dependency. "
        "Install with: pip install complier[mcp]"
    ) from exc

from .local import LocalMCPDetails, normalize_tool_name, wrap_local_mcp
from .remote import RemoteMCPDetails, wrap_remote_mcp

__all__ = [
    "LocalMCPDetails",
    "RemoteMCPDetails",
    "normalize_tool_name",
    "wrap_local_mcp",
    "wrap_remote_mcp",
]
