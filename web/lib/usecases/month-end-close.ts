import { UseCase } from "./types";

export const monthEndClose: UseCase = {
  slug: "month-end-close",
  title: "Month-end close for a startup",
  summary:
    "The dot supports bank reconciliations, accruals, prepaid amortization, and deferred revenue schedules.",
  constraints: [
    {
      text: "The close finishes by business day 5.",
      how: "deadline",
      detail: "One tock is a business day. close is only offered on days 1 to 5; after that the only action is alert_controller. The proof shows every close happened by day 5.",
    },
    {
      text: "Every reconciliation shows no unexplained variance over $100.",
      how: "enforced",
      detail: "A reconciliation records book minus bank. Explanations reduce the unexplained part, and sign_off needs it within $100 either way. close needs every account signed off.",
    },
    {
      text: "Journal entries are drafted but never posted without controller approval.",
      how: "enforced",
      detail: "post is only offered for an entry the controller approved. The proof shows posts never exceed approvals.",
    },
    {
      text: "Revenue follows the ASC 606 schedule in the contract tracker.",
      how: "enforced",
      detail: "The tracker's schedule for this month is 12000, and recognize only offers exactly that amount, once. Building the schedule from the contract is outside the model.",
    },
  ],
  source: `-- Month-end close. One tock is one business day.
-- Two accounts stand in for the bank and card reconciliations.

datatype Acct = Bank | Card
channel reconcile : Acct.Int.Int     -- book balance, statement balance
channel explain : Acct.Int           -- an explained difference, in dollars
channel sign_off : Acct
channel draft_je, controller_approve, post : Int
channel recognize : Int              -- revenue recognised this month
channel close, alert_controller
channel tock

-- Sign off only when the unexplained variance is within $100.
Open(a) = reconcile!a?book:{-10000000..10000000}?stmt:{-10000000..10000000}
            -> Rec(a, book - stmt, 0)
Rec(a, v, x) =
     explain!a?amt:{-10000000..10000000} -> Rec(a, v, x + amt)
  [] v - x <= 100 and x - v <= 100 & sign_off!a -> Signed(a, v, x)
Signed(a, v, x) = close -> Signed(a, v, x)

-- Journal entries need the controller before they post.
Journal = draft_je?id:{1..1000} -> Drafted(id)
Drafted(id) = controller_approve!id -> Approved(id)
Approved(id) = post!id -> Journal

-- This month's ASC 606 amount from the contract tracker, recognised once.
Revenue(sched) = recognize!sched -> Recognised
Recognised = close -> Recognised

Calendar(day) =
     day <= 5 & close -> Closed(day)
  [] day <= 5 & tock -> Calendar(day + 1)
  [] day > 5 & alert_controller -> Late
Closed(day) = STOP
Late = STOP

Controls(approved, posted) =
     controller_approve?id -> Controls(approved + 1, posted)
  [] post?id -> Controls(approved, posted + 1)

System =
  ((Open(Bank) [| {| close |} |] Open(Card)) [| {| close |} |]
   Revenue(12000) [| {| close |} |] Calendar(1))
  ||| (Journal [| {| controller_approve, post |} |] Controls(0, 0))

assert Closed :[always day <= 5]
assert Signed :[always v - x <= 100 and x - v <= 100]
assert Controls :[always posted <= approved]
`,
};
