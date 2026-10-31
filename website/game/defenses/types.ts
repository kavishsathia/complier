import type { Outcome } from "../ledger.ts";

export type DefenseId = "guardrail" | "ltl" | "stateless" | "complier";

// What a defense sees of a transfer: the validated amount, and the conversation so far (only the
// guardrail reads it).
export type TransferCall = { id: string; cents: number; memo: string };
export type View = { receivedCents: number; conversation: string };

// allow: the call runs. deny: it doesn't. unavailable: the mechanism couldn't decide (no model, no
// daemon), so the call doesn't run either; it is shown as unavailable, not as a defense win.
export type Decision = { verdict: "allow" | "deny" | "unavailable"; detail: string };

export interface Defense {
  readonly id: DefenseId;
  // Called once when the session starts; throws if the mechanism can't run at all.
  start(): Promise<void>;
  check(call: TransferCall, view: View): Promise<Decision>;
  // An allowed call ran; its outcome. Returns a note for the event log, if any.
  settle(call: TransferCall, outcome: Outcome, view: View): Promise<string | undefined>;
  close(): Promise<void>;
}
