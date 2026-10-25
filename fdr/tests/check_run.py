"""Checks a runs/<UTC>/ directory (from test.sh) against the expected outcomes.

Usage: python3 -I tests/check_run.py RUN_DIR [OUT.json]
Every expectation below was written before FDR first ran these files; this script only reads the
logs. "reset" is the historical construction, kept for comparison: the GuardReset assertions
expected to fail are the cases the current interleave construction fixes.
"""
import json
import re
import sys

run = sys.argv[1]
results = []


def check(name, ok, detail=""):
    results.append({"check": name, "ok": bool(ok), "detail": detail})


def jsonl(name):
    with open(f"{run}/{name}.jsonl") as f:
        return [json.loads(line) for line in f if line.strip()]


def attempts(records):
    return [r for r in records if r["type"] == "attempt" and r["decision"] != "error"]


def compiled(records):
    return next(r for r in records if r["type"] == "compiled")


def refines(name):
    """Assertion text -> 'Passed'/'Failed' from refines -f plain output."""
    text = open(f"{run}/{name}.refines.txt").read()
    out, header, open_header = {}, None, False
    for line in text.splitlines():
        if line and not line[0].isspace() and not line.startswith(("Welcome", "License")):
            header, open_header = line, not line.endswith(":")
        elif open_header and line.startswith("    ") and not line.startswith("        "):
            header += " " + line.strip()
            open_header = not line.endswith(":")
        elif header and line.strip().startswith("Result:"):
            out[header.rstrip(":")] = line.split(":", 1)[1].strip()
            header = None
    return {re.sub(r"\s+", " ", k): v for k, v in out.items()}


summary = dict(l.rsplit(" exit=", 1) for l in open(f"{run}/summary.txt").read().split("\n") if " exit=" in l)
check("step-logic self-test passes", summary.get("test_guard_step") == "0")
for c in ("reset", "interleave"):
    for fx in ("henz_req_exec", "agent_tools"):
        recs = jsonl(f"{c}.{fx}")
        check(f"{c}.{fx}: all admission checks pass", summary[f"{c}.{fx}"] == "0" and
              all(r["ok"] for r in recs if r["type"] == "admission"))
        edges = compiled(recs)["refuse_edges"]
        if c == "reset":
            check(f"reset.{fx}: FDR LTS refuse edges return to root", edges["self_loop"] == 1 and
                  edges["to_root"] >= 1 and edges["elsewhere"] == 0, json.dumps(edges))
        else:
            check(f"interleave.{fx}: every FDR LTS refuse edge is a self-loop", edges["to_root"] == 0 and
                  edges["elsewhere"] == 0 and edges["self_loop"] == compiled(recs)["nodes"], json.dumps(edges))
    for neg in ("negative_overlap", "negative_outside"):
        check(f"{c}.{neg}: admission refused (exit 5)", summary[f"{c}.{neg}"] == "5")

seq = lambda c, fx: [(a["attempt"], a["decision"]) for a in attempts(jsonl(f"{c}.{fx}"))]
check("reset.agent_tools: dirty push refused, retry allowed (historical comparison)",
      seq("reset", "agent_tools")[2:4] == [("git_push", "refuse"), ("git_push", "allow")])
check("interleave.agent_tools: dirty push refused twice, allowed only after run_tests",
      seq("interleave", "agent_tools")[2:6] == [("git_push", "refuse"), ("git_push", "refuse"),
                                                 ("run_tests", "allow"), ("git_push", "allow")])
ia = attempts(jsonl("interleave.agent_tools"))
check("interleave.agent_tools: both refusals keep the state, feedback lists Dirty's actions",
      all(ia[i]["state_preserved"] and ia[i]["node_id"] == ia[1]["node_id"] and
          ia[i]["permitted"] == ["read_file", "write_file", "run_tests"] for i in (2, 3)))
check("interleave.henz_req_exec: after exec every attempt is refused, nothing permitted",
      seq("interleave", "henz_req_exec")[3:] == [("req", "refuse"), ("exec", "refuse")] and
      all(a["permitted"] == [] for a in attempts(jsonl("interleave.henz_req_exec"))[3:]))
check("reset.henz_req_exec: after exec a refusal restarts Policy (historical comparison)",
      seq("reset", "henz_req_exec")[3:] == [("req", "refuse"), ("exec", "allow")])

expected = {
    "compare_agent_tools": {
        "System(ControllableCHAOS(A, R), GuardReset) :[deadlock free [F]]": "Passed",
        "System(ControllableCHAOS(A, R), GuardInterleave) :[deadlock free [F]]": "Passed",
        "GuardReset :[deterministic [F]]": "Passed",
        "GuardInterleave :[deterministic [F]]": "Passed",
        "Policy [T= GuardInterleave \\ R": "Passed",
        "GuardInterleave \\ R [T= Policy": "Passed",
        "Policy [T= GuardReset \\ R": "Failed",
        "NoPushWhileDirty [T= System(Stubborn, GuardReset) \\ R": "Failed",
        "NoPushWhileDirty [T= System(Stubborn, GuardInterleave) \\ R": "Passed",
        "NoPushWhileDirty [T= System(ControllableCHAOS(A, R), GuardReset) \\ R": "Failed",
        "NoPushWhileDirty [T= System(ControllableCHAOS(A, R), GuardInterleave) \\ R": "Passed",
        "ExpectEager [T= System(Eager, GuardInterleave)": "Passed",
        "System(Eager, GuardInterleave) :[deadlock free [F]]": "Passed",
        "ExpectEager [T= Eager [|union(A, R)|] GuardInterleave": "Failed",
    },
    "compare_henz_req_exec": {
        "System(ControllableCHAOS(A, R), GuardReset) :[deadlock free [F]]": "Passed",
        "System(ControllableCHAOS(A, R), GuardInterleave) :[deadlock free [F]]": "Passed",
        "Policy [T= System(ControllableCHAOS(A, R), GuardInterleave) \\ R": "Passed",
        "Policy [T= System(ControllableCHAOS(A, R), GuardReset) \\ R": "Failed",
    },
}
for name, exp in expected.items():
    got = refines(name)
    check(f"{name}: FDR CLI ran exactly the expected {len(exp)} assertions", sorted(got) == sorted(exp),
          json.dumps(sorted(set(got) ^ set(exp))))
    for assertion, verdict in exp.items():
        check(f"{name}: {assertion} -> {verdict}", got.get(assertion) == verdict, got.get(assertion, "missing"))

failed = [r for r in results if not r["ok"]]
for r in results:
    print(("PASS " if r["ok"] else "FAIL ") + r["check"] + (f"  [{r['detail']}]" if not r["ok"] else ""))
print(f"{len(results) - len(failed)}/{len(results)} checks pass")
if len(sys.argv) > 2:
    json.dump({"run": run, "passed": len(results) - len(failed), "total": len(results), "checks": results},
              open(sys.argv[2], "w"), indent=1)
sys.exit(1 if failed else 0)
