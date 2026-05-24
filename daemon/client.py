"""Client helpers extensions use to talk to the daemon.

Mirrors the lean four-method per-session contract in daemon/server.py:

    attach   -> {hint}
    check    -> {allowed, reason, missing, hint}
    record   -> {hint}
    choose   -> {}

Typical extension usage:

    from daemon.client import DaemonClient

    client = DaemonClient(session="my-session-id")
    client.attach(contract_path="/path/to/workflow.cpl")
    client.check("search_web", {"query": "hi"})
"""

from __future__ import annotations

from typing import Any

from . import protocol
from .discovery import ensure_daemon


class DaemonClient:
    def __init__(self, session: str) -> None:
        self.session = session
        self.sock = str(ensure_daemon())

    def attach(
        self,
        contract_path: str,
        workflow: str | None = None,
    ) -> dict[str, Any]:
        return protocol.request(
            self.sock,
            "attach",
            {
                "session": self.session,
                "contract_path": contract_path,
                "workflow": workflow,
            },
        )

    def detach(self) -> dict[str, Any]:
        return protocol.request(self.sock, "detach", {"session": self.session})

    def check(
        self,
        tool: str,
        params: dict[str, Any],
        choice: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "session": self.session,
            "tool": tool,
            "params": params,
        }
        if choice is not None:
            payload["choice"] = choice
        return protocol.request(self.sock, "check", payload)

    def record(
        self,
        tool: str,
        params: dict[str, Any],
        result: Any,
        choice: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "session": self.session,
            "tool": tool,
            "params": params,
            "result": result,
        }
        if choice is not None:
            payload["choice"] = choice
        return protocol.request(self.sock, "record", payload)

    def choose(self, arm: str) -> dict[str, Any]:
        return protocol.request(
            self.sock,
            "choose",
            {"session": self.session, "arm": arm},
        )

    def human(self) -> dict[str, Any]:
        return protocol.request(
            self.sock,
            "human",
            {"session": self.session},
        )
