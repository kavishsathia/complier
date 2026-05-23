"""Resolve which .cpl contract to attach for a given cwd."""

from __future__ import annotations

import os
from pathlib import Path


def contract_path(cwd: str) -> Path:
    """Return the contract path for `cwd`.

    Lookup order:
      1. $CC_CONTRACT
      2. <cwd>/.claude/complier.cpl
      3. <cwd>/complier.cpl
    """
    env = os.environ.get("CC_CONTRACT")
    if env:
        return Path(env)
    dotted = Path(cwd) / ".claude" / "complier.cpl"
    if dotted.exists():
        return dotted
    return Path(cwd) / "complier.cpl"
