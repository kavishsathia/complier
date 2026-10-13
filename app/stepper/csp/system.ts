// The system layer: events submitted from outside the process. In a stable
// state (no τ), a world event (~) the state doesn't offer is dropped
// [IO-Drop] and an agent event (^) it doesn't offer is refused [IO-Refuse].

import { step } from "./step.ts";
import type { Derivation, Event, Mark, Proc, Spec, Type, Value } from "./syntax.ts";
import { texLabel, texSet } from "./tex.ts";

const sameEvent = (a: Event, b: Event) =>
  a.chan === b.chan && a.values.length === b.values.length && a.values.every((v, i) => v === b.values[i]);

const values = (t: Type): Value[] =>
  t.k === "bool" ? [true, false] : Array.from({ length: Math.max(0, t.hi - t.lo + 1) }, (_, i) => t.lo + i);

// Σ, channel by channel: every value tuple each channel's types allow.
export function alphabet(spec: Spec, limit = 400): { event: Event; mark: Mark }[] {
  const out: { event: Event; mark: Mark }[] = [];
  for (const [chan, types] of spec.chans) {
    let tuples: Value[][] = [[]];
    for (const t of types) tuples = tuples.flatMap((vs) => values(t).map((v) => [...vs, v]));
    for (const vs of tuples) {
      if (out.length >= limit) return out;
      out.push({ event: { k: "ev", chan, values: vs }, mark: spec.marks.get(chan) ?? "internal" });
    }
  }
  return out;
}

export const showEvent = (e: Event) => [e.chan, ...e.values.map(String)].join(".");

// Reads c.1.true as an event, checking it against the channel's declaration.
export function readEvent(spec: Spec, text: string): Event | string {
  const [chan, ...parts] = text.trim().split(".");
  const types = spec.chans.get(chan);
  if (!chan) return "type an event, such as coin or c.1";
  if (!types) return `${chan} is not a channel of this spec`;
  if (parts.length !== types.length)
    return `${chan} carries ${types.length} value(s), not ${parts.length}`;
  const vs: Value[] = [];
  for (const [i, p] of parts.entries()) {
    const t = types[i];
    const v: Value | null = p === "true" ? true : p === "false" ? false : /^-?\d+$/.test(p) ? Number(p) : null;
    const ok = v !== null && (t.k === "bool" ? typeof v === "boolean" : typeof v === "number" && v >= t.lo && v <= t.hi);
    if (!ok) return `${p} is not a value of ${t.k === "bool" ? "Bool" : `{${t.lo}..${t.hi}}`}`;
    vs.push(v!);
  }
  return { k: "ev", chan, values: vs };
}

// offered(P) = { a ∈ Σ | ∃P'. P --a--> P' }
export function offered(spec: Spec, p: Proc): Event[] {
  const out: Event[] = [];
  for (const d of step(spec, p))
    if (d.label.k === "ev" && !out.some((e) => sameEvent(e, d.label as Event))) out.push(d.label);
  return out;
}

export type Outcome =
  | { k: "accepted"; mark: Mark; ds: Derivation[] }
  | { k: "dropped" | "refused"; mark: Mark; d: Derivation }
  | { k: "unstable"; mark: Mark }
  | { k: "blocked"; mark: Mark };

// What submitting a in state S does: the transitions labelled a if S offers
// it. Otherwise nothing for an internal event, which only ever happens on its
// own; nothing yet if S can still take τ; and else [IO-Drop] for a world
// event and [IO-Refuse] for an agent event.
export function submit(spec: Spec, s: Proc, a: Event): Outcome {
  const mark = spec.marks.get(a.chan) ?? "internal";
  const all = step(spec, s);
  const ds = all.filter((d) => d.label.k === "ev" && sameEvent(d.label, a));
  if (ds.length) return { k: "accepted", mark, ds };
  if (mark === "internal") return { k: "blocked", mark };
  if (all.some((d) => d.label.k === "tau")) return { k: "unstable", mark };
  const offer = offered(spec, s);
  const set = offer.length ? `\\{${offer.map(texLabel).join(", ")}\\}` : texSet([]);
  const drop = mark === "world";
  const d: Derivation = {
    rule: drop ? "IO-Drop" : "IO-Refuse",
    from: s,
    label: drop ? { k: "drop", ev: a } : { k: "refuse", ev: a },
    to: s,
    premises: [],
    side: [
      `${texLabel(a)} \\in \\Sigma^{${drop ? "\\sim" : "\\wedge"}}`,
      "S \\overset{\\tau}{\\nrightarrow}",
      `${texLabel(a)} \\notin \\mathit{offered}(S) = ${set}`,
    ],
  };
  return { k: drop ? "dropped" : "refused", mark, d };
}
