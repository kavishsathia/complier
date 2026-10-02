import { UseCase } from "./types";

export const openSource: UseCase = {
  slug: "open-source",
  title: "Open-source project maintenance",
  summary:
    "The dot handles issue triage, labeling, contributor support, and releases.",
  constraints: [
    {
      text: "Every new issue gets a first response within 48 hours.",
      how: "deadline",
      detail: "One tock is an hour. After 48 hours without a response, the issue is Overdue and responding is the only action on it.",
    },
    {
      text: "Releases follow semver, with a changelog in Keep a Changelog format.",
      how: "enforced",
      detail: "A release is only offered as the next major, minor or patch version, and only after a changelog entry. The proof shows every release is a valid semver bump of the previous one. The changelog's format is checked by a linter, not the model.",
    },
    {
      text: "All PRs pass the CLA check before review.",
      how: "enforced",
      detail: "review is only offered after a passing cla result for that PR.",
    },
    {
      text: "Issues from first-time contributors are never closed without a human maintainer's look.",
      how: "enforced",
      detail: "An issue is opened with a first-time flag. close is only offered for it after maintainer_look. The proof shows no first-time issue is closed unseen.",
    },
  ],
  source: `-- Open-source maintenance. One tock is one hour.

datatype Issue = I1 | I2
channel opened : Issue.Int            -- 1 if the author is a first-time contributor
channel respond, maintainer_look, close : Issue
channel pr, review : Int
channel cla : Int.Int                 -- PR, 1 if the CLA is signed
channel write_changelog
channel release : Int.Int.Int         -- major, minor, patch
channel tock

Quiet(i) = opened!i?f:{0..1} -> New(i, f, 0)  [] tock -> Quiet(i)
New(i, f, h) = respond!i -> Triage(i, f, 0)
            [] h < 48 & tock -> New(i, f, h + 1)
            [] h >= 48 & tock -> Overdue(i, f)
Overdue(i, f) = respond!i -> Triage(i, f, 0)  [] tock -> Overdue(i, f)
Triage(i, f, seen) =
     maintainer_look!i -> Triage(i, f, 1)
  [] f == 0 or seen == 1 & close!i -> Closed(i, f, seen)
  [] tock -> Triage(i, f, seen)
Closed(i, f, seen) = tock -> Closed(i, f, seen)

-- Review only after the CLA check passes.
PRs = pr?n:{1..10000} -> Checking(n)
Checking(n) = cla!n?ok:{0..1} -> Checked(n, ok)
Checked(n, ok) = ok == 1 & review!n -> PRs  [] ok == 0 & cla!n?ok2:{0..1} -> Checked(n, ok2)

-- The next version is a major, minor or patch bump, after a changelog entry.
Version(maj, min, pat, notes) =
     notes == 0 & write_changelog -> Version(maj, min, pat, 1)
  [] notes == 1 & release!(maj + 1)!0!0 -> Version(maj + 1, 0, 0, 0)
  [] notes == 1 & release!maj!(min + 1)!0 -> Version(maj, min + 1, 0, 0)
  [] notes == 1 & release!maj!min!(pat + 1) -> Version(maj, min, pat + 1, 0)

Releases(lm, ln, lp, bad) =
     release?a?b?c -> Releases(a, b, c, bad +
       (if (a == lm + 1 and b == 0 and c == 0) or (a == lm and b == ln + 1 and c == 0)
           or (a == lm and b == ln and c == lp + 1) then 0 else 1))

System =
  (Quiet(I1) [| {| tock |} |] Quiet(I2))
  ||| PRs
  ||| (Version(1, 4, 2, 0) [| {| release |} |] Releases(1, 4, 2, 0))

assert Releases :[always bad == 0]
assert Closed :[always f == 0 or seen == 1]
assert New :[always h <= 48]
`,
};
