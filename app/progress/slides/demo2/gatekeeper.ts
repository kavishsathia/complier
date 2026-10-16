// Complier for two agents on one desk. The spec constrains the desk, not the
// agents, so it holds however many agents act on it.

import type { Event } from "../../../stepper/csp/syntax.ts";

export const SPEC = `channel ^next, ^send, ^reject

-- Two roles, one agent each. Each reads the next order,
-- then sends or rejects it.
role A = ^next -> (^send -> A [] ^reject -> A)
role B = ^next -> (^send -> B [] ^reject -> B)

-- The lock both roles synchronise on: after a read, no
-- other read until that order is sent or rejected.
LOCK = ^next -> (^send -> LOCK [] ^reject -> LOCK)

MAIN = (A ||| B) [| {next, send, reject} |] LOCK
`;

// The translation unit: each tool call becomes an event, performed by the
// role the calling agent joined.
const CHANNEL: Record<string, string> = { next_order: "next", send_to_recipient: "send", reject_order: "reject" };

export const event = (tool: string): Event | null => (CHANNEL[tool] ? { k: "ev", chan: CHANNEL[tool], values: [] } : null);
