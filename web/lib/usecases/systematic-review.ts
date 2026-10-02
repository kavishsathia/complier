import { UseCase } from "./types";

export const systematicReview: UseCase = {
  slug: "systematic-review",
  title: "Living systematic review",
  summary:
    "For a medical research team keeping a review current for years, the dot runs weekly PubMed and preprint searches.",
  constraints: [
    {
      text: "Inclusion criteria are applied exactly as written (e.g., RCTs only, adults 18+, published since 2015).",
      how: "enforced",
      detail: "A found study carries its design, minimum participant age and year as fields, and the dot's vote must equal the criteria applied to them. Reading those fields correctly out of a paper is the judgment the model takes as given.",
    },
    {
      text: "The dot acts as one of two independent screeners, never the only one.",
      how: "enforced",
      detail: "include needs both the dot's vote and a person's vote to be yes. The proof shows inclusions never exceed human yes votes.",
    },
    {
      text: "PRISMA flow counts are updated every cycle.",
      how: "deadline",
      detail: "One tock is a week. A new search cannot start until the counts for the last one are updated.",
    },
    {
      text: "Every included study is logged with its DOI.",
      how: "enforced",
      detail: "After include, log_doi is the only thing that can happen to that study. The proof shows logged studies never fall more than one behind inclusions.",
    },
    {
      text: "Included studies are checked against retraction databases monthly.",
      how: "deadline",
      detail: "After four weeks without a retraction check, the review is Overdue and the check is the only allowed action.",
    },
  ],
  source: `-- Living systematic review. One tock is one week.
-- Criteria: randomised controlled trial, adults 18+, published 2015 or later.

channel search, update_prisma
channel found : Int.Int.Int        -- 1 if an RCT, youngest participant age, year
channel dot_vote, human_vote : Int -- 1 for include
channel include, exclude
channel log_doi
channel retraction_check
channel tock

-- One search per cycle, and the PRISMA counts are updated before the next.
Cycle = search -> Screening
Screening = found?rct:{0..1}?age:{0..120}?year:{1950..2100}
              -> Vote(if rct == 1 and age >= 18 and year >= 2015 then 1 else 0)
         [] update_prisma -> Waiting
Vote(ok) = dot_vote!ok -> Second(ok)
Second(ok) = human_vote?h:{0..1} -> Decide(ok, h)
Decide(ok, h) = ok == 1 and h == 1 & include -> Logging
             [] ok == 0 or h == 0 & exclude -> Screening
Logging = log_doi -> Screening
Waiting = tock -> Cycle

Retractions(w) = retraction_check -> Retractions(0)
              [] w < 4 & tock -> Retractions(w + 1)
              [] w >= 4 & tock -> Overdue
Overdue = retraction_check -> Retractions(0)  [] tock -> Overdue

Prisma(yes, included, logged) =
     human_vote?h -> Prisma(yes + h, included, logged)
  [] include -> Prisma(yes, included + 1, logged)
  [] log_doi -> Prisma(yes, included, logged + 1)

System =
  (Cycle [| {| tock |} |] Retractions(0))
    [| {| human_vote, include, log_doi |} |]
  Prisma(0, 0, 0)

assert Prisma :[always included <= yes]
assert Prisma :[always logged <= included and included <= logged + 1]
assert Retractions :[always w <= 4]
`,
};
