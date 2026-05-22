"""OpenAI Agents SDK demo using Ollama as the model provider.

This is the same workflow as run_agents_sdk_demo.py but runs against a local
Ollama instance instead of the OpenAI API.  All Complier wrappers, function
tools, and MCP servers work identically — only the model configuration changes.

Prerequisites:
    1. Ollama running locally (default: http://localhost:11434)
    2. A model pulled that supports tool calling, e.g.:
           ollama pull qwen2.5
           ollama pull llama3.1
           ollama pull gemma4
"""

from __future__ import annotations

import os
import socket
import subprocess
import time
from pathlib import Path

from agents import Agent, Runner, function_tool
from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel
from agents.mcp import MCPServerStdio, MCPServerStreamableHttp
from dotenv import load_dotenv
from openai import AsyncOpenAI

from complier import Contract, wrap_local_mcp, wrap_remote_mcp


ROOT = Path(__file__).resolve().parents[1]
DEMO_DIR = ROOT / "demo"
DOWNSTREAM_REMOTE_PORT = 9101
WRAPPER_REMOTE_PORT = 9102


def _load_env() -> None:
    load_dotenv(ROOT / ".env")
    load_dotenv(DEMO_DIR / ".env")


def project_status() -> str:
    """Return the current project status."""
    return "project-status: green"


def mark_done(summary: str) -> str:
    """Mark the demo workflow as done."""
    return f"done:{summary}"


def _start_process(command: list[str], env: dict[str, str] | None = None) -> subprocess.Popen[str]:
    process_env = os.environ.copy()
    if env:
        process_env.update(env)
    return subprocess.Popen(command, env=process_env, cwd=str(ROOT))


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


def main() -> None:
    _load_env()

    ollama_base_url = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434/v1")
    ollama_model = os.environ.get("OLLAMA_MODEL", "gemma4")
    remote_auth_token = os.environ.get("REMOTE_MCP_AUTH_TOKEN", "demo-token")

    ollama_client = AsyncOpenAI(
        base_url=ollama_base_url,
        api_key="ollama",  # required by the client but ignored by Ollama
    )

    contract_session = Contract.from_source(
        """
workflow "demo"
    | project_status
    | notion.create_notion_page
    | vault.read_local_vault_details
    | mark_done
"""
    ).create_session()

    remote_downstream = _start_process(
        [
            "./.venv/bin/python",
            "demo/remote_mcp_downstream.py",
            "--port",
            str(DOWNSTREAM_REMOTE_PORT),
        ]
    )

    try:
        _wait_for_port(DOWNSTREAM_REMOTE_PORT)

        remote_details = wrap_remote_mcp(
            contract_session,
            "notion",
            f"http://127.0.0.1:{DOWNSTREAM_REMOTE_PORT}/mcp/",
            port=WRAPPER_REMOTE_PORT,
        )
        local_details = wrap_local_mcp(
            contract_session,
            "vault",
            ["./.venv/bin/python", "demo/local_mcp_downstream.py"],
        )

        status_tool = function_tool(contract_session.wrap(project_status))
        done_tool = function_tool(contract_session.wrap(mark_done))

        local_server = MCPServerStdio(
            {
                "command": local_details.command[0],
                "args": local_details.command[1:],
                "env": local_details.env,
            },
            cache_tools_list=True,
            name="vault-local-wrapper",
        )
        remote_server = MCPServerStreamableHttp(
            {
                "url": remote_details.url,
                "headers": {"Authorization": f"Bearer {remote_auth_token}"},
            },
            cache_tools_list=True,
            name="notion-remote-wrapper",
            use_structured_content=True,
        )

        agent = Agent(
            name="Complier Ollama Demo Agent",
            model=OpenAIChatCompletionsModel(
                model=ollama_model,
                openai_client=ollama_client,
            ),
            instructions=(
                "Follow this exact process. "
                "First call project_status. "
                "Then call create_notion_page with title 'Agents SDK demo'. "
                "Then call read_local_vault_details. "
                "Then call mark_done with a short summary containing the earlier tool outputs. "
                "Finally return a compact summary."
            ),
            tools=[status_tool, done_tool],
            mcp_servers=[remote_server, local_server],
        )

        async def _run() -> None:
            async with remote_server, local_server:
                result = await Runner.run(
                    agent,
                    "Run the workflow exactly once and report the final result.",
                    max_turns=12,
                )
                print("final_output:")
                print(result.final_output_as(str, raise_if_incorrect_type=True))

        import anyio

        anyio.run(_run)
    finally:
        contract_session.close()
        _stop_process(remote_downstream)


if __name__ == "__main__":
    main()
