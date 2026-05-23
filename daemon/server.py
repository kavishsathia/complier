"""Multi-session complier daemon over a Unix socket.

Methods (daemon-level):
    attach_session  params={session_name, contract_path, workflow?}
    detach_session  params={session_name}
    list_sessions   params={}
    stop            params={}

Methods (per-session; require session_name in params):
    kickoff
    check_tool_call    {tool_name, args, kwargs, choice?}
    record_blocked_call {tool_name, decision}
    record_result      {tool_name, result}
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

            session_name = params.get("session_name")
            if session_name is None:
                return {"error": "session_name is required for this method"}
            entry = self.registry.get(session_name)
            if entry is None:
                return {"error": f"unknown session: {session_name!r}"}

            if method == "kickoff":
                return {"result": {"kickoff": entry.session.kickoff()}}

            inner_params = {k: v for k, v in params.items() if k != "session_name"}
            inner = entry.session.handle_server_request(
                {"method": method, "params": inner_params}
            )
            if "error" in inner:
                return {"error": inner["error"]}
            return {"result": inner}
        except Exception as exc:
            return {"error": f"{type(exc).__name__}: {exc}"}

    def _dispatch_daemon_method(
        self, method: str | None, params: dict[str, Any]
    ) -> dict[str, Any] | None:
        if method == "attach_session":
            entry = self.registry.attach(
                name=params["session_name"],
                contract_path=params["contract_path"],
                workflow=params.get("workflow"),
            )
            return {
                "result": {
                    "session_name": entry.name,
                    "workflow": entry.workflow,
                    "contract_path": entry.contract_path,
                }
            }
        if method == "detach_session":
            ok = self.registry.detach(params["session_name"])
            return {"result": {"ok": ok}}
        if method == "list_sessions":
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


def run() -> None:
    daemon = Daemon()
    asyncio.run(daemon.serve())
