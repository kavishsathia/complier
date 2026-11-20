#!/bin/sh
# Anyone: the scores so far, best first, and each worker's approach.
cd "$(dirname "$0")/.." || exit 1
for w in worker1 worker2 worker3; do
  score=$(cat ".board/$w" 2>/dev/null || echo "not submitted")
  approach=$(head -1 "trees/$w/APPROACH.md" 2>/dev/null || echo "no approach yet")
  echo "$score	$w	$approach"
done | sort -n
