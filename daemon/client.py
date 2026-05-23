"""Client helpers extensions use to talk to the daemon.

Typical extension usage:

    from daemon.client import DaemonClient

    client = DaemonClient(session_name="my-session-id")
    client.attach(contract_path="/path/to/workflow.cpl")
    client.kickoff()
    response = client.check_tool_call("search_web", [], {"query": "hi"})
"""

from __future__ import annotations

from typing import Any

from . import protocol
from .discovery import ensure_daemon


class DaemonClient:
    def __init__(self, session_name: str) -> None:
        self.session_name = session_name
        self.sock = str(ensure_daemon())

    def attach(
        self,
        contract_path: str,
        workflow: str | None = None,
    ) -> dict[str, Any]:
        return protocol.request(
            self.sock,
            "attach_session",
            {
                "session_name": self.session_name,
                "contract_path": contract_path,
                "workflow": workflow,
            },
        )

    def detach(self) -> dict[str, Any]:
        return protocol.request(
            self.sock, "detach_session", {"session_name": self.session_name}
        )

    def kickoff(self) -> dict[str, Any]:
        return protocol.request(
            self.sock, "kickoff", {"session_name": self.session_name}
        )

    def check_tool_call(
        self,
        tool_name: str,
        args: list[Any],
        kwargs: dict[str, Any],
        choice: str | None = None,
    ) -> dict[str, Any]:
        params: dict[str, Any] = {
            "session_name": self.session_name,
            "tool_name": tool_name,
            "args": args,
            "kwargs": kwargs,
        }
        if choice is not None:
            params["choice"] = choice
        return protocol.request(self.sock, "check_tool_call", params)

    def record_result(self, tool_name: str, result: Any) -> dict[str, Any]:
        return protocol.request(
            self.sock,
            "record_result",
            {
                "session_name": self.session_name,
                "tool_name": tool_name,
                "result": result,
            },
        )

    def record_blocked_call(
        self, tool_name: str, decision: dict[str, Any]
    ) -> dict[str, Any]:
        return protocol.request(
            self.sock,
            "record_blocked_call",
            {
                "session_name": self.session_name,
                "tool_name": tool_name,
                "decision": decision,
            },
        )
