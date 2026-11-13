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
- `workspace/WRITER.md` and `workspace/REVIEWER.md`: each agent's instructions; an agent is told
  only "You are the writer: follow WRITER.md." Each asks its agent to make one deliberate
  out-of-turn attempt (writer: publish right after submitting; reviewer: review before anything is
  submitted), so the run shows a deny and a refusal. `workspace/.claude/settings.json` allows the
  four tool scripts, `sleep` and file edits, so an interactive run doesn't stop to ask.

The step-by-step guide, with two interactive Claude Code sessions, is on the site at
`/get-started/two-agents`.

## Run it

```sh
complier doctor                      # needs: ready
examples/two-agents/run.sh           # about 3–6 minutes; prints the machine's timeline at the end
```

Each agent runs `claude -p` with `COMPLIER_MACHINE=review-gate` and its own `COMPLIER_ROLE`, and
loads this checkout's plugin with `--plugin-dir`, so nothing is installed globally. Transcripts
(`writer.jsonl`, `reviewer.jsonl`), session ids, the workspace and `machine.log` are kept in the
output folder.

## Roles

Each agent is its own `ControllableCHAOS`: the spec declares `datatype Role = writer | reviewer`
and `Agent = ||| r : Role @ ControllableCHAOS(r)`, and every event carries the role that made it
(`attempt.writer.submit`, `result.reviewer.review.approved`). The daemon attempts each call as the
agent's `COMPLIER_ROLE`, so only the writer can submit or publish and only the reviewer can review;
the same step from the other agent is refused. The agents take turns. In each state only one role has a step, and `other` (anything that isn't
submit, review or publish) is only offered to that role. The waiting agent ends its turn instead of
polling, and its Stop hook holds it until its role has a step, then tells it to continue. So the
waiting agent makes no calls, and nothing contends for the machine's one pending call.

- The reviewer starts held, until the writer submits.
- The writer's publish during review is **denied**, then it ends its turn and is held.
- Once the policy finishes, both agents are released.
