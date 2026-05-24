"""Entry points: python -m daemon serve|stop|list-sessions."""

from __future__ import annotations

import argparse
import json
import sys

from . import protocol, server
from .discovery import socket_path


def main() -> int:
    parser = argparse.ArgumentParser(prog="complier-daemon")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("serve", help="Run the daemon in the foreground.")
    sub.add_parser("stop", help="Tell a running daemon to shut down.")
    sub.add_parser("list-sessions", help="List sessions on the running daemon.")

    args = parser.parse_args()

    if args.cmd == "serve":
        server.run()
        return 0
    if args.cmd == "stop":
        sock = socket_path()
        if not sock.exists():
            return 0
        protocol.request(str(sock), "stop", {})
        return 0
    if args.cmd == "list-sessions":
        sock = socket_path()
        if not sock.exists():
            print("daemon not running", file=sys.stderr)
            return 1
        response = protocol.request(str(sock), "list", {})
        print(json.dumps(response, indent=2))
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
