"""Workflow persistence — saves React Flow graph state as JSON files."""

from __future__ import annotations

import json
from pathlib import Path


DEFAULT_DIR = Path.home() / ".complier-studio" / "workflows"


class WorkflowStore:
    def __init__(self, directory: Path = DEFAULT_DIR) -> None:
        self._dir = directory
        self._dir.mkdir(parents=True, exist_ok=True)

    def _path(self, name: str) -> Path:
        safe = "".join(c if c.isalnum() or c in "-_ " else "_" for c in name)
        return self._dir / f"{safe}.json"

    def list(self) -> list[dict]:
        results = []
        for f in sorted(self._dir.glob("*.json")):
            try:
                data = json.loads(f.read_text())
                results.append({"name": data.get("name", f.stem), "file": f.name})
            except Exception:
                continue
        return results

    def save(self, name: str, graph: dict) -> None:
        graph["name"] = name
        self._path(name).write_text(json.dumps(graph, indent=2))

    def load(self, name: str) -> dict | None:
        path = self._path(name)
        if not path.exists():
            return None
        return json.loads(path.read_text())

    def delete(self, name: str) -> None:
        path = self._path(name)
        if path.exists():
            path.unlink()
