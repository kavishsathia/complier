// A translation unit in the YAML format complier's CLI loads (cel/README.md): `translate` with
// tools, schema, assumption, rules, fallback and results, plus `hidden` reads. It is read as data
// (no anchors, aliases or tags, no unknown fields), every CEL source is compiled up front, and
// errors carry the line they are about.
//
// At a call, the unit binds `tool` and the schema's fields from the call's JSON arguments,
// evaluates the domain (`tool in tools && assumption`), every rule and the fallback, and names the
// action: one match is that rule's event, none is the fallback's, several is an ambiguity, which
// is refused like a call outside the domain or a rule that fails to evaluate.

import { isMap, isScalar, isSeq, LineCounter, parseDocument, visit, type Node } from "yaml";
import { CelError, compile, evaluate, none, shown, some, type CelValue, type Expr } from "./cel.ts";

export type SpecError = { line: number; message: string };

type Ty = { k: "int" | "string" | "bool" | "double" | "dyn" } | { k: "list" | "map" | "optional"; of: Ty };

type Rule = { name: string; when: Expr; emit: string; value?: Expr };

export type Unit = {
  tools: string[];
  schema: { name: string; ty: Ty }[];
  assumption: Expr;
  rules: Rule[];
  fallback: { emit: string; value?: Expr };
  // Keyed by action; `default` covers the actions without their own.
  results: Map<string, Expr>;
  resultDefault?: Expr;
  hidden: string[];
};

// A fixed CSP event, as the CLI checks it: a name, then dotted parts (accept.15).
const EVENT = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

class Fail extends Error {
  error: SpecError;
  constructor(error: SpecError) {
    super(error.message);
    this.error = error;
  }
}

function parseType(text: string): Ty | null {
  const s = text.replace(/\s+/g, "");
  const inner = (p: string) => (s.startsWith(p) && s.endsWith(">") ? s.slice(p.length, -1) : null);
  const opt = inner("optional<");
  if (opt !== null) {
    const of = parseType(opt);
    return of && { k: "optional", of };
  }
  const list = inner("list<");
  if (list !== null) {
    const of = parseType(list);
    return of && { k: "list", of };
  }
  const map = inner("map<string,");
  if (map !== null) {
    const of = parseType(map);
    return of && { k: "map", of };
  }
  return ["int", "string", "bool", "double", "dyn"].includes(s) ? ({ k: s } as Ty) : null;
}

export function loadUnit(src: string): { ok: true; unit: Unit } | { ok: false; error: SpecError } {
  const lines = new LineCounter();
  const doc = parseDocument(src, { lineCounter: lines, uniqueKeys: true, prettyErrors: false, version: "1.2" });
  const lineOf = (n: Node | null | undefined) => (n?.range ? lines.linePos(n.range[0]).line : 1);
  if (doc.errors.length) {
    return { ok: false, error: { line: lines.linePos(doc.errors[0].pos[0]).line, message: doc.errors[0].message.split("\n")[0] } };
  }
  const fail = (n: Node | null | undefined, message: string): never => {
    throw new Fail({ line: lineOf(n), message });
  };

  try {
    visit(doc, {
      Alias(_, n) {
        fail(n, "aliases aren't allowed; the unit is plain data");
      },
      Node(_, n) {
        if ((n as { anchor?: string }).anchor) fail(n, "anchors aren't allowed; the unit is plain data");
        if ((n as { tag?: string }).tag) fail(n, "tags aren't allowed; the unit is plain data");
      },
    });

    const fields = (n: Node | null | undefined, path: string, required: string[], optional: string[]) => {
      if (!isMap(n)) return fail(n, `${path}: expected a mapping`);
      const out = new Map<string, Node>();
      for (const pair of n.items) {
        const key = isScalar(pair.key) ? String(pair.key.value) : "";
        if (![...required, ...optional].includes(key)) fail(pair.key as Node, `${path}: unknown field "${key}"`);
        out.set(key, pair.value as Node);
      }
      for (const r of required) if (!out.has(r)) fail(n, `${path}: missing field "${r}"`);
      return out;
    };
    const str = (n: Node | undefined, path: string): string => {
      if (!isScalar(n) || typeof n.value !== "string") return fail(n, `${path}: expected a string, got ${isScalar(n) ? typeof n.value : "a collection"}`);
      return n.value;
    };
    const strings = (n: Node | undefined, path: string): string[] => {
      if (!isSeq(n)) return fail(n, `${path}: expected a list`);
      return n.items.map((x, i) => str(x as Node, `${path}[${i}]`));
    };
    const cel = (n: Node | undefined, path: string): Expr => {
      const text = str(n, path);
      try {
        return compile(text);
      } catch (e) {
        if (e instanceof CelError) return fail(n, `${path}: ${e.message}`);
        throw e;
      }
    };
    const event = (n: Node | undefined, path: string) => {
      const e = str(n, path);
      if (!EVENT.test(e)) fail(n, `${path}: CSP event "${e}" must be a fixed name`);
      return e;
    };

    const top = fields(doc.contents as Node, "unit", ["translate"], ["service", "hidden"]);
    const t = fields(top.get("translate"), "translate", ["tools", "rules"], ["schema", "assumption", "fallback", "timeoutMs", "unroll", "results"]);
    const tools = strings(t.get("tools"), "translate.tools");
    if (!tools.length) fail(t.get("tools"), "translate.tools: list at least one tool");

    const schema: Unit["schema"] = [];
    const s = t.get("schema");
    if (s) {
      if (!isMap(s)) fail(s, "translate.schema: expected a mapping");
      for (const pair of (s as { items: { key: unknown; value: unknown }[] }).items) {
        const name = isScalar(pair.key) ? String(pair.key.value) : "";
        if (!IDENT.test(name) || name === "tool") fail(pair.key as Node, `translate.schema: "${name}" can't be a field name`);
        const text = str(pair.value as Node, `translate.schema.${name}`);
        const ty = parseType(text);
        if (!ty) fail(pair.value as Node, `translate.schema.${name}: ${text} isn't a type (int, string, bool, double, dyn, list<T>, map<string, V>, optional<T>)`);
        schema.push({ name, ty: ty! });
      }
    }

    const assumption = t.get("assumption") ? cel(t.get("assumption"), "translate.assumption") : compile("true");

    const rulesNode = t.get("rules");
    if (!isMap(rulesNode) || !rulesNode.items.length) fail(rulesNode, "translate.rules: expected at least one rule");
    const rules: Rule[] = [];
    for (const pair of (rulesNode as { items: { key: unknown; value: unknown }[] }).items) {
      const name = isScalar(pair.key) ? String(pair.key.value) : "";
      const what = `translate.rules.${name}`;
      const r = fields(pair.value as Node, what, ["when", "emit"], ["value"]);
      rules.push({ name, when: cel(r.get("when"), `${what}.when`), emit: event(r.get("emit"), `${what}.emit`), value: r.get("value") && cel(r.get("value"), `${what}.value`) });
    }

    let fallback: Unit["fallback"];
    const fb = t.get("fallback");
    if (fb) {
      const f = fields(fb, "translate.fallback", ["emit"], ["value"]);
      const emit = event(f.get("emit"), "translate.fallback.emit");
      const clash = rules.find((r) => r.emit === emit);
      if (clash) fail(f.get("emit"), `rule ${clash.name} also emits ${emit}; the fallback must be a distinct CSP event`);
      fallback = { emit, value: f.get("value") && cel(f.get("value"), "translate.fallback.value") };
    } else {
      let emit = "other";
      for (let i = 2; rules.some((r) => r.emit === emit); i++) emit = `other_${i}`;
      fallback = { emit };
    }

    const results = new Map<string, Expr>();
    let resultDefault: Expr | undefined;
    const rs = t.get("results");
    if (rs) {
      if (!isMap(rs)) fail(rs, "translate.results: expected a mapping");
      for (const pair of (rs as { items: { key: unknown; value: unknown }[] }).items) {
        const name = isScalar(pair.key) ? String(pair.key.value) : "";
        const expr = cel(pair.value as Node, `translate.results.${name}`);
        if (name === "default") resultDefault = expr;
        else results.set(name, expr);
      }
    }

    const emitted = [...rules.map((r) => r.emit), fallback.emit];
    for (const action of results.keys()) if (!emitted.includes(action)) fail(rs, `results.${action}: no rule of this unit emits ${action}`);
    if (!resultDefault) {
      for (const action of new Set(emitted)) {
        if (!results.has(action)) fail(rs ?? t.get("rules"), `${action} has no result expression and there's no \`default\`, so its calls' results couldn't be bound`);
      }
    }

    const hidden = top.get("hidden") ? strings(top.get("hidden"), "hidden") : [];
    for (const h of hidden) if (tools.includes(h)) fail(top.get("hidden"), `hidden: ${h} is also translated`);

    return { ok: true, unit: { tools, schema, assumption, rules, fallback, results, resultDefault, hidden } };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, error: e.error };
    throw e;
  }
}

// One JSON argument as a CEL value of its schema type.
function bind(ty: Ty, v: unknown, path: string): CelValue {
  if (ty.k === "optional") return v === undefined ? none() : some(bind(ty.of, v, path));
  if (v === undefined) throw new CelError(`${path} is required`);
  if (v === null) throw new CelError(`${path} is null`);
  switch (ty.k) {
    case "int":
      if (typeof v !== "number" || !Number.isInteger(v)) throw new CelError(`${path} must be an int`);
      return v;
    case "double":
      if (typeof v !== "number") throw new CelError(`${path} must be a double`);
      return v;
    case "string":
      if (typeof v !== "string") throw new CelError(`${path} must be a string`);
      return v;
    case "bool":
      if (typeof v !== "boolean") throw new CelError(`${path} must be a bool`);
      return v;
    case "list":
      if (!Array.isArray(v)) throw new CelError(`${path} must be a list`);
      return v.map((x, i) => bind(ty.of, x, `${path}[${i}]`));
    case "map":
      if (typeof v !== "object" || Array.isArray(v)) throw new CelError(`${path} must be an object`);
      return Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, bind(ty.of, x, `${path}.${k}`)]));
    case "dyn":
      return v as CelValue;
  }
}

export type Translation =
  | { k: "hidden" }
  | { k: "event"; action: string; value?: string; rule?: string }
  | { k: "refused"; reason: string };

export function translate(unit: Unit, tool: string, args: Record<string, unknown>): Translation {
  if (unit.hidden.includes(tool)) return { k: "hidden" };
  if (!unit.tools.includes(tool)) return { k: "refused", reason: `${tool} isn't a tool the unit translates` };
  let vars: Record<string, CelValue>;
  try {
    vars = { tool };
    for (const f of unit.schema) vars[f.name] = bind(f.ty, args[f.name], f.name);
  } catch (e) {
    return { k: "refused", reason: `the call's arguments don't fit the unit's schema: ${(e as Error).message}` };
  }
  try {
    if (evaluate(unit.assumption, vars) !== true) return { k: "refused", reason: "the call is outside the unit's domain (its assumption is false)" };
    const matched = unit.rules.filter((r) => {
      const v = evaluate(r.when, vars);
      if (typeof v !== "boolean") throw new CelError(`rule ${r.name} isn't a bool`);
      return v;
    });
    if (matched.length > 1) return { k: "refused", reason: `the call matches more than one rule (${matched.map((r) => r.name).join(", ")})` };
    const hit = matched[0];
    const valueExpr = hit ? hit.value : unit.fallback.value;
    const value = valueExpr ? shown(evaluate(valueExpr, vars)) : undefined;
    return { k: "event", action: hit ? hit.emit : unit.fallback.emit, value, rule: hit?.name };
  } catch (e) {
    if (e instanceof CelError) return { k: "refused", reason: `a rule failed on this call: ${e.message}` };
    throw e;
  }
}

// What an allowed call returned, as a value of the policy's Value: the action's own results
// expression if it has one, else `default`. `ok` and `output` are bound.
export function resultValue(unit: Unit, action: string, ok: boolean, output: string): string {
  const expr = unit.results.get(action) ?? unit.resultDefault;
  if (!expr) throw new CelError(`${action} has no result expression`);
  const v = evaluate(expr, { ok, output });
  if (typeof v !== "string") throw new CelError("a result expression must give a string");
  return v;
}
