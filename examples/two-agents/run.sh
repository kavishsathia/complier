#!/usr/bin/env bash
# Two agents, a writer and a reviewer, monitored together by one complier machine, run headless in
# Claude Code (the default) or Codex.
#
#   examples/two-agents/run.sh [--harness claude|codex] [OUT_DIR]
#
# Needs complier on PATH with its CEL and FDR backends (`complier doctor` says ready). Copies
# workspace/ to OUT_DIR, starts machine review-gate, runs both agents at once (each bound by
# COMPLIER_MACHINE/COMPLIER_ROLE), then prints the machine's log. HARNESS (or COMPLIER_HARNESS)
# chooses the harness when --harness isn't given; COMPLIER_STATE is complier's state folder (default
# ~/.complier), where the machine's event log is read from.
#
# Claude Code: a logged-in `claude`, given this checkout's plugin with --plugin-dir and the unit
#   claude-code.yaml. CLAUDE and MODEL override the claude command and model.
# Codex: a logged-in `codex` with complier's plugin installed and its hooks trusted in /hooks
#   (`complier doctor` says so), and the unit codex.yaml. Each agent is started with
#   `complier agent --harness codex`, which starts nothing unless Codex runs complier's hooks, and
#   runs `codex exec --json`. CODEX_MODEL sets the model (default: Codex's own), CODEX_SANDBOX the
#   sandbox (default workspace-write), CODEX_ARGS more Codex options given before `exec`
#   (whitespace-separated, e.g. -c key=value), and CODEX_TIMEOUT a limit in seconds per agent
#   (default 1800).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
HARNESS=${HARNESS:-${COMPLIER_HARNESS:-claude}}
if [ "${1:-}" = --harness ]; then
  HARNESS=${2:?--harness needs claude or codex}
  shift 2
fi
case "$HARNESS" in
  claude | codex) ;;
  *) echo "run.sh: unknown harness $HARNESS (claude or codex)" >&2; exit 2 ;;
esac
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
if [ "$HARNESS" = claude ]; then
  UNIT=claude-code.yaml
else
  UNIT=codex.yaml
  # Codex skips hooks that aren't trusted, which would leave the agents unconstrained: check first,
  # before anything starts.
  (cd "$OUT/workspace" && complier agent --harness codex --machine "$MACHINE" --role writer --check)
fi
complier machine up "$MACHINE" --spec "$HERE/review-gate.csp" --unit "$HERE/$UNIT"

for role in writer reviewer; do
  prompt="You are the $role: follow $(echo "$role" | tr a-z A-Z).md."
  if [ "$HARNESS" = claude ]; then
    sid=$(python3 -c 'import uuid; print(uuid.uuid4())')
    echo "$sid" > "$OUT/$role.session"
    echo "$role: Claude Code session $sid"
    ( cd "$OUT/workspace" && COMPLIER_MACHINE=$MACHINE COMPLIER_ROLE=$role "$CLAUDE" -p "$prompt" \
        --plugin-dir "$ROOT/plugin" --model "$MODEL" --session-id "$sid" \
        --permission-mode acceptEdits --allowedTools Bash Read Write Edit \
        --disallowedTools Task Agent WebFetch WebSearch \
        --max-turns 80 --output-format stream-json --verbose > "$OUT/$role.jsonl" 2>&1 ) &
  else
    # Codex names its session itself: it's the thread id its JSON events start with.
    read -r -a extra <<< "${CODEX_ARGS:-}"
    echo "$role: Codex session (its id is written to $role.session once it starts)"
    ( cd "$OUT/workspace" && timeout "${CODEX_TIMEOUT:-1800}" complier agent --harness codex --machine "$MACHINE" --role "$role" "$prompt" -- \
        ${extra[@]+"${extra[@]}"} exec --json --skip-git-repo-check --sandbox "${CODEX_SANDBOX:-workspace-write}" \
        ${CODEX_MODEL:+--model "$CODEX_MODEL"} < /dev/null > "$OUT/$role.jsonl" 2> "$OUT/$role.stderr"
      status=$?
      python3 -c 'import json,sys
for line in open(sys.argv[1]):
    if line.startswith("{") and json.loads(line).get("type") == "thread.started":
        print(json.loads(line)["thread_id"]); break' "$OUT/$role.jsonl" > "$OUT/$role.session" || true
      [ "$status" = 124 ] && echo "$role: stopped after ${CODEX_TIMEOUT:-1800}s (CODEX_TIMEOUT)" >&2
      exit "$status" ) &
  fi
done
failed=0
for job in $(jobs -p); do wait "$job" || failed=1; done

tail -n +"$((SKIP + 1))" "$LOG" > "$OUT/machine.log"
echo
echo "machine $MACHINE, as complier saw it:"
python3 "$HERE/summarise.py" "$OUT/machine.log"
echo
echo "transcripts, log and workspace: $OUT"
[ "$HARNESS" = claude ] || exit "$failed"
