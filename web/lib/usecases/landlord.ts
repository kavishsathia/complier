import { UseCase } from "./types";

export const landlord: UseCase = {
  slug: "landlord",
  title: "Small landlord, 6 rental units",
  summary:
    "The dot covers rent reconciliation, maintenance requests, renewals, and turnovers.",
  constraints: [
    {
      text: "The rent ledger reconciles to the bank statement monthly with $0 unexplained variance.",
      how: "enforced",
      detail: "Rent recorded in the ledger and deposits from the bank feed are summed separately, and close_month is only offered when they are equal. The proof shows every closed month had zero variance.",
    },
    {
      text: "Emergency requests (no heat, active leak) are escalated to the owner within 1 hour.",
      how: "deadline",
      detail: "One tock is 15 minutes. An emergency request must reach escalate_owner within 4 tocks, or it is Overdue and escalating is the only action.",
    },
    {
      text: "Renewal notices go out by the lease or local legal deadline, commonly 60 to 90 days.",
      how: "deadline",
      detail: "With a 60 day deadline, send_notice is offered while at least 5760 tocks remain before the lease ends; after that the only action is alert_owner.",
    },
    {
      text: "Itemized security deposit returns are sent within the state's statutory window.",
      how: "deadline",
      detail: "With a 21 day window (2016 tocks), the return must list at least one item and its deductions cannot exceed the deposit. Past the window the only action is alert_owner.",
    },
  ],
  source: `-- Small landlord. One tock is 15 minutes.
-- Two units stand in for six.

datatype Unit = U1 | U2
channel record_rent : Unit.Int      -- rent entered in the ledger
channel bank_deposit : Int          -- money seen on the bank statement
channel close_month : Int           -- closes with the variance it found
channel request : Unit.Int          -- a maintenance request, 1 if an emergency
channel escalate_owner, handle : Unit
channel send_notice, alert_owner : Unit
channel move_out : Unit.Int         -- tenant leaves, deposit held
channel return_deposit : Unit.Int.Int  -- deposit refunded, deductions, items listed
channel tock

-- Close only when the ledger and the bank agree to the dollar.
Books(ledger, bank) =
     record_rent?u?amt:{1..10000} -> Books(ledger + amt, bank)
  [] bank_deposit?amt:{1..100000} -> Books(ledger, bank + amt)
  [] ledger == bank & close_month!(ledger - bank) -> Books(0, 0)

-- Emergencies reach the owner within 4 tocks.
Calm(u) = request!u?em:{0..1} -> Open(u, em, 0)  [] tock -> Calm(u)
Open(u, em, t) =
     em == 1 & escalate_owner!u -> Fixing(u)
  [] em == 0 & handle!u -> Calm(u)
  [] em == 0 or t < 4 & tock -> Open(u, em, t + em)
  [] em == 1 and t >= 4 & tock -> Overdue(u)
Overdue(u) = escalate_owner!u -> Fixing(u)  [] tock -> Overdue(u)
Fixing(u) = handle!u -> Calm(u)  [] tock -> Fixing(u)

-- The renewal notice goes out at least 60 days (5760 tocks) before the lease ends.
Lease(u, t) =
     t >= 5760 & send_notice!u -> Noticed(u, t)
  [] t > 0 & tock -> Lease(u, t - 1)
  [] t == 0 & tock -> Lease(u, 0)
  [] t < 5760 & alert_owner!u -> Lapsed(u)
Noticed(u, t) = tock -> Noticed(u, t)
Lapsed(u) = tock -> Lapsed(u)

-- The itemised deposit return goes out within 21 days (2016 tocks).
Tenant(u) = move_out!u?dep:{1..10000} -> Returning(u, dep, 0)  [] tock -> Tenant(u)
Returning(u, dep, t) =
     t <= 2016 & return_deposit!u?ded:{0..dep}?items:{1..30} -> Returned(u, dep, ded, t)
  [] t <= 2016 & tock -> Returning(u, dep, t + 1)
  [] t > 2016 & alert_owner!u -> Lapsed(u)
  [] t > 2016 & tock -> Returning(u, dep, t)
Returned(u, dep, ded, t) = tock -> Returned(u, dep, ded, t)

Closes(bad) = close_month?v -> Closes(bad + (if v == 0 then 0 else 1))

System =
  (Books(0, 0) [| {| close_month |} |] Closes(0))
  ||| (Calm(U1) [| {| tock |} |] Lease(U1, 8640) [| {| tock |} |] Tenant(U2))

assert Closes :[always bad == 0]
assert Open :[always t <= 4]
assert Noticed :[always t >= 5760]
assert Returned :[always t <= 2016 and ded <= dep]
`,
};
