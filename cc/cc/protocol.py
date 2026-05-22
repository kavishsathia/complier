"""Newline-delimited JSON request/response over a Unix socket.

Wire format: one JSON object per line. Requests are
    {"method": str, "params": dict}
Responses are either
    {"result": <any>}    or    {"error": str}
"""

from __future__ import annotations

import json
import socket
from typing import Any


def request(sock_path: str, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Send a single request and return the parsed response."""
    payload = json.dumps({"method": method, "params": params or {}}) + "\n"
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
        s.connect(sock_path)
        s.sendall(payload.encode("utf-8"))
        s.shutdown(socket.SHUT_WR)
        chunks: list[bytes] = []
        while True:
            chunk = s.recv(4096)
            if not chunk:
                break
            chunks.append(chunk)
    line = b"".join(chunks).decode("utf-8").strip()
    if not line:
        return {"error": "empty response from sidecar"}
    return json.loads(line)
