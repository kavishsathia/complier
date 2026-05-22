"""End-to-end demo for wrapping a remote HTTP MCP server."""

from __future__ import annotations

import os
import socket
import subprocess
import time

import anyio
import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from complier.contract.model import Contract
from complier.wrappers.remote_mcp import wrap_remote_mcp


DOWNSTREAM_PORT = 9001
WRAPPER_PORT = 9002


async def main() -> None:
    contract_session = Contract.from_source(
        """
workflow "notion"
    | notion.create_notion_page
"""
    ).create_session()

    downstream = _start_process(
        [
            "./.venv/bin/python",
            "demo/remote_mcp_downstream.py",
            "--port",
            str(DOWNSTREAM_PORT),
        ]
    )
    notion = wrap_remote_mcp(
        contract_session,
        "notion",
        f"http://127.0.0.1:{DOWNSTREAM_PORT}/mcp/",
        port=WRAPPER_PORT,
    )
    mirror = wrap_remote_mcp(
        contract_session,
        "mirror",
        f"http://127.0.0.1:{DOWNSTREAM_PORT}/mcp/",
        port=WRAPPER_PORT,
    )

    try:
        _wait_for_port(DOWNSTREAM_PORT)

        async with httpx.AsyncClient(headers={"Authorization": "Bearer demo-token"}) as http_client:
            async with streamable_http_client(notion.url, http_client=http_client) as transport:
                read_stream, write_stream, _get_session_id = transport
                async with ClientSession(read_stream, write_stream) as client_session:
                    await client_session.initialize()

                    tools = await client_session.list_tools()
                    print("notion_tools:", [tool.name for tool in tools.tools])

                    allowed = await client_session.call_tool("create_notion_page", {"title": "hello"})
                    print("allowed_is_error:", allowed.isError)
                    print("allowed_result:", allowed.structuredContent)

                    blocked = await client_session.call_tool("read_vaults_details", {})
                    print("blocked_is_error:", blocked.isError)
                    print("blocked_result:", blocked.structuredContent)

            async with streamable_http_client(mirror.url, http_client=http_client) as transport:
                read_stream, write_stream, _get_session_id = transport
                async with ClientSession(read_stream, write_stream) as client_session:
                    await client_session.initialize()

                    tools = await client_session.list_tools()
                    print("mirror_tools:", [tool.name for tool in tools.tools])
    finally:
        contract_session.close()
        _stop_process(downstream)


def _start_process(command: list[str], env: dict[str, str] | None = None) -> subprocess.Popen[str]:
    process_env = os.environ.copy()
    if env:
        process_env.update(env)
    return subprocess.Popen(command, env=process_env)


def _stop_process(process: subprocess.Popen[str]) -> None:
    process.terminate()
    try:
        process.wait(timeout=3)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)


def _wait_for_port(port: int, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.2):
                return
        except OSError:
            time.sleep(0.05)
    raise TimeoutError(f"Timed out waiting for port {port}")


if __name__ == "__main__":
    anyio.run(main)
