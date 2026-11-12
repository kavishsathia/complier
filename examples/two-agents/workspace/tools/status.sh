#!/bin/sh
# Anyone: where the work is.
cd "$(dirname "$0")/.." || exit 1
echo "submitted revision: $(cat .board/revision 2>/dev/null || echo none)"
echo "review: $(cat .board/review.md 2>/dev/null || echo none)"
[ -f published.md ] && echo "PUBLISHED" || echo "not published"
