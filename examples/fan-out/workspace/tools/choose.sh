#!/bin/sh
# Planner: chooses a worker's submission, merges its branch into main and writes RESULT.md.
cd "$(dirname "$0")/.." || exit 1
w=$1
case "$w" in worker1|worker2|worker3) ;; *) echo "usage: ./tools/choose.sh worker1|worker2|worker3"; exit 1 ;; esac
[ -s ".board/$w" ] || { echo "$w hasn't submitted"; exit 1; }
git -c user.name=planner -c user.email=planner@complier.invalid merge -q --no-ff "$w" -m "Choose $w (RMSLE $(cat ".board/$w"))" || exit 1
{ echo "# Result"; echo; echo "Chosen: $w, RMSLE $(cat ".board/$w")."; echo; echo "| RMSLE | worker | approach |"; echo "| --- | --- | --- |"
  ./tools/status.sh | while IFS="	" read -r s n a; do echo "| $s | $n | $a |"; done; } > RESULT.md
git add RESULT.md && git -c user.name=planner -c user.email=planner@complier.invalid commit -qm "Result: $w" >/dev/null
echo "CHOSEN $w"
cat RESULT.md
