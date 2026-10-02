import { UseCase } from "./types";

export const renovation: UseCase = {
  slug: "renovation",
  title: "Home renovation (kitchen and bathroom)",
  summary:
    "The dot coordinates bids, permits, inspections, and change orders.",
  constraints: [
    {
      text: "There are at least 3 bids per trade.",
      how: "enforced",
      detail: "award is only offered for a trade with 3 or more bids in.",
    },
    {
      text: "Permits are issued before any covered work starts.",
      how: "enforced",
      detail: "start_work is only offered once the city has issued the permit. The proof shows no work starts unpermitted.",
    },
    {
      text: "Every change order is written down with its cost and schedule impact before approval.",
      how: "enforced",
      detail: "write_co carries the cost and the days of delay; approve_co is only offered for a written one. The proof shows approvals never exceed written orders.",
    },
    {
      text: "10% retainage is held until the punch list closes.",
      how: "enforced",
      detail: "Progress payments are capped at 90% of the contract until punch_closed. The proof shows payments stay at or under 90% while the punch list is open.",
    },
    {
      text: "Spend stays within budget plus a 10 to 15% contingency.",
      how: "enforced",
      detail: "With a budget of 100000 and 15% contingency, awards plus approved change orders stay within 115000.",
    },
  ],
  source: `-- Kitchen and bathroom renovation. Budget 100000 plus 15%: 115000.
-- One trade (plumbing) needs a permit; amounts are in dollars.

channel bid : Int                     -- a contractor's bid
channel award : Int                   -- contract price, in tens of dollars
channel permit_issued, start_work, punch_closed
channel pay : Int                     -- a progress payment
channel release_retainage
channel write_co : Int.Int            -- cost, days of delay
channel approve_co, reject_co : Int

-- Three bids before an award, within what the budget has left.
Bidding(n, low) = bid?amt:{1..1000000} -> Bidding(n + 1, if n == 0 or amt < low then amt else low)
               [] n >= 3 & award?c:{1..11500} -> Contracted(c, 0, 0)
-- c is the contract in tens of dollars, so 90% of it is 9 * c dollars.
Contracted(c, permit, started) =
     permit == 0 & permit_issued -> Contracted(c, 1, started)
  [] permit == 1 and started == 0 & start_work -> Contracted(c, permit, 1)
  [] started == 1 & punch_closed -> Closing(c)
Closing(c) = release_retainage -> Finished(c)
Finished(c) = STOP

-- Payments stay at or below 90% of the contract until the punch list closes.
Payments(c10, paid, open) =
     award?c -> Payments(c, 0, 1)
  [] open == 1 & pay?amt:{1..9 * c10 - paid} -> Payments(c10, paid + amt, open)
  [] punch_closed -> Payments(c10, paid, 0)

-- Change orders: written with cost and delay, then approved within the contingency.
Changes(spent, written, approved) =
     award?c -> Changes(10 * c, written, approved)
  [] write_co?cost:{1..115000 - spent}?days:{0..365} -> Pending(spent, cost, written + 1, approved)
Pending(spent, cost, written, approved) =
     approve_co!cost -> Changes(spent + cost, written, approved + 1)
  [] reject_co!cost -> Changes(spent, written, approved)

System =
  Bidding(0, 0)
    [| {| award, punch_closed |} |]
  (Payments(0, 0, 0) [| {| award |} |] Changes(0, 0, 0))

assert Payments :[always open == 0 or paid <= 9 * c10]
assert Changes :[always approved <= written and spent <= 115000]
assert Contracted :[always started == 0 or permit == 1]
`,
};
