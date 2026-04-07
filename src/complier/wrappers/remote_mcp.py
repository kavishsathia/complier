"""Helpers for wrapping remote HTTP MCP servers."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
import time

import httpx

from complier.session.session import Session


@dataclass(slots=True)
class RemoteMCPDetails:
    """Connection details for a wrapped remote HTTP MCP server."""

    namespace: str
    url: str


def wrap_remote_mcp(
    session: Session,
    namespace: str,
    url: str,
    *,
    host: str = "127.0.0.1",
    port: int = 8766,
    auth_token: str | None = None,
) -> RemoteMCPDetails:
    """Register and return connection details for a namespaced remote HTTP MCP wrapper."""
    from .local_mcp import _normalize_namespace

    normalized_namespace = _normalize_namespace(namespace)
    base_url = _ensure_remote_wrapper_host(session, host=host, port=port)
    _register_remote_namespace(base_url, normalized_namespace, url, auth_token=auth_token)
    return RemoteMCPDetails(namespace=normalized_namespace, url=f"{base_url}/mcp/{normalized_namespace}/")


def _ensure_remote_wrapper_host(session: Session, *, host: str, port: int) -> str:
    if session._remote_wrapper_base_url is not None:
        return session._remote_wrapper_base_url

    server_details = session.server.to_dict()
    wrapper_command = [
        sys.executable,
        "-m",
        "complier.wrappers.remote_http_proxy",
        "--session-host",
        str(server_details["host"]),
        "--session-port",
        str(server_details["port"]),
        "--host",
        host,
        "--port",
        str(port),
    ]
    src_path = Path(__file__).resolve().parents[3] / "src"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(src_path)
    process = subprocess.Popen(wrapper_command, env=env)
    session.register_managed_process(process)
    _wait_for_port(host, port)
    session._remote_wrapper_base_url = f"http://{host}:{port}"
    return session._remote_wrapper_base_url


def _register_remote_namespace(
    base_url: str,
    namespace: str,
    downstream_url: str,
    auth_token: str | None = None,
) -> None:
    payload: dict[str, str] = {"namespace": namespace, "downstream_url": downstream_url}
    if auth_token:
        payload["auth_token"] = auth_token
    response = httpx.post(f"{base_url}/setup", json=payload, timeout=5.0)
    response.raise_for_status()


def _wait_for_port(host: str, port: int, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    raise TimeoutError(f"Timed out waiting for port {port}")
