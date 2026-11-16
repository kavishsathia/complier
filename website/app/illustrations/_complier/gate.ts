// complier between an agent and its tools, as the pre-tool-use hook and the daemon decide a call:
// the translation unit names the call's action, the policy allows, denies or refuses the attempt,
// and only an allowed call runs. Its result then moves the policy on.

import { CelError } from "./cel.ts";
import { attempt, loadPolicy, offered, PolicyError, result, start, type Policy, type PState } from "./policy.ts";
import { loadUnit, resultValue, translate, type SpecError, type Unit } from "./unit.ts";

export type Machine = { unit: Unit; policy: Policy };

export type LoadErrors = { unit?: SpecError; policy?: SpecError };

export function load(unitSrc: string, policySrc: string): { ok: true; machine: Machine } | { ok: false; errors: LoadErrors } {
  const u = loadUnit(unitSrc);
  const p = loadPolicy(policySrc);
  if (!u.ok || !p.ok) return { ok: false, errors: { unit: u.ok ? undefined : u.error, policy: p.ok ? undefined : p.error } };
  try {
    // Unfold the start once, so a policy that can't be walked is an error now rather than at a call.
    offered(p.policy, start(), p.policy.roles?.[0] ?? null);
    return { ok: true, machine: { unit: u.unit, policy: p.policy } };
  } catch (e) {
    if (e instanceof PolicyError) return { ok: false, errors: { policy: { line: 1, message: e.message } } };
    throw e;
  }
}

export { start };

// What complier decided about one call. `action` is the event the unit named, with its value as
// the daemon logs it (accept.3).
export type Verdict =
  | { k: "allowed"; action: string; event: string }
  | { k: "denied"; action: string; event: string; reason: string }
  | { k: "refused"; action?: string; event?: string; reason: string };

export function decide(m: Machine, state: PState, role: string | null, tool: string, args: Record<string, unknown>): { verdict: Verdict; state: PState } {
  const t = translate(m.unit, tool, args);
  if (t.k === "hidden") return { verdict: { k: "allowed", action: "", event: "" }, state };
  if (t.k === "refused") return { verdict: { k: "refused", reason: t.reason }, state };
  const event = t.value === undefined ? t.action : `${t.action}.${t.value}`;
  try {
    const a = attempt(m.policy, state, role, t.action);
    if (a.k === "refused") return { verdict: { k: "refused", action: t.action, event, reason: a.reason }, state };
    if (a.k === "denied") return { verdict: { k: "denied", action: t.action, event, reason: a.reason }, state: a.state };
    return { verdict: { k: "allowed", action: t.action, event }, state: a.state };
  } catch (e) {
    // A policy that can't be walked here fails closed.
    if (e instanceof PolicyError) return { verdict: { k: "refused", action: t.action, event, reason: e.message }, state };
    throw e;
  }
}

// The allowed call ran and returned `output`; the unit turns that into a Value and the policy
// follows its result edge.
export function finish(m: Machine, state: PState, role: string | null, action: string, ok: boolean, output: string): PState {
  if (!action) return state;
  try {
    return result(m.policy, state, role, action, resultValue(m.unit, action, ok, output));
  } catch (e) {
    if (e instanceof CelError || e instanceof PolicyError) throw new Error(e.message);
    throw e;
  }
}

// The daemon's words for a call it didn't let run, as the agent's tool result says them.
export function told(tool: string, v: Verdict) {
  return v.k === "denied"
    ? `Denied by complier: ${v.reason} (${tool} is ${v.event}). Nothing changed.`
    : `Refused by complier: ${v.reason}. Nothing changed.`;
}
