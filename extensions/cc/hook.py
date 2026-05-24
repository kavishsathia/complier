"""Claude Code hook handler.

Reads a Claude Code hook event JSON from stdin, dispatches based on
`hook_event_name`, talks to the complier daemon over its lean four-method
protocol, writes the hook's structured response on stdout.
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


def _format_hint_block(hint: str) -> str:
    if not hint:
        return ""
    lines = [line for line in hint.splitlines() if line.strip()]
    if not lines:
        return ""
    return "Allowed next actions:\n" + "\n".join(f"- {line}" for line in lines)


def _session_id(event: dict[str, Any]) -> str:
    return f"cc:{event.get('session_id', 'default')}"


def _attach(client: DaemonClient, event: dict[str, Any]) -> dict[str, Any]:
    cwd = event.get("cwd", ".")
    return client.attach(contract_path=str(contract_path(cwd)))


def _handle_pre_tool_use(event: dict[str, Any], client: DaemonClient) -> dict[str, Any]:
    tool_name = event.get("tool_name", "")
    tool_input = event.get("tool_input") or {}
    response = client.check(tool_name, tool_input)
    if "error" in response:
        return {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "additionalContext": f"cc daemon error: {response['error']}",
            }
        }

    result = response.get("result") or {}
    allowed = result.get("allowed", False)
    reason = result.get("reason") or ""
    missing = result.get("missing") or []
    hint_block = _format_hint_block(result.get("hint") or "")

    if allowed:
        out: dict[str, Any] = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "allow",
            }
        }
        if hint_block:
            out["hookSpecificOutput"]["additionalContext"] = hint_block
        return out

    parts = [reason] if reason else []
    if missing:
        parts.append("Missing: " + "; ".join(missing))
    if hint_block:
        parts.append(hint_block)
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
    tool_input = event.get("tool_input") or {}
    tool_response = event.get("tool_response")
    response = client.record(tool_name, tool_input, tool_response)
    hint = (response.get("result") or {}).get("hint", "")
    hint_block = _format_hint_block(hint)
    if hint_block:
        return {
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": hint_block,
            }
        }
    return {}


def _handle_session_start(event: dict[str, Any], client: DaemonClient) -> dict[str, Any]:
    response = _attach(client, event)
    hint = (response.get("result") or {}).get("hint", "")
    hint_block = _format_hint_block(hint)
    if hint_block:
        return {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": f"complier contract active.\n\n{hint_block}",
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
        client = DaemonClient(session=_session_id(event))
        # PreToolUse and PostToolUse rely on the session already being attached;
        # SessionStart does it explicitly to surface the kickoff hint.
        if hook_name != "SessionStart":
            _attach(client, event)
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
