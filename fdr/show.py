"""Prints guard_driver's JSON lines (stdin) as a short readable report.

Usage: build/guard_driver ... | python3 -I show.py [AUTOMATON.json]
Every line shown comes from the driver's output, which comes from FDR; nothing is computed here
beyond formatting. With AUTOMATON.json (the driver's --export), also lists the compiled LTS.
"""
import json
import re
import sys


def one_line(text):
    return re.sub(r"\s+", " ", text).strip()


def events(names):
    return ", ".join(names) if names else "(nothing)"


for raw in sys.stdin:
    if not raw.strip():
        continue
    r = json.loads(raw)
    kind = r["type"]
    if kind == "fdr":
        print(r["version"].split(" copyright")[0])
    elif kind == "loaded":
        print(f"loaded {r['script']}")
        print("\nAdmission (checked by FDR before anything runs)")
    elif kind == "admission":
        mark = "ok  " if r["ok"] else "FAIL"
        print(f"  {mark} {one_line(r['check'])}: {r['detail']}")
    elif kind == "compiled":
        e = r["refuse_edges"]
        print(f"\nCompiled {r['process']}: {r['nodes']} states, {r['transitions']} transitions")
        print(f"  refuse edges: {e['self_loop']} back to the same state, {e['to_root']} to the start, "
              f"{e['elsewhere']} elsewhere")
        print(f"  at the start the agent may: {events(r['root_permitted'])}")
        print("\nAttempts (the agent's tool calls, as events)")
    elif kind == "attempt":
        step, attempt = r["step"], r["attempt"]
        if r["decision"] == "error":
            print(f"  {step:>2}  {attempt:<11} error: {r['reason']}")
            continue
        if r["decision"] == "allow":
            what = "allowed"
        else:
            what = "REFUSED, " + ("state kept" if r["state_preserved"] else "state changed")
        state = f"state {r['node_id']}" + (" (start)" if r["at_root"] else "")
        print(f"  {step:>2}  {attempt:<11} {what:<22} now at {state:<15} next allowed: {events(r['permitted'])}")
    elif kind == "permitted":
        print(f"  {r['step']:>2}  {'?':<11} {'(asks what is allowed)':<22} {'':<22} next allowed: {events(r['permitted'])}")
    elif kind == "error":
        print(f"\nerror at {r['stage']}: {one_line(r['message'])}")

if len(sys.argv) > 1:
    with open(sys.argv[1]) as f:
        a = json.load(f)
    print(f"\nCompiled LTS ({a['construction']}), as exported by the driver")
    for t in a["transitions"]:
        mark = "  (refusal)" if t["event"] in a["refusals"] else ""
        print(f"  {t['from']} --{t['event']}--> {t['to']}{mark}")
