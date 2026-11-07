// A policy as a sequence diagram between the agents (ControllableCHAOS, one per role) and the
// monitor (ComplierGuard(Policy)). Only the happy path is drawn: each allowed call is one exchange,
// attempt and result into the monitor and allow out of it, and every deny is left out (and listed in
// `omitted`). Refusals aren't drawn either: they leave the policy where it was.
//
// The policy's external choices stay choices: a choice is a fragment whose operands are the
// branches the monitor offers at once, labelled by what the agent attempts to take each one. A
// result whose value decides where the policy goes is a fragment too, one operand per outcome: the
// value comes from the call, and neither the agent nor the monitor picks it. A named process is a
// state on the monitor's lifeline; reaching one again on the same path ends that path with a loop
// back to it.

import { CHANNELS, PolicyError, type Clause, type Cond, type Fn, type Pat, type Policy, type Proc, type SetE, type Val } from "./policy.ts";

export type Item =
  // The monitor is in a named process: its definition's head, such as Checked(big).
  | { k: "state"; label: string }
  // attempt, allow and result of one allowed call. `values` are the results drawn on this arrow;
  // null when they lead different ways, and a `results` item follows.
  | { k: "exchange"; role: string | null; act: string; values: string[] | null }
  | { k: "results"; role: string | null; act: string; ops: { values: string[]; items: Item[] }[] }
  // External choice: every operand is offered, and the agent's attempt takes one.
  | { k: "choice"; ops: { label: string; items: Item[] }[] }
  // Back to a state drawn earlier on this path.
  | { k: "loop"; label: string }
  // The monitor takes no more attempts (STOP), or has terminated (SKIP).
  | { k: "stop" }
  | { k: "skip" }
  // Every action offered here is denied, so no happy path goes on.
  | { k: "denied"; events: string[] };

export type Diagram = {
  agents: string[];
  roles: boolean;
  items: Item[];
  // Denials left out of the drawing, each with the state it's offered in.
  omitted: { event: string; at: string }[];
};

// Bound on what's drawn, so a policy with many branches fails clearly instead of hanging.
const LIMIT = 600;

type Env = Map<string, string>;

export function diagram(policy: Policy): Diagram {
  return new Builder(policy).run();
}

// The agent lifeline's name when there are no roles.
export const AGENT = "ControllableCHAOS";

class Builder {
  count = 0;
  omitted = new Map<string, { event: string; at: string }>();
  policy: Policy;
  constructor(policy: Policy) {
    this.policy = policy;
  }

  run(): Diagram {
    const start: Proc = { k: "call", name: "Policy", args: [], line: 1 };
    const items = this.drawn(start, [], "Policy", new Map());
    return {
      agents: this.policy.roles ?? [AGENT],
      roles: !!this.policy.roles,
      items,
      omitted: [...this.omitted.values()],
    };
  }

  // Values ----------------------------------------------------------------------------------------

  value(v: Val, env: Env, line: number): string {
    if (v.k === "con") return v.name;
    const bound = env.get(v.name);
    if (bound !== undefined) return bound;
    if (this.policy.cons.has(v.name)) return v.name;
    return fail(line, `${v.name} is neither a value of a datatype nor bound here`);
  }

  setOf(s: SetE, env: Env, line: number): string[] {
    switch (s.k) {
      case "lit":
        return s.items.map((v) => this.value(v, env, line));
      case "type": {
        const t = this.policy.types.get(s.name);
        if (!t) fail(line, `${s.name} isn't a datatype`);
        return t!;
      }
      case "returns":
        return this.returns(this.value(s.arg, env, line), line);
    }
  }

  returns(act: string, line: number): string[] {
    for (const r of this.policy.returns) {
      const env = match([r.pat], [act]);
      if (env) {
        const vs = this.setOf(r.set, env, r.line);
        for (const v of vs) if (this.policy.cons.get(v) !== "Value") fail(r.line, `Returns(${act}) holds ${v}, which isn't a Value`);
        return vs;
      }
    }
    return fail(line, `Returns(${act}) isn't defined`);
  }

  cond(c: Cond, env: Env, line: number): boolean {
    switch (c.k) {
      case "bool":
        return c.v;
      case "eq":
        return (this.value(c.a, env, line) === this.value(c.b, env, line)) === (c.op === "==");
      case "member":
        return this.setOf(c.set, env, line).includes(this.value(c.v, env, line));
      case "not":
        return !this.cond(c.c, env, line);
      case "and":
        return this.cond(c.a, env, line) && this.cond(c.b, env, line);
      case "or":
        return this.cond(c.a, env, line) || this.cond(c.b, env, line);
    }
  }

  // Processes -------------------------------------------------------------------------------------

  // A named process applied to values: the first clause whose patterns match.
  resolve(name: string, args: string[], line: number): { clause: Clause & { body: Proc }; env: Env } {
    const clauses = this.policy.defs.get(name);
    if (!clauses) fail(line, `${name} is used but never defined`);
    if (clauses![0].pats.length !== args.length) fail(line, `${name} takes ${clauses![0].pats.length} argument(s), not ${args.length}`);
    for (const clause of clauses!) {
      const env = match(clause.pats, args);
      if (!env) continue;
      if ("error" in clause) throw new PolicyError(clause.error);
      return { clause, env };
    }
    return fail(line, `no definition of ${name} matches ${name}(${args.join(", ")})`);
  }

  // The process a closure stands for once ifs and Permit's continuation are applied.
  head(p: Proc, env: Env): { p: Proc; env: Env } {
    for (;;) {
      if (p.k === "if") p = this.cond(p.c, env, 0) ? p.then : p.else;
      else if (p.k === "apply") {
        const arg = this.value(p.arg, env, p.line);
        const f: Fn = p.fn;
        if (f.k === "lambda") {
          const bound = match([f.pat], [arg]);
          if (!bound) return { p: { k: "stop" }, env };
          env = new Map([...env, ...bound]);
          p = f.body;
        } else return { p: { k: "call", name: f.name, args: [{ k: "con", name: arg }], line: f.line }, env };
      } else return { p, env };
    }
  }

  tick(line: number) {
    if (++this.count > LIMIT) fail(line, `the diagram would have more than ${LIMIT} steps; draw a smaller policy`);
  }

  // The happy-path items of P, or null if every way on is a denial. `path` holds the named
  // processes (with their arguments) entered on the way here; `at` names the current state.
  walk(p0: Proc, path: string[], at: string, env0: Env = new Map()): Item[] | null {
    const { p, env } = this.head(p0, env0);
    switch (p.k) {
      case "stop":
        return [{ k: "stop" }];
      case "skip":
        return [{ k: "skip" }];
      case "call": {
        this.tick(p.line);
        const args = p.args.map((a) => this.value(a, env, p.line));
        const key = `${p.name}(${args.join(",")})`;
        const { clause, env: bound } = this.resolve(p.name, args, p.line);
        if (path.includes(key)) return [{ k: "loop", label: clause.head }];
        const rest = this.walk(clause.body, [...path, key], clause.head, bound);
        if (!rest) return null;
        // Policy = Draft: one state, named both ways.
        if (rest[0]?.k === "state") return [{ k: "state", label: `${clause.head} = ${rest[0].label}` }, ...rest.slice(1)];
        return [{ k: "state", label: clause.head }, ...rest];
      }
      case "ext": {
        const ops: { label: string; items: Item[] }[] = [];
        const denied: string[] = [];
        for (const op of branches(p)) {
          const h = this.head(op, env);
          if (h.p.k === "stop") continue; // STOP [] P = P
          const items = this.walk(h.p, path, at, h.env);
          if (items === null) {
            denied.push(...this.deniedIn(h.p, h.env));
            continue;
          }
          // A choice in an operand offers its operands alongside: [] is associative.
          if (items.length === 1 && items[0].k === "choice") ops.push(...items[0].ops);
          else ops.push({ label: this.label(items), items });
        }
        if (!ops.length) return [{ k: "denied", events: denied }];
        if (ops.length === 1) return ops[0].items;
        return [{ k: "choice", ops }];
      }
      case "pre":
        return this.prefix(p, path, at, env);
      case "if":
      case "apply":
        throw new Error("unreachable");
    }
  }

  // P's items where it can't be left out: a state that offers only denials says so.
  drawn(p0: Proc, path: string[], at: string, env0: Env): Item[] {
    const items = this.walk(p0, path, at, env0);
    if (items) return items;
    const { p, env } = this.head(p0, env0);
    const denied: Item = { k: "denied", events: this.deniedIn(p, env) };
    if (p.k !== "call") return [denied];
    return [{ k: "state", label: this.resolve(p.name, p.args.map((a) => this.value(a, env, p.line)), p.line).clause.head }, denied];
  }

  // The denials P offers right away (for the `denied` item).
  deniedIn(p: Proc, env: Env): string[] {
    return this.answers(p, env, "", 0)
      .filter(({ p }) => p.k === "pre" && p.chan === "attempt")
      .map(({ p, env }) => `deny.${(p as Extract<Proc, { k: "pre" }>).fields.map((f) => (f.k === "out" ? this.value(f.v, env, 0) : "?")).join(".")}`);
  }

  // What the agent attempts to take a choice's operand.
  attempts(items: Item[]): string[] {
    const first = items.find((i) => i.k !== "state");
    if (first?.k === "exchange") return [`${first.role ? `${first.role} ` : ""}attempts ${first.act}`];
    if (first?.k === "choice") return first.ops.flatMap((o) => this.attempts(o.items));
    return [];
  }

  label(items: Item[]): string {
    const first = items.find((i) => i.k !== "state");
    const acts = this.attempts(items);
    if (acts.length) return [...new Set(acts)].join(" or ");
    if (first?.k === "stop") return "STOP: no more attempts";
    if (first?.k === "skip") return "SKIP: terminates";
    if (first?.k === "loop") return `back to ${first.label}`;
    return "";
  }

  // attempt.x -> (allow.x -> result.x?v -> P(v) [] deny.x -> Q): one exchange per allowed call.
  prefix(p: Extract<Proc, { k: "pre" }>, path: string[], at: string, env: Env): Item[] | null {
    this.tick(p.line);
    const roles = this.policy.roles;
    const outs = (q: Extract<Proc, { k: "pre" }>, chan: string, n: number) => {
      if (!CHANNELS.includes(q.chan))
        fail(q.line, `the event ${q.chan} isn't drawn: a policy's events are the prelude's attempt, allow, deny and result`);
      if (q.chan !== chan) return null;
      const vs = q.fields.slice(0, n);
      if (q.fields.length < n || vs.some((f) => f.k !== "out")) fail(q.line, `${chan} needs ${roles ? "a role and an action" : "an action"}${chan === "result" ? " and a value" : ""}`);
      return vs.map((f) => this.value((f as { v: Val }).v, env, q.line));
    };
    const n = roles ? 2 : 1;
    const head = outs(p, "attempt", n);
    if (!head) fail(p.line, `${p.chan} comes before any attempt: the monitor answers attempts, it doesn't start exchanges`);
    if (p.fields.length !== n) fail(p.line, `attempt needs ${roles ? "a role and an action, attempt.r.x" : "exactly one action, attempt.x"}`);
    const [role, act] = roles ? head! : [null, head![0]];
    if (role !== null && !roles!.includes(role)) fail(p.line, `${role} isn't a Role`);
    if (this.policy.cons.get(act) !== "Act") fail(p.line, `${act} isn't an Act`);
    const ev = head!.join(".");

    // The verdicts that follow the attempt.
    let allowNext: { p: Proc; env: Env } | null = null;
    let denied = false;
    for (const v of this.answers(p.next, env, ev)) {
      const got = outs(v.p as Extract<Proc, { k: "pre" }>, "allow", n) ?? outs(v.p as Extract<Proc, { k: "pre" }>, "deny", n);
      if (!got || got.join(".") !== ev)
        fail(v.p.k === "pre" ? v.p.line : p.line, `attempt.${ev} must be answered with allow.${ev} or deny.${ev}, so complier wouldn't admit this policy`);
      const q = v.p as Extract<Proc, { k: "pre" }>;
      if (q.fields.length !== n) fail(q.line, `${q.chan}.${ev} carries no more data`);
      if (q.chan === "deny") denied = true;
      else allowNext = { p: q.next, env: v.env };
    }
    if (denied) this.omitted.set(`deny.${ev}@${at}`, { event: `deny.${ev}`, at });
    if (!allowNext) return null;

    // The results the allowed call can return, each with where the policy goes.
    const groups = new Map<string, { values: string[]; p: Proc; env: Env }>();
    const returnable = this.returns(act, p.line);
    for (const r of this.answers(allowNext.p, allowNext.env, ev)) {
      const q = r.p as Extract<Proc, { k: "pre" }>;
      const got = outs(q, "result", n);
      if (!got || got.join(".") !== ev) fail(q.k === "pre" ? q.line : p.line, `after allow.${ev}, the policy must accept the call's result, result.${ev}.v`);
      const last = q.fields[n];
      if (!last || q.fields.length !== n + 1) fail(q.line, `result.${ev} carries the call's value: result.${ev}?v or result.${ev}.value`);
      const values = last.k === "out" ? [this.value(last.v, r.env, q.line)] : last.set ? this.setOf(last.set, r.env, q.line) : this.policy.types.get("Value")!;
      for (const value of values) {
        if (!returnable.includes(value)) continue;
        const e = last.k === "in" ? new Map([...r.env, [last.name, value]]) : r.env;
        const next = this.head(q.next, e);
        const key = this.key(next.p, next.env);
        const g = groups.get(key);
        if (g) g.values.push(value);
        else groups.set(key, { values: [value], p: next.p, env: next.env });
      }
    }
    const accepted = [...groups.values()].flatMap((g) => g.values);
    const missing = returnable.filter((v) => !accepted.includes(v));
    if (missing.length) fail(p.line, `after allow.${ev}, the policy doesn't accept result.${ev}.${missing[0]}, so complier wouldn't admit it`);

    const ops = [...groups.values()].map((g) => ({
      values: g.values,
      items: this.drawn(g.p, path, at, g.env),
    }));
    const exchange: Item = { k: "exchange", role, act, values: ops.length === 1 ? ops[0].values : null };
    if (ops.length === 1) return [exchange, ...ops[0].items];
    return [exchange, { k: "results", role, act, ops }];
  }

  // The branches a process offers next, with named processes unfolded (they're mid-exchange, so
  // they aren't states of the diagram).
  answers(p0: Proc, env0: Env, ev: string, depth = 0): { p: Proc; env: Env }[] {
    if (depth > 50) fail(0, ev ? `after attempt.${ev}, the policy keeps unfolding without answering` : "the policy keeps unfolding without offering anything");
    const { p, env } = this.head(p0, env0);
    if (p.k === "ext") return [...this.answers(p.l, env, ev, depth + 1), ...this.answers(p.r, env, ev, depth + 1)];
    if (p.k === "call") {
      const { clause, env: bound } = this.resolve(p.name, p.args.map((a) => this.value(a, env, p.line)), p.line);
      return this.answers(clause.body, bound, ev, depth + 1);
    }
    if (p.k === "pre") return [{ p, env }];
    if (p.k === "stop" || !ev) return [];
    return fail(0, `after attempt.${ev}, the policy must answer it, not ${p.k === "skip" ? "terminate" : "stop"}`);
  }

  // Equal keys mean the same process: the results that share one are drawn as one.
  key(p: Proc, env: Env): string {
    if (p.k === "call") {
      const args = p.args.map((a) => this.value(a, env, p.line));
      const { clause, env: bound } = this.resolve(p.name, args, p.line);
      return `${p.name}#${this.policy.defs.get(p.name)!.indexOf(clause)}#${closed(clause.body, bound)}`;
    }
    return closed(p, env);
  }
}

const fail = (line: number, msg: string): never => {
  throw new PolicyError(line ? `line ${line}: ${msg}` : msg);
};

// The operands of a chain of [].
function branches(p: Proc): Proc[] {
  return p.k === "ext" ? [...branches(p.l), ...branches(p.r)] : [p];
}

function match(pats: Pat[], args: string[]): Env | null {
  const env: Env = new Map();
  for (const [i, x] of pats.entries()) {
    if (x.k === "con" && x.name !== args[i]) return null;
    if (x.k === "var") env.set(x.name, args[i]);
  }
  return env;
}

// A process with its free variables' values, as text: equal texts are equal processes.
function closed(p: Proc, env: Env): string {
  return JSON.stringify(subst(p, env), (k, v) => (k === "line" ? undefined : v));
}

// P with each free variable replaced by its value. An input c?x and a lambda \ x @ P rebind x.
function subst(p: Proc, env: Env): Proc {
  if (!env.size) return p;
  const v = (x: Val): Val => (x.k === "name" && env.has(x.name) ? { k: "con", name: env.get(x.name)! } : x);
  const s = (x: SetE): SetE => (x.k === "lit" ? { k: "lit", items: x.items.map(v) } : x.k === "returns" ? { k: "returns", arg: v(x.arg) } : x);
  const c = (x: Cond): Cond => {
    switch (x.k) {
      case "bool":
        return x;
      case "eq":
        return { ...x, a: v(x.a), b: v(x.b) };
      case "member":
        return { ...x, v: v(x.v), set: s(x.set) };
      case "not":
        return { ...x, c: c(x.c) };
      default:
        return { ...x, a: c(x.a), b: c(x.b) };
    }
  };
  const without = (names: string[]) => new Map([...env].filter(([x]) => !names.includes(x)));
  switch (p.k) {
    case "stop":
    case "skip":
      return p;
    case "pre": {
      const inputs = p.fields.flatMap((f) => (f.k === "in" ? [f.name] : []));
      const fields = p.fields.map((f) => (f.k === "out" ? { k: "out" as const, v: v(f.v) } : f.set ? { ...f, set: s(f.set) } : f));
      return { ...p, fields, next: subst(p.next, without(inputs)) };
    }
    case "ext":
      return { ...p, l: subst(p.l, env), r: subst(p.r, env) };
    case "if":
      return { ...p, c: c(p.c), then: subst(p.then, env), else: subst(p.else, env) };
    case "call":
      return { ...p, args: p.args.map(v) };
    case "apply": {
      const fn: Fn = p.fn.k === "lambda" ? { ...p.fn, body: subst(p.fn.body, without(p.fn.pat.k === "var" ? [p.fn.pat.name] : [])) } : p.fn;
      return { ...p, fn, arg: v(p.arg) };
    }
  }
}
