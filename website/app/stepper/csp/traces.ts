// The visible traces of a process up to a length, with τ hidden: what the
// tests compare against FDR's traces model.

import { step } from "./step.ts";
import type { Label, Proc, Spec } from "./syntax.ts";

export const showLabel = (l: Label) =>
  l.k === "tau" ? "τ" : l.k === "tick" ? "✓" : [l.chan, ...l.values.map(String)].join(".");

// Every trace of at most `depth` visible events, each as its events joined by
// commas ("" is the empty trace).
export function traces(spec: Spec, start: Proc, depth: number, limit = 200_000): Set<string> {
  const out = new Set<string>();
  const seen = new Set<string>();
  const todo: { p: Proc; t: string[] }[] = [{ p: start, t: [] }];
  while (todo.length) {
    const { p, t } = todo.pop()!;
    const key = JSON.stringify(p) + "|" + t.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > limit) throw new Error(`more than ${limit} states`);
    out.add(t.join(","));
    for (const d of step(spec, p)) {
      if (d.label.k === "tau") todo.push({ p: d.to, t });
      else if (t.length < depth) todo.push({ p: d.to, t: [...t, showLabel(d.label)] });
    }
  }
  return out;
}

// The states reachable in at most `depth` visible events, τ steps included.
export function reachable(spec: Spec, start: Proc, depth: number): Proc[] {
  const out = new Map<string, Proc>();
  const todo: { p: Proc; n: number }[] = [{ p: start, n: 0 }];
  const seen = new Set<string>();
  while (todo.length) {
    const { p, n } = todo.pop()!;
    const key = JSON.stringify(p);
    if (seen.has(key + "|" + n)) continue;
    seen.add(key + "|" + n);
    out.set(key, p);
    for (const d of step(spec, p)) if (d.label.k === "tau" || n < depth) todo.push({ p: d.to, n: d.label.k === "tau" ? n : n + 1 });
  }
  return [...out.values()];
}
