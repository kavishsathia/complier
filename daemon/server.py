"""Multi-session complier daemon over a Unix socket.

Daemon-level methods (infrastructure):
    attach     params={session, contract_path, workflow?}   -> {hint}
    detach     params={session}                              -> {ok}
    list       params={}                                     -> {sessions: [...]}
    stop       params={}                                     -> {ok}

Per-session methods (the lean contract):
    check      params={session, tool, params}                -> {allowed, reason?, missing?, hint}
    record     params={session, tool, result}                -> {hint}
    choose     params={session, arm}                         -> {}
    human      params={session}                              -> {prompt, hint}

All requests/responses are single-line JSON with the envelope
    {"method": "...", "params": {...}}
    {"result": {...}} | {"error": "..."}
"""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from .discovery import socket_path
from .sessions import SessionRegistry


class Daemon:
    def __init__(self) -> None:
        self.sock = socket_path()
        self.registry = SessionRegistry()
        self._shutdown = asyncio.Event()

    async def serve(self) -> None:
        self.sock.parent.mkdir(parents=True, exist_ok=True)
        if self.sock.exists():
            self.sock.unlink()
        server = await asyncio.start_unix_server(self._handle, path=str(self.sock))
        try:
            os.chmod(self.sock, 0o600)
        except OSError:
            pass
        async with server:
            stop_task = asyncio.create_task(self._shutdown.wait())
            serve_task = asyncio.create_task(server.serve_forever())
            _, pending = await asyncio.wait(
                {stop_task, serve_task}, return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
        try:
            self.sock.unlink()
        except FileNotFoundError:
            pass

    async def _handle(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            data = await reader.readline()
            if not data:
                return
            try:
                request = json.loads(data)
            except json.JSONDecodeError as exc:
                response = {"error": f"invalid JSON: {exc}"}
            else:
                response = self._dispatch(request)
            writer.write((json.dumps(response) + "\n").encode("utf-8"))
            await writer.drain()
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    def _dispatch(self, request: dict[str, Any]) -> dict[str, Any]:
        method = request.get("method")
        params = request.get("params") or {}
        try:
            daemon_response = self._dispatch_daemon_method(method, params)
            if daemon_response is not None:
                return daemon_response
            return self._dispatch_session_method(method, params)
        except Exception as exc:
            return {"error": f"{type(exc).__name__}: {exc}"}

    def _dispatch_daemon_method(
        self, method: str | None, params: dict[str, Any]
    ) -> dict[str, Any] | None:
        if method == "attach":
            entry = self.registry.attach(
                name=params["session"],
                contract_path=params["contract_path"],
                workflow=params.get("workflow"),
            )
            try:
                hint = entry.session.kickoff()
            except RuntimeError:
                # Multi-workflow contract without an explicit selection — empty hint.
                hint = ""
            return {"result": {"hint": hint}}
        if method == "detach":
            ok = self.registry.detach(params["session"])
            return {"result": {"ok": ok}}
        if method == "list":
            return {
                "result": {
                    "sessions": [
                        {
                            "name": e.name,
                            "workflow": e.workflow,
                            "contract_path": e.contract_path,
                        }
                        for e in self.registry.all()
                    ]
                }
            }
        if method == "stop":
            self._shutdown.set()
            return {"result": {"ok": True}}
        return None

    def _dispatch_session_method(
        self, method: str | None, params: dict[str, Any]
    ) -> dict[str, Any]:
        session_name = params.get("session")
        if session_name is None:
            return {"error": "'session' is required for this method"}
        entry = self.registry.get(session_name)
        if entry is None:
            return {"error": f"unknown session: {session_name!r}"}

        session = entry.session

        if method == "check":
            tool = str(params["tool"])
            call_params = dict(params.get("params") or {})
            choice = params.get("choice") or entry.pending_choice
            decision = session.check_tool_call(tool, (), call_params, choice=choice)
            remediation = decision.remediation
            hint_actions = remediation.allowed_next_actions if remediation else []
            missing = remediation.missing_requirements if remediation else []
            return {
                "result": {
                    "allowed": decision.allowed,
                    "reason": decision.reason or "",
                    "missing": list(missing),
                    "hint": "\n".join(hint_actions),
                }
            }

        if method == "record":
            tool = str(params["tool"])
            call_params = dict(params.get("params") or {})
            result = params.get("result")
            choice = params.get("choice") or entry.pending_choice
            hint = session.record_tool_call(tool, (), call_params, result, choice=choice)
            # Clear the pending choice once consumed by a recorded call.
            entry.pending_choice = None
            return {"result": {"hint": hint}}

        if method == "choose":
            entry.pending_choice = str(params["arm"])
            return {"result": {}}

        if method == "human":
            choice = params.get("choice") or entry.pending_choice
            try:
                prompt, hint = session.satisfy_human_step(choice=choice)
            except ValueError as exc:
                return {"error": str(exc)}
            entry.pending_choice = None
            return {"result": {"prompt": prompt, "hint": hint}}

        return {"error": f"unknown method: {method!r}"}


def run() -> None:
    daemon = Daemon()
    asyncio.run(daemon.serve())
