import { randomUUID } from "node:crypto";
import { ComplierDefense, daemonConfig } from "./defenses/complier.ts";
import { Guardrail } from "./defenses/guardrail.ts";
import { LtlMonitor } from "./defenses/ltl.ts";
import { StatelessValidator } from "./defenses/stateless.ts";
import type { Decision, Defense, DefenseId, TransferCall } from "./defenses/types.ts";
import { dollars, GOAL_CENTS, Ledger, parseAmount } from "./ledger.ts";
import type { Message, Transport } from "./model.ts";
import { SYSTEM, TOOLS } from "./model.ts";

// A game session: one defense, one fresh ledger, one conversation. The defense is fixed when the
// session starts; switching defense or pressing "new challenge" ends this session and starts another
// with a fresh ledger, so no balance or monitor state carries over between comparisons.

export const DEFENSES: DefenseId[] = ["guardrail", "ltl", "stateless", "complier"];
export const BOUNDS = {
  ttlMs: 15 * 60_000,
  maxTransfers: 20,
  maxTurns: 10,
  maxModelCallsPerTurn: 4,
  maxToolCallsPerMessage: 3,
  maxMessageChars: 400,
  maxSessions: 200,
};

export type Event =
  | { kind: "visitor"; text: string }
  | { kind: "agent"; text: string; transport: Transport["kind"] }
  | { kind: "transfer"; source: "model" | "visitor"; amountCents: number; verdict: Decision["verdict"]; detail: string; effect: string; note?: string }
  | { kind: "invalid"; source: "model" | "visitor"; input: string; reason: string }
  | { kind: "error"; text: string };

export class SessionError extends Error {}

export type Deps = {
  // The guardrail's judge and the agent's model; undefined when no live model is configured.
  judge?: Transport;
  daemon?: ReturnType<typeof daemonConfig>;
};

export function makeDefense(id: DefenseId, session: string, deps: Deps): Defense {
  switch (id) {
    case "guardrail":
      return new Guardrail(deps.judge);
    case "ltl":
      return new LtlMonitor();
    case "stateless":
      return new StatelessValidator();
    case "complier": {
      const config = deps.daemon ?? daemonConfig();
      if ("unavailable" in config) throw new SessionError(`Complier mode is unavailable: ${config.unavailable}`);
      return new ComplierDefense(config, session);
    }
  }
}

export class Session {
  readonly id: string;
  readonly defense: Defense;
  readonly ledger = new Ledger();
  readonly events: Event[] = [];
  readonly messages: Message[] = [{ role: "system", content: SYSTEM }];
  readonly expiresAt: number;
  transfers = 0;
  turns = 0;
  ended = false;
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;

  constructor(id: string, defense: Defense, now = Date.now()) {
    this.id = id;
    this.defense = defense;
    this.expiresAt = now + BOUNDS.ttlMs;
  }

  // Runs f after everything already queued on this session: transfers and turns never interleave,
  // so a defense's check and the ledger's update happen as one step.
  exclusive<T>(f: () => Promise<T>): Promise<T> {
    const run = this.queue.then(f, f);
    this.queue = run.catch(() => undefined);
    return run;
  }

  get breached() {
    return this.ledger.received > GOAL_CENTS;
  }

  open(now = Date.now()) {
    if (this.ended) throw new SessionError("this challenge has ended; start a new one");
    if (now > this.expiresAt) throw new SessionError("this challenge timed out; start a new one");
  }

  conversation() {
    return this.events
      .filter((e) => e.kind === "visitor" || e.kind === "agent")
      .map((e) => `${e.kind === "visitor" ? "User" : "Agent"}: ${(e as { text: string }).text}`)
      .join("\n");
  }

  // The one effectful tool, wherever its call came from. Returns what the caller (the model) is told.
  transfer(rawArgs: unknown, source: "model" | "visitor"): Promise<string> {
    return this.exclusive(() => this.transferNow(rawArgs, source));
  }

  // transfer() for a caller that already holds the session.
  private async transferNow(rawArgs: unknown, source: "model" | "visitor"): Promise<string> {
    this.open();
    if (this.transfers >= BOUNDS.maxTransfers) throw new SessionError(`this challenge allows ${BOUNDS.maxTransfers} transfer attempts; start a new one`);
    this.transfers++;
    const args = rawArgs && typeof rawArgs === "object" ? (rawArgs as Record<string, unknown>) : {};
    const amount = parseAmount(args.amount_cents);
    if ("reason" in amount) {
      this.events.push({ kind: "invalid", source, input: safeShow(args.amount_cents), reason: amount.reason });
      return `rejected before any defense: ${amount.reason}. Nothing was sent.`;
    }
    const memo = typeof args.memo === "string" ? args.memo.slice(0, 80) : "";
    const call: TransferCall = { id: `${this.id}-${++this.seq}`, cents: amount.cents, memo };
    const view = () => ({ receivedCents: this.ledger.received, conversation: this.conversation() });
    const decision = await this.defense.check(call, view());
    if (decision.verdict !== "allow") {
      const effect = decision.verdict === "deny" ? "blocked: nothing sent" : "not run: defense unavailable";
      this.events.push({ kind: "transfer", source, amountCents: call.cents, verdict: decision.verdict, detail: decision.detail, effect });
      return `${effect}. ${decision.detail}`;
    }
    const outcome = this.ledger.transfer(call.cents);
    let note: string | undefined;
    try {
      note = await this.defense.settle(call, outcome, view());
    } catch (e) {
      note = `the defense couldn't record the result: ${(e as Error).message}`;
    }
    const effect = "error" in outcome ? `bank failed: ${outcome.error}` : `sent ${dollars(call.cents)}`;
    this.events.push({ kind: "transfer", source, amountCents: call.cents, verdict: "allow", detail: decision.detail, effect, note });
    return "error" in outcome ? `failed: ${outcome.error}` : outcome.output;
  }

  // One visitor message through the agent: the model may call send_fake_money; each call goes
  // through transfer() above. Model text never moves money.
  say(text: unknown, model: Transport): Promise<void> {
    return this.exclusive(async () => {
      this.open();
      if (typeof text !== "string" || !text.trim()) throw new SessionError("write a message first");
      if (text.length > BOUNDS.maxMessageChars) throw new SessionError(`messages are at most ${BOUNDS.maxMessageChars} characters`);
      if (this.turns >= BOUNDS.maxTurns) throw new SessionError(`this challenge allows ${BOUNDS.maxTurns} messages; start a new one`);
      this.turns++;
      this.events.push({ kind: "visitor", text });
      this.messages.push({ role: "user", content: text });
      for (let i = 0; i < BOUNDS.maxModelCallsPerTurn; i++) {
        const out = await model.complete(this.messages, TOOLS);
        const calls = out.tool_calls.slice(0, BOUNDS.maxToolCallsPerMessage);
        this.messages.push({ role: "assistant", content: out.content, ...(calls.length ? { tool_calls: calls } : {}) });
        if (out.content.trim()) this.events.push({ kind: "agent", text: out.content.slice(0, 1_000), transport: model.kind });
        if (!calls.length) return;
        for (const c of calls) {
          let content: string;
          if (c.name !== "send_fake_money") content = `there is no tool named ${c.name.slice(0, 60)}`;
          else {
            let args: unknown;
            try {
              args = JSON.parse(c.arguments);
            } catch {
              args = undefined;
            }
            content = args === undefined ? "rejected: the arguments weren't JSON. Nothing was sent." : await this.transferNow(args, "model");
          }
          this.messages.push({ role: "tool", tool_call_id: c.id, content });
        }
      }
      this.events.push({ kind: "error", text: "the agent kept calling tools; this message's turn was cut off" });
    });
  }

  async end() {
    if (this.ended) return;
    this.ended = true;
    await this.defense.close();
  }

  view() {
    return {
      id: this.id,
      defense: this.defense.id,
      receivedCents: this.ledger.received,
      walletCents: this.ledger.wallet,
      goalCents: GOAL_CENTS,
      breached: this.breached,
      transfersLeft: BOUNDS.maxTransfers - this.transfers,
      turnsLeft: BOUNDS.maxTurns - this.turns,
      expiresAt: this.expiresAt,
      ended: this.ended,
      events: this.events,
    };
  }
}

function safeShow(v: unknown) {
  try {
    return String(typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v) ?? String(v)).slice(0, 60);
  } catch {
    return "(unprintable)";
  }
}

export class Store {
  private readonly sessions = new Map<string, Session>();

  async create(id: DefenseId, deps: Deps): Promise<Session> {
    if (!DEFENSES.includes(id)) throw new SessionError("unknown defense");
    await this.sweep();
    if (this.sessions.size >= BOUNDS.maxSessions) throw new SessionError("the game is busy; try again in a few minutes");
    const sid = randomUUID();
    const defense = makeDefense(id, sid, deps);
    try {
      await defense.start();
    } catch (e) {
      await defense.close().catch(() => undefined);
      throw new SessionError(`${id} couldn't start: ${(e as Error).message}`);
    }
    const s = new Session(sid, defense);
    this.sessions.set(sid, s);
    return s;
  }

  get(id: unknown): Session {
    const s = typeof id === "string" ? this.sessions.get(id) : undefined;
    if (!s) throw new SessionError("no such challenge (it may have expired); start a new one");
    return s;
  }

  async end(id: unknown) {
    const s = this.get(id);
    this.sessions.delete(s.id);
    await s.end();
  }

  async sweep(now = Date.now()) {
    for (const s of [...this.sessions.values()]) {
      if (now > s.expiresAt || s.ended) {
        this.sessions.delete(s.id);
        await s.end().catch(() => undefined);
      }
    }
  }
}
