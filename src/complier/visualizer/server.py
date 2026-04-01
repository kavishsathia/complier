"""Local server for visualizing compiled contracts."""

from __future__ import annotations

import json
import mimetypes
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from typing import Any

from complier.contract.model import Contract

from .graph import contract_to_graph

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".jsx")
mimetypes.add_type("text/css", ".css")


class VisualizerServer:
    """Small local server that exposes contract graph JSON."""

    def __init__(self, httpd: ThreadingHTTPServer, thread: Thread, url: str) -> None:
        self._httpd = httpd
        self._thread = thread
        self.url = url

    def close(self) -> None:
        """Stop the server and wait briefly for shutdown."""
        self._httpd.shutdown()
        self._thread.join(timeout=1.0)


def serve_contract(contract: Contract, host: str = "127.0.0.1", port: int = 8765) -> VisualizerServer:
    """Start a background server for the given contract."""
    graph_payload = contract_to_graph(contract)
    app_dir = Path.cwd() / "visualizer-app"

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/api/contract":
                self._send_json(graph_payload)
                return

            if self.path in {"/", "/index.html"}:
                index_path = app_dir / "index.html"
                if index_path.exists():
                    self._send_file(index_path, "text/html; charset=utf-8")
                else:
                    self._send_json(
                        {
                            "error": "Visualizer app not found.",
                            "expected": str(index_path),
                        },
                        status=404,
                    )
                return

            static_path = self._resolve_static_path(self.path)
            if static_path is not None:
                content_type, _ = mimetypes.guess_type(static_path.name)
                self._send_file(
                    static_path,
                    content_type or "application/octet-stream",
                )
                return

            self._send_json({"error": "Not found."}, status=404)

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
            return

        def _send_json(self, payload: Any, status: int = 200) -> None:
            body = json.dumps(payload, indent=2).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _send_file(self, path: Path, content_type: str) -> None:
            body = path.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _resolve_static_path(self, request_path: str) -> Path | None:
            relative_path = request_path.lstrip("/")
            candidate = (app_dir / relative_path).resolve()

            try:
                candidate.relative_to(app_dir.resolve())
            except ValueError:
                return None

            if candidate.is_file():
                return candidate

            return None

    httpd = ThreadingHTTPServer((host, port), Handler)
    thread = Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return VisualizerServer(httpd=httpd, thread=thread, url=f"http://{host}:{port}")
