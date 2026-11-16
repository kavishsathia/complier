// Walks a complier policy the way the daemon walks the automaton FDR compiles from it
// (cli/src/daemon.rs). The spec is read by the site's parser for complier policies
// (app/sequence/policy.ts), which expands Permit and Deny into complier-fdr's prelude:
//
//   Permit(x, P) = attempt.x -> allow.x -> result.x?v : Returns(x) -> P(v)
//   Deny(x, P)   = attempt.x -> deny.x -> P
//
// with the role first in every event when the spec declares `datatype Role`. An agent's call is
// attempt.<role>.<action>: if the policy's current state offers it, the policy's own allow or deny
// edge is the verdict; if not, the call is refused and the policy stays where it was. An allowed
// call's result then moves the policy along result.<role>.<action>.<value>.

import { parsePolicy, PolicyError, type Cond, type Pat, type Policy, type Proc, type SetE, type Val } from "../../sequence/policy.ts";

export { PolicyError, type Policy };

// A state of the policy: a process and the values its variables are bound to. Plain data, so it
// travels between the browser and the demo's route as JSON.
export type PState = { p: Proc; env: Record<string, string> };

type Pre = Extract<Proc, { k: "pre" }>;
type Head = { pre: Pre; env: Record<string, string> } | { done: true };

const DEPTH = 200;

export function loadPolicy(src: string): { ok: true; policy: Policy } | { ok: false; error: { line: number; message: string } } {
  try {
    return { ok: true, policy: parsePolicy(src) };
  } catch (e) {
    if (!(e instanceof PolicyError)) throw e;
    const m = /^line (\d+): ([\s\S]*)$/.exec(e.message);
    return { ok: false, error: { line: m ? Number(m[1]) : 1, message: m ? m[2] : e.message } };
  }
}

export const start = (): PState => ({ p: { k: "call", name: "Policy", args: [], line: 1 }, env: {} });

function value(policy: Policy, v: Val, env: Record<string, string>): string {
  if (v.k !== "name") return v.name;
  if (v.name in env) return env[v.name];
  if (policy.cons.has(v.name)) return v.name;
  throw new PolicyError(`${v.name} is neither a value of a datatype nor bound here`);
}

function match(pats: Pat[], args: string[]): Record<string, string> | null {
  const env: Record<string, string> = {};
  for (let i = 0; i < pats.length; i++) {
    const p = pats[i];
    if (p.k === "con" && p.name !== args[i]) return null;
    if (p.k === "var") env[p.name] = args[i];
  }
  return env;
}

function setOf(policy: Policy, s: SetE, env: Record<string, string>): string[] {
  switch (s.k) {
    case "lit":
      return s.items.map((v) => value(policy, v, env));
    case "type": {
      const t = policy.types.get(s.name);
      if (!t) throw new PolicyError(`${s.name} isn't a datatype`);
      return t;
    }
    case "returns":
      return returns(policy, value(policy, s.arg, env));
  }
}

export function returns(policy: Policy, act: string): string[] {
  for (const r of policy.returns) {
    const env = match([r.pat], [act]);
    if (env) return setOf(policy, r.set, env);
  }
  throw new PolicyError(`Returns(${act}) isn't defined`);
}

function cond(policy: Policy, c: Cond, env: Record<string, string>): boolean {
  switch (c.k) {
    case "bool":
      return c.v;
    case "eq":
      return (value(policy, c.a, env) === value(policy, c.b, env)) === (c.op === "==");
    case "member":
      return setOf(policy, c.set, env).includes(value(policy, c.v, env));
    case "not":
      return !cond(policy, c.c, env);
    case "and":
      return cond(policy, c.a, env) && cond(policy, c.b, env);
    case "or":
      return cond(policy, c.a, env) || cond(policy, c.b, env);
  }
}

// The prefixes a state offers next: named processes, ifs and Permit's continuations are
// unfolded, and both sides of [] are offered. SKIP means the policy has finished.
function heads(policy: Policy, s: PState, depth = 0): Head[] {
  if (depth > DEPTH) throw new PolicyError("the policy unfolds without offering an event");
  const { p, env } = s;
  switch (p.k) {
    case "stop":
      return [];
    case "skip":
      return [{ done: true }];
    case "pre":
      return [{ pre: p, env }];
    case "ext":
      return [...heads(policy, { p: p.l, env }, depth + 1), ...heads(policy, { p: p.r, env }, depth + 1)];
    case "if":
      return heads(policy, { p: cond(policy, p.c, env) ? p.then : p.else, env }, depth + 1);
    case "apply": {
      const arg = value(policy, p.arg, env);
      if (p.fn.k === "lambda") {
        const bound = match([p.fn.pat], [arg]);
        return bound ? heads(policy, { p: p.fn.body, env: { ...env, ...bound } }, depth + 1) : [];
      }
      return heads(policy, { p: { k: "call", name: p.fn.name, args: [{ k: "con", name: arg }], line: p.fn.line }, env }, depth + 1);
    }
    case "call": {
      // A process parameter stands for the process passed in.
      const name = !p.args.length && p.name in env ? env[p.name] : p.name;
      const args = p.args.map((a) => value(policy, a, env));
      const clauses = policy.defs.get(name);
      if (!clauses) throw new PolicyError(`${name} is used but never defined`);
      for (const clause of clauses) {
        const bound = match(clause.pats, args);
        if (!bound) continue;
        if ("error" in clause) throw new PolicyError(clause.error);
        return heads(policy, { p: clause.body, env: bound }, depth + 1);
      }
      throw new PolicyError(`no definition of ${name} matches ${name}(${args.join(", ")})`);
    }
  }
}

const fieldsAre = (policy: Policy, h: { pre: Pre; env: Record<string, string> }, want: string[]) =>
  h.pre.fields.length >= want.length &&
  want.every((w, i) => {
    const f = h.pre.fields[i];
    return f.k === "out" && value(policy, f.v, h.env) === w;
  });

const key = (role: string | null, act: string) => (role ? [role, act] : [act]);

export type Attempt =
  | { k: "allowed"; state: PState }
  | { k: "denied"; state: PState; reason: string }
  | { k: "refused"; reason: string };

// The agent attempts `act` as `role` (null without roles).
export function attempt(policy: Policy, s: PState, role: string | null, act: string): Attempt {
  if (policy.roles && (!role || !policy.roles.includes(role))) return { k: "refused", reason: `${role} isn't a role of the spec (its Role lists ${policy.roles.join(", ")})` };
  if (!policy.types.get("Act")!.includes(act)) return { k: "refused", reason: `${act} isn't an action of the spec (its Act doesn't list it)` };
  const hs = heads(policy, s);
  if (hs.some((h) => "done" in h)) return { k: "refused", reason: "the policy has finished" };
  const want = key(policy.roles ? role : null, act);
  const taken = hs.find((h): h is Exclude<Head, { done: true }> => !("done" in h) && h.pre.chan === "attempt" && fieldsAre(policy, h, want));
  if (!taken) return { k: "refused", reason: policy.roles ? `the policy doesn't take ${act} from ${role} now` : `the policy doesn't take ${act} now` };
  const answer = heads(policy, { p: taken.pre.next, env: taken.env }).find(
    (h): h is Exclude<Head, { done: true }> => !("done" in h) && (h.pre.chan === "allow" || h.pre.chan === "deny") && fieldsAre(policy, h, want),
  );
  if (!answer) throw new PolicyError(`attempt.${want.join(".")} has no allow or deny`);
  const next = { p: answer.pre.next, env: answer.env };
  return answer.pre.chan === "allow" ? { k: "allowed", state: next } : { k: "denied", state: next, reason: `the policy denied ${act}` };
}

// The allowed call's result came back as `v`: the policy follows result.<role>.<act>.v.
export function result(policy: Policy, s: PState, role: string | null, act: string, v: string): PState {
  const want = key(policy.roles ? role : null, act);
  for (const h of heads(policy, s)) {
    if ("done" in h || h.pre.chan !== "result" || !fieldsAre(policy, h, want)) continue;
    const input = h.pre.fields[want.length];
    if (!input || input.k !== "in") continue;
    const allowed = input.set ? setOf(policy, input.set, h.env) : policy.types.get("Value")!;
    if (!allowed.includes(v)) throw new PolicyError(`${act} returned ${v}, which the policy doesn't accept: the unit and the spec's Returns(${act}) disagree`);
    return { p: h.pre.next, env: { ...h.env, [input.name]: v } };
  }
  throw new PolicyError(`the policy isn't waiting for ${act}'s result`);
}

// The actions a role could take now.
export function offered(policy: Policy, s: PState, role: string | null): string[] {
  const out: string[] = [];
  for (const h of heads(policy, s)) {
    if ("done" in h || h.pre.chan !== "attempt") continue;
    const vals = h.pre.fields.map((f) => (f.k === "out" ? value(policy, f.v, h.env) : "?"));
    if (policy.roles ? vals[0] === role : true) out.push(vals[vals.length - 1]);
  }
  return out;
}
