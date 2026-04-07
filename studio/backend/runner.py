"""Workflow runner — executes a contract-enforced agent with MCP tools."""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import anyio
from agents import Agent, Runner
from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel
from agents.mcp import MCPServerStdio, MCPServerStreamableHttp
from openai import AsyncOpenAI

from complier import Contract, wrap_local_mcp, wrap_remote_mcp

from .token_store import FileTokenStorage


def _unwrap_error(exc: BaseException) -> str:
    """Recursively unwrap ExceptionGroups to get the actual error messages."""
    if isinstance(exc, BaseExceptionGroup):
        parts = []
        for sub in exc.exceptions:
            parts.append(_unwrap_error(sub))
        return "; ".join(parts)
    if exc.__cause__:
        return f"{exc}: {_unwrap_error(exc.__cause__)}"
    return str(exc)


def _parse_local_command(command: str) -> tuple[str, list[str]]:
    import shlex
    import shutil

    try:
        parts = shlex.split(command)
    except ValueError:
        parts = command.split()

    if Path(parts[0]).is_file() or shutil.which(parts[0]):
        return parts[0], parts[1:]

    raw_tokens = command.split()
    for i in range(1, len(raw_tokens)):
        candidate = " ".join(raw_tokens[: i + 1])
        if Path(candidate).is_file():
            return candidate, raw_tokens[i + 1 :]

    return parts[0], parts[1:]


@dataclass
class WorkflowRunner:
    """Manages a single workflow execution in a background thread."""

    cpl: str
    prompt: str
    ollama_url: str
    model: str
    mcp_configs: list[dict]

    status: str = "pending"
    final_output: str | None = None
    error: str | None = None
    _session: Any = field(default=None, repr=False)
    _log_cursor: int = field(default=0, repr=False)
    _thread: threading.Thread | None = field(default=None, repr=False)
    _history: list[dict] = field(default_factory=list, repr=False)

    def start(self) -> None:
        self.status = "running"
        self._thread = threading.Thread(target=self._run_sync, daemon=True)
        self._thread.start()

    def get_new_logs(self) -> list[dict]:
        if self._session is not None:
            self._history = list(self._session.state.history)
        entries = self._history[self._log_cursor:]
        self._log_cursor = len(self._history)
        return [self._format_entry(e) for e in entries]

    def stop(self) -> None:
        if self._session is not None:
            self._session.state.terminated = True
        self.status = "stopped"
        self._cleanup()

    def _run_sync(self) -> None:
        try:
            anyio.run(self._run_async)
        except BaseException as exc:
            import traceback
            tb = traceback.format_exception(exc)
            self.error = "".join(tb)
            self.status = "error"
        finally:
            self._cleanup()

    async def _run_async(self) -> None:
        from dotenv import load_dotenv
        load_dotenv(Path(__file__).resolve().parents[2] / ".env")
        load_dotenv(Path(__file__).resolve().parents[2] / "demo" / ".env")

        contract = Contract.from_source(self.cpl)
        session = contract.create_session()
        self._session = session

        mcp_servers = []
        project_root = str(Path(__file__).resolve().parents[2])

        try:
            for cfg in self.mcp_configs:
                if not cfg.get("enabled", True):
                    continue
                name = cfg.get("name", "mcp")
                server_type = cfg.get("type", "")

                try:
                    if server_type == "local":
                        command = cfg.get("command", "")
                        if not command:
                            continue
                        executable, args = _parse_local_command(command)
                        details = wrap_local_mcp(session, name, [executable, *args])
                        mcp_servers.append(
                            MCPServerStdio(
                                {
                                    "command": details.command[0],
                                    "args": details.command[1:],
                                    "env": details.env,
                                    "cwd": project_root,
                                },
                                cache_tools_list=True,
                                name=f"{name}-local-wrapper",
                            )
                        )

                    elif server_type == "remote":
                        url = cfg.get("url", "")
                        if not url:
                            continue
                        auth_token = None
                        server_id = cfg.get("id", "")
                        if server_id:
                            storage = FileTokenStorage(server_id)
                            token_data = await storage.get_tokens()
                            if token_data and token_data.access_token:
                                auth_token = token_data.access_token
                        details = wrap_remote_mcp(session, name, url, auth_token=auth_token)
                        mcp_servers.append(
                            MCPServerStreamableHttp(
                                {"url": details.url},
                                cache_tools_list=True,
                                name=f"{name}-remote-wrapper",
                            )
                        )
                except Exception as exc:
                    logger.warning(f"Skipping MCP server '{name}': {exc}")
                    continue

            if not mcp_servers:
                self.error = "No MCP servers could be started."
                self.status = "error"
                return

            if self.ollama_url:
                client = AsyncOpenAI(
                    base_url=self.ollama_url,
                    api_key="ollama",
                )
                model = OpenAIChatCompletionsModel(
                    model=self.model,
                    openai_client=client,
                )
            else:
                model = self.model

            agent = Agent(
                name="Complier Studio Agent",
                model=model,
                instructions=self.prompt,
                mcp_servers=mcp_servers,
            )

            async with _enter_all(mcp_servers):
                result = await Runner.run(
                    agent,
                    self.prompt,
                    max_turns=20,
                )
                self.final_output = result.final_output_as(str, raise_if_incorrect_type=True)
                self.status = "done"

        except BaseException as exc:
            import traceback
            self.error = "".join(traceback.format_exception(exc))
            self.status = "error"

    def _cleanup(self) -> None:
        if self._session is not None:
            try:
                self._session.close()
            except Exception:
                pass

    @staticmethod
    def _format_entry(entry: dict) -> dict:
        event = entry.get("event", "unknown")
        tool_name = entry.get("tool_name", "")

        if event == "tool_call_allowed":
            kwargs = entry.get("kwargs", {})
            detail = json.dumps(kwargs, default=str) if kwargs else ""
            return {"event": "allowed", "tool": tool_name, "detail": detail}

        if event == "tool_call_blocked":
            decision = entry.get("decision")
            reason = ""
            remediation = ""
            if decision:
                if hasattr(decision, "reason"):
                    reason = decision.reason or ""
                elif isinstance(decision, dict):
                    reason = decision.get("reason", "")
                if hasattr(decision, "remediation"):
                    rem = decision.remediation
                    if rem:
                        remediation = rem.message if hasattr(rem, "message") else str(rem)
                elif isinstance(decision, dict) and decision.get("remediation"):
                    remediation = decision["remediation"].get("message", "")
            detail = reason
            if remediation:
                detail += f" | {remediation}"
            return {"event": "blocked", "tool": tool_name, "detail": detail}

        if event == "tool_result_recorded":
            result = entry.get("result")
            if isinstance(result, dict):
                content = result.get("content", [])
                if isinstance(content, list) and content:
                    first = content[0]
                    if isinstance(first, dict):
                        detail = str(first.get("text", ""))[:200]
                    else:
                        detail = str(first)[:200]
                else:
                    detail = str(result)[:200]
            else:
                detail = str(result)[:200] if result else ""
            return {"event": "result", "tool": tool_name, "detail": detail}

        return {"event": event, "tool": tool_name, "detail": ""}


class _enter_all:
    """Async context manager that enters multiple MCP servers."""

    def __init__(self, servers: list) -> None:
        self._servers = servers
        self._stack: list = []

    async def __aenter__(self):
        for s in self._servers:
            await s.__aenter__()
            self._stack.append(s)
        return self

    async def __aexit__(self, *exc):
        for s in reversed(self._stack):
            try:
                await s.__aexit__(*exc)
            except Exception:
                pass
