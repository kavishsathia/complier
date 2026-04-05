"""JS-to-Python bridge API exposed to the pywebview frontend."""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from complier import Contract

from .store import WorkflowStore


class StudioAPI:
    """Public methods on this class are callable from JS via window.pywebview.api."""

    def __init__(self, store: WorkflowStore) -> None:
        self._store = store

    # ------------------------------------------------------------------
    # Health
    # ------------------------------------------------------------------

    def ping(self) -> str:
        return "pong"

    # ------------------------------------------------------------------
    # CPL validation
    # ------------------------------------------------------------------

    def validate_cpl(self, cpl_source: str) -> dict:
        """Parse CPL source and return whether it is valid."""
        try:
            Contract.from_source(cpl_source)
            return {"valid": True}
        except Exception as exc:
            return {"valid": False, "error": str(exc)}

    # ------------------------------------------------------------------
    # Ollama
    # ------------------------------------------------------------------

    def list_ollama_models(self, ollama_url: str) -> list[str]:
        """Query a running Ollama instance for available model names."""
        try:
            resp = httpx.get(f"{ollama_url}/api/tags", timeout=5)
            resp.raise_for_status()
            models = resp.json().get("models", [])
            return [m["name"] for m in models]
        except Exception:
            return []

    # ------------------------------------------------------------------
    # Workflow persistence
    # ------------------------------------------------------------------

    def list_workflows(self) -> list[dict]:
        return self._store.list()

    def save_workflow(self, name: str, graph_json: str) -> dict:
        self._store.save(name, json.loads(graph_json))
        return {"ok": True}

    def load_workflow(self, name: str) -> dict | None:
        return self._store.load(name)

    def delete_workflow(self, name: str) -> dict:
        self._store.delete(name)
        return {"ok": True}
