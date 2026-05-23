"""Entry point: `python -m cc hook`.

cc is now a thin Claude Code adapter — the daemon owns sidecar
lifecycle and per-session sockets. The only command extensions
need is the hook handler.
"""

from __future__ import annotations

import argparse
import sys

from . import hook


def main() -> int:
    parser = argparse.ArgumentParser(prog="cc")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("hook", help="Handle a Claude Code hook event from stdin.")
    args = parser.parse_args()

    if args.cmd == "hook":
        return hook.main()
    return 1


if __name__ == "__main__":
    sys.exit(main())
