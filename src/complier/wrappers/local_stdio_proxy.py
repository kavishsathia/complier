"""Local stdio MCP proxy with tool-name namespacing."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from typing import Any, TextIO

from .local_mcp import normalize_tool_name


@dataclass(slots=True)
class ProxyState:
    """Shared request and tool mapping state for the stdio proxy."""

    namespace: str
    request_methods: dict[str, str] = field(default_factory=dict)
    exposed_to_downstream: dict[str, str] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock)


def main(argv: list[str] | None = None) -> int:
    """Run the local stdio MCP proxy."""
    args = _parse_args(argv)
    process = subprocess.Popen(
        args.downstream_command,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
    )

    assert process.stdin is not None
    assert process.stdout is not None
    assert process.stderr is not None

    state = ProxyState(namespace=args.namespace)
    threads = [
        threading.Thread(
            target=_forward_client_to_server,
            args=(sys.stdin, process.stdin, state),
            daemon=True,
        ),
        threading.Thread(
            target=_forward_server_to_client,
            args=(process.stdout, sys.stdout, state),
            daemon=True,
        ),
        threading.Thread(
            target=_forward_stderr,
            args=(process.stderr, sys.stderr),
            daemon=True,
        ),
    ]
    for thread in threads:
        thread.start()

    exit_code = process.wait()
    for thread in threads[:2]:
        thread.join(timeout=0.2)
    return exit_code


def _parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a local namespaced stdio MCP proxy.")
    parser.add_argument("--namespace", required=True)
    parser.add_argument(
        "downstream_command",
        nargs=argparse.REMAINDER,
        help="Command used to start the downstream stdio MCP server.",
    )
    args = parser.parse_args(argv)
    if args.downstream_command and args.downstream_command[0] == "--":
        args.downstream_command = args.downstream_command[1:]
    if not args.downstream_command:
        parser.error("a downstream MCP command is required")
    return args


def _forward_client_to_server(source: TextIO, dest: TextIO, state: ProxyState) -> None:
    for line in source:
        payload = _try_load_json(line)
        if payload is not None:
            payload = _rewrite_client_message(payload, state)
            line = json.dumps(payload, separators=(",", ":")) + "\n"
        dest.write(line)
        dest.flush()
    dest.close()


def _forward_server_to_client(source: TextIO, dest: TextIO, state: ProxyState) -> None:
    for line in source:
        payload = _try_load_json(line)
        if payload is not None:
            payload = _rewrite_server_message(payload, state)
            line = json.dumps(payload, separators=(",", ":")) + "\n"
        dest.write(line)
        dest.flush()


def _forward_stderr(source: TextIO, dest: TextIO) -> None:
    for line in source:
        dest.write(line)
        dest.flush()


def _rewrite_client_message(payload: dict[str, Any], state: ProxyState) -> dict[str, Any]:
    request_id = payload.get("id")
    method = payload.get("method")
    if request_id is not None and isinstance(method, str):
        with state.lock:
            state.request_methods[str(request_id)] = method

    if method != "tools/call":
        return payload

    params = payload.get("params")
    if not isinstance(params, dict):
        return payload

    tool_name = params.get("name")
    if not isinstance(tool_name, str):
        return payload

    with state.lock:
        original_name = state.exposed_to_downstream.get(tool_name)
    if original_name is None and tool_name.startswith(f"{state.namespace}."):
        original_name = tool_name.split(".", 1)[1]
    if original_name is not None:
        params["name"] = original_name
    return payload


def _rewrite_server_message(payload: dict[str, Any], state: ProxyState) -> dict[str, Any]:
    response_id = payload.get("id")
    if response_id is None:
        return payload

    with state.lock:
        method = state.request_methods.pop(str(response_id), None)

    if method != "tools/list":
        return payload

    result = payload.get("result")
    if not isinstance(result, dict):
        return payload

    tools = result.get("tools")
    if not isinstance(tools, list):
        return payload

    rewritten_tools: list[dict[str, Any]] = []
    name_map: dict[str, str] = {}
    for tool in tools:
        if not isinstance(tool, dict):
            rewritten_tools.append(tool)
            continue
        original_name = tool.get("name")
        if not isinstance(original_name, str):
            rewritten_tools.append(tool)
            continue

        exposed_name = normalize_tool_name(state.namespace, original_name)
        name_map[exposed_name] = original_name
        rewritten_tool = dict(tool)
        rewritten_tool["name"] = exposed_name
        if "title" not in rewritten_tool:
            rewritten_tool["title"] = original_name
        rewritten_tools.append(rewritten_tool)

    with state.lock:
        state.exposed_to_downstream.update(name_map)

    result["tools"] = rewritten_tools
    return payload


def _try_load_json(line: str) -> dict[str, Any] | None:
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None
    if isinstance(payload, dict):
        return payload
    return None


if __name__ == "__main__":
    raise SystemExit(main())
