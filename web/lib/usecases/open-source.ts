import { UseCase } from "./types";

export const openSource: UseCase = {
  slug: "open-source",
  title: "Open-source project maintenance",
  summary:
    "Two agents maintain a project: an implementor that answers issues, writes fixes and cuts releases, and a reviewer that reviews and merges. Each process is exactly one participant: the world (contributors, the CLA bot, CI), the human maintainer, the implementor, or the reviewer. Observers only count events for the proofs. Review and merge events carry who performed them, so the separation between the two agents is checked, not assumed.",
  constraints: [
    {
      text: "Every new issue gets a first response within 48 hours.",
      how: "deadline",
      detail: "One tock is an hour. After 48 hours without a response, the issue is Overdue and responding is the only thing the implementor may do with it.",
    },
    {
      text: "All PRs pass the CLA check before review.",
      how: "enforced",
      detail: "The reviewer only approves or requests changes once the CLA bot has reported the CLA signed and CI is green on the latest commit. ReviewGate shows no review happens otherwise.",
    },
    {
      text: "Issues from first-time contributors are never closed without a human maintainer's look.",
      how: "enforced",
      detail: "The implementor can only close a first-time issue after maintainer_look. FirstTimeGate shows no first-time issue is closed unseen.",
    },
    {
      text: "Releases follow semver, with a changelog in Keep a Changelog format.",
      how: "enforced",
      detail: "The implementor writes a changelog entry after a merge and only then releases, as the next major, minor or patch version. Releases shows every release is a valid bump of the last, and ReleaseGate that each has its entry. The entry's format is a linter's job, not the model's.",
    },
    {
      text: "The implementor never approves or merges its own work, and the reviewer never pushes code.",
      how: "enforced",
      detail: "approve, request_changes, merge and push name who did them. Only the reviewer's process offers the first three, only the implementor's offers push, so an attempt by the wrong agent is blocked. Separation shows it never happens.",
    },
    {
      text: "A merge needs the reviewer's approval of the latest commit.",
      how: "enforced",
      detail: "Any push after an approval sends the reviewer back to waiting for CI. MergeGate shows every merge had a standing approval.",
    },
  ],
  source: `-- Open-source maintenance with two agents. One tock is one hour.
-- The implementor answers issues, writes fixes and cuts releases.
-- The reviewer reviews and merges. Events say who performed them.

datatype Who = Implementor | Reviewer

-- performed by the world (contributors, the CLA bot, CI)
channel opened : Int            -- an issue arrives; 1 if from a first-time contributor
channel cla : Int               -- CLA check result for the PR, 1 if signed
channel ci : Int                -- CI result for the latest commit, 1 if green
channel tock

-- performed by the human maintainer
channel maintainer_look

-- performed by the implementor
channel respond, close, open_pr, write_changelog
channel release : Int.Int.Int   -- major, minor, patch

-- performed by whoever the first field names
channel push, approve, request_changes, merge : Who

-- The world --------------------------------------------------------------

Contributors = opened?f:{0..1} -> Quiet  [] tock -> Contributors
Quiet = tock -> Quiet

-- Reports on the PR's CLA until it is signed.
CLABot(pending) =
     open_pr -> CLABot(1)
  [] pending == 1 & cla?ok:{0..1} -> CLABot(1 - ok)

-- Runs on the PR and on every new commit.
CI(pending) =
     open_pr -> CI(1)
  [] push?w -> CI(1)
  [] pending == 1 & ci?pass:{0..1} -> CI(0)

-- The human --------------------------------------------------------------

Maintainer = maintainer_look -> Maintainer

-- The implementor --------------------------------------------------------

-- The issue: first response within 48 hours; a first-time contributor's
-- issue stays open until the maintainer has looked.
NoIssue = opened?f -> New(f, 0, 0)  [] tock -> NoIssue  [] maintainer_look -> NoIssue
New(f, looked, h) =
     respond -> Triaged(f, looked)
  [] maintainer_look -> New(f, 1, h)
  [] h < 48 & tock -> New(f, looked, h + 1)
  [] h >= 48 & tock -> Overdue(f, looked)
Overdue(f, looked) =
     respond -> Triaged(f, looked)
  [] maintainer_look -> Overdue(f, 1)
  [] tock -> Overdue(f, looked)
Triaged(f, looked) =
     f == 0 or looked == 1 & close -> Closed
  [] maintainer_look -> Triaged(f, 1)
  [] tock -> Triaged(f, looked)
Closed = tock -> Closed  [] maintainer_look -> Closed

-- The fix: it pushes commits, and follows the reviewer's decisions.
Drafting = open_pr -> Submitted
Submitted =
     push!Implementor -> Submitted
  [] request_changes!Reviewer -> Fixing
  [] approve!Reviewer -> Approved
Fixing = push!Implementor -> Submitted
Approved = push!Implementor -> Submitted  [] merge!Reviewer -> Merged
Merged = STOP

-- The release: a changelog entry after a merge, then the next semver.
Version(maj, min, pat, merged, notes) =
     merge!Reviewer -> Version(maj, min, pat, 1, notes)
  [] merged == 1 and notes == 0 & write_changelog -> Version(maj, min, pat, merged, 1)
  [] notes == 1 & release!(maj + 1)!0!0 -> Version(maj + 1, 0, 0, 0, 0)
  [] notes == 1 & release!maj!(min + 1)!0 -> Version(maj, min + 1, 0, 0, 0)
  [] notes == 1 & release!maj!min!(pat + 1) -> Version(maj, min, pat + 1, 0, 0)

-- The reviewer -----------------------------------------------------------

-- It reviews only once the CLA is signed and CI is green on the latest
-- commit, and a push after its approval sends it back to waiting.
Idle = open_pr -> Watching(0, 0)
Watching(signed, green) =
     cla?ok -> Watching(ok, green)
  [] ci?pass -> Watching(signed, pass)
  [] push!Implementor -> Watching(signed, 0)
  [] signed == 1 and green == 1 & approve!Reviewer -> Ready(signed)
  [] signed == 1 and green == 1 & request_changes!Reviewer -> AwaitingFix(signed)
AwaitingFix(signed) =
     push!Implementor -> Watching(signed, 0)
  [] cla?ok -> AwaitingFix(ok)
  [] ci?pass -> AwaitingFix(signed)
Ready(signed) =
     merge!Reviewer -> Done
  [] push!Implementor -> Watching(signed, 0)
  [] cla?ok -> Ready(signed)
  [] ci?pass -> Ready(signed)
Done = STOP

-- Observers: not participants, they count for the proofs -----------------

FirstTimeGate(f, looked, bad) =
     opened?x -> FirstTimeGate(x, 0, bad)
  [] maintainer_look -> FirstTimeGate(f, 1, bad)
  [] close -> FirstTimeGate(f, looked, bad + (if f == 1 and looked == 0 then 1 else 0))

ReviewGate(signed, green, bad) =
     open_pr -> ReviewGate(0, 0, bad)
  [] cla?ok -> ReviewGate(ok, green, bad)
  [] ci?pass -> ReviewGate(signed, pass, bad)
  [] push?w -> ReviewGate(signed, 0, bad)
  [] approve?w -> ReviewGate(signed, green, bad + (if signed == 1 and green == 1 then 0 else 1))
  [] request_changes?w -> ReviewGate(signed, green, bad + (if signed == 1 and green == 1 then 0 else 1))

MergeGate(ok, bad) =
     approve?w -> MergeGate(1, bad)
  [] push?w -> MergeGate(0, bad)
  [] request_changes?w -> MergeGate(0, bad)
  [] merge?w -> MergeGate(ok, bad + 1 - ok)

Separation(bad) =
     push?w -> Separation(bad + (if w == Implementor then 0 else 1))
  [] approve?w -> Separation(bad + (if w == Reviewer then 0 else 1))
  [] request_changes?w -> Separation(bad + (if w == Reviewer then 0 else 1))
  [] merge?w -> Separation(bad + (if w == Reviewer then 0 else 1))

Releases(lm, ln, lp, bad) =
     release?a?b?c -> Releases(a, b, c, bad +
       (if (a == lm + 1 and b == 0 and c == 0) or (a == lm and b == ln + 1 and c == 0)
           or (a == lm and b == ln and c == lp + 1) then 0 else 1))

ReleaseGate(notes, bad) =
     write_changelog -> ReleaseGate(1, bad)
  [] release?a?b?c -> ReleaseGate(0, bad + 1 - notes)

System =
  (((Contributors ||| (CLABot(0) [| {| open_pr |} |] CI(0)))
       [| {| opened, tock, open_pr, cla, push, ci |} |]
     ((NoIssue ||| (Drafting [| {| merge |} |] Version(1, 4, 2, 0, 0)))
        [| {| open_pr, push, approve, request_changes, merge |} |]
      Idle))
     [| {| maintainer_look |} |]
   Maintainer)
    [| {| opened, maintainer_look, close, open_pr, cla, ci, push, approve,
          request_changes, merge, release, write_changelog |} |]
  (FirstTimeGate(0, 0, 0)
   ||| ((ReviewGate(0, 0, 0) [| {| approve, push, request_changes |} |] MergeGate(0, 0))
          [| {| push, approve, request_changes, merge |} |] Separation(0))
   ||| (Releases(1, 4, 2, 0) [| {| release |} |] ReleaseGate(0, 0)))

assert FirstTimeGate :[always bad == 0]
assert ReviewGate :[always bad == 0]
assert MergeGate :[always bad == 0]
assert Separation :[always bad == 0]
assert Releases :[always bad == 0]
assert ReleaseGate :[always bad == 0]
assert New :[always h <= 48]
`,
};
