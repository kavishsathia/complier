"""Decision objects returned during runtime enforcement."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

from complier.contract.ast import ParamValue, ProseGuard


@dataclass(slots=True)
class NextActionDescriptor:
    """Describes a single reachable tool call."""

    tool_name: str
    params: dict[str, ParamValue] = field(default_factory=dict)
    guards: list[ProseGuard] = field(default_factory=list)
    choice_label: str | None = None


@dataclass(slots=True)
class NextActions:
    """All reachable next actions from the current workflow position."""

    actions: list[NextActionDescriptor] = field(default_factory=list)
    is_branch_possible: bool = False
    is_unordered_possible: bool = False


import re as _re
_ANNOTATION_RE = _re.compile(r"#?\{[^}]+\}|\[[^\]]+\]")


def _strip_annotations(prose: str) -> str:
    return _ANNOTATION_RE.sub(lambda m: m.group(0).lstrip("#{}[]").strip("{}[]"), prose)


def default_next_actions_formatter(next_actions: NextActions) -> list[str]:
    results = []
    for desc in next_actions.actions:
        parts = []

        param_strs = []
        for name, value in desc.params.items():
            if isinstance(value, ProseGuard):
                param_strs.append(f"{name}: {_strip_annotations(value.prose)}")
            else:
                param_strs.append(f"{name}={value!r}")
        if param_strs:
            parts.append(f"({', '.join(param_strs)})")

        guard_strs = [_strip_annotations(g.prose) for g in desc.guards if g.prose]
        if guard_strs:
            parts.append(f"— requires: {'; '.join(guard_strs)}")

        if desc.choice_label:
            parts.append(f'(pass choice="{desc.choice_label}")')

        results.append(f"{desc.tool_name} {'  '.join(parts)}".strip())
    return results


NextActionsFormatter = Callable[[NextActions], list[str]]


@dataclass(slots=True)
class Remediation:
    """Guidance returned when a call is blocked or needs correction."""

    message: str
    allowed_next_actions: list[str] = field(default_factory=list)
    missing_requirements: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "message": self.message,
            "allowed_next_actions": list(self.allowed_next_actions),
            "missing_requirements": list(self.missing_requirements),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Remediation":
        return cls(
            message=str(data["message"]),
            allowed_next_actions=[str(item) for item in data.get("allowed_next_actions", [])],
            missing_requirements=[str(item) for item in data.get("missing_requirements", [])],
        )


@dataclass(slots=True)
class Decision:
    """Result of evaluating whether a runtime action complies."""

    allowed: bool
    reason: str | None = None
    remediation: Remediation | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "allowed": self.allowed,
            "reason": self.reason,
            "remediation": None if self.remediation is None else self.remediation.to_dict(),
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Decision":
        remediation = data.get("remediation")
        return cls(
            allowed=bool(data["allowed"]),
            reason=data.get("reason"),
            remediation=None if remediation is None else Remediation.from_dict(remediation),
        )


@dataclass(slots=True)
class BlockedToolResponse:
    """Structured response returned to an agent when a tool call is blocked."""

    tool_name: str
    allowed: bool = False
    reason: str | None = None
    remediation: Remediation | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "tool_name": self.tool_name,
            "allowed": self.allowed,
            "reason": self.reason,
            "remediation": None if self.remediation is None else self.remediation.to_dict(),
        }
