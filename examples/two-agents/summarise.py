#!/usr/bin/env python3
"""Prints a machine's event log (JSON lines, as `complier machine log` writes it) as a readable timeline."""
import json
import sys

rows = []
for line in open(sys.argv[1]):
    line = line.strip()
    if not line.startswith("{"):
        continue
    rows.append(json.loads(line))
t0 = next((r["t"] for r in rows if "t" in r), 0)
counts = {}
for r in rows:
    t = f"{(r.get('t', t0) - t0) / 1000:6.1f}s"
    kind = r.get("kind")
    if kind == "act":
        counts[(r["role"], r["outcome"])] = counts.get((r["role"], r["outcome"]), 0) + 1
        if r["event"] == "other" and r["outcome"] == "allowed":
            continue  # status checks, waits and draft writing: counted, not listed
        why = f"  ({r['reason']})" if r.get("reason") else ""
        print(f"{t}  {r['role']:<8} {r['event']:<8} {r['outcome'].upper():<8} state {r['state']}{why}")
    elif kind == "result":
        if not r["event"].startswith("result.other."):
            print(f"{t}  {'':<8} {r['event']:<24} -> state {r['state']}")
    elif kind == "status":
        print(f"{t}  machine {r['status']}: {r.get('reason', '')}")
print()
for (role, outcome), n in sorted(counts.items()):
    print(f"{role:<8} {outcome:<8} {n}")
