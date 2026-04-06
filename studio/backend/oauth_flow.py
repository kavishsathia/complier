"""Build an OAuthClientProvider for a remote MCP server connection."""

from __future__ import annotations

import logging
import webbrowser

import anyio
import httpx
from mcp import ClientSession
from mcp.client.auth.oauth2 import OAuthClientProvider
from mcp.client.streamable_http import streamable_http_client
from mcp.shared.auth import OAuthClientMetadata

from .oauth_callback import OAuthCallbackServer
from .token_store import FileTokenStorage

logger = logging.getLogger(__name__)


async def test_remote_with_oauth(
    url: str,
    server_id: str,
) -> dict:
    """Connect to a remote MCP server, handling OAuth if required.

    Returns a dict with ``ok``, ``tools``, ``message``, ``error``,
    and ``authenticated`` fields.
    """
    callback_server = OAuthCallbackServer()
    storage = FileTokenStorage(server_id)

    client_metadata = OAuthClientMetadata(
        redirect_uris=[callback_server.redirect_uri],
        grant_types=["authorization_code"],
        response_types=["code"],
        token_endpoint_auth_method="none",
        client_name="Complier Studio",
    )

    async def redirect_handler(auth_url: str) -> None:
        webbrowser.open(auth_url)

    async def callback_handler() -> tuple[str, str | None]:
        return await callback_server.wait_for_callback()

    auth = OAuthClientProvider(
        server_url=url,
        client_metadata=client_metadata,
        storage=storage,
        redirect_handler=redirect_handler,
        callback_handler=callback_handler,
    )

    client = httpx.AsyncClient(auth=auth)
    names: list[str] = []

    async with anyio.create_task_group() as tg:
        tg.start_soon(callback_server.run)

        try:
            async with client:
                async with streamable_http_client(url, http_client=client) as (read, write, _):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        result = await session.list_tools()
                        names = [t.name for t in result.tools]
        finally:
            tg.cancel_scope.cancel()

    has_tokens = await storage.get_tokens() is not None
    return {
        "ok": True,
        "tools": names,
        "message": f"Connected — {len(names)} tool(s) found",
        "authenticated": has_tokens,
    }


async def test_remote_safe(url: str, server_id: str) -> dict:
    """Wrapper that catches exceptions and returns them as error dicts."""
    try:
        return await test_remote_with_oauth(url, server_id)
    except BaseExceptionGroup as eg:
        # Unwrap ExceptionGroup to get the actual error message
        errors = []
        for exc in eg.exceptions:
            errors.append(str(exc))
        return {"ok": False, "error": "; ".join(errors)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def clear_tokens(server_id: str) -> None:
    """Remove stored OAuth tokens for a server."""
    FileTokenStorage(server_id).clear()
