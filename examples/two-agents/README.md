# Two Claude Code instances on one machine

A writer and a reviewer, two separate Claude Code sessions, work in one folder. One complier machine
monitors both of them. The writer drafts and submits, and the reviewer approves or rejects. **The
review's result decides what comes next:** a rejection sends the work back to the writer, and an
approval lets it be published. Publishing ends the workflow and releases both sessions.

```
Writing ──submit──▶ InReview ──review = approved──▶ Approved ──publish──▶ SKIP
   ▲                    │
   └─review = rejected──┘
```

- `review-gate.csp`: the policy. Publishing before an approval is **denied**. Acting out of turn
  (reviewing before anything is submitted, or submitting while a draft is in review) is **refused**,
  and the state stays where it was.
- `claude-code.yaml`: the unit. `tools/submit.sh`, `tools/review.sh` and `tools/publish.sh` are the
  three steps, and any other Bash/Write/Edit call is `other`. The review's value comes from what
  `review.sh` prints (`APPROVED…` or `REJECTED…`).
- `prompts/`: each agent's instructions. Each prompt asks its agent to make one deliberate
  out-of-turn attempt (writer: publish right after submitting; reviewer: review before anything is
  submitted), so the run shows a deny and a refusal.

## Run it

```sh
complier doctor                      # needs: ready
examples/two-agents/run.sh           # about 3–6 minutes; prints the machine's timeline at the end
```

Each agent runs `claude -p` with `COMPLIER_MACHINE=review-gate` and its own `COMPLIER_ROLE`, and
loads this checkout's plugin with `--plugin-dir`, so nothing is installed globally. Transcripts
(`writer.jsonl`, `reviewer.jsonl`), session ids, the workspace and `machine.log` are kept in the
output folder.

## What the roles are, today

The policy's events don't carry a role: `machine up` compiles policies over `attempt.x`, not
`attempt.r.x`. Both agents therefore drive one shared state. The role is recorded on every attempt in
the log, but the policy can't tell *who* attempted something. The order between the two agents is
what is enforced; who does each step is set by the prompts. What you can see in a run:

- While one agent's allowed call is still running, the other agent's attempts are refused ("the
  result of … hasn't come back yet"), because the machine waits for one result at a time.
- The Stop hook tells each agent what the shared policy allows next, which can be the other agent's
  step.
- Every Bash/Write/Edit call is mediated, including `sleep` and status checks. While one agent waits
  with `sleep 4`, the other agent's calls are refused (one pending result per machine). Agents recover
  by retrying, but a refused edit followed by a successful submit can send an unchanged draft for
  review. The policy orders steps; it doesn't see what's in the files.
- Once the policy finishes, the machine stops taking attempts, so a final `status.sh` check is
  refused too. Both agents are released from their Stop hold.
