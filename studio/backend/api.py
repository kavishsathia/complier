"""JS-to-Python bridge API exposed to the pywebview frontend."""

from __future__ import annotations

import json
import random
from pathlib import Path

import anyio
import httpx
from agents import Agent, Runner, function_tool
from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel
from openai import AsyncOpenAI

from complier import Contract

from .mcp_store import MCPConfigStore
from .store import WorkflowStore


@function_tool
def generate_random_num(min: int = 1, max: int = 100) -> str:
    """Generate a random number between min and max (inclusive)."""
    return str(random.randint(min, max))


class StudioAPI:
    """Public methods on this class are callable from JS via window.pywebview.api."""

    def __init__(self, store: WorkflowStore, mcp_store: MCPConfigStore | None = None) -> None:
        self._store = store
        self._mcp_store = mcp_store or MCPConfigStore()

    @staticmethod
    def _parse_local_command(command: str) -> tuple[str, list[str]]:
        """Parse a command string, handling spaces in file paths.

        Tries shlex first.  If the executable token isn't a real file,
        progressively joins whitespace-separated tokens until a valid
        path is found (handles unquoted paths like
        ``/Users/x/Side Projects/venv/bin/python``).
        """
        import shlex
        import shutil

        # 1. Try shlex (handles quoted strings correctly)
        try:
            parts = shlex.split(command)
        except ValueError:
            parts = command.split()

        # If first token is already a valid executable, we're done
        if Path(parts[0]).is_file() or shutil.which(parts[0]):
            return parts[0], parts[1:]

        # 2. Progressively join tokens to find an executable with spaces in path
        raw_tokens = command.split()
        for i in range(1, len(raw_tokens)):
            candidate = " ".join(raw_tokens[: i + 1])
            if Path(candidate).is_file():
                remaining = raw_tokens[i + 1 :]
                return candidate, remaining

        # 3. Fall back to first shlex token (will likely fail, but gives a clear error)
        return parts[0], parts[1:]

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    def ping(self) -> str:
        return "pong"

    # ------------------------------------------------------------------
    # CPL validation
    # ------------------------------------------------------------------

    def validate_cpl(self, cpl_source: str) -> dict:
        """Parse CPL source and return whether it is valid."""
        try:
            Contract.from_source(cpl_source)
            return {"valid": True}
        except Exception as exc:
            return {"valid": False, "error": str(exc)}

    def parse_cpl(self, cpl_source: str) -> dict:
        """Parse CPL source and return the AST as JSON."""
        from dataclasses import asdict, is_dataclass
        from complier.contract import ContractParser

        class _Enc(json.JSONEncoder):
            def default(self, obj: object) -> object:
                if is_dataclass(obj) and not isinstance(obj, type):
                    return asdict(obj)
                return super().default(obj)

        try:
            parsed = ContractParser().parse(cpl_source)
            ast_dict = json.loads(json.dumps(parsed.program, cls=_Enc))
            return {"ok": True, "ast": ast_dict}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # ------------------------------------------------------------------
    # Ollama
    # ------------------------------------------------------------------

    def list_ollama_models(self, ollama_url: str) -> list[str]:
        """Query a running Ollama instance for available model names."""
        try:
            resp = httpx.get(f"{ollama_url}/api/tags", timeout=5)
            resp.raise_for_status()
            models = resp.json().get("models", [])
            return [m["name"] for m in models]
        except Exception:
            return []

    # ------------------------------------------------------------------
    # Workflow persistence
    # ------------------------------------------------------------------

    def list_workflows(self) -> list[dict]:
        return self._store.list()

    def save_workflow(self, name: str, graph_json: str) -> dict:
        self._store.save(name, json.loads(graph_json))
        return {"ok": True}

    def load_workflow(self, name: str) -> dict | None:
        return self._store.load(name)

    def delete_workflow(self, name: str) -> dict:
        self._store.delete(name)
        return {"ok": True}

    # ------------------------------------------------------------------
    # MCP server configuration
    # ------------------------------------------------------------------

    def list_mcp_servers(self) -> list[dict]:
        return self._mcp_store.list()

    def save_mcp_server(self, config_json: str) -> dict:
        self._mcp_store.save(json.loads(config_json))
        return {"ok": True}

    def delete_mcp_server(self, config_id: str) -> dict:
        self._mcp_store.delete(config_id)
        return {"ok": True}

    def test_mcp_server(self, config_json: str) -> dict:
        """Connect to an MCP server and list its tools."""
        import shlex

        from mcp import ClientSession
        from mcp.client.stdio import StdioServerParameters, stdio_client

        config = json.loads(config_json)
        server_type = config.get("type", "")

        if server_type == "remote":
            from mcp.client.streamable_http import streamable_http_client

            url = config.get("url", "")
            if not url:
                return {"ok": False, "error": "No URL provided"}

            async def _test_remote() -> dict:
                async with streamable_http_client(url) as (read, write, _):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        result = await session.list_tools()
                        names = [t.name for t in result.tools]
                        return {
                            "ok": True,
                            "tools": names,
                            "message": f"Connected — {len(names)} tool(s) found",
                        }

            try:
                return anyio.from_thread.run(_test_remote)
            except Exception:
                try:
                    return anyio.run(_test_remote)
                except Exception as exc:
                    return {"ok": False, "error": str(exc)}

        if server_type == "local":
            command = config.get("command", "")
            if not command:
                return {"ok": False, "error": "No command provided"}

            executable, args = self._parse_local_command(command)
            params = StdioServerParameters(command=executable, args=args)

            async def _test_local() -> dict:
                async with stdio_client(params) as (read, write):
                    async with ClientSession(read, write) as session:
                        await session.initialize()
                        result = await session.list_tools()
                        names = [t.name for t in result.tools]
                        return {
                            "ok": True,
                            "tools": names,
                            "message": f"Connected — {len(names)} tool(s) found",
                        }

            try:
                return anyio.from_thread.run(_test_local)
            except Exception:
                try:
                    return anyio.run(_test_local)
                except Exception as exc:
                    return {"ok": False, "error": str(exc)}

        return {"ok": False, "error": f"Unknown server type: {server_type}"}

    # ------------------------------------------------------------------
    # Chat (OpenAI Agents SDK + Ollama)
    # ------------------------------------------------------------------

    def chat(self, ollama_url: str, model: str, messages_json: str) -> str:
        """Run a chat turn through the Agents SDK with Ollama."""
        messages = json.loads(messages_json)
        last_user_msg = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                last_user_msg = m["content"]
                break

        if not last_user_msg:
            return "No message provided."

        ollama_client = AsyncOpenAI(
            base_url=f"{ollama_url}/v1",
            api_key="ollama",
        )

        agent = Agent(
            name="Studio Chat Agent",
            model=OpenAIChatCompletionsModel(
                model=model,
                openai_client=ollama_client,
            ),
            instructions="You are a helpful assistant. You have access to a generate_random_num tool that generates random numbers. Use it when asked.",
            tools=[generate_random_num],
        )

        async def _run() -> str:
            result = await Runner.run(
                agent,
                last_user_msg,
                max_turns=6,
            )
            return result.final_output_as(str, raise_if_incorrect_type=True)

        try:
            return anyio.from_thread.run(_run)
        except Exception:
            return anyio.run(_run)
