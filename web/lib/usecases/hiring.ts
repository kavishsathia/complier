import { UseCase } from "./types";

export const hiring: UseCase = {
  slug: "hiring",
  title: "Hiring pipeline for a senior engineering role",
  summary:
    "The dot handles sourcing, coordination, scheduling, and candidate communication across about 200 applicants.",
  constraints: [
    {
      text: "Every applicant hears back within 5 business days.",
      how: "deadline",
      detail: "One tock is a business day. A new applicant must get a reply within 5, or they are Overdue and replying is the only action on them.",
    },
    {
      text: "Evaluation uses structured scorecards only, with no filtering on protected characteristics.",
      how: "enforced",
      detail: "The only evaluation event is a scorecard score from 1 to 4, and the dot's screening decision follows it: 3 or more is booked, less is declined. No event in the model carries a protected characteristic, so no decision can depend on one. Whether a score was given fairly is a judgment the model does not make.",
    },
    {
      text: "Interview loops are booked with at least 24 hours' notice to both sides.",
      how: "enforced",
      detail: "schedule carries the hours of notice and only offers 24 or more.",
    },
    {
      text: "Offers and rejections after onsite interviews come from a human.",
      how: "enforced",
      detail: "After onsite, the only decisions offered are human_offer and human_reject. The proof shows the dot never declines anyone after their onsite.",
    },
    {
      text: "Where automated screening tools are regulated (e.g., NYC Local Law 144), the dot stays out of ranking decisions.",
      how: "enforced",
      detail: "rank exists as an event but is never offered. The proof shows it never happens.",
    },
  ],
  source: `-- Hiring pipeline. One tock is one business day.
-- Two applicants stand in for two hundred.

datatype Applicant = A1 | A2
channel apply, reply, decline, onsite, rank : Applicant
channel score : Applicant.Int          -- structured scorecard total, 1..4
channel schedule : Applicant.Int       -- hours of notice given to both sides
channel human_offer, human_reject : Applicant
channel tock

Pool(a) = apply!a -> New(a, 0)  [] tock -> Pool(a)
New(a, d) = reply!a -> Screening(a)
         [] d < 5 & tock -> New(a, d + 1)
         [] d >= 5 & tock -> Overdue(a)
Overdue(a) = reply!a -> Screening(a)  [] tock -> Overdue(a)

-- The dot's screening follows the scorecard and nothing else.
Screening(a) = score!a?s:{1..4} -> Scored(a, s)  [] tock -> Screening(a)
Scored(a, s) = s >= 3 & schedule!a?h:{24..720} -> Booked(a)
            [] s < 3 & decline!a -> Done(a)
            [] tock -> Scored(a, s)
Booked(a) = onsite!a -> Onsite(a)  [] tock -> Booked(a)

-- After the onsite, only a person decides.
Onsite(a) = human_offer!a -> Done(a)  [] human_reject!a -> Done(a)  [] tock -> Onsite(a)
Done(a) = tock -> Done(a)

-- rank is in the alphabet, but nothing ever offers it.
Audit(a, seen, bad) =
     onsite!a -> Audit(a, 1, bad)
  [] decline!a -> Audit(a, seen, bad + seen)
  [] rank!a -> Audit(a, seen, bad + 1)

System =
  (Pool(A1) [| {| tock |} |] Pool(A2))
    [| {| onsite, decline, rank |} |]
  (Audit(A1, 0, 0) ||| Audit(A2, 0, 0))

assert Audit :[always bad == 0]
assert New :[always d <= 5]
`,
};
