import { UseCase } from "./types";

export const personalTax: UseCase = {
  slug: "personal-tax",
  title: "Year-round personal tax preparation (US)",
  summary:
    "The dot collects documents as they arrive and manages estimated payments.",
  constraints: [
    {
      text: "Quarterly estimated payments are calendared for Apr 15, Jun 15, Sep 15, and Jan 15.",
      how: "deadline",
      detail: "One tock is a month, starting in January. Each quarter's payment is offered until its due month passes; a missed one is Overdue, where paying late (and noting it) is the only action.",
    },
    {
      text: "Estimates meet the safe harbor of 100% of prior-year tax, or 110% above the income threshold.",
      how: "enforced",
      detail: "With prior-year tax of 20000 and income above 150000, file is only offered once estimates total at least 110% of it. The proof shows every return was filed with the safe harbor met.",
    },
    {
      text: "Every deduction is backed by a filed receipt.",
      how: "enforced",
      detail: "claim_deduction is only offered after receipt for the same deduction. The proof shows claims never exceed receipts.",
    },
    {
      text: "All 1099s and W-2s are accounted for against the prior year's list before filing.",
      how: "enforced",
      detail: "Last year's list has three forms. file needs every one received.",
    },
  ],
  source: `-- Personal tax year. One tock is one month, starting in January (month 1).
-- Prior-year tax 20000, income 180000, so the safe harbor is 110%: 22000.

datatype Form = W2 | Int1099 | Div1099
channel pay_estimate : Int.Int     -- quarter 1..4, amount
channel note_late : Int
channel receipt, claim_deduction : Int
channel form : Form
channel file
channel tock

-- Due months: Apr (4), Jun (6), Sep (9), and Jan of next year (13).
Estimates(m, q, paid) =
     q <= 4 & pay_estimate!q?amt:{0..100000} -> Estimates(m, q + 1, paid + amt)
  [] q > 4 or m < (if q == 1 then 4 else if q == 2 then 6 else if q == 3 then 9 else 13)
     & tock -> Estimates(m + 1, q, paid)
  [] q <= 4 and m >= (if q == 1 then 4 else if q == 2 then 6 else if q == 3 then 9 else 13)
     & tock -> Overdue(m + 1, q, paid)
  [] paid * 100 >= 110 * 20000 & file -> Filed(paid)
Overdue(m, q, paid) = note_late!q -> Estimates(m, q, paid)  [] tock -> Overdue(m + 1, q, paid)
Filed(paid) = STOP

-- One receipt per deduction before it is claimed.
Deductions(receipts, claims) =
     receipt?d:{1..100} -> Deductions(receipts + 1, claims)
  [] claims < receipts & claim_deduction?d:{1..100} -> Deductions(receipts, claims + 1)
  [] file -> Claimed(receipts, claims)
Claimed(receipts, claims) = STOP

-- Last year's forms: all must be in before filing.
Forms(w, i, d) =
     form!W2 -> Forms(1, i, d)
  [] form!Int1099 -> Forms(w, 1, d)
  [] form!Div1099 -> Forms(w, i, 1)
  [] w == 1 and i == 1 and d == 1 & file -> Complete
Complete = STOP

System = Estimates(1, 1, 0) [| {| file |} |] Deductions(0, 0) [| {| file |} |] Forms(0, 0, 0)

assert Filed :[always paid >= 22000]
assert Claimed :[always claims <= receipts]
`,
};
