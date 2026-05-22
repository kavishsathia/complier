"""Path resolution and sidecar auto-spawn."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def socket_path(session_id: str) -> Path:
    return Path(tempfile.gettempdir()) / f"cc-{session_id}.sock"


def contract_path(cwd: str) -> Path:
    env = os.environ.get("CC_CONTRACT")
    if env:
        return Path(env)
    dotted = Path(cwd) / ".claude" / "complier.cpl"
    if dotted.exists():
        return dotted
    return Path(cwd) / "complier.cpl"


def ensure_sidecar(session_id: str, cwd: str, timeout: float = 5.0) -> Path:
    """Return the socket path, spawning the sidecar in the background if needed."""
    sock = socket_path(session_id)
    if sock.exists():
        return sock

    log_path = Path(tempfile.gettempdir()) / f"cc-{session_id}.log"
    log = open(log_path, "ab")
    subprocess.Popen(
        [sys.executable, "-m", "cc", "serve", "--session-id", session_id, "--cwd", cwd],
        start_new_session=True,
        stdin=subprocess.DEVNULL,
        stdout=log,
        stderr=log,
    )

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if sock.exists():
            return sock
        time.sleep(0.02)
    raise TimeoutError(f"sidecar did not bind {sock} within {timeout}s; see {log_path}")
