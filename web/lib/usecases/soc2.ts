import { UseCase } from "./types";

export const soc2: UseCase = {
  slug: "soc2",
  title: "SOC 2 Type II evidence collection",
  summary:
    "Across a 6 to 12 month observation window, the dot continuously gathers proof that controls actually operated, not just that they exist.",
  constraints: [
    {
      text: "Every production deploy links to a ticket with at least one approving reviewer who isn't the author.",
      how: "enforced",
      detail: "deploy carries the ticket's author and approver and is only offered when they differ. A self-approval does not count; another approval is needed. The proof shows no deploy is ever self-approved.",
    },
    {
      text: "Access for terminated employees is revoked within 24 hours of the HR termination date.",
      how: "deadline",
      detail: "One tock is an hour. After 24 hours without revoke, the termination becomes a control Gap.",
    },
    {
      text: "Quarterly access reviews are completed and signed by the system owner.",
      how: "enforced",
      detail: "Only sign_review.Owner is ever offered, and an unsigned quarter moves to Unsigned until the owner signs. The proof shows no review is signed by anyone else.",
    },
    {
      text: "All evidence is timestamped and filed in the auditor's folder structure.",
      how: "enforced",
      detail: "Each deploy must be followed by file_evidence before the next change can start. The proof shows at most one deploy is ever unfiled. The folder layout itself is outside the model.",
    },
    {
      text: "Any control gap is reported to the compliance lead within 48 hours.",
      how: "deadline",
      detail: "A Gap allows report_gap and counts hours; after 48 it is Unreported, where reporting is the only allowed action.",
    },
  ],
  source: `-- SOC 2 Type II evidence collection. One tock is one hour.

datatype Person = Ana | Ben | Owner
channel open_ticket : Person          -- the author opens a change ticket
channel approve : Person              -- someone approves the ticket
channel deploy : Person.Person        -- the ticket's author and approver
channel file_evidence                 -- timestamped into the auditor's folders
channel sign_review : Person          -- quarterly access review sign-off
channel terminate, revoke, report_gap : Person
channel tock

-- A deploy needs approval from someone other than the author,
-- and its evidence is filed before the next change starts.
Change = open_ticket?a -> Review(a)
Review(a) = approve?r -> Approved(a, r)
Approved(a, r) = r != a & deploy!a!r -> Filing
              [] r == a & approve?r2 -> Approved(a, r2)
Filing = file_evidence -> Change

-- Access is revoked within 24 hours of termination, or it is a gap,
-- and a gap is reported within 48 hours.
Active(p) = terminate!p -> Leaving(p, 0)  [] tock -> Active(p)
Leaving(p, h) = revoke!p -> Gone(p)
             [] h < 24 & tock -> Leaving(p, h + 1)
             [] h >= 24 & tock -> Gap(p, 0)
Gap(p, h) = report_gap!p -> Reported(p)
         [] h < 48 & tock -> Gap(p, h + 1)
         [] h >= 48 & tock -> Unreported(p)
Unreported(p) = report_gap!p -> Reported(p)  [] tock -> Unreported(p)
Reported(p) = revoke!p -> Gone(p)  [] tock -> Reported(p)
Gone(p) = tock -> Gone(p)

-- The quarterly review (about 2190 hours) is signed by the system owner.
Quarter(h) = sign_review!Owner -> Quarter(0)
          [] h < 2190 & tock -> Quarter(h + 1)
          [] h >= 2190 & tock -> Unsigned
Unsigned = sign_review!Owner -> Quarter(0)  [] tock -> Unsigned

Audit(deploys, self_approved, unfiled, other_signers) =
     deploy?a?r -> Audit(deploys + 1, self_approved + (if a == r then 1 else 0),
                         unfiled + 1, other_signers)
  [] file_evidence -> Audit(deploys, self_approved, unfiled - 1, other_signers)
  [] sign_review?p -> Audit(deploys, self_approved, unfiled,
                            other_signers + (if p == Owner then 0 else 1))

System =
  ((Change ||| (Active(Ana) [| {| tock |} |] Active(Ben)) [| {| tock |} |] Quarter(0))
    [| {| deploy, file_evidence, sign_review |} |]
  Audit(0, 0, 0, 0))

assert Audit :[always self_approved == 0]
assert Audit :[always unfiled <= 1]
assert Audit :[always other_signers == 0]
assert Leaving :[always h <= 24]
`,
};
