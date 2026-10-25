#!/usr/bin/env bash
# Runs a policy through the FDR-backed guard and prints what FDR admitted, compiled and decided.
#
#   fdr/demo.sh                                   # csp/agent_tools.csp, attempts/agent_tools.txt
#   fdr/demo.sh SCRIPT.csp ATTEMPTS.txt [--construction reset]
#
# Paths are relative to fdr/. The driver's raw JSON lines and the exported LTS are left in build/.
set -uo pipefail
cd "$(dirname "$0")"
[ -x build/guard_driver ] || ./build.sh || exit 1

script=${1:-csp/agent_tools.csp}
attempts=${2:-attempts/agent_tools.txt}
shift $(($# < 2 ? $# : 2))
rm -f build/demo.automaton.json
build/guard_driver "$script" --attempts "$attempts" --export build/demo.automaton.json "$@" >build/demo.jsonl
code=$?
python3 -I show.py $([ -f build/demo.automaton.json ] && echo build/demo.automaton.json) <build/demo.jsonl
case $code in
  0) ;;
  3) echo "FDR has no valid licence on this machine: run refines once to get one (fdr/README.md)." ;;
  5) echo "Admission refused (exit 5): the policy was not loaded." ;;
  *) echo "guard_driver exited with $code" ;;
esac
exit $code
