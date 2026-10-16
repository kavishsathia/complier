// Complier for two agents on one desk. The spec constrains the desk, not the
// agents, so it holds however many agents act on it.

import type { Event } from "../../../stepper/csp/syntax.ts";
import { recipient, type Desk } from "./model";

export const SPEC = `-- A shipment carries the order id and the quantity sent.
channel ^ship : {1..5}.{0..100}
channel ^reject : {1..5}

-- Each order ships once, in exactly its quantity,
-- or is rejected.
ORDER(o : {1..5}, q : {0..100}) =
  ^ship.o.q -> SKIP [] ^reject.o -> SKIP
ORDERS = ORDER(1, 15) ||| ORDER(2, 25) ||| ORDER(3, 15)
     ||| ORDER(4, 10) ||| ORDER(5, 12)

-- One shared stock: shipments keep it >= 20.
INVENTORY(stock : {0..100}) =
  ^ship?o?q:{0..stock - 20} -> INVENTORY(stock - q)

MAIN = INVENTORY(100) [| {ship} |] ORDERS
`;

// The translation unit. next_order only reads, so it passes through with no
// event; the writes become events on the recipient's order.
export function event(desk: Desk, tool: string, name: string, quantity?: number): Event | null {
  const o = recipient(desk, name);
  if (!o) return null;
  if (tool === "send_to_recipient") return { k: "ev", chan: "ship", values: [o.id, quantity ?? 0] };
  return { k: "ev", chan: "reject", values: [o.id] };
}
