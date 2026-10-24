// Translation: which contract event a tool call is. Nothing here decides that. cel-java's runtime
// evaluates the rules on each call and its verifier answers the admission proofs; this module
// builds their inputs and reads their answers back, as complier's CLI does (cli/src/translate.rs
// with YAML units) and as the CEL units tool it came from does (kavishsathia/kavishsathia,
// src/lib/cel/units.ts).

import type { Evaluation, EvaluationBatch, Outcome, VerificationResult } from "../cel/engine.ts";

// ---- binding a call's JSON arguments as CEL literals ----

export type Ty =
  | { k: "bool" | "int" | "uint" | "double" | "string" | "dyn" }
  | { k: "list" | "map" | "optional"; of: Ty };

// The types a JSON argument can be bound to, in the verifier's syntax; a string is an error.
export function parseType(text: string): Ty | string {
  const s = text.replace(/\s+/g, "");
  const inner = (prefix: string) => (s.startsWith(prefix) && s.endsWith(">") ? s.slice(prefix.length, -1) : null);
  const list = inner("list<");
  if (list !== null) {
    const of = parseType(list);
    return typeof of === "string" ? of : { k: "list", of };
  }
  const opt = inner("optional<") ?? inner("optional_type<");
  if (opt !== null) {
    const of = parseType(opt);
    return typeof of === "string" ? of : { k: "optional", of };
  }
  const map = inner("map<");
  if (map !== null) {
    let depth = 0;
    const comma = [...map].findIndex((c) => ((depth += c === "<" ? 1 : c === ">" ? -1 : 0), c === "," && depth === 0));
    if (comma < 0) return `${text}: expected map<key, value>`;
    if (map.slice(0, comma) !== "string") return `${text}: JSON object keys are strings, so only map<string, V> can be bound`;
    const of = parseType(map.slice(comma + 1));
    return typeof of === "string" ? of : { k: "map", of };
  }
  switch (s) {
    case "bool":
    case "int":
    case "uint":
    case "double":
    case "string":
    case "dyn":
      return { k: s };
  }
  return `${text}: not a type a JSON argument can be bound to (bool, int, uint, double, string, dyn, list<T>, map<string, V>, optional<T>)`;
}

const kind = (v: unknown) =>
  v === null ? "null" : Array.isArray(v) ? "an array" : typeof v === "object" ? "an object" : `a ${typeof v}`;

const describe = (t: Ty): string =>
  t.k === "list" ? `a list of ${describe(t.of)}` : t.k === "map" ? `an object of ${describe(t.of)}` : t.k === "optional" ? describe(t.of) : t.k === "dyn" ? "any value" : `${t.k === "int" || t.k === "uint" ? "an" : "a"} ${t.k}`;

// A CEL string literal; JSON's escapes are CEL escapes.
const quote = (s: string) => JSON.stringify(s);

const double = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

function dynLiteral(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : double(v);
  if (typeof v === "string") return quote(v);
  if (Array.isArray(v)) return `[${v.map(dynLiteral).join(", ")}]`;
  return `{${Object.entries(v as object).map(([k, x]) => `${quote(k)}: ${dynLiteral(x)}`).join(", ")}}`;
}

// The JSON value as a CEL literal of type t; cel-java then type-checks it against the field.
export function literal(t: Ty, v: unknown): string {
  const wrong = () => {
    throw new Error(`expected ${describe(t)}, got ${kind(v)}`);
  };
  switch (t.k) {
    case "dyn":
      return dynLiteral(v);
    case "bool":
      return typeof v === "boolean" ? String(v) : wrong();
    case "int":
      return typeof v === "number" && Number.isSafeInteger(v) ? String(v) : wrong();
    case "uint":
      return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? `${v}u` : wrong();
    case "double":
      return typeof v === "number" ? double(v) : wrong();
    case "string":
      return typeof v === "string" ? quote(v) : wrong();
    case "list":
      return Array.isArray(v) ? `[${v.map((x) => literal(t.of, x)).join(", ")}]` : wrong();
    case "map":
      return v && typeof v === "object" && !Array.isArray(v)
        ? `{${Object.entries(v).map(([k, x]) => `${quote(k)}: ${literal(t.of, x)}`).join(", ")}}`
        : wrong();
    case "optional":
      return `optional.of(${literal(t.of, v)})`;
  }
}

export type Binding = { name: string; literal: string };

// The concrete event a call is: `tool`, then each schema field bound from the argument of that
// name. An absent optional argument is optional.none(); any other absent argument is an error.
export function bind(
  schema: { name: string; ty: Ty }[],
  tool: string,
  args: Record<string, unknown>,
): { ok: true; bindings: Binding[] } | { ok: false; errors: { field: string; error: string }[] } {
  const bindings: Binding[] = [{ name: "tool", literal: quote(tool) }];
  const errors: { field: string; error: string }[] = [];
  for (const f of schema) {
    try {
      if (!(f.name in args)) {
        if (f.ty.k !== "optional") throw new Error("missing argument");
        bindings.push({ name: f.name, literal: "optional.none()" });
      } else bindings.push({ name: f.name, literal: literal(f.ty, args[f.name]) });
    } catch (e) {
      errors.push({ field: f.name, error: (e as Error).message });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, bindings };
}

// `name:type` per line, the verifier's variable syntax, with `tool` first.
export const variables = (schema: { name: string; type: string }[]) =>
  ["tool:string", ...schema.map((f) => `${f.name}:${f.type.trim()}`)].join("\n");

// ---- the admission queries ----

// Each source on its own lines, so a // comment stays a comment.
export const conjoin = (...exprs: string[]) => exprs.map((e) => `(\n${e.trim() === "" ? "true" : e}\n)`).join(" && ");

export const domainOf = (tools: string[], assumption: string) =>
  conjoin(`tool in [${tools.map(quote).join(", ")}]`, assumption);

const unionOf = (preds: string[]) => (preds.length ? preds.map((p) => `(\n${p}\n)`).join(" || ") : "false");

// The generated fallback: no rule matches.
export const fallbackPredicate = (preds: string[]) => `!(\n${unionOf(preds)}\n)`;

// isSatisfiable: two rules share a call in the domain.
export const pairQuery = (domain: string, a: string, b: string) => conjoin(domain, a, b);

// isAlwaysTrue: every call in the domain is matched by a rule or the fallback. Not a tautology in
// CEL: a predicate that can error is a counterexample.
export const exhaustiveQuery = (domain: string, preds: string[]) =>
  `!(\n${domain}\n) || ${unionOf(preds)} || (\n${fallbackPredicate(preds)}\n)`;

// isSatisfiable: the fallback and some rule both match (disjoint by construction; checked anyway).
export const fallbackDisjointQuery = (domain: string, preds: string[]) =>
  conjoin(domain, fallbackPredicate(preds), unionOf(preds));

export type Verdict =
  | { kind: "proved"; detail: string }
  | { kind: "refuted"; detail: string; witness: Record<string, string> }
  | { kind: "not-proven"; detail: string; witness?: Record<string, string> }
  | { kind: "error"; detail: string };

// isSatisfiable read as "is it empty?": only VIOLATED (no model in any pass) proves emptiness;
// VERIFIED is a model, INCONCLUSIVE and timeouts prove nothing.
export function readEmptiness(out: Outcome<VerificationResult>): Verdict {
  if (out.ok === false) return { kind: "error", detail: out.failure.kind === "compile" ? out.failure.error : out.failure.rootError || out.failure.error };
  const r = out.value;
  if (r.status === "VIOLATED") return { kind: "proved", detail: r.message };
  if (r.status === "VERIFIED") return { kind: "refuted", detail: r.message, witness: parseWitness(r.message) };
  const witness = parseWitness(r.message);
  return { kind: "not-proven", detail: r.message, ...(Object.keys(witness).length ? { witness } : {}) };
}

// isSatisfiable read as "is it non-empty?", for the domain.
export function readNonEmptiness(out: Outcome<VerificationResult>): Verdict {
  const v = readEmptiness(out);
  if (v.kind === "proved") return { kind: "refuted", detail: v.detail, witness: {} };
  if (v.kind === "refuted") return { kind: "proved", detail: v.detail };
  return v;
}

// isAlwaysTrue: VERIFIED proves it, VIOLATED comes with a counterexample.
export function readValidity(out: Outcome<VerificationResult>): Verdict {
  if (out.ok === false) return { kind: "error", detail: out.failure.kind === "compile" ? out.failure.error : out.failure.rootError || out.failure.error };
  const r = out.value;
  if (r.status === "VERIFIED") return { kind: "proved", detail: r.message || "no counterexample in any pass" };
  const witness = parseWitness(r.message);
  if (r.status === "VIOLATED") return { kind: "refuted", detail: r.message, witness };
  return { kind: "not-proven", detail: r.message, ...(Object.keys(witness).length ? { witness } : {}) };
}

// The model cel-java prints after "Satisfying input:", one `  name = value` per line.
export function parseWitness(message: string): Record<string, string> {
  const out: Record<string, string> = {};
  const at = message.search(/(Satisfying|Counterexample|Potential satisfying|Potential counterexample) input:/);
  if (at < 0) return out;
  for (const line of message.slice(at).split("\n").slice(1)) {
    const m = /^ {2}([A-Za-z_][A-Za-z0-9_]*) = (.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

// ---- classifying one call ----

export type Classification =
  | { kind: "input-error"; errors: { field: string; error: string }[] }
  | { kind: "domain-error"; error: string }
  | { kind: "rule-error"; errors: { rule: string; error: string }[] }
  | { kind: "outside-domain" }
  | { kind: "fallback-error"; error: string }
  | { kind: "fallback" }
  | { kind: "mapped"; rule: number }
  | { kind: "ambiguous"; rules: number[] };

// The runtime's results for [domain, ...rules, fallback]. No first match wins: several matches
// is ambiguous, and a rule that errors refuses the call rather than falling through.
export function classify(batch: EvaluationBatch, ruleNames: string[]): Classification {
  if (batch.inputErrors.length) return { kind: "input-error", errors: batch.inputErrors };
  const [domain, ...rest] = batch.results;
  if (!domain) return { kind: "domain-error", error: "no result" };
  if (domain.ok === false) return { kind: "domain-error", error: domain.error };
  const errors: { rule: string; error: string }[] = [];
  const matches: number[] = [];
  ruleNames.forEach((name, i) => {
    const r: Evaluation | undefined = rest[i];
    if (!r) errors.push({ rule: name, error: "no result" });
    else if (r.ok === false) errors.push({ rule: name, error: r.error });
    else if (r.value) matches.push(i);
  });
  if (errors.length) return { kind: "rule-error", errors };
  if (!domain.value) return { kind: "outside-domain" };
  const fb = rest[ruleNames.length];
  if (!fb || fb.ok === false || fb.value !== (matches.length === 0)) {
    return { kind: "fallback-error", error: !fb ? "no result" : fb.ok === false ? fb.error : `fallback evaluated to ${fb.value}` };
  }
  if (!matches.length) return { kind: "fallback" };
  if (matches.length === 1) return { kind: "mapped", rule: matches[0] };
  return { kind: "ambiguous", rules: matches };
}
