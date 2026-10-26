// The contract: a CSP spec run by the site's CSP engine (app/stepper/csp, the /stepper page's
// parser and operational rules). This file only drives it the way complier's hook checks a
// contract in the traces model: every event is an action the agent attempts, τ happens on its own,
// the monitor keeps every state the spec could be in, and an attempt is allowed if some state
// offers its event. A refused attempt leaves the states as they were.

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
    const line = m ? Number(m[1]) : 1;
    // The CLI's contracts mark events !e; here the contract is plain CSP.
    const marked = /(^|[\s(>=\[\]])[!?^~]\s*[a-z_]/.test((src.split("\n")[line - 1] ?? "").replace(/--.*$/, ""));
    const message = (m ? m[2] : e.message) + (marked ? ". Events are plain CSP here: write draft, not !draft" : "");
    return { ok: false, error: { line, message } };
  }
  const defs = [...spec.defs.values()];
  if (!defs.length) return { ok: false, error: { line: 1, message: "define a process, such as WRITER = draft -> WRITER" } };
  const start = spec.defs.get("MAIN") ?? defs[0];
  if (start.params.length) {
    return { ok: false, error: { line: start.line, message: `${start.name} takes arguments, so it can't be where the contract starts` } };
  }
  return { ok: true, contract: { spec, start: start.name } };
}

// Everything reachable by τ, which happens without the agent.
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
      if (d.label.k === "tau") todo.push(d.to);
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
  | { ok: false; reason: "not-in-contract" | "not-now" | "diverges"; detail?: string };

// The agent performs `chan`: accepted if some state offers it, and refused otherwise, leaving the
// contract where it was.
export function perform(c: Contract, state: State, chan: string): Step {
  if (!c.spec.chans.has(chan)) return { ok: false, reason: "not-in-contract" };
  const next: Proc[] = [];
  for (const p of state) for (const d of step(c.spec, p)) if (isEvent(d.label, chan)) next.push(d.to);
  if (!next.length) return { ok: false, reason: "not-now" };
  const closed = closure(c.spec, next);
  if (typeof closed === "string") return { ok: false, reason: "diverges", detail: closed };
  return { ok: true, state: closed, to: [...new Set(next.map(show))] };
}

// The events some state offers next.
export function enabled(c: Contract, state: State): string[] {
  const out = new Set<string>();
  for (const p of state) {
    for (const d of step(c.spec, p)) if (d.label.k === "ev") out.add(d.label.chan);
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
      case "chaos":
        return "ControllableCHAOS(…)";
      case "prio":
        return `prioritise(${s(p.p)}, …)`;
      case "pre":
        return `${p.chan}${p.fields.length ? "…" : ""} -> ${s(p.next)}`;
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
      case "inter":
        return `${s(p.l)} ||| ${s(p.r)}`;
    }
  };
  const out = s(p);
  return out.length > 60 ? `${out.slice(0, 57)}…` : out;
}
