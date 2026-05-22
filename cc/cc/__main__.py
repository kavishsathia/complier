"""Entry points: `python -m cc serve|hook|stop`."""

from __future__ import annotations

import argparse
import sys

from . import client, discovery, protocol, sidecar


def main() -> int:
    p = argparse.ArgumentParser(prog="cc")
    sub = p.add_subparsers(dest="cmd", required=True)

    serve = sub.add_parser("serve", help="Run the sidecar in the foreground.")
    serve.add_argument("--session-id", required=True)
    serve.add_argument("--cwd", required=True)
    serve.add_argument("--workflow", default=None)

    sub.add_parser("hook", help="Handle a Claude Code hook event from stdin.")

    stop = sub.add_parser("stop", help="Tell a running sidecar to shut down.")
    stop.add_argument("--session-id", required=True)

    args = p.parse_args()

    if args.cmd == "serve":
        sidecar.run(args.session_id, args.cwd, args.workflow)
        return 0
    if args.cmd == "hook":
        return client.main()
    if args.cmd == "stop":
        sock = discovery.socket_path(args.session_id)
        if not sock.exists():
            return 0
        protocol.request(str(sock), "stop", {})
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
