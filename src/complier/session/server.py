"""Local TCP server for cross-process session access."""

from __future__ import annotations

import json
import socket
import socketserver
import threading
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from .decisions import Decision

if TYPE_CHECKING:
    from .session import Session


@dataclass(slots=True)
class SessionServer:
    """Owns a local TCP endpoint for a live session."""

    session: "Session"
    host: str = "127.0.0.1"
    port: int = 0
    _requested_port: int = field(init=False, repr=False)
    _server: socketserver.ThreadingTCPServer | None = field(init=False, default=None, repr=False)
    _thread: threading.Thread | None = field(init=False, default=None, repr=False)

    def __post_init__(self) -> None:
        self._requested_port = self.port

    def ensure_started(self) -> None:
        if self._server is not None:
            return
        server = _ThreadingSessionTCPServer((self.host, self._requested_port), _SessionRequestHandler)
        server.session = self.session
        self._server = server
        self.host, self.port = server.server_address
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self._thread = thread

    def close(self) -> None:
        if self._server is None:
            return
        self._server.shutdown()
        self._server.server_close()
        self._server = None

    def to_dict(self) -> dict[str, Any]:
        self.ensure_started()
        return {"host": self.host, "port": self.port}


class _ThreadingSessionTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    session: "Session"


class _SessionRequestHandler(socketserver.StreamRequestHandler):
    def handle(self) -> None:
        while True:
            line = self.rfile.readline()
            if not line:
                return
            request = json.loads(line.decode("utf-8"))
            response = self.server.session.handle_server_request(request)
            self.wfile.write(json.dumps(response).encode("utf-8") + b"\n")
            self.wfile.flush()


@dataclass(slots=True)
class SessionServerClient:
    """Client for a local session server."""

    host: str
    port: int

    def check_tool_call(
        self,
        tool_name: str,
        args: tuple[Any, ...],
        kwargs: dict[str, Any],
        choice: str | None = None,
    ) -> Decision:
        response = self._request(
            "check_tool_call",
            {
                "tool_name": tool_name,
                "args": list(args),
                "kwargs": kwargs,
                "choice": choice,
            },
        )
        return Decision.from_dict(response["decision"])

    def record_blocked_call(self, tool_name: str, decision: Decision) -> None:
        self._request(
            "record_blocked_call",
            {
                "tool_name": tool_name,
                "decision": decision.to_dict(),
            },
        )

    def record_result(self, tool_name: str, result: Any) -> None:
        self._request(
            "record_result",
            {
                "tool_name": tool_name,
                "result": result,
            },
        )

    def _request(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        payload = {"method": method, "params": params}
        with socket.create_connection((self.host, self.port)) as sock:
            sock.sendall(json.dumps(payload).encode("utf-8") + b"\n")
            file = sock.makefile("rb")
            response = json.loads(file.readline().decode("utf-8"))
        if "error" in response:
            raise RuntimeError(str(response["error"]))
        return response
