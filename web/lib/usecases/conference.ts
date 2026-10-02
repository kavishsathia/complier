import { UseCase } from "./types";

export const conference: UseCase = {
  slug: "conference",
  title: "300-person industry conference",
  summary:
    "The dot runs the call for papers, speaker logistics, the hotel room block, and travel reimbursements.",
  constraints: [
    {
      text: "CFP review is blind, with at least 2 reviewers per submission.",
      how: "enforced",
      detail: "Review events carry the submission and the score, never the author, and decide needs two reviews from different reviewers. The proof shows every decision had two distinct reviewers.",
    },
    {
      text: "Room-block pickup is tracked against the attrition clause (e.g., 80% by cutoff), with a warning at 60%.",
      how: "deadline",
      detail: "With a 100-room block, pickup is counted per booking. From the warning day, warn_pickup is offered while pickup is under 60. At the cutoff, time only moves on with 80 or more rooms picked up; under that, alert_attrition is the only way forward.",
    },
    {
      text: "Speaker slides are collected 7 days before the event.",
      how: "deadline",
      detail: "One tock is a day. With fewer than 7 days left and no slides, the speaker is Overdue and chasing them is the only action.",
    },
    {
      text: "Reimbursements are processed within 30 days with a receipt for every line item.",
      how: "enforced",
      detail: "A claim lists its line items; reimburse needs a receipt for every one and is only offered within 30 days. The proof shows no claim is paid with a missing receipt.",
    },
  ],
  source: `-- Conference operations. One tock is one day; the event is 40 days out.
-- Room block of 100: warn below 60 on day 20, attrition check below 80 at day 10.

datatype Reviewer = R1 | R2 | R3
channel review : Reviewer.Int         -- a blind score for the submission
channel decide : Int                  -- accept 1, reject 0
channel book_room
channel warn_pickup, alert_attrition
channel collect_slides, chase_slides
channel claim : Int                   -- number of line items
channel receipt
channel reimburse : Int.Int           -- line items, receipts
channel tock

-- One submission: decided only after two different reviewers.
Submission(first, n) =
     n == 0 & review?r?s:{1..5} -> Submission(r, 1)
  [] n == 1 & review?r:{0..first - 1}?s:{1..5} -> Reviewed(first, r)
  [] n == 1 & review?r:{first + 1..2}?s:{1..5} -> Reviewed(first, r)
Reviewed(a, b) = decide?x:{0..1} -> Decided(a, b)
Decided(a, b) = STOP

-- Days left d, rooms picked up p, warned flag.
Block(d, p, warned) =
     p < 100 & book_room -> Block(d, p + 1, warned)
  [] d <= 20 and p < 60 and warned == 0 & warn_pickup -> Block(d, p, 1)
  [] d > 10 and (d > 20 or p >= 60 or warned == 1) & tock -> Block(d - 1, p, warned)
  [] d <= 20 and d > 10 and p < 60 and warned == 0 & tock -> Block(d - 1, p, warned)
  [] d == 10 and p < 80 & alert_attrition -> Cutoff(p)
  [] d == 10 and p >= 80 & tock -> Cutoff(p)
Cutoff(p) = tock -> Cutoff(p)

Speaker(d, slides) =
     slides == 0 & collect_slides -> Speaker(d, 1)
  [] d >= 7 or slides == 1 & tock -> Speaker(d - 1, slides)
  [] d < 7 and slides == 0 & tock -> Overdue(d - 1)
Overdue(d) = chase_slides -> Speaker(d, 0)  [] collect_slides -> Speaker(d, 1)  [] tock -> Overdue(d - 1)

-- A claim is paid within 30 days and only with a receipt per line.
Claims = claim?lines:{1..50} -> Collecting(lines, 0, 0)
Collecting(lines, got, age) =
     got < lines & receipt -> Collecting(lines, got + 1, age)
  [] got == lines and age <= 30 & reimburse!lines!got -> Paid(lines, got, age)
  [] tock -> Collecting(lines, got, age + 1)
Paid(lines, got, age) = tock -> Paid(lines, got, age)

System =
  Submission(R1, 0)
  ||| (Block(40, 0, 0) [| {| tock |} |] Speaker(40, 0) [| {| tock |} |] Claims)

assert Decided :[always a != b]
assert Paid :[always got == lines and age <= 30]
`,
};
