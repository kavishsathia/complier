// Tests for the stepper's CSP: interleaving, nondeterminism, prioritise and
// the ControllableCHAOS builtin. Run with `npm test`.

import assert from "node:assert/strict";
import { test } from "node:test";
import { EXAMPLES } from "./example.ts";
import { parse } from "./parse.ts";
import { chaosBody, step } from "./step.ts";
import type { Proc, Spec } from "./syntax.ts";
import { reachable, showLabel, traces } from "./traces.ts";

const main = (spec: Spec, name = "MAIN"): Proc => spec.defs.get(name)!.body;
const labels = (spec: Spec, p: Proc) => step(spec, p).map((d) => showLabel(d.label)).sort();
const set = (...ts: string[]) => new Set(ts);
const tracesOf = (src: string, depth: number) => {
  const spec = parse(src);
  return traces(spec, main(spec), depth);
};

test("||| is its own operator, not a synchronising parallel", () => {
  const spec = parse("channel a\nMAIN = a -> STOP ||| a -> STOP");
  assert.equal(main(spec).k, "inter");
  assert.equal(main(parse("channel a\nMAIN = a -> STOP [| {} |] a -> STOP")).k, "par");
});

test("interleaving: an event both sides offer is two transitions, one per side", () => {
  const spec = parse("channel a, b\nMAIN = a -> b -> STOP ||| a -> STOP");
  const ds = step(spec, main(spec));
  assert.deepEqual(ds.map((d) => [d.rule, showLabel(d.label)]), [["InterL", "a"], ["InterR", "a"]]);
  // The left move leaves the right side exactly as it was, and the other way round.
  const [l, r] = ds as [(typeof ds)[0], (typeof ds)[0]];
  assert.deepEqual(l.to, { k: "inter", l: { k: "pre", chan: "b", fields: [], next: { k: "stop" } }, r: (main(spec) as { r: Proc }).r });
  assert.deepEqual(r.to, { k: "inter", l: (main(spec) as { l: Proc }).l, r: { k: "stop" } });
  assert.deepEqual(labels(spec, l.to), ["a", "b"]);
  assert.deepEqual(labels(spec, r.to), ["a"]);
});

test("interleaving differs from synchronising on the shared event", () => {
  const inter = tracesOf("channel a, b\nMAIN = a -> b -> STOP ||| a -> STOP", 3);
  const sync = tracesOf("channel a, b\nMAIN = a -> b -> STOP [| {a} |] a -> STOP", 3);
  assert.deepEqual(inter, set("", "a", "a,a", "a,b", "a,a,b", "a,b,a"));
  assert.deepEqual(sync, set("", "a", "a,b"));
});

test("interleaving terminates only once both sides have", () => {
  const spec = parse("channel a\nMAIN = SKIP ||| a -> SKIP");
  let p = main(spec);
  assert.deepEqual(labels(spec, p), ["a", "τ"]);
  p = step(spec, p).find((d) => d.rule === "InterTermL")!.to;
  assert.deepEqual(labels(spec, p), ["a"]);
  p = step(spec, p)[0]!.to;
  p = step(spec, p).find((d) => d.rule === "InterTermR")!.to;
  assert.deepEqual(step(spec, p).map((d) => d.rule), ["InterTerm"]);
});

test("internal choice resolves by τ, external choice by the event", () => {
  const spec = parse("channel a, b\nINT = a -> STOP |~| b -> STOP\nEXT = a -> STOP [] b -> STOP");
  assert.deepEqual(labels(spec, main(spec, "INT")), ["τ", "τ"]);
  assert.deepEqual(labels(spec, main(spec, "EXT")), ["a", "b"]);
  // Same traces, but after INT's τ only one of the events is left.
  const after = step(spec, main(spec, "INT")).map((d) => labels(spec, d.to));
  assert.deepEqual(after, [["a"], ["b"]]);
});

// Each case is one of the trace equalities checked with FDR 4.2.7.
test("prioritise matches FDR: τ and ✓ rank first, unlisted events are never held back", () => {
  const ch = "channel a, b, c, d\n";
  assert.deepEqual(tracesOf(ch + "MAIN = prioritise(a -> STOP [] b -> STOP, <{a}, {b}>)", 2), set("", "a"));
  assert.deepEqual(tracesOf(ch + "MAIN = prioritise(a -> STOP [] (b -> STOP |~| c -> STOP), <{a}, {b, c}>)", 2), set("", "a"));
  assert.deepEqual(tracesOf(ch + "MAIN = prioritise(a -> STOP [] c -> STOP, <{a}, {b}>)", 2), set("", "a", "c"));
  assert.deepEqual(tracesOf(ch + "MAIN = prioritise(c -> STOP [] (a -> STOP |~| b -> STOP), <{a}, {b}>)", 2), set("", "a", "b", "c"));
  assert.deepEqual(tracesOf(ch + "MAIN = prioritise(a -> STOP [] (b -> STOP |~| b -> STOP), <{}, {a}>)", 2), set("", "b", "a"));
  assert.deepEqual(tracesOf(ch + "MAIN = prioritise(a -> STOP [] SKIP, <{a}>)", 2), set("", "a", "✓"));
  assert.deepEqual(tracesOf(ch + "MAIN = prioritise(b -> STOP [] SKIP, <{a}, {b}>)", 2), set("", "✓"));
});

test("ControllableCHAOS unfolds to its definition: A under |~| with STOP, R under []", () => {
  const spec = parse("channel a, b, r\nMAIN = ControllableCHAOS({a, b}, {r})");
  const cc = main(spec);
  assert.equal(cc.k, "chaos");
  const [d, ...rest] = step(spec, cc);
  assert.equal(rest.length, 0);
  assert.equal(d!.rule, "Call");
  assert.equal(d!.label.k, "tau");
  const pre = (chan: string): Proc => ({ k: "pre", chan, fields: [], next: cc });
  assert.deepEqual(d!.to, {
    k: "ext",
    l: { k: "int", l: { k: "stop" }, r: { k: "int", l: pre("a"), r: pre("b") } },
    r: pre("r"),
  });
  assert.deepEqual(d!.to, chaosBody(spec, cc as Extract<Proc, { k: "chaos" }>));
  // Before its internal choice resolves, it offers R and no action; every
  // resolution still offers R, and the STOP branch offers only R.
  assert.deepEqual(labels(spec, d!.to), ["r", "τ", "τ"]);
  const resolved = reachable(spec, d!.to, 0).filter((p) => !step(spec, p).some((x) => x.label.k === "tau"));
  assert.deepEqual(resolved.map((p) => labels(spec, p)).sort(), [["a", "r"], ["b", "r"], ["r"]]);
});

test("ControllableCHAOS covers every event of a channel that carries data", () => {
  const spec = parse("channel n : {0..2}\nchannel r\nMAIN = ControllableCHAOS({n}, {r})");
  assert.deepEqual(tracesOf("channel n : {0..2}\nchannel r\nMAIN = ControllableCHAOS({n}, {r})", 1), set("", "n.0", "n.1", "n.2", "r"));
  assert.ok(spec);
});

test("ControllableCHAOS checks its sets", () => {
  assert.throws(() => parse("channel a, r\nMAIN = ControllableCHAOS({}, {r})"), /A is empty/);
  assert.throws(() => parse("channel a, r\nMAIN = ControllableCHAOS({a}, {})"), /R is empty/);
  assert.throws(() => parse("channel a\nMAIN = ControllableCHAOS({a}, {a})"), /a appears twice/);
  assert.throws(() => parse("channel a\nControllableCHAOS = a -> STOP"), /expected a process definition/);
  assert.throws(() => parse("channel a, b\nMAIN = prioritise(a -> STOP, <{a}, {a, b}>)"), /a appears twice/);
});

test("the extensions are gone: marks, roles and their rules don't parse", () => {
  assert.throws(() => parse("channel ^coin\nMAIN = coin -> MAIN"));
  assert.throws(() => parse("channel coin\nMAIN = ~coin -> MAIN"));
  assert.throws(() => parse("channel coin\nMAIN = !coin -> MAIN"));
  assert.throws(() => parse("channel coin\n[[agent]] MAIN = coin -> MAIN"));
});

// The default example: the guard keeps the policy's state across a refusal,
// and an allowed action always beats refuse.
test("refusal guard: refusing keeps the policy where it was", () => {
  const spec = parse(EXAMPLES[0]!.src);
  const ts = traces(spec, main(spec), 4);
  assert.ok(ts.has("draft,refuse,review,publish"), "after draft and a refusal, review is still allowed");
  assert.ok(!ts.has("draft,publish"), "publish before a review is never allowed");
  assert.ok(!ts.has("draft,refuse,publish"), "a refusal doesn't move the policy on");
  assert.ok(ts.has("refuse"), "an agent that tries something else is refused");
  // Every reachable state can do something: the system never deadlocks.
  for (const p of reachable(spec, main(spec), 5)) assert.ok(step(spec, p).length > 0);
});

test("refusal guard: refuse never fires while the agent's chosen action is allowed", () => {
  const spec = parse(EXAMPLES[0]!.src);
  for (const p of reachable(spec, main(spec), 4)) {
    const ls = labels(spec, p);
    if (ls.includes("τ")) assert.ok(!ls.includes("refuse"), "refuse waits for the agent's choice");
    else if (ls.some((l) => l !== "refuse")) assert.ok(!ls.includes("refuse"), `allowed ${ls} beats refuse`);
  }
});

test("every example parses and steps", () => {
  for (const { name, src } of EXAMPLES) {
    const spec = parse(src);
    assert.ok(traces(spec, main(spec), 3).size > 1, name);
  }
});
