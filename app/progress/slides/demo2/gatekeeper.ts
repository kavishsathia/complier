// Complier for two agents on one desk. The spec constrains the desk, not the
// agents, so it holds however many agents act on it.

import type { Event } from "../../../stepper/csp/syntax.ts";
import type { Call, Desk } from "./model";

export const SPEC = `-- Events carry the order id; accepts carry quantity.
channel ^accept : {1..5}.{0..100}
channel ^reject : {1..5}

-- Each order is decided exactly once.
ORDER(o : {1..5}) =
  accept.o?q -> SKIP [] reject.o -> SKIP
ORDERS = ORDER(1) ||| ORDER(2) ||| ORDER(3)
     ||| ORDER(4) ||| ORDER(5)

-- One shared stock: accepts keep it >= 20.
INVENTORY(stock : {0..100}) =
  accept?o?q:{0..stock - 20} -> INVENTORY(stock - q)

MAIN = INVENTORY(100) [| {accept} |] ORDERS
`;

// The translation unit: accepting carries the order's quantity from the desk.
export function event(call: Call, desk: Desk): Event | null {
  const order = desk.orders.find((o) => o.id === call.id);
  if (!order) return null;
  return call.name === "accept_order"
    ? { k: "ev", chan: "accept", values: [order.id, order.quantity] }
    : { k: "ev", chan: "reject", values: [order.id] };
}
