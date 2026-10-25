#!/usr/bin/env bash
# Builds, runs the step-logic self-test, runs every fixture through the FDR-backed driver (the
# current interleave construction, then the historical reset one for comparison), runs FDR's own
# `refines` on the assertion files, and checks all of it with tests/check_run.py.
#
#   fdr/test.sh       # logs in fdr/runs/<UTC time>/; ends with "N/N checks pass"
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE"
. ./env.sh
out=runs/$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$out"
./build.sh >"$out/build.log" 2>&1 || { cat "$out/build.log"; exit 1; }
build/test_guard_step >"$out/test_guard_step.log" 2>&1
echo "test_guard_step exit=$?" | tee -a "$out/summary.txt"

run() {
  local name=$1
  shift
  timeout 300 build/guard_driver "$@" >"$out/$name.jsonl" 2>"$out/$name.stderr" </dev/null
  echo "$name exit=$?" | tee -a "$out/summary.txt"
}
for c in interleave reset; do
  att=attempts
  [ "$c" = reset ] && att=attempts/reset
  run "$c.agent_tools" csp/agent_tools.csp --construction "$c" \
    --attempts "$att/agent_tools.txt" --export "$out/$c.agent_tools.automaton.json"
  run "$c.henz_req_exec" csp/henz_req_exec.csp --construction "$c" \
    --attempts "$att/henz_req_exec.txt" --export "$out/$c.henz_req_exec.automaton.json"
  run "$c.negative_overlap" csp/negative_overlap.csp --construction "$c" --attempts "$att/henz_req_exec.txt"
  run "$c.negative_outside" csp/negative_outside.csp --construction "$c" --attempts "$att/henz_req_exec.txt"
done

cli() {
  LD_LIBRARY_PATH="$FDR_LIBS" timeout 300 "$FDR_HOME/bin/refines" -f plain -q "csp/$1.csp" \
    >"$out/$1.refines.txt" 2>&1 </dev/null
  echo "$1.refines exit=$?" | tee -a "$out/summary.txt"
}
cli compare_agent_tools
cli compare_henz_req_exec

python3 -I tests/check_run.py "$out" "$out/checks.json" >"$out/checks.txt" 2>&1
code=$?
echo "check_run exit=$code" | tee -a "$out/summary.txt"
tail -1 "$out/checks.txt"
echo "logs: fdr/$out"
exit $code
