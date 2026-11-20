#!/bin/sh
# Planner: hands out the approaches. Every worker needs its worktree (trees/workerN, on branch
# workerN) with an APPROACH.md in it.
cd "$(dirname "$0")/.." || exit 1
missing=""
for w in worker1 worker2 worker3; do
  if ! git -C "trees/$w" rev-parse --is-inside-work-tree >/dev/null 2>&1; then missing="$missing $w(no worktree: git worktree add trees/$w -b $w)"
  elif [ ! -s "trees/$w/APPROACH.md" ]; then missing="$missing $w(no trees/$w/APPROACH.md)"; fi
done
[ -z "$missing" ] || { echo "NOT ASSIGNED, missing:$missing"; exit 1; }
mkdir -p .board
for w in worker1 worker2 worker3; do
  echo "$w: $(head -1 "trees/$w/APPROACH.md")"
done
echo "ASSIGNED: each worker now works on its own approach."
