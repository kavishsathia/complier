import { dollars, GOAL_CENTS } from "../ledger.ts";
import type { Outcome } from "../ledger.ts";
import type { Decision, Defense, TransferCall } from "./types.ts";

// A runtime monitor for an LTL formula over the game's trace of states, by formula progression
// (Bacchus and Kabanza): after each state the formula is rewritten into what the rest of the trace
// must satisfy, and a residual of `false` means the prefix already violates it. Atoms compare a
// state variable with an integer, e.g. amount_cents <= 10000.
//
// The trace is the stream of transfers that went through, one state per transfer:
// { amount_cents }. The monitor sees only these events, never the ledger. Before a transfer runs,
// the monitor progresses the formula over that transfer's event; if that is false the transfer is
// denied and the formula is kept, since nothing happened. A transfer the bank failed isn't in the
// trace. The monitor's only memory is its residual formula.
//
// That is why it doesn't stop split transfers: G (amount_cents <= 10000) is the formula you'd write,
// and it bounds each transfer, not the total. A formula that bounds the total over these events
// exists (amounts are whole dollars and the limit is $100, so it can spell out every sequence that
// stays under it), but it grows with the limit and nobody writes it by hand.

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

// The game's property as LTL over transfer events: no transfer is more than $100.
export const SPEC = `G (amount_cents <= ${GOAL_CENTS})`;
// The only variable a state of this trace has.
export const VARIABLES = ["amount_cents"];

// The state variables a formula mentions.
export function variables(f: Formula, out = new Set<string>()): Set<string> {
  if (f.op === "atom") out.add(f.name);
  else if ("f" in f) variables(f.f, out);
  else if ("l" in f) (variables(f.l, out), variables(f.r, out));
  return out;
}

// Whether x is a formula as parse() and progress() build them: what a saved monitor is checked
// against before it is trusted again.
export function isFormula(x: unknown, depth = 0): x is Formula {
  if (depth > 64 || !x || typeof x !== "object") return false;
  const f = x as Record<string, unknown>;
  switch (f.op) {
    case "true":
    case "false":
      return true;
    case "atom":
      return typeof f.name === "string" && /^[a-z_][a-z0-9_]*$/.test(f.name) && ["<=", "<", ">=", ">", "==", "!="].includes(f.cmp as string) && Number.isSafeInteger(f.value);
    case "not":
    case "next":
    case "globally":
    case "eventually":
      return isFormula(f.f, depth + 1);
    case "and":
    case "or":
    case "implies":
    case "until":
      return isFormula(f.l, depth + 1) && isFormula(f.r, depth + 1);
    default:
      return false;
  }
}

export class LtlMonitor implements Defense {
  readonly id = "ltl" as const;
  readonly spec = SPEC;
  // What the rest of the trace must satisfy.
  private formula: Formula;

  // A new monitor starts before any event; a restored one carries on from its formula.
  constructor(formula?: Formula) {
    if (formula && !isFormula(formula)) throw new Error("LTL: invalid saved formula");
    this.formula = formula ?? parse(SPEC);
  }

  async check(call: TransferCall): Promise<Decision> {
    const event = { amount_cents: call.cents };
    const residual = progress(this.formula, event);
    return residual.op === "false"
      ? { verdict: "deny", detail: `the event amount_cents = ${call.cents} would violate ${this.spec}` }
      : { verdict: "allow", detail: `the event amount_cents = ${call.cents} (${dollars(call.cents)}) satisfies ${this.spec} (earlier transfers aren't added up)` };
  }

  settle(call: TransferCall, outcome: Outcome) {
    // Only a transfer that went through is an event of the trace.
    if (!outcome.ok) return undefined;
    this.formula = progress(this.formula, { amount_cents: call.cents });
    return `monitor stepped over the event amount_cents = ${call.cents}`;
  }

  snapshot() {
    return this.formula;
  }
}
