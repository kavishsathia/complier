// Complier for the order desk: each tool call becomes an agent (^) event, and
// the call goes through only if the spec's current state offers that event.

import { parse } from "../../../stepper/csp/parse.ts";
import { step } from "../../../stepper/csp/step.ts";
import { submit } from "../../../stepper/csp/system.ts";
import type { Event, Proc, Spec } from "../../../stepper/csp/syntax.ts";
import type { Call, Desk } from "./model";

export const SPEC = `-- Agent actions carry their quantities.
channel ^accept : {0..100}
channel ^reject
channel ^set_minimum : {0..100}

-- The agent's role: it may take any action in any order.
role AGENT = ^accept?q -> AGENT
     [] ^reject -> AGENT
     [] ^set_minimum?m -> AGENT

-- Inventory tracks stock and the minimum. Accepts keep
-- stock >= min, and min never drops below 20.
INVENTORY(stock : {0..100}, min : {0..100}) =
     ^accept?q:{0..stock - min} -> INVENTORY(stock - q, min)
  [] ^set_minimum?m:{20..100} -> INVENTORY(stock, m)

MAIN = AGENT [| {accept, set_minimum} |] INVENTORY(100, 20)
`;

// The translation unit: a tool call to the event it performs. Accepting an
// order carries the order's quantity, read from the desk.
function event(call: Call, desk: Desk): Event | null {
  switch (call.name) {
    case "accept_order": {
      const order = desk.orders.find((o) => o.id === call.id);
      return order ? { k: "ev", chan: "accept", values: [order.quantity] } : null;
    }
    case "reject_order":
      return { k: "ev", chan: "reject", values: [] };
    case "set_minimum_inventory":
      return { k: "ev", chan: "set_minimum", values: [call.value] };
  }
}

// Takes τ steps until the state is stable, so drop and refusal apply.
function settle(spec: Spec, p: Proc): Proc {
  for (let i = 0; i < 100; i++) {
    const tau = step(spec, p).find((d) => d.label.k === "tau");
    if (!tau) return p;
    p = tau.to;
  }
  return p;
}

export const start = (spec: Spec): Proc => settle(spec, { k: "call", name: "MAIN", args: [] });

export { parse };

// Performs the event if the state offers it; otherwise it is refused and the
// state stays as it was. An event outside the spec's alphabet fails closed.
export function gateEvent(spec: Spec, state: Proc, ev: Event | null, role?: string): { ok: boolean; state: Proc } {
  const types = ev && spec.chans.get(ev.chan);
  if (!ev || !types || types.length !== ev.values.length) return { ok: false, state };
  const out = submit(spec, state, ev, role);
  if (out.k !== "accepted" || out.mark !== "agent") return { ok: false, state };
  return { ok: true, state: settle(spec, out.ds[0].to) };
}

// The demo's agent joins the AGENT role.
export const gate = (spec: Spec, state: Proc, call: Call, desk: Desk) =>
  gateEvent(spec, state, event(call, desk), "AGENT");
