"""Next-actions formatter for the daemon path.

Differs from the core's default_next_actions_formatter in one place:
when a branch or unordered block is reachable, the formatter tells the
agent to run `complier choose <arm>` before its real tool call. The
core formatter emits `(pass choice="X")` instead, which only makes
sense for callers that pass choice as a Python kwarg (FunctionWrapper,
MCP proxies). Agents talking to the daemon over hooks have no such
kwarg channel — they have a CLI binary.
"""

from __future__ import annotations

from complier.contract.ast import (
    CelExpression,
    HintPrompt,
    HumanPrompt,
    ModelPrompt,
)
from complier.session.decisions import (
    NextActionDescriptor,
    NextActions,
    render_constraint_value,
)


def cli_choose_formatter(next_actions: NextActions) -> list[str]:
    """Render reachable actions, prepending a `complier choose` instruction
    when a branch or unordered block is in play."""
    has_choice = next_actions.is_branch_possible or next_actions.is_unordered_possible

    if not has_choice:
        return [_render(desc) for desc in next_actions.actions]

    construct = "branch" if next_actions.is_branch_possible else "unordered block"
    lines = [
        f"{construct} ahead — run `complier choose <arm>` first, then call one of:",
    ]
    for desc in next_actions.actions:
        body = _render(desc)
        if desc.choice_label:
            lines.append(f'  - arm "{desc.choice_label}": {body}')
        else:
            lines.append(f"  - {body}")
    return lines


def _render(desc: NextActionDescriptor) -> str:
    parts: list[str] = []

    param_strs = []
    for name, value in desc.params.items():
        if isinstance(value, (HintPrompt, ModelPrompt, HumanPrompt, CelExpression)):
            param_strs.append(f"{name}: {render_constraint_value(value)}")
        else:
            param_strs.append(f"{name}={value!r}")
    if param_strs:
        parts.append(f"({', '.join(param_strs)})")

    guard_strs = [render_constraint_value(g) for g in desc.guards]
    if guard_strs:
        parts.append(f"— requires: {'; '.join(guard_strs)}")

    return f"{desc.tool_name} {'  '.join(parts)}".strip()
