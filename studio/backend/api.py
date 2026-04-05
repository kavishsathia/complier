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

from .store import WorkflowStore


@function_tool
def generate_random_num(min: int = 1, max: int = 100) -> str:
    """Generate a random number between min and max (inclusive)."""
    return str(random.randint(min, max))


class StudioAPI:
    """Public methods on this class are callable from JS via window.pywebview.api."""

    def __init__(self, store: WorkflowStore) -> None:
        self._store = store

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
