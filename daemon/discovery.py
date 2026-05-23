"""Socket path resolution and lazy daemon spawn."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path


def socket_path() -> Path:
    """Return the daemon socket path.

    Honors COMPLIER_SOCK if set, otherwise ~/.complier/daemon.sock.
    """
    env = os.environ.get("COMPLIER_SOCK")
    if env:
        return Path(env)
    root = Path.home() / ".complier"
    return root / "daemon.sock"


def ensure_daemon(timeout: float = 5.0) -> Path:
    """Return the daemon socket path, spawning the daemon if it isn't already running."""
    sock = socket_path()
    if sock.exists():
        return sock

    sock.parent.mkdir(parents=True, exist_ok=True)
    log_path = Path(tempfile.gettempdir()) / "complier-daemon.log"
    log = open(log_path, "ab")
    subprocess.Popen(
        [sys.executable, "-m", "daemon", "serve"],
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
    raise TimeoutError(f"daemon did not bind {sock} within {timeout}s; see {log_path}")
