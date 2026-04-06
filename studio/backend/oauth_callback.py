"""Minimal local HTTP server to catch OAuth redirect callbacks."""

from __future__ import annotations

import socket

import anyio
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import HTMLResponse
from starlette.routing import Route

CALLBACK_HTML = """\
<!DOCTYPE html>
<html>
<head><title>Complier Studio</title></head>
<body style="font-family: system-ui; display: flex; justify-content: center;
             align-items: center; height: 100vh; margin: 0; background: #1a1a2e;
             color: #e0e0e0;">
  <div style="text-align: center;">
    <h2>Authenticated</h2>
    <p>You can close this window and return to Complier Studio.</p>
  </div>
</body>
</html>
"""


def _pick_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class OAuthCallbackServer:
    """Starts a local HTTP server, waits for a single OAuth callback, then shuts down."""

    def __init__(self) -> None:
        self.port = _pick_free_port()
        self._code: str | None = None
        self._state: str | None = None
        self._received = anyio.Event()

    @property
    def redirect_uri(self) -> str:
        return f"http://127.0.0.1:{self.port}/callback"

    async def wait_for_callback(self) -> tuple[str, str | None]:
        """Block until the OAuth callback arrives, then return (code, state)."""
        await self._received.wait()
        return self._code or "", self._state

    async def run(self) -> None:
        """Run the callback server until a callback is received."""
        import uvicorn

        async def handle_callback(request: Request) -> HTMLResponse:
            self._code = request.query_params.get("code")
            self._state = request.query_params.get("state")
            self._received.set()
            return HTMLResponse(CALLBACK_HTML)

        app = Starlette(routes=[Route("/callback", endpoint=handle_callback, methods=["GET"])])
        config = uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="warning")
        server = uvicorn.Server(config)

        async with anyio.create_task_group() as tg:
            tg.start_soon(server.serve)
            await self._received.wait()
            server.should_exit = True
