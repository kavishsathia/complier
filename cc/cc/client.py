"""Per-hook subprocess: translates between Claude Code hooks and the sidecar.

Reads a Claude Code hook event JSON from stdin, dispatches based on
`hook_event_name`, and writes the hook's structured response on stdout.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from . import discovery, protocol


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload))
    sys.stdout.flush()


def _format_next_actions(actions: list[str]) -> str:
    if not actions:
        return ""
    return "Allowed next actions:\n" + "\n".join(f"- {a}" for a in actions)


def _handle_pre_tool_use(event: dict[str, Any], sock: str) -> dict[str, Any]:
    tool_name = event.get("tool_name", "")
    tool_input = event.get("tool_input") or {}
    response = protocol.request(
        sock,
        "check_tool_call",
        {"tool_name": tool_name, "args": [], "kwargs": tool_input},
    )
    if "error" in response:
        # Fail open with a warning so the hook doesn't break Claude Code.
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": f"cc sidecar error: {response['error']}",
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


def _handle_post_tool_use(event: dict[str, Any], sock: str) -> dict[str, Any]:
    tool_name = event.get("tool_name", "")
    tool_response = event.get("tool_response")
    protocol.request(
        sock,
        "record_result",
        {"tool_name": tool_name, "result": tool_response},
    )
    return {}


def _handle_session_start(event: dict[str, Any], sock: str) -> dict[str, Any]:
    # Sidecar is already spawned by discovery.ensure_sidecar; ensure it has
    # a fresh kickoff so the first PreToolUse sees the right next-actions.
    response = protocol.request(sock, "kickoff", {})
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

    session_id = event.get("session_id", "default")
    cwd = event.get("cwd", ".")
    hook_name = event.get("hook_event_name", "")

    try:
        sock = str(discovery.ensure_sidecar(session_id, cwd))
    except Exception as e:
        # Fail open: don't block Claude Code if cc is misconfigured.
        _emit({
            "hookSpecificOutput": {
                "hookEventName": hook_name,
                "additionalContext": f"cc sidecar unavailable: {e}",
            }
        })
        return 0

    if hook_name == "PreToolUse":
        _emit(_handle_pre_tool_use(event, sock))
    elif hook_name == "PostToolUse":
        _emit(_handle_post_tool_use(event, sock))
    elif hook_name == "SessionStart":
        _emit(_handle_session_start(event, sock))
    else:
        _emit({})
    return 0
