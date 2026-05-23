"""Claude Code hook handler.

Reads a Claude Code hook event JSON from stdin, dispatches based on
`hook_event_name`, talks to the complier daemon, writes the hook's
structured response on stdout.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from daemon.client import DaemonClient

from .contract import contract_path


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def _format_next_actions(actions: list[str]) -> str:
    if not actions:
        return ""
    return "Allowed next actions:\n" + "\n".join(f"- {a}" for a in actions)


def _session_name(event: dict[str, Any]) -> str:
    return f"cc:{event.get('session_id', 'default')}"


def _ensure_attached(client: DaemonClient, event: dict[str, Any]) -> dict[str, Any]:
    cwd = event.get("cwd", ".")
    return client.attach(contract_path=str(contract_path(cwd)))


def _handle_pre_tool_use(event: dict[str, Any], client: DaemonClient) -> dict[str, Any]:
    tool_name = event.get("tool_name", "")
    tool_input = event.get("tool_input") or {}
    response = client.check_tool_call(tool_name, [], tool_input)
    if "error" in response:
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": f"cc daemon error: {response['error']}",
            }
        }

    decision = (response.get("result") or {}).get("decision") or {}
    allowed = decision.get("allowed", False)
    reason = decision.get("reason") or ""
    remediation = decision.get("remediation") or {}
    next_actions = remediation.get("allowed_next_actions") or []
    missing = remediation.get("missing_requirements") or []
    message = remediation.get("message") or ""

    if allowed:
        hint = _format_next_actions(next_actions)
        out: dict[str, Any] = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
            }
        }
        if hint:
            out["hookSpecificOutput"]["additionalContext"] = hint
        return out

    parts = [reason] if reason else []
    if message:
        parts.append(message)
    if missing:
        parts.append("Missing: " + "; ".join(missing))
    hint = _format_next_actions(next_actions)
    if hint:
        parts.append(hint)
    deny_reason = "\n\n".join(p for p in parts if p) or "Blocked by complier contract."
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": deny_reason,
        }
    }


def _handle_post_tool_use(event: dict[str, Any], client: DaemonClient) -> dict[str, Any]:
    tool_name = event.get("tool_name", "")
    tool_response = event.get("tool_response")
    client.record_result(tool_name, tool_response)
    return {}


def _handle_session_start(event: dict[str, Any], client: DaemonClient) -> dict[str, Any]:
    response = client.kickoff()
    kickoff = (response.get("result") or {}).get("kickoff", "")
    if kickoff:
        return {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": f"complier contract active.\n\n{kickoff}",
            }
        }
    return {}


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        _emit({})
        return 0
    event = json.loads(raw)

    hook_name = event.get("hook_event_name", "")
    try:
        client = DaemonClient(session_name=_session_name(event))
        _ensure_attached(client, event)
    except Exception as exc:
        _emit({
            "hookSpecificOutput": {
                "hookEventName": hook_name,
                "additionalContext": f"cc daemon unavailable: {exc}",
            }
        })
        return 0

    if hook_name == "PreToolUse":
        _emit(_handle_pre_tool_use(event, client))
    elif hook_name == "PostToolUse":
        _emit(_handle_post_tool_use(event, client))
    elif hook_name == "SessionStart":
        _emit(_handle_session_start(event, client))
    else:
        _emit({})
    return 0
