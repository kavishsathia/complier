"""Long-running Unix-socket sidecar that owns one Session per session_id.

Dispatch is delegated to Session.handle_server_request, which already
implements check_tool_call / record_result / record_blocked_call. We add
"kickoff" and "stop" on top.
"""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

from complier.contract.model import Contract
from complier.session.session import Session

from .discovery import contract_path, socket_path


class Sidecar:
    def __init__(self, session_id: str, cwd: str, workflow: str | None = None) -> None:
        cpl = contract_path(cwd)
        contract = Contract.from_file(cpl)
        # Pick the sole workflow if there's exactly one; otherwise leave it
        # for the agent's first check_tool_call (which infers it implicitly).
        if workflow is None and len(contract.workflows) == 1:
            workflow = next(iter(contract.workflows))
        self.session = Session(contract=contract, workflow=workflow)
        self.session_id = session_id
        self.cwd = cwd
        self.sock = socket_path(session_id)
        self._shutdown = asyncio.Event()

    async def serve(self) -> None:
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
            done, pending = await asyncio.wait(
                {stop_task, serve_task}, return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
        try:
            self.sock.unlink()
        except FileNotFoundError:
            pass

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            data = await reader.readline()
            if not data:
                return
            try:
                request = json.loads(data)
            except json.JSONDecodeError as e:
                response = {"error": f"invalid JSON: {e}"}
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
            if method == "kickoff":
                return {"result": {"kickoff": self.session.kickoff()}}
            if method == "stop":
                self._shutdown.set()
                return {"result": {"ok": True}}
            # Delegate the rest to Session's existing dispatch.
            inner = self.session.handle_server_request({"method": method, "params": params})
            if "error" in inner:
                return {"error": inner["error"]}
            return {"result": inner}
        except Exception as e:
            return {"error": f"{type(e).__name__}: {e}"}


def run(session_id: str, cwd: str, workflow: str | None = None) -> None:
    sidecar = Sidecar(session_id=session_id, cwd=cwd, workflow=workflow)
    asyncio.run(sidecar.serve())
