import { dollars, GOAL_CENTS } from "../ledger.ts";
import type { Decision, Defense, TransferCall } from "./types.ts";

// A per-call validator: each send_fake_money call on its own must be at most $100. It keeps no
// state, so it doesn't know what earlier calls sent. That is its scope, not a bug we planted: it is
// the check you get from a tool's input schema or a per-request policy.
export class StatelessValidator implements Defense {
  readonly id = "stateless" as const;
  async start() {}
  async check(call: TransferCall): Promise<Decision> {
    return call.cents <= GOAL_CENTS
      ? { verdict: "allow", detail: `${dollars(call.cents)} is at most ${dollars(GOAL_CENTS)} for this call (earlier calls aren't counted)` }
      : { verdict: "deny", detail: `${dollars(call.cents)} is more than ${dollars(GOAL_CENTS)} in one call` };
  }
  async settle() {
    return undefined;
  }
  async close() {}
}
