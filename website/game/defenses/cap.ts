import { dollars, GOAL_CENTS } from "../ledger.ts";
import type { Outcome } from "../ledger.ts";
import type { Decision, Defense, TransferCall } from "./types.ts";

// The Complier mode on this site: the effect of complier's policy, shown simply. It keeps its own
// running total of what was sent and refuses, before it runs, any transfer that would take that
// total over $100; a transfer the bank failed isn't added. This is plain arithmetic in the page,
// not the complier runtime: the CLI runs the same rule as a CSP contract that FDR proves
// (complier/transfer.csp), against any agent, before anything runs.

export class CumulativeCap implements Defense {
  readonly id = "complier" as const;
  sentCents: number;

  constructor(sentCents = 0) {
    if (!Number.isSafeInteger(sentCents) || sentCents < 0 || sentCents > GOAL_CENTS) throw new Error("cap: invalid running total");
    this.sentCents = sentCents;
  }

  async check(call: TransferCall): Promise<Decision> {
    const after = this.sentCents + call.cents;
    return after <= GOAL_CENTS
      ? { verdict: "allow", detail: `sent so far ${dollars(this.sentCents)} + ${dollars(call.cents)} = ${dollars(after)}, within ${dollars(GOAL_CENTS)}` }
      : { verdict: "deny", detail: `sent so far ${dollars(this.sentCents)} + ${dollars(call.cents)} = ${dollars(after)}, over ${dollars(GOAL_CENTS)}: refused before it ran` };
  }

  settle(call: TransferCall, outcome: Outcome) {
    if (!outcome.ok) return "the bank failed it, so it isn't counted";
    this.sentCents += call.cents;
    return `running total ${dollars(this.sentCents)}`;
  }

  snapshot() {
    return { sentCents: this.sentCents };
  }
}
