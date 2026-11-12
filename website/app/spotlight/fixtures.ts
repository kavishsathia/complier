// Demonstration fixtures for /spotlight, shown labelled as such: copies of complier's example
// workflows (PR #23's test-before-commit, and the two-agent review gate). They are not saved on
// this computer and nothing applies them.

import type { Workflow } from "./search.ts";

export const FIXTURES: Workflow[] = [
  {
    "name": "test-before-commit",
    "description": "Only commit after the tests pass since the last edit.",
    "noticed": "(example from complier PR #23: examples/workflows/test-before-commit)",
    "created": "",
    "spec": {
      "file": "policy.csp",
      "src": "-- A saved Claude Code workflow: tests must pass after the last edit before a commit.\n-- Editing makes the work untested; a passing test run makes it tested; a commit is allowed only\n-- while it is tested, and a successful commit ends the workflow. Other commands are always allowed.\ndatatype Act = edit | test | commit | other\ndatatype Value = done | failed\nReturns(_) = {done, failed}\n\nPolicy = Untested\n\nUntested =\n     Permit(edit, \\ _ @ Untested)\n  [] Permit(other, \\ _ @ Untested)\n  [] Permit(test, \\ v @ if v == done then Tested else Untested)\n  [] Deny(commit, Untested)\n\nTested =\n     Permit(edit, \\ _ @ Untested)\n  [] Permit(other, \\ _ @ Tested)\n  [] Permit(test, \\ v @ if v == done then Tested else Untested)\n  [] Permit(commit, \\ v @ if v == done then SKIP else Tested)\n"
    },
    "units": [
      {
        "file": "claude-code.yaml",
        "src": "# Claude Code's built-in tools, as the actions of policy.csp. Reads are hidden (passed through);\n# every other built-in tool this unit doesn't name is blocked while the workflow is applied.\nservice: claude-code\n\ntranslate:\n  tools: [Bash, Edit, Write, NotebookEdit]\n  schema:\n    command: optional<string>\n  rules:\n    edit:\n      when: tool != 'Bash'\n      emit: edit\n    test:\n      when: >-\n        tool == 'Bash' && (command.orValue('').contains('cargo test') || command.orValue('').contains('npm test')\n          || command.orValue('').contains('pytest'))\n      emit: test\n    commit:\n      when: >-\n        tool == 'Bash' && command.orValue('').contains('git commit') && !(command.orValue('').contains('cargo test')\n          || command.orValue('').contains('npm test') || command.orValue('').contains('pytest'))\n      emit: commit\n  fallback:\n    emit: other\n  results:\n    default: \"ok ? 'done' : 'failed'\"\nhidden: [Read, ToolSearch]\n"
      }
    ],
    "sessions": [],
    "source": "fixture"
  },
  {
    "name": "review-gate",
    "description": "A writer submits; a reviewer approves or rejects; publishing needs an approval.",
    "noticed": "(example from the two-agent demo: examples/two-agents)",
    "created": "",
    "spec": {
      "file": "review-gate.csp",
      "src": "-- Two Claude Code agents, a writer and a reviewer, on one complier machine.\n-- The writer submits a draft; the reviewer's verdict decides what happens next: a rejection sends\n-- the work back to the writer, an approval lets it be published, and publishing ends the workflow.\n-- Publishing before an approval is denied; acting out of turn (reviewing before anything is\n-- submitted, submitting while a draft is in review) is refused, and leaves the state as it was.\ndatatype Act = submit | review | publish | other\ndatatype Value = done | failed | approved | rejected\nReturns(review) = {approved, rejected, failed}\nReturns(_)      = {done, failed}\n\nPolicy = Writing\n\nWriting =\n     Permit(submit, \\ v @ if v == done then InReview else Writing)\n  [] Permit(other, \\ _ @ Writing)\n  [] Deny(publish, Writing)\n\nInReview =\n     Permit(review, \\ v @ if v == approved then Approved else if v == rejected then Writing else InReview)\n  [] Permit(other, \\ _ @ InReview)\n  [] Deny(publish, InReview)\n\nApproved =\n     Permit(publish, \\ v @ if v == done then SKIP else Approved)\n  [] Permit(other, \\ _ @ Approved)\n"
    },
    "units": [
      {
        "file": "claude-code.yaml",
        "src": "# Claude Code's built-in tools as review-gate.csp's actions. Each step is one script in the shared\n# workspace; anything else (writing the draft, checking status, waiting) is `other`. The review's\n# result is the verdict review.sh prints.\nservice: claude-code\n\ntranslate:\n  tools: [Bash, Write, Edit]\n  schema:\n    command: optional<string>\n  rules:\n    submit:\n      when: >-\n        tool == 'Bash' && command.orValue('').contains('tools/submit.sh')\n          && !command.orValue('').contains('tools/review.sh') && !command.orValue('').contains('tools/publish.sh')\n      emit: submit\n    review:\n      when: >-\n        tool == 'Bash' && command.orValue('').contains('tools/review.sh')\n          && !command.orValue('').contains('tools/submit.sh') && !command.orValue('').contains('tools/publish.sh')\n      emit: review\n    publish:\n      when: >-\n        tool == 'Bash' && command.orValue('').contains('tools/publish.sh')\n          && !command.orValue('').contains('tools/submit.sh') && !command.orValue('').contains('tools/review.sh')\n      emit: publish\n  fallback:\n    emit: other\n  results:\n    review: \"!ok ? 'failed' : (output.contains('APPROVED') ? 'approved' : 'rejected')\"\n    default: \"ok ? 'done' : 'failed'\"\nhidden: [Read]\n"
      }
    ],
    "sessions": [],
    "source": "fixture"
  }
];
