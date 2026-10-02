import { UseCase } from "./types";

export const regulatory: UseCase = {
  slug: "regulatory",
  title: "Regulatory change monitoring for fintech compliance",
  summary:
    "For a fintech compliance team, the dot watches regulator publications and maps each change to internal policies.",
  constraints: [
    {
      text: "Every new rule or guidance is logged with its effective date within 2 business days of publication.",
      how: "deadline",
      detail: "One tock is a business day. log carries the effective date and only offers the one published. After 2 days unlogged, the rule is Overdue and logging is the only action.",
    },
    {
      text: "A gap analysis is drafted within 10 business days.",
      how: "deadline",
      detail: "The same clock keeps running after logging. After 10 days without draft_gap, escalate is the only action.",
    },
    {
      text: "Nothing gets marked \"no impact\" without compliance officer sign-off.",
      how: "enforced",
      detail: "mark_no_impact is only offered after officer_signoff. The proof shows no-impact marks never exceed sign-offs.",
    },
    {
      text: "Mapping each change to internal policies.",
      how: "not-encoded",
      detail: "Which policies a rule touches is a judgment. The model governs the steps around it, not the mapping itself.",
    },
  ],
  source: `-- Regulatory change monitoring. One tock is one business day.
-- Two publications stand in for the regulators' feeds.

datatype Rule = Rule1 | Rule2
channel published : Rule.Int        -- a new rule and its effective date (yyyymmdd)
channel log : Rule.Int              -- logged with its effective date
channel draft_gap, escalate : Rule
channel officer_signoff, mark_no_impact, mark_impact : Rule
channel tock

Watching(r) = published!r?eff:{20000101..21001231} -> New(r, eff, 0)
           [] tock -> Watching(r)
New(r, eff, d) =
     log!r!eff -> Logged(r, d)
  [] d < 2 & tock -> New(r, eff, d + 1)
  [] d >= 2 & tock -> Overdue(r, eff, d + 1)
Overdue(r, eff, d) =
     d < 10 & log!r!eff -> Logged(r, d)
  [] d >= 10 & log!r!eff -> Late(r)
  [] tock -> Overdue(r, eff, d + 1)
Logged(r, d) =
     draft_gap!r -> Assessing(r)
  [] d < 10 & tock -> Logged(r, d + 1)
  [] d >= 10 & tock -> Late(r)
Late(r) = escalate!r -> Logged(r, 0)  [] tock -> Late(r)

-- "No impact" needs the compliance officer first.
Assessing(r) = mark_impact!r -> Done(r)
            [] officer_signoff!r -> SignedOff(r)
            [] tock -> Assessing(r)
SignedOff(r) = mark_no_impact!r -> Done(r)  [] mark_impact!r -> Done(r)  [] tock -> SignedOff(r)
Done(r) = tock -> Done(r)

Audit(signoffs, no_impact) =
     officer_signoff?r -> Audit(signoffs + 1, no_impact)
  [] mark_no_impact?r -> Audit(signoffs, no_impact + 1)

System =
  (Watching(Rule1) [| {| tock |} |] Watching(Rule2))
    [| {| officer_signoff, mark_no_impact |} |]
  Audit(0, 0)

assert Audit :[always no_impact <= signoffs]
assert New :[always d <= 2]
assert Logged :[always d <= 10]
`,
};
