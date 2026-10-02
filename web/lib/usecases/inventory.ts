import { UseCase } from "./types";

export const inventory: UseCase = {
  slug: "inventory",
  title: "Inventory management for a small e-commerce brand",
  summary:
    "The dot handles reorders across about 150 SKUs and 4 suppliers. The encoding shows one top-20 SKU with one supplier. Each process is exactly one participant: the world (the shelf and the supplier), the owner, or the agent.",
  constraints: [
    {
      text: "It reorders when stock falls to demand-during-lead-time plus safety stock.",
      how: "enforced",
      detail: "With demand of at most 5 a day, a 3 day lead time and 5 of safety stock, the reorder point is 20. The agent keeps its own count of stock by watching sales and deliveries, and will not agree to close_day while its count is at or under 20 with nothing on order, or while a large PO is waiting on the owner.",
    },
    {
      text: "The top 20 SKUs never stock out.",
      how: "enforced",
      detail: "This is a fact about the world, so it is proven under the assumptions written into the world's processes: Shelf sells at most 5 a day and Supplier1 delivers within the quoted 3 days. Under those, the proof shows Shelf's real stock never goes below zero.",
    },
    {
      text: "POs over a set dollar amount need owner approval.",
      how: "enforced",
      detail: "With a 2000 limit, the agent sends a larger PO to the owner and can only place exactly the approved amount after owner_approve. This is enforced by the agent's process; there is no assertion for it in this encoding.",
    },
    {
      text: "Actual supplier lead times are tracked against quoted ones, and suppliers slipping more than 20% get flagged.",
      how: "not-encoded",
      detail: "This encoding assumes the supplier delivers on time, which is what the stock-out proof needs, so there is no slip to flag. Tracking slips needs a supplier without that assumption.",
    },
  ],
  source: `-- Inventory for one top-20 SKU with one supplier.
-- close_day is the end of the day. The agent must agree to it,
-- so it can hold the day open until its job is done.

channel sell : Int                 -- units sold
channel deliver                    -- 50 units arrive from the supplier
channel close_day
channel reorder : Int              -- a PO to the supplier, value in dollars
channel request_approval : Int     -- a PO over 2000 goes to the owner first
channel owner_approve

-- The world --------------------------------------------------------------

-- Customers buy at most 5 a day. s is the real stock on the shelf.
Shelf(s, sold) =
     sell?q:{0..5 - sold} -> Shelf(s - q, sold + q)
  [] deliver -> Shelf(s + 50, sold)
  [] close_day -> Shelf(s, 0)

-- The supplier delivers within its quoted 3 days (assumed).
Supplier1(o, age) =
     reorder?v -> Supplier1(1, 0)
  [] o == 1 & deliver -> Supplier1(0, 0)
  [] o == 0 or age < 3 & close_day -> Supplier1(o, age + o)

-- The owner ---------------------------------------------------------------

Owner = request_approval?v -> Deciding(v)
Deciding(v) = owner_approve -> Owner

-- The agent ---------------------------------------------------------------
-- It sees sales and deliveries, never blocks them, and keeps its own
-- count of the stock. Reorder point 20.

Agent(s, o) =
     sell?q -> Agent(s - q, o)
  [] deliver -> Agent(s + 50, 0)
  [] s <= 20 and o == 0 & reorder?v:{1..2000} -> Agent(s, 1)
  [] s <= 20 and o == 0 & request_approval?v:{2001..100000} -> Waiting(s, v)
  [] s > 20 or o == 1 & close_day -> Agent(s, o)

-- Waiting for the owner to approve a big PO. The day cannot close here.
Waiting(s, v) =
     sell?q -> Waiting(s - q, v)
  [] owner_approve -> Placing(s, v)

-- Approved: send exactly the approved PO. The day cannot close here.
Placing(s, v) =
     sell?q -> Placing(s - q, v)
  [] reorder!v -> Agent(s, 1)

System =
  (Shelf(40, 0) [| {| deliver, close_day |} |] Supplier1(0, 0))
    [| {| sell, deliver, reorder, close_day |} |]
  (Agent(40, 0) [| {| request_approval, owner_approve |} |] Owner)

assert Shelf :[always s >= 0]
`,
};
