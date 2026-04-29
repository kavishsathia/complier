"""Graph serialization for compiled contracts."""

from __future__ import annotations

from dataclasses import fields, is_dataclass
from typing import Any

from complier.contract.model import Contract
from complier.contract.runtime import CompiledWorkflow, RuntimeNode


def contract_to_graph(contract: Contract) -> dict[str, Any]:
    """Serialize a compiled contract into frontend-friendly graph data."""
    return {
        "name": contract.name,
        "workflows": {
            name: workflow_to_graph(workflow)
            for name, workflow in contract.workflows.items()
        },
    }


def workflow_to_graph(workflow: CompiledWorkflow) -> dict[str, Any]:
    """Serialize one compiled workflow into nodes and edges."""
    nodes = []
    edges = []

    for node in workflow.nodes.values():
        nodes.append(_serialize_node(node))
        for target_id in node.next_ids:
            edges.append(
                {
                    "id": f"{node.id}__{target_id}",
                    "source": node.id,
                    "target": target_id,
                    "kind": "next",
                }
            )

        branch_targets = getattr(node, "arms", {})
        for label, target_id in branch_targets.items():
            edges.append(
                {
                    "id": f"{node.id}__branch__{label}__{target_id}",
                    "source": node.id,
                    "target": target_id,
                    "kind": "branch",
                    "label": label,
                }
            )

        else_target = getattr(node, "else_node_id", None)
        if else_target is not None:
            edges.append(
                {
                    "id": f"{node.id}__else__{else_target}",
                    "source": node.id,
                    "target": else_target,
                    "kind": "else",
                    "label": "else",
                }
            )

        unordered_targets = getattr(node, "case_entry_ids", {})
        for label, target_id in unordered_targets.items():
            edges.append(
                {
                    "id": f"{node.id}__case__{label}__{target_id}",
                    "source": node.id,
                    "target": target_id,
                    "kind": "unordered",
                    "label": label,
                }
            )

    return {
        "name": workflow.name,
        "startNodeId": workflow.start_node_id,
        "endNodeId": workflow.end_node_id,
        "nodes": nodes,
        "edges": edges,
    }


def _serialize_node(node: RuntimeNode) -> dict[str, Any]:
    if not is_dataclass(node):
        raise TypeError(f"Expected dataclass runtime node, got {type(node)!r}")

    payload = {
        field.name: _to_json_value(getattr(node, field.name))
        for field in fields(node)
        if field.name != "next_ids"
    }
    return {
        "id": node.id,
        "kind": type(node).__name__,
        "data": payload,
    }


def _to_json_value(value: Any) -> Any:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, list):
        return [_to_json_value(item) for item in value]

    if isinstance(value, dict):
        return {
            str(key): _to_json_value(item)
            for key, item in value.items()
        }

    if is_dataclass(value):
        return {
            "kind": type(value).__name__,
            "data": {
                field.name: _to_json_value(getattr(value, field.name))
                for field in fields(value)
            },
        }

    return repr(value)
