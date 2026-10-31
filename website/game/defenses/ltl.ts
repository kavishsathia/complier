import { dollars, GOAL_CENTS } from "../ledger.ts";
import type { Outcome } from "../ledger.ts";
import type { Decision, Defense, TransferCall, View } from "./types.ts";

// A runtime monitor for an LTL formula over the game's trace of states, by formula progression
// (Bacchus and Kabanza): after each state the formula is rewritten into what the rest of the trace
// must satisfy, and a residual of `false` means the prefix already violates it. Atoms compare a
// state variable with an integer, e.g. received_cents <= 10000.
//
// The trace is the ledger's state after each transfer that ran: a state is { received_cents }.
// Before a transfer runs, the monitor progresses the formula over the state the transfer would
// produce; if that is false the transfer is denied and the monitor keeps its formula, since nothing
// happened. Once the transfer has run, the monitor progresses over the state the ledger actually
// reached. The formula, not the code, says what is checked.

export type Formula =
  | { op: "true" }
  | { op: "false" }
  | { op: "atom"; name: string; cmp: "<=" | "<" | ">=" | ">" | "==" | "!="; value: number }
  | { op: "not"; f: Formula }
  | { op: "and" | "or" | "implies" | "until"; l: Formula; r: Formula }
  | { op: "next" | "globally" | "eventually"; f: Formula };

export type State = Record<string, number>;

const T: Formula = { op: "true" };
const F: Formula = { op: "false" };

export function parse(src: string): Formula {
  const tokens = src.match(/\s*(<=|>=|==|!=|->|&&|\|\||[()!<>]|\d+|[A-Za-z_][A-Za-z0-9_]*|\S)/g)?.map((t) => t.trim()) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const eat = (t?: string) => {
    const got = tokens[i++];
    if (t !== undefined && got !== t) throw new Error(`LTL: expected ${t} but found ${got ?? "the end"}`);
    if (got === undefined) throw new Error("LTL: unexpected end of formula");
    return got;
  };
  const binary = (next: () => Formula, ops: Record<string, Formula["op"]>, right = false): Formula => {
    let l = next();
    while (peek() in ops) {
      const op = ops[eat()] as "and" | "or" | "implies" | "until";
      const r = right ? binary(next, ops, true) : next();
      l = { op, l, r };
      if (right) break;
    }
    return l;
  };
  const unary = (): Formula => {
    const t = peek();
    if (t === "!") return eat(), { op: "not", f: unary() };
    if (t === "G") return eat(), { op: "globally", f: unary() };
    if (t === "F") return eat(), { op: "eventually", f: unary() };
    if (t === "X") return eat(), { op: "next", f: unary() };
    if (t === "(") {
      eat();
      const f = implies();
      eat(")");
      return f;
    }
    if (t === "true" || t === "false") return eat(), { op: t };
    const name = eat();
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`LTL: expected a state variable, found ${name}`);
    const cmp = eat();
    if (!["<=", "<", ">=", ">", "==", "!="].includes(cmp)) throw new Error(`LTL: expected a comparison after ${name}`);
    const value = Number(eat());
    if (!Number.isSafeInteger(value)) throw new Error("LTL: atoms compare with whole numbers");
    return { op: "atom", name, cmp: cmp as "<=", value };
  };
  const until = () => binary(unary, { U: "until" }, true);
  const and = () => binary(until, { "&&": "and" });
  const or = () => binary(and, { "||": "or" });
  const implies = (): Formula => binary(or, { "->": "implies" }, true);
  const f = implies();
  if (i !== tokens.length) throw new Error(`LTL: unexpected ${tokens[i]}`);
  return f;
}

export function show(f: Formula): string {
  switch (f.op) {
    case "true":
    case "false":
      return f.op;
    case "atom":
      return `${f.name} ${f.cmp} ${f.value}`;
    case "not":
      return `!${show(f.f)}`;
    case "next":
      return `X ${show(f.f)}`;
    case "globally":
      return `G ${show(f.f)}`;
    case "eventually":
      return `F ${show(f.f)}`;
    case "and":
      return `(${show(f.l)} && ${show(f.r)})`;
    case "or":
      return `(${show(f.l)} || ${show(f.r)})`;
    case "implies":
      return `(${show(f.l)} -> ${show(f.r)})`;
    case "until":
      return `(${show(f.l)} U ${show(f.r)})`;
  }
}

const not = (f: Formula): Formula => (f.op === "true" ? F : f.op === "false" ? T : f.op === "not" ? f.f : { op: "not", f });
const and = (l: Formula, r: Formula): Formula =>
  l.op === "false" || r.op === "false" ? F : l.op === "true" ? r : r.op === "true" ? l : { op: "and", l, r };
const or = (l: Formula, r: Formula): Formula =>
  l.op === "true" || r.op === "true" ? T : l.op === "false" ? r : r.op === "false" ? l : { op: "or", l, r };

function atom(f: Extract<Formula, { op: "atom" }>, s: State): boolean {
  const v = s[f.name];
  if (typeof v !== "number") throw new Error(`LTL: the state has no variable ${f.name}`);
  switch (f.cmp) {
    case "<=": return v <= f.value;
    case "<": return v < f.value;
    case ">=": return v >= f.value;
    case ">": return v > f.value;
    case "==": return v === f.value;
    case "!=": return v !== f.value;
  }
}

// What the rest of the trace must satisfy, given that the next state is s.
export function progress(f: Formula, s: State): Formula {
  switch (f.op) {
    case "true":
    case "false":
      return f;
    case "atom":
      return atom(f, s) ? T : F;
    case "not":
      return not(progress(f.f, s));
    case "and":
      return and(progress(f.l, s), progress(f.r, s));
    case "or":
      return or(progress(f.l, s), progress(f.r, s));
    case "implies":
      return or(not(progress(f.l, s)), progress(f.r, s));
    case "next":
      return f.f;
    case "globally":
      return and(progress(f.f, s), f);
    case "eventually":
      return or(progress(f.f, s), f);
    case "until":
      return or(progress(f.r, s), and(progress(f.l, s), f));
  }
}

// The game's property: what the visitor has received never exceeds $100.
export const SPEC = `G (received_cents <= ${GOAL_CENTS})`;

export class LtlMonitor implements Defense {
  readonly id = "ltl" as const;
  private formula: Formula;
  readonly spec: string;

  constructor(spec = SPEC) {
    this.spec = spec;
    this.formula = parse(spec);
  }

  async start() {
    // The trace starts in the initial state.
    this.formula = progress(this.formula, { received_cents: 0 });
    if (this.formula.op === "false") throw new Error(`LTL: the initial state already violates ${this.spec}`);
  }

  async check(call: TransferCall, view: View): Promise<Decision> {
    const next = { received_cents: view.receivedCents + call.cents };
    const residual = progress(this.formula, next);
    return residual.op === "false"
      ? { verdict: "deny", detail: `with received_cents = ${next.received_cents}, ${this.spec} would be violated` }
      : { verdict: "allow", detail: `received_cents = ${next.received_cents} (${dollars(next.received_cents)}) still satisfies ${this.spec}` };
  }

  async settle(_call: TransferCall, _outcome: Outcome, view: View) {
    // view is the ledger after the call: the state the trace actually reached.
    this.formula = progress(this.formula, { received_cents: view.receivedCents });
    return `monitor stepped to received_cents = ${view.receivedCents}`;
  }

  async close() {}
}
