#!/bin/sh
# Worker: scores trees/$COMPLIER_ROLE/predictions.csv on the test set and commits the worktree.
cd "$(dirname "$0")/.." || exit 1
w=${COMPLIER_ROLE:?submit.sh runs as a worker, with COMPLIER_ROLE set}
case "$w" in worker1|worker2|worker3) ;; *) echo "only a worker submits ($w isn't one)"; exit 1 ;; esac
tree="trees/$w"
[ -s "$tree/predictions.csv" ] || { echo "INVALID: no $tree/predictions.csv"; exit 1; }
score=$(python3 tools/score.py "$tree/predictions.csv") || { echo "INVALID: $score"; exit 1; }
mkdir -p .board
echo "$score" > ".board/$w"
git -C "$tree" add -A >/dev/null && git -C "$tree" -c user.name="$w" -c user.email="$w@complier.invalid" commit -qm "$w: RMSLE $score" >/dev/null 2>&1
echo "SUBMITTED $w: RMSLE $score"
