"""Core agent loop for Complier-enforced local model execution."""

from __future__ import annotations

import json
import re
import time
from typing import Any, Callable

ToolImpl = Callable[..., Any]


def _strip_thinking(text: str) -> str:
    """Remove Gemma 4 thinking tokens from model output."""
    return re.sub(r"<\|?channel\|?>.*?<\|?/channel\|?>", "", text, flags=re.DOTALL).strip()


def _parse_action(text: str) -> dict | None:
    """Extract the first JSON object from model output."""
    text = _strip_thinking(text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def _build_action_prompt(available: str) -> str:
    return (
        f"Available actions:\n{available}\n\n"
        "Output raw JSON only. No markdown, no explanation.\n"
        'Format: {"action": "<name>", "args": {<key: value>}}'
    )


def run(
    session,
    tools: dict[str, ToolImpl],
    model,
    tokenizer,
    task: str,
    max_turns: int = 10,
    max_tokens: int = 1024,
    verbose: bool = True,
) -> list[dict]:
    """
    Run the agent loop until the workflow completes or max_turns is reached.

    Returns the conversation history as a list of {role, content} dicts.
    """
    kickoff = session.kickoff()
    if not kickoff.strip():
        raise RuntimeError("kickoff() returned no available actions — check your contract.")

    history: list[dict[str, str]] = [
        {
            "role": "user",
            "content": (
                f"You are an agent. Complete the following task step by step.\n\n"
                f"Task: {task}\n\n"
                f"{_build_action_prompt(kickoff)}"
            ),
        }
    ]

    for turn in range(max_turns):
        if verbose:
            print(f"\n[turn {turn + 1}]")

        formatted = tokenizer.apply_chat_template(
            history,
            add_generation_prompt=True,
            tokenize=False,
            enable_thinking=True,
        )

        t0 = time.time()
        raw = model.generate(formatted, max_tokens=max_tokens)
        elapsed = time.time() - t0

        if verbose:
            clean = _strip_thinking(raw)
            print(f"  model ({elapsed:.1f}s): {clean}")

        history.append({"role": "assistant", "content": raw})

        action = _parse_action(raw)
        if action is None:
            history.append({
                "role": "user",
                "content": (
                    "Could not parse your response as JSON. "
                    "Output raw JSON only.\n\n"
                    f"{_build_action_prompt(kickoff)}"
                ),
            })
            continue

        tool_name: str = action.get("action", "")
        args: dict = action.get("args", {})

        decision = session.check_tool_call(tool_name, (), args)

        if not decision.allowed:
            next_hint = ""
            if decision.remediation and decision.remediation.allowed_next_actions:
                next_hint = "\n\n" + _build_action_prompt(
                    "\n".join(decision.remediation.allowed_next_actions)
                )
            history.append({
                "role": "user",
                "content": (
                    f"Action '{tool_name}' was not allowed: {decision.reason}.{next_hint}"
                ),
            })
            if verbose:
                print(f"  blocked: {decision.reason}")
            continue

        impl = tools.get(tool_name)
        if impl is None:
            result = f"(no implementation registered for '{tool_name}')"
        else:
            try:
                result = impl(**args)
            except Exception as exc:
                result = f"Tool raised an error: {exc}"

        if verbose:
            print(f"  executed {tool_name}({args}) → {result}")

        next_actions = (
            decision.remediation.allowed_next_actions
            if decision.remediation
            else []
        )

        if not next_actions:
            history.append({"role": "user", "content": f"Result: {result}\n\nWorkflow complete."})
            if verbose:
                print("  workflow complete.")
            break

        history.append({
            "role": "user",
            "content": (
                f"Result: {result}\n\n"
                f"{_build_action_prompt(chr(10).join(next_actions))}"
            ),
        })

    return history
