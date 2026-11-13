#!/bin/sh
# Reviewer: ./tools/review.sh approve   or   ./tools/review.sh reject "what to fix"
cd "$(dirname "$0")/.." || exit 1
[ -s .board/submitted.md ] || { echo "nothing has been submitted"; exit 1; }
n=$(cat .board/revision)
case "$1" in
  approve) printf 'APPROVED revision %s\n' "$n" > .board/review.md ;;
  reject) printf 'REJECTED revision %s: %s\n' "$n" "${2:-no reason given}" > .board/review.md ;;
  *) echo "usage: review.sh approve | reject \"what to fix\""; exit 2 ;;
esac
cat .board/review.md
