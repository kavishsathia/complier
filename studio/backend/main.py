"""Complier Studio — pywebview entry point."""

from __future__ import annotations

import sys
from pathlib import Path

import webview

from .api import StudioAPI
from .store import WorkflowStore

FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"


def main() -> None:
    dev = "--dev" in sys.argv
    store = WorkflowStore()
    api = StudioAPI(store)

    url: str
    if dev:
        url = "http://localhost:5173"
    else:
        index = FRONTEND_DIST / "index.html"
        if not index.exists():
            print("Frontend not built. Run: cd studio/frontend && npm run build")
            sys.exit(1)
        url = str(index)

    webview.create_window(
        "Complier Studio",
        url,
        js_api=api,
        width=1440,
        height=900,
        min_size=(1024, 680),
    )
    webview.start(debug=dev)


if __name__ == "__main__":
    main()
