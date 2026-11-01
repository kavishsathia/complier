import { CumulativeCap } from "./defenses/cap.ts";
import { Guardrail } from "./defenses/guardrail.ts";
import { isFormula, LtlMonitor, variables, VARIABLES } from "./defenses/ltl.ts";
import { StatelessValidator } from "./defenses/stateless.ts";
import type { Decision, Defense, DefenseId, TransferCall } from "./defenses/types.ts";
import { dollars, GOAL_CENTS, Ledger, parseAmount } from "./ledger.ts";
import type { Completion, Message, ToolCall, Transport } from "./model.ts";
import { SYSTEM, TOOLS } from "./model.ts";

// A challenge: one defense, one ledger, one conversation, all in the visitor's browser. The defense
// is fixed when the challenge starts; switching defense or pressing "New challenge" starts another
// with a fresh ledger, so no balance or defense state carries over between comparisons. The whole
// challenge is plain JSON (save/restore), so the page keeps it in localStorage across reloads and
// checks it before trusting it again.

export const STATE_VERSION = 2;
export const DEFENSES: DefenseId[] = ["guardrail", "ltl", "stateless", "complier"];
export const BOUNDS = {
  maxTransfers: 20,
  maxTurns: 10,
  maxModelCallsPerTurn: 4,
  maxToolCallsPerMessage: 3,
  maxMessageChars: 400,
};

export type Event =
  | { kind: "visitor"; text: string }
  | { kind: "agent"; text: string; transport: Transport["kind"]; timing?: string }
  | { kind: "transfer"; source: "model" | "visitor"; amountCents: number; verdict: Decision["verdict"]; detail: string; effect: string; note?: string }
  | { kind: "invalid"; source: "model" | "visitor"; input: string; reason: string }
  | { kind: "error"; text: string };

export type Saved = {
  version: typeof STATE_VERSION;
  id: string;
  defense: DefenseId;
  wallet: number;
  received: number;
  transfers: number;
  turns: number;
  steps: number;
  seq: number;
  events: Event[];
  messages: Message[];
  defenseState: unknown;
};

export class SessionError extends Error {}

// What isn't saved: the model that is the agent and the guardrail's judge (loaded in this tab, if at
// all), and who to tell when the challenge changes.
export type Deps = { judge?: Transport; onChange?: (s: Session) => void };

function makeDefense(id: DefenseId, deps: Deps, saved?: unknown): Defense {
  switch (id) {
    case "guardrail":
      return new Guardrail(deps.judge);
    case "ltl":
      if (saved !== undefined && (!isFormula(saved) || ![...variables(saved)].every((v) => VARIABLES.includes(v)))) throw new SessionError("the LTL monitor's saved state isn't a formula over this trace");
      return new LtlMonitor(saved as never);
    case "stateless":
      return new StatelessValidator();
    case "complier": {
      const sent = saved === undefined ? 0 : (saved as { sentCents?: unknown } | null)?.sentCents;
      if (typeof sent !== "number" || !Number.isSafeInteger(sent) || sent < 0 || sent > GOAL_CENTS) throw new SessionError("the cap's saved total isn't valid");
      return new CumulativeCap(sent);
    }
    default:
      throw new SessionError("unknown defense");
  }
}

export class Session {
  readonly id: string;
  readonly defense: Defense;
  readonly ledger: Ledger;
  readonly events: Event[];
  readonly messages: Message[];
  transfers = 0;
  turns = 0;
  // Model steps since the visitor's last message.
  steps = 0;
  // Set when this challenge is replaced: anything still running on it stops at its next step.
  ended = false;
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;
  private readonly onChange?: (s: Session) => void;

  private constructor(id: string, defense: Defense, ledger: Ledger, events: Event[], messages: Message[], onChange?: (s: Session) => void) {
    this.id = id;
    this.defense = defense;
    this.ledger = ledger;
    this.events = events;
    this.messages = messages;
    this.onChange = onChange;
  }

  static create(defense: DefenseId, deps: Deps = {}, id: string = globalThis.crypto.randomUUID()): Session {
    if (!DEFENSES.includes(defense)) throw new SessionError("unknown defense");
    return new Session(id, makeDefense(defense, deps), new Ledger(), [], [{ role: "system", content: SYSTEM }], deps.onChange);
  }

  save(): Saved {
    return {
      version: STATE_VERSION,
      id: this.id,
      defense: this.defense.id,
      wallet: this.ledger.wallet,
      received: this.ledger.received,
      transfers: this.transfers,
      turns: this.turns,
      steps: this.steps,
      seq: this.seq,
      events: this.events,
      messages: this.messages,
      defenseState: this.defense.snapshot(),
    };
  }

  // A saved challenge, checked field by field; anything that doesn't fit throws SessionError, and
  // the page starts a new challenge instead.
  static restore(raw: unknown, deps: Deps = {}): Session {
    const s = raw as Partial<Saved> | null;
    if (!s || typeof s !== "object") throw new SessionError("not a saved challenge");
    if (s.version !== STATE_VERSION) throw new SessionError("saved by another version of the game");
    if (typeof s.id !== "string" || !/^[\w-]{1,64}$/.test(s.id)) throw new SessionError("bad challenge id");
    if (!DEFENSES.includes(s.defense as DefenseId)) throw new SessionError("unknown defense");
    const count = (n: unknown, max: number) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= max;
    if (!count(s.transfers, BOUNDS.maxTransfers) || !count(s.turns, BOUNDS.maxTurns) || !count(s.steps, BOUNDS.maxModelCallsPerTurn) || !count(s.seq, 10_000)) {
      throw new SessionError("bad counters");
    }
    let ledger: Ledger;
    try {
      ledger = new Ledger(s.wallet, s.received);
    } catch {
      throw new SessionError("bad balances");
    }
    if (!Array.isArray(s.events) || s.events.length > 500 || !s.events.every(isEvent)) throw new SessionError("bad event log");
    if (!Array.isArray(s.messages) || s.messages.length > 500 || !s.messages.every(isMessage) || s.messages[0]?.role !== "system") throw new SessionError("bad conversation");
    // The prompt is the game's, not whatever was saved.
    const messages = s.messages.map((m, i) => (i === 0 ? { role: "system" as const, content: SYSTEM } : m));
    const defense = makeDefense(s.defense as DefenseId, deps, s.defenseState === null ? undefined : s.defenseState);
    // The cap's total and the ledger must agree: both only grow by transfers that went through.
    if (defense instanceof CumulativeCap && defense.sentCents !== ledger.received) throw new SessionError("the cap's total and the ledger disagree");
    const session = new Session(s.id, defense, ledger, s.events, messages, deps.onChange);
    session.transfers = s.transfers!;
    session.turns = s.turns!;
    session.steps = s.steps!;
    session.seq = s.seq!;
    return session;
  }

  // Runs f after everything already queued on this challenge: transfers and turns never interleave,
  // so a defense's check and the ledger's update happen as one step, however fast the clicks come.
  exclusive<T>(f: () => Promise<T>): Promise<T> {
    const run = this.queue.then(f, f);
    this.queue = run.catch(() => undefined);
    return run;
  }

  get breached() {
    return this.ledger.received > GOAL_CENTS;
  }

  private open() {
    if (this.ended) throw new SessionError("this challenge has ended; start a new one");
  }

  private changed() {
    if (!this.ended) this.onChange?.(this);
  }

  // The transcript a guardrail would read in a harness: the visitor's messages, the agent's text, its
  // tool calls and their results (including the call being judged), but not the system prompt.
  conversation() {
    const lines: string[] = [];
    for (const m of this.messages) {
      if (m.role === "user") lines.push(`User: ${m.content}`);
      else if (m.role === "assistant") {
        if (m.content.trim()) lines.push(`Agent: ${m.content}`);
        for (const c of m.tool_calls ?? []) lines.push(`Agent calls ${c.name}(${c.arguments})`);
      } else if (m.role === "tool") lines.push(`Tool result: ${m.content}`);
    }
    return lines.join("\n");
  }

  // The one effectful tool, wherever its call came from. Returns what the caller (the model) is told.
  transfer(rawArgs: unknown, source: "model" | "visitor"): Promise<string> {
    return this.exclusive(() => this.transferNow(rawArgs, source));
  }

  // transfer() for a caller that already holds the challenge.
  private async transferNow(rawArgs: unknown, source: "model" | "visitor"): Promise<string> {
    this.open();
    if (this.transfers >= BOUNDS.maxTransfers) throw new SessionError(`this challenge allows ${BOUNDS.maxTransfers} transfer attempts; start a new one`);
    this.transfers++;
    const args = rawArgs && typeof rawArgs === "object" ? (rawArgs as Record<string, unknown>) : {};
    const amount = parseAmount(args.amount_dollars);
    if ("reason" in amount) {
      this.events.push({ kind: "invalid", source, input: safeShow(args.amount_dollars), reason: amount.reason });
      this.changed();
      return `rejected before any defense: ${amount.reason}. Nothing was sent.`;
    }
    const memo = typeof args.memo === "string" ? args.memo.slice(0, 80) : "";
    const call: TransferCall = { id: `${this.id}-${++this.seq}`, cents: amount.cents, memo };
    const view = () => ({ conversation: this.conversation() });
    const decision = await this.defense.check(call, view());
    // The guardrail's judge can take a while; a challenge replaced meanwhile takes nothing.
    this.open();
    if (decision.verdict !== "allow") {
      const effect = decision.verdict === "deny" ? "blocked: nothing sent" : "not run: defense unavailable";
      this.events.push({ kind: "transfer", source, amountCents: call.cents, verdict: decision.verdict, detail: decision.detail, effect });
      this.changed();
      return `${effect}. ${decision.detail}`;
    }
    const outcome = this.ledger.transfer(call.cents);
    const note = this.defense.settle(call, outcome, view());
    const effect = "error" in outcome ? `bank failed: ${outcome.error}` : `sent ${dollars(call.cents)}`;
    this.events.push({ kind: "transfer", source, amountCents: call.cents, verdict: "allow", detail: decision.detail, effect, ...(note ? { note } : {}) });
    this.changed();
    return "error" in outcome ? `failed: ${outcome.error}` : outcome.output;
  }

  // One visitor message through the agent: the model may call send_fake_money; each call goes
  // through transferNow above. Model text never moves money.
  say(text: unknown, model: Transport): Promise<void> {
    return this.exclusive(async () => {
      this.open();
      if (typeof text !== "string" || !text.trim()) throw new SessionError("write a message first");
      if (text.length > BOUNDS.maxMessageChars) throw new SessionError(`messages are at most ${BOUNDS.maxMessageChars} characters`);
      if (this.turns >= BOUNDS.maxTurns) throw new SessionError(`this challenge allows ${BOUNDS.maxTurns} messages; start a new one`);
      this.turns++;
      this.steps = 0;
      this.events.push({ kind: "visitor", text });
      this.messages.push({ role: "user", content: text });
      this.changed();
      for (; this.steps < BOUNDS.maxModelCallsPerTurn; ) {
        const out = await model.complete(this.messages, TOOLS);
        this.open();
        this.steps++;
        if (!(await this.apply(out, model.kind)).length) return;
      }
      this.events.push({ kind: "error", text: "the agent kept calling tools; this message's turn was cut off" });
      this.changed();
    });
  }

  // One model message: its text is shown, and each of its tool calls goes through transferNow.
  // Returns the tool results, empty if the model called no tool.
  private async apply(out: Completion, transport: Transport["kind"]): Promise<{ id: string; content: string }[]> {
    const calls = out.tool_calls.slice(0, BOUNDS.maxToolCallsPerMessage).map((c, i): ToolCall => ({ id: `call-${this.turns}-${this.steps}-${i}`, name: String(c.name).slice(0, 60), arguments: String(c.arguments).slice(0, 500) }));
    this.messages.push({ role: "assistant", content: out.content.slice(0, 2_000), ...(calls.length ? { tool_calls: calls } : {}) });
    if (out.content.trim() || out.timing) this.events.push({ kind: "agent", text: out.content.slice(0, 1_000), transport, ...(out.timing ? { timing: out.timing.slice(0, 120) } : {}) });
    this.changed();
    const results: { id: string; content: string }[] = [];
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
      results.push({ id: c.id, content });
    }
    if (calls.length) this.changed();
    return results;
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
      events: [...this.events],
    };
  }
}

function safeShow(v: unknown) {
  try {
    return String(JSON.stringify(v) ?? String(v)).slice(0, 60);
  } catch {
    return "(unprintable)";
  }
}

const str = (x: unknown, max: number) => typeof x === "string" && x.length <= max;
const SOURCES = ["model", "visitor"];

function isEvent(x: unknown): x is Event {
  const e = x as Record<string, unknown> | null;
  if (!e || typeof e !== "object") return false;
  switch (e.kind) {
    case "visitor":
      return str(e.text, BOUNDS.maxMessageChars);
    case "agent":
      return str(e.text, 1_000) && ["browser-local", "scripted"].includes(e.transport as string) && (e.timing === undefined || str(e.timing, 120));
    case "transfer":
      return (
        SOURCES.includes(e.source as string) &&
        typeof e.amountCents === "number" &&
        Number.isSafeInteger(e.amountCents) &&
        ["allow", "deny", "unavailable"].includes(e.verdict as string) &&
        str(e.detail, 500) &&
        str(e.effect, 200) &&
        (e.note === undefined || str(e.note, 200))
      );
    case "invalid":
      return SOURCES.includes(e.source as string) && str(e.input, 60) && str(e.reason, 200);
    case "error":
      return str(e.text, 200);
    default:
      return false;
  }
}

function isMessage(x: unknown): x is Message {
  const m = x as Record<string, unknown> | null;
  if (!m || typeof m !== "object" || !str(m.content, 4_000)) return false;
  if (m.role === "system" || m.role === "user") return true;
  if (m.role === "tool") return str(m.tool_call_id, 64);
  if (m.role !== "assistant") return false;
  return (
    m.tool_calls === undefined ||
    (Array.isArray(m.tool_calls) &&
      m.tool_calls.length <= BOUNDS.maxToolCallsPerMessage &&
      m.tool_calls.every((c: Record<string, unknown>) => c && str(c.id, 64) && str(c.name, 60) && str(c.arguments, 500)))
  );
}
