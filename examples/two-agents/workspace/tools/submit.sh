#!/bin/sh
# Writer: submits draft.md for review.
cd "$(dirname "$0")/.." || exit 1
[ -s draft.md ] || { echo "no draft.md to submit"; exit 1; }
mkdir -p .board
n=$(( $(cat .board/revision 2>/dev/null || echo 0) + 1 ))
cp draft.md .board/submitted.md && echo "$n" > .board/revision && rm -f .board/review.md
echo "SUBMITTED revision $n"
