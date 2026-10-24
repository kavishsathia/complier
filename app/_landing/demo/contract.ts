// The contract: a CSP spec run by the site's CSP engine (app/stepper/csp, the /stepper page's
// parser and operational rules). This file only drives it the way complier's daemon monitors a
// contract in the traces model: it keeps every state the spec could be in, lets internal events
// and τ happen on their own, and accepts an agent's event if some state offers it.

import { parse, SpecError } from "../../stepper/csp/parse.ts";
import { step } from "../../stepper/csp/step.ts";
import type { Event, Proc, Spec } from "../../stepper/csp/syntax.ts";

export type Contract = { spec: Spec; start: string };
export type State = Proc[];
export type ContractError = { line: number; message: string };

// How many states the monitor tracks before it gives up on a spec.
const LIMIT = 200;

const key = (p: Proc) => JSON.stringify(p);

export function loadContract(src: string): { ok: true; contract: Contract } | { ok: false; error: ContractError } {
  let spec: Spec;
  try {
    spec = parse(src);
  } catch (e) {
    if (!(e instanceof SpecError)) throw e;
    const m = /^line (\d+): ([\s\S]*)$/.exec(e.message);
    return { ok: false, error: m ? { line: Number(m[1]), message: m[2] } : { line: 1, message: e.message } };
  }
  const lineOf = (re: RegExp) => Math.max(1, src.split("\n").findIndex((l) => re.test(l.replace(/--.*$/, ""))) + 1);
  for (const [chan, mark] of spec.marks) {
    if (mark === "world") {
      return {
        ok: false,
        error: {
          line: lineOf(new RegExp(`[?~]\\s*${chan}\\b`)),
          message: `?${chan} is an input from the world, which complier doesn't observe: only agents' calls (!events) reach a contract`,
        },
      };
    }
  }
  const defs = [...spec.defs.values()];
  if (!defs.length) return { ok: false, error: { line: 1, message: "define a process, such as WRITER = !draft -> WRITER" } };
  const start = spec.defs.get("MAIN") ?? defs[0];
  if (start.params.length) {
    return { ok: false, error: { line: start.line, message: `${start.name} takes arguments, so it can't be where the contract starts` } };
  }
  return { ok: true, contract: { spec, start: start.name } };
}

// Everything reachable by τ and internal (unmarked) events, which happen without an agent.
function closure(spec: Spec, from: Proc[]): State | string {
  const seen = new Map<string, Proc>();
  const todo = [...from];
  while (todo.length) {
    const p = todo.pop()!;
    const k = key(p);
    if (seen.has(k)) continue;
    seen.set(k, p);
    if (seen.size > LIMIT) return `the contract reaches more than ${LIMIT} states without an agent acting`;
    for (const d of step(spec, p)) {
      if (d.label.k === "tau" || (d.label.k === "ev" && spec.marks.get(d.label.chan) === "internal")) todo.push(d.to);
    }
  }
  return [...seen.values()];
}

export function initial(c: Contract): State | string {
  return closure(c.spec, [{ k: "call", name: c.start, args: [] }]);
}

const isEvent = (l: { k: string }, chan: string): l is Event => l.k === "ev" && (l as Event).chan === chan && (l as Event).values.length === 0;

export type Step =
  | { ok: true; state: State; to: string[] }
  | { ok: false; reason: "not-in-contract" | "not-agent" | "not-now" | "diverges"; detail?: string };

// The agent performs `chan`: accepted if some state offers it, and refused otherwise, leaving the
// contract where it was.
export function perform(c: Contract, state: State, chan: string): Step {
  const mark = c.spec.marks.get(chan);
  if (!mark) return { ok: false, reason: "not-in-contract" };
  if (mark !== "agent") return { ok: false, reason: "not-agent" };
  const next: Proc[] = [];
  for (const p of state) for (const d of step(c.spec, p)) if (isEvent(d.label, chan)) next.push(d.to);
  if (!next.length) return { ok: false, reason: "not-now" };
  const closed = closure(c.spec, next);
  if (typeof closed === "string") return { ok: false, reason: "diverges", detail: closed };
  return { ok: true, state: closed, to: [...new Set(next.map(show))] };
}

// The agent events some state offers next.
export function enabled(c: Contract, state: State): string[] {
  const out = new Set<string>();
  for (const p of state) {
    for (const d of step(c.spec, p)) if (d.label.k === "ev" && c.spec.marks.get(d.label.chan) === "agent") out.add(d.label.chan);
  }
  return [...out];
}

// A short plain-text rendering of a process, for "the contract is now at …".
export function show(p: Proc): string {
  const s = (p: Proc): string => {
    switch (p.k) {
      case "stop":
        return "STOP";
      case "skip":
        return "SKIP";
      case "omega":
        return "done";
      case "call":
        return p.args.length ? `${p.name}(…)` : p.name;
      case "role":
        return s(p.p);
      case "pre":
        return `${p.mark === "agent" ? "!" : ""}${p.chan}${p.fields.length ? "…" : ""} -> ${s(p.next)}`;
      case "ext":
        return `${s(p.l)} [] ${s(p.r)}`;
      case "int":
        return `${s(p.l)} |~| ${s(p.r)}`;
      case "seq":
        return `${s(p.l)}; ${s(p.r)}`;
      case "guard":
        return `… & ${s(p.p)}`;
      case "par":
        return `${s(p.l)} ‖ ${s(p.r)}`;
    }
  };
  const out = s(p);
  return out.length > 60 ? `${out.slice(0, 57)}…` : out;
}
