import { UseCase } from "./types";

export const apMatching: UseCase = {
  slug: "ap-matching",
  title: "Accounts payable three-way matching",
  summary:
    "The dot pulls vendor invoices from a shared AP inbox, matches each to its purchase order and goods receipt in the ERP, and chases missing receipts from the requesting department.",
  constraints: [
    {
      text: "The invoice must match the PO within ±2% or $50, whichever is lower.",
      how: "enforced",
      detail: "match is only offered when the goods receipt is in and the amount is within both 2% and $50 of the PO, which is the lower of the two.",
    },
    {
      text: "Duplicates are detected by vendor + invoice number + amount.",
      how: "enforced",
      detail: "Each invoice id stands for one vendor, number and amount. If it arrives again after it is closed, the only thing allowed is flag_duplicate. The proof shows no invoice is ever queued for payment twice.",
    },
    {
      text: "Every invoice gets processed within 2 business days of arrival.",
      how: "deadline",
      detail: "One tock is a business day. After two, the invoice goes Overdue and the only allowed action on it is escalate.",
    },
    {
      text: "Invoices with 2/10 net 30 terms get flagged by day 8.",
      how: "not-encoded",
      detail: "It needs a second clock per invoice. It would follow the same pattern as the 2-day deadline; it is left out to keep the example small.",
    },
    {
      text: "The dot never releases a payment itself; it only queues it for approval.",
      how: "enforced",
      detail: "release is only possible after a human approve. The proof shows releases never exceed approvals.",
    },
  ],
  source: `-- Accounts payable three-way matching. One tock is one business day.
-- Two invoice ids stand in for the inbox; each id is one vendor,
-- invoice number and amount.

datatype Inv = INV1 | INV2
channel arrive : Inv.Int.Int        -- invoice, amount, PO amount (dollars)
channel receipt : Inv               -- the goods receipt shows up in the ERP
channel chase : Inv                 -- ask the requesting department for it
channel match, reject, flag_duplicate, escalate : Inv
channel queue_payment : Inv.Int
channel approve, release : Inv      -- a person approves, then the bank releases
channel tock

New(i) = arrive!i?amt:{1..1000000}?po:{1..1000000} -> Open(i, amt, po, 0, 0)
      [] tock -> New(i)

-- Matching needs the receipt and an amount within 2% and within $50 of the PO.
Open(i, amt, po, rcv, age) =
     rcv == 0 & receipt!i -> Open(i, amt, po, 1, age)
  [] rcv == 0 & chase!i -> Open(i, amt, po, rcv, age)
  [] rcv == 1 and 50 * (amt - po) <= po and 50 * (po - amt) <= po
       and amt - po <= 50 and po - amt <= 50
     & match!i -> Matched(i, amt)
  [] reject!i -> Closed(i)
  [] age < 2 & tock -> Open(i, amt, po, rcv, age + 1)
  [] age >= 2 & tock -> Overdue(i, amt, po, rcv)

Overdue(i, amt, po, rcv) =
     escalate!i -> Open(i, amt, po, rcv, 0)
  [] tock -> Overdue(i, amt, po, rcv)

-- The dot only queues a payment; release needs a person's approval.
Matched(i, amt) = queue_payment!i!amt -> Queued(i)  [] tock -> Matched(i, amt)
Queued(i) = approve!i -> Approved(i)  [] tock -> Queued(i)
Approved(i) = release!i -> Closed(i)  [] tock -> Approved(i)

-- The same invoice arriving again can only be flagged.
Closed(i) = arrive!i?amt:{1..1000000}?po:{1..1000000} -> Duplicate(i)
         [] tock -> Closed(i)
Duplicate(i) = flag_duplicate!i -> Closed(i)  [] tock -> Duplicate(i)

-- Counts payments queued per invoice, approvals and releases.
Ledger(q1, q2, approved, released) =
     queue_payment?i?amt -> Ledger(q1 + (if i == INV1 then 1 else 0),
                                   q2 + (if i == INV2 then 1 else 0), approved, released)
  [] approve?i -> Ledger(q1, q2, approved + 1, released)
  [] release?i -> Ledger(q1, q2, approved, released + 1)

System =
  (New(INV1) [| {| tock |} |] New(INV2))
    [| {| queue_payment, approve, release |} |]
  Ledger(0, 0, 0, 0)

assert Ledger :[always q1 <= 1 and q2 <= 1]
assert Ledger :[always released <= approved]
assert Open :[always age <= 2]
`,
};
