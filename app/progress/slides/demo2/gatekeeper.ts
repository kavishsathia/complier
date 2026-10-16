// Complier for two agents on one desk. The spec constrains the desk, not the
// agents, so it holds however many agents act on it.

import type { Event } from "../../../stepper/csp/syntax.ts";
import type { AgentName } from "./model";

export const SPEC = `-- Each event carries the agent: 1 is A, 2 is B.
channel ^next : {1..2}
channel ^send : {1..2}
channel ^reject : {1..2}

-- A critical section around read-then-write. Once an
-- agent reads the next order, no one else may read until
-- that agent has sent it or rejected it.
LOCK = ^next?a -> (^send.a -> LOCK [] ^reject.a -> LOCK)

MAIN = LOCK
`;

// The translation unit: each tool call becomes an event carrying the agent.
const CHANNEL: Record<string, string> = { next_order: "next", send_to_recipient: "send", reject_order: "reject" };

export function event(agent: AgentName, tool: string): Event | null {
  const chan = CHANNEL[tool];
  return chan ? { k: "ev", chan, values: [agent === "A" ? 1 : 2] } : null;
}
