#!/usr/bin/env bash
# Two Claude Code instances, a writer and a reviewer, monitored together by one complier machine.
#
#   examples/two-agents/run.sh [OUT_DIR]
#
# Needs complier on PATH with its CEL and FDR backends (`complier doctor` says ready) and a logged-in
# `claude`. Copies workspace/ to OUT_DIR, starts machine review-gate, runs both agents at once (each
# bound by COMPLIER_MACHINE/COMPLIER_ROLE, with this checkout's plugin), then prints the machine's log.
# CLAUDE and MODEL override the claude command and model; COMPLIER_STATE is complier's state folder
# (default ~/.complier), where the machine's event log is read from.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
CLAUDE=${CLAUDE:-claude}
MODEL=${MODEL:-claude-opus-5-5}
MACHINE=${MACHINE:-review-gate}
OUT=${1:-$(mktemp -d "${TMPDIR:-/tmp}/complier-two-agents.XXXXXX")}
mkdir -p "$OUT"
cp -R "$HERE/workspace" "$OUT/workspace"

STATE=${COMPLIER_STATE:-$HOME/.complier}
LOG=$STATE/machines/$MACHINE.log
complier machine down "$MACHINE" >/dev/null 2>&1 || true
# complier appends to a machine's log across runs: keep only this run's lines.
SKIP=$( (wc -l < "$LOG") 2>/dev/null || echo 0)
complier machine up "$MACHINE" --spec "$HERE/review-gate.csp" --unit "$HERE/claude-code.yaml"

for role in writer reviewer; do
  sid=$(python3 -c 'import uuid; print(uuid.uuid4())')
  echo "$sid" > "$OUT/$role.session"
  echo "$role: Claude Code session $sid"
  ( cd "$OUT/workspace" && COMPLIER_MACHINE=$MACHINE COMPLIER_ROLE=$role "$CLAUDE" -p "You are the $role: follow $(echo "$role" | tr a-z A-Z).md." \
      --plugin-dir "$ROOT/plugin" --model "$MODEL" --session-id "$sid" \
      --permission-mode acceptEdits --allowedTools Bash Read Write Edit \
      --disallowedTools Task Agent WebFetch WebSearch \
      --max-turns 80 --output-format stream-json --verbose > "$OUT/$role.jsonl" 2>&1 ) &
done
wait

tail -n +"$((SKIP + 1))" "$LOG" > "$OUT/machine.log"
echo
echo "machine $MACHINE, as complier saw it:"
python3 "$HERE/summarise.py" "$OUT/machine.log"
echo
echo "transcripts, log and workspace: $OUT"
