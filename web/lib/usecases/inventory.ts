import { UseCase } from "./types";

export const inventory: UseCase = {
  slug: "inventory",
  title: "Inventory management for a small e-commerce brand",
  summary:
    "The dot handles reorders across about 150 SKUs and 4 suppliers.",
  constraints: [
    {
      text: "It reorders when stock falls to demand-during-lead-time plus safety stock.",
      how: "enforced",
      detail: "With demand of at most 5 a day, a 3 day lead time and 5 of safety stock, the reorder point is 20. The day cannot be closed while stock is at or under 20 with nothing on order.",
    },
    {
      text: "The top 20 SKUs never stock out.",
      how: "enforced",
      detail: "This is a fact about the world, so it is proven under stated assumptions: demand of at most 5 a day and deliveries within the quoted 3 days. Under those, the proof shows stock never goes below zero. A late delivery breaks the assumption, which is what the slip flag is for.",
    },
    {
      text: "POs over a set dollar amount need owner approval.",
      how: "enforced",
      detail: "With a 2000 limit, a reorder over it waits for owner_approve. The proof shows large POs never exceed approvals.",
    },
    {
      text: "Actual supplier lead times are tracked against quoted ones, and suppliers slipping more than 20% get flagged.",
      how: "enforced",
      detail: "For the second supplier, nothing is assumed about delivery. Once an order is more than 20% past its quoted 5 days (6 or more), the day cannot close until flag_slip.",
    },
  ],
  source: `-- Inventory for one top-20 SKU and one supplier we track for slips.
-- One close_day is the dot's end-of-day run. Demand: at most 5 a day.
-- Assumed for the top SKU: deliveries arrive within the quoted 3 days.

channel sell : Int                 -- units sold (the world decides)
channel reorder : Int              -- a PO goes out, value in dollars
channel request_approval : Int     -- a PO over the limit goes to the owner first
channel owner_approve
channel deliver                    -- 50 units arrive
channel close_day
channel order2, deliver2, flag_slip

-- s: stock, o: 1 when an order is out, age: days it has been out,
-- sold: units sold today. Reorder point 20.
Stock(s, o, age, sold) =
     sell?q:{0..5 - sold} -> Stock(s - q, o, age, sold + q)
  [] s <= 20 and o == 0 & reorder?v:{1..2000} -> Stock(s, 1, 0, sold)
  [] s <= 20 and o == 0 & request_approval?v:{2001..100000} -> Approval(s, sold, v)
  [] o == 1 & deliver -> Stock(s + 50, 0, 0, sold)
  [] (s > 20 or o == 1) and (o == 0 or age < 3) & close_day -> Stock(s, o, age + o, 0)
Approval(s, sold, v) =
     owner_approve -> Placing(s, sold, v)
  [] sell?q:{0..5 - sold} -> Approval(s - q, sold + q, v)
Placing(s, sold, v) =
     reorder!v -> Stock(s, 1, 0, sold)
  [] sell?q:{0..5 - sold} -> Placing(s - q, sold + q, v)

-- The second supplier quotes 5 days; 6 or more is a slip over 20%.
Supplier(o, age, flagged) =
     o == 0 & order2 -> Supplier(1, 0, 0)
  [] o == 1 & deliver2 -> Supplier(0, 0, 0)
  [] o == 1 and age >= 6 and flagged == 0 & flag_slip -> Supplier(o, age, 1)
  [] o == 0 or age < 6 or flagged == 1 & close_day -> Supplier(o, age + o, flagged)

POs(big, approvals) =
     reorder?v -> POs(big + (if v > 2000 then 1 else 0), approvals)
  [] owner_approve -> POs(big, approvals + 1)

System =
  (Stock(40, 0, 0, 0) [| {| close_day |} |] Supplier(0, 0, 0))
    [| {| reorder, owner_approve |} |]
  POs(0, 0)

assert Stock :[always s >= 0]
assert POs :[always big <= approvals]
`,
};
