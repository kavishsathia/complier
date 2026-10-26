// One run of the demo: load the translation unit and the contract, admit the unit with the CEL
// verifier, then decide each call the way complier's pre-tool hook does: classify it with CEL's
// runtime, and allow it only if the contract's current state offers its event. An allowed call is
// then run by the agent's harness with its own connection; nothing here calls Notion.

import { checkSatisfiable, checkValid, compileOnly, evaluate, loadEngine, type LoadPhase } from "../cel/engine.ts";
import { enabled, initial, loadContract, perform, type ContractError, type State } from "./contract.ts";
import {
  bind,
  classify,
  domainOf,
  exhaustiveQuery,
  fallbackDisjointQuery,
  fallbackPredicate,
  pairQuery,
  readEmptiness,
  readNonEmptiness,
  readValidity,
  variables,
  type Classification,
  type Verdict,
} from "./translation.ts";
import { loadUnit, type Unit, type UnitError } from "./unit.ts";

export type Call = { key: string; tool: string; args: string };

export type Check = { label: string; verdict: Verdict };

export type Admission =
  | { ok: true; checks: Check[] }
  | { ok: false; checks: Check[]; compile?: { path: string; line: number; message: string }[] };

export type CallResult = {
  key: string;
  tool: string;
  // What the translation made of it.
  translated:
    | { k: "args-error"; message: string }
    | { k: "not-offered" }
    | { k: "hidden" }
    | { k: "classified"; c: Classification; event?: string; rule?: string };
  // What the contract did with it.
  verdict:
    | { k: "allowed"; to?: string[] }
    | { k: "refused"; why: string };
  next: string[];
};

export type RunResult =
  | { k: "invalid"; unit?: UnitError[]; contract?: ContractError }
  | { k: "engine-failed"; message: string }
  | { k: "not-admitted"; admission: Admission }
  | { k: "done"; admission: Admission; calls: CallResult[]; start: string };

// What the engine is doing, for whoever is listening: loading, proving a unit (each check as it
// is answered; null while pending), or classifying calls.
export type Progress =
  | { k: "engine"; phase: LoadPhase }
  | { k: "admission"; labels: string[]; verdicts: (Verdict | null)[] }
  | { k: "classifying"; done: number; total: number }
  | { k: "idle" };

const listeners = new Set<(p: Progress) => void>();
export function subscribe(fn: (p: Progress) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const emit = (p: Progress) => listeners.forEach((fn) => fn(p));
// Runs in flight; background work going quiet doesn't end a run's progress.
let runs = 0;
const quiet = () => runs === 0 && emit({ k: "idle" });

// Admission and classification depend only on the unit (and the call), so runs that change only
// the contract or the calls reuse them; the engine is deterministic.
const admissions = new Map<string, Promise<Admission>>();
const classifications = new Map<string, Promise<Classification>>();

const engine = () => loadEngine((phase) => emit({ k: "engine", phase }));

// The unit's admission, proven once per distinct unit. An engine error or an inconclusive answer
// isn't an answer about the unit, so the next run asks again.
function admission(unit: Unit): Promise<Admission> {
  const key = JSON.stringify(unit);
  let a = admissions.get(key);
  if (!a) {
    a = admit(unit);
    admissions.set(key, a);
    a.then(
      (r) => r.checks.some((c) => c.verdict.kind === "error" || c.verdict.kind === "not-proven") && admissions.delete(key),
      () => admissions.delete(key),
    );
  }
  return a;
}

// Starts the engine and proves the translation as it stands, once a visitor turns to the demo, so
// Run has less to wait for. Errors surface when Run asks for the same work.
export function prepare(translation: string) {
  const u = loadUnit(translation);
  engine()
    .then(() => (u.ok === true ? admission(u.unit) : undefined))
    .then(quiet, quiet);
}

async function admit(unit: Unit): Promise<Admission> {
  const vars = variables(unit.schema);
  const preds = unit.rules.map((r) => r.when);
  const domain = domainOf(unit.tools, unit.assumption);
  const o = { variables: vars, unknowns: "", timeoutMs: unit.timeoutMs, unrollLimit: unit.unroll };

  const pairs: [number, number][] = [];
  for (let i = 0; i < preds.length; i++) for (let j = i + 1; j < preds.length; j++) pairs.push([i, j]);
  const steps: { label: string; ask: () => Promise<Verdict> }[] = [
    { label: "Some call is in the domain", ask: async () => readNonEmptiness(await checkSatisfiable(domain, o)) },
    ...pairs.map(([i, j]) => ({
      label: `No call is both ${unit.rules[i].name} and ${unit.rules[j].name}`,
      ask: async () => readEmptiness(await checkSatisfiable(pairQuery(domain, preds[i], preds[j]), o)),
    })),
    { label: `Every call is a rule's or ${unit.fallback}`, ask: async () => readValidity(await checkValid(exhaustiveQuery(domain, preds), o)) },
    { label: `${unit.fallback} never overlaps a rule`, ask: async () => readEmptiness(await checkSatisfiable(fallbackDisjointQuery(domain, preds), o)) },
  ];
  const labels = ["Rules compile to bool", ...steps.map((s) => s.label)];
  const verdicts: (Verdict | null)[] = labels.map(() => null);
  const show = () => emit({ k: "admission", labels, verdicts: [...verdicts] });
  show();

  // Every source compiles and is a bool, before any proof.
  const sources = [
    ...(unit.assumption.trim() ? [{ path: "translate.assumption", line: unit.assumptionAt?.line ?? 1, src: unit.assumption }] : []),
    ...unit.rules.map((r) => ({ path: `translate.rules.${r.name}.when`, line: r.at.line, src: r.when })),
  ];
  const compile: { path: string; line: number; message: string }[] = [];
  for (const s of sources) {
    const out = await compileOnly(s.src, vars);
    if (out.ok === false) compile.push({ path: s.path, line: s.line, message: out.failure.error || out.failure.rootError });
    else if (!/\bbool\b|kind=BOOL/.test(out.value.type)) compile.push({ path: s.path, line: s.line, message: `has type ${out.value.type}, not bool` });
  }
  verdicts[0] = compile.length ? { kind: "error", detail: `${compile.length} source(s) don't compile` } : { kind: "proved", detail: "" };
  show();
  if (compile.length) return { ok: false, checks: [], compile };

  // A unit is refused at its first failed check, as the CLI refuses it.
  const checks: Check[] = [];
  for (const [i, step] of steps.entries()) {
    const verdict = await step.ask();
    checks.push({ label: step.label, verdict });
    verdicts[i + 1] = verdict;
    show();
    if (verdict.kind !== "proved") break;
  }
  return { ok: checks.length === steps.length && checks.every((c) => c.verdict.kind === "proved"), checks };
}

async function translate(unit: Unit, tool: string, args: Record<string, unknown>): Promise<Classification> {
  const b = bind(unit.schema, tool, args);
  if (b.ok === false) return { kind: "input-error", errors: b.errors };
  const preds = unit.rules.map((r) => r.when);
  const exprs = [domainOf(unit.tools, unit.assumption), ...preds, fallbackPredicate(preds)];
  const out = await evaluate(variables(unit.schema), b.bindings, exprs);
  if (out.ok === false) throw new Error(out.failure.rootError || out.failure.error);
  return classify(out.value, unit.rules.map((r) => r.name));
}

function refusal(reason: "not-in-contract" | "not-now" | "diverges", event: string, detail?: string) {
  switch (reason) {
    case "not-in-contract":
      return `the contract has no ${event} event`;
    case "not-now":
      return `the contract doesn't allow ${event} now`;
    case "diverges":
      return detail ?? `the contract diverges after ${event}`;
  }
}

export function validate(translation: string, contract: string) {
  const u = loadUnit(translation);
  const k = loadContract(contract);
  return { u, k };
}

export async function run(input: { translation: string; contract: string; calls: Call[] }): Promise<RunResult> {
  runs++;
  try {
    return await steps(input);
  } finally {
    runs--;
    quiet();
  }
}

async function steps(input: { translation: string; contract: string; calls: Call[] }): Promise<RunResult> {
  const { u, k } = validate(input.translation, input.contract);
  if (u.ok === false || k.ok === false) return { k: "invalid", unit: u.ok === false ? u.errors : undefined, contract: k.ok === false ? k.error : undefined };
  const unit = u.unit;
  const contract = k.contract;
  const start = initial(contract);
  if (typeof start === "string") return { k: "invalid", contract: { line: 1, message: start } };

  try {
    await engine();
  } catch (e) {
    return { k: "engine-failed", message: (e as Error).message };
  }

  const unitKey = JSON.stringify(unit);
  let a: Admission;
  try {
    a = await admission(unit);
  } catch (e) {
    return { k: "engine-failed", message: (e as Error).message };
  }
  if (!a.ok) return { k: "not-admitted", admission: a };

  let state: State = start;
  const calls: CallResult[] = [];
  let i = 0;
  for (const call of input.calls) {
    emit({ k: "classifying", done: i++, total: input.calls.length });
    const tool = call.tool.trim();
    const base = { key: call.key, tool };
    let args: Record<string, unknown>;
    try {
      const parsed = call.args.trim() ? JSON.parse(call.args) : {};
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("arguments must be a JSON object");
      args = parsed;
    } catch (e) {
      calls.push({ ...base, translated: { k: "args-error", message: (e as Error).message }, verdict: { k: "refused", why: "its arguments aren't a JSON object" }, next: enabled(contract, state) });
      continue;
    }
    if (unit.hidden.includes(tool)) {
      calls.push({ ...base, translated: { k: "hidden" }, verdict: { k: "allowed" }, next: enabled(contract, state) });
      continue;
    }
    if (!unit.tools.includes(tool)) {
      calls.push({ ...base, translated: { k: "not-offered" }, verdict: { k: "refused", why: "the unit neither translates it nor lists it as hidden, so complier refuses it" }, next: enabled(contract, state) });
      continue;
    }
    const ck = JSON.stringify([unitKey, tool, args]);
    let classified = classifications.get(ck);
    if (!classified) {
      classified = translate(unit, tool, args);
      classifications.set(ck, classified);
    }
    let c: Classification;
    try {
      c = await classified;
    } catch (e) {
      classifications.delete(ck);
      return { k: "engine-failed", message: (e as Error).message };
    }
    const event = c.kind === "mapped" ? unit.rules[c.rule].emit : c.kind === "fallback" ? unit.fallback : undefined;
    const rule = c.kind === "mapped" ? unit.rules[c.rule].name : c.kind === "fallback" ? "fallback" : undefined;
    const translated = { k: "classified" as const, c, event, rule };
    if (!event) {
      const why =
        c.kind === "outside-domain"
          ? "it's outside the unit's domain (the assumption is false)"
          : c.kind === "ambiguous"
            ? "more than one rule matches it"
            : c.kind === "input-error"
              ? "an argument doesn't fit the schema"
              : "CEL couldn't evaluate a rule on it";
      calls.push({ ...base, translated, verdict: { k: "refused", why }, next: enabled(contract, state) });
      continue;
    }
    const s = perform(contract, state, event);
    if (s.ok === true) {
      state = s.state;
      calls.push({ ...base, translated, verdict: { k: "allowed", to: s.to }, next: enabled(contract, state) });
    } else {
      calls.push({ ...base, translated, verdict: { k: "refused", why: refusal(s.reason, event, s.detail) }, next: enabled(contract, state) });
    }
  }
  emit({ k: "classifying", done: input.calls.length, total: input.calls.length });
  return { k: "done", admission: a, calls, start: contract.start };
}
