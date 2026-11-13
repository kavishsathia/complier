#!/bin/sh
# Writer: publishes the approved submission.
cd "$(dirname "$0")/.." || exit 1
grep -q '^APPROVED' .board/review.md 2>/dev/null || { echo "not approved"; exit 1; }
cp .board/submitted.md published.md && echo "PUBLISHED revision $(cat .board/revision)"
