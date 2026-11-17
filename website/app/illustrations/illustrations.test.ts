// The illustrations' complier: their units and policies load, and calls are allowed, denied or
// refused as complier's daemon decides them (cli/src/daemon.rs), with a refusal leaving the policy
// where it was.

import assert from "node:assert/strict";
import { test } from "node:test";
import { compile, evaluate, none, some } from "./_complier/cel.ts";
import { decide, finish, load, start, type Machine } from "./_complier/gate.ts";
import { offered } from "./_complier/policy.ts";
import { apply, initial as initialDesk, type Call } from "./_desk/model.ts";
import { POLICY as DESK_POLICY, UNIT as DESK_UNIT } from "./_desk/spec.ts";
import { initial as pairDesk } from "./_pair/model.ts";
import { finished, first, tick, type Ask, type Frame } from "./_pair/run.ts";
import { POLICY as PAIR_POLICY, UNIT as PAIR_UNIT } from "./_pair/spec.ts";

const machine = (unit: string, policy: string): Machine => {
  const m = load(unit, policy);
  if (!("machine" in m)) throw new Error(JSON.stringify(m.errors));
  return m.machine;
};

test("CEL: regex.extract reads the desk's minimum from its reply", () => {
  assert.deepEqual(evaluate(compile("regex.extract(output, 'Minimum inventory: ([0-9]+)')"), { output: "Done. Minimum inventory: 40. Current inventory: 85." }), some("40"));
  assert.deepEqual(evaluate(compile("regex.extract(output, 'x([0-9]+)')"), { output: "none here" }), none());
});

test("CEL: optionals, comparisons, in, ternary and errors", () => {
  const v = { tool: "set_minimum_inventory", value: some(0), id: none() };
  assert.equal(evaluate(compile("tool == 'set_minimum_inventory' ? value.hasValue() : id.hasValue()"), v), true);
  assert.equal(evaluate(compile("value.value() < 20"), v), true);
  assert.equal(evaluate(compile("id.orValue(7) in [1, 7]"), v), true);
  assert.equal(evaluate(compile("ok ? 'done' : 'failed'"), { ok: false }), "failed");
  assert.throws(() => evaluate(compile("id.value() == 1"), v), /none/);
  assert.throws(() => evaluate(compile("tool == 1"), v), /overload/);
  // A definite answer on one side of && wins over an error on the other, as in CEL.
  assert.equal(evaluate(compile("tool == 'x' && id.value() == 1"), v), false);
  assert.throws(() => compile("tool =="), /end/);
});

const OUT = (min: number, inv: number) => `Done. Minimum inventory: ${min}. Current inventory: ${inv}.`;

// Runs desk calls in order, returning each verdict; allowed calls' results come back as the
// route returns them.
function runDesk(m: Machine, calls: [string, Record<string, unknown>][]) {
  let s = start();
  let desk = structuredClone(initialDesk);
  return calls.map(([tool, args]) => {
    const d = decide(m, s, null, tool, args);
    s = d.state;
    if (d.verdict.k === "allowed") {
      desk = apply(desk, { name: tool, ...args } as Call);
      s = finish(m, s, null, d.verdict.action, true, OUT(desk.minimum, desk.inventory));
    }
    return d.verdict.k;
  });
}
const accept = (id: number): [string, Record<string, unknown>] => ["accept_order", { id, reason: "x" }];
const setMin = (value: number): [string, Record<string, unknown>] => ["set_minimum_inventory", { value, reason: "x" }];

test("order desk: the unit and policy load; each accept carries its order's quantity", () => {
  const m = machine(DESK_UNIT, DESK_POLICY);
  assert.deepEqual(m.unit.rules.map((r) => r.emit), ["accept.10", "accept.12", "accept.15", "accept.20", "accept.25", "reject", "set_minimum", "lower_minimum"]);
  assert.deepEqual(offered(m.policy, start(), null).sort(), ["accept.10", "accept.12", "accept.15", "accept.20", "accept.25", "lower_minimum", "reject", "set_minimum"]);
  for (const o of initialDesk.orders) {
    const v = decide(m, start(), null, "accept_order", { id: o.id }).verdict;
    assert.equal(v.k === "allowed" && v.action, `accept.${o.quantity}`);
  }
});

test("order desk: an accept that would leave stock below the minimum is refused, whatever the agent decides", () => {
  const m = machine(DESK_UNIT, DESK_POLICY);
  // 25 + 20 + 15 + 15 = 75 leaves 25; 12 would leave 13 and 10 would leave 15.
  assert.deepEqual(runDesk(m, [accept(2), accept(4), accept(1), accept(5), accept(6), accept(3)]), ["allowed", "allowed", "allowed", "allowed", "refused", "refused"]);
  const m2 = machine(DESK_UNIT, DESK_POLICY);
  const r = decide(m2, start(), null, "accept_order", { id: 2 });
  let s = finish(m2, r.state, null, "accept.25", true, OUT(20, 75));
  for (const [id, q] of [[4, 20], [1, 15], [5, 15]]) s = finish(m2, decide(m2, s, null, "accept_order", { id }).state, null, `accept.${q}`, true, "Done.");
  const over = decide(m2, s, null, "accept_order", { id: 6 });
  assert.deepEqual(over.verdict, { k: "refused", action: "accept.12", event: "accept.12", reason: "the policy doesn't take accept.12 now" });
  assert.equal(over.state, s, "a refusal keeps the policy's state");
});

test("order desk: the accept that leaves exactly the minimum is allowed, the next one isn't", () => {
  const m = machine(DESK_UNIT, DESK_POLICY);
  // The policy counts every allowed accept, as the deck's INVENTORY did: eight 10s leave 20.
  assert.deepEqual(runDesk(m, Array.from({ length: 9 }, () => accept(3))), [...Array(8).fill("allowed"), "refused"]);
  // With the minimum raised to 30, 25 + 20 + 15 + 10 leaves exactly 30.
  assert.deepEqual(runDesk(m, [setMin(30), accept(2), accept(4), accept(1), accept(3), accept(6)]), ["allowed", "allowed", "allowed", "allowed", "allowed", "refused"]);
});

test("order desk: the minimum can't be lowered below 20; raising it tightens accepts", () => {
  const m = machine(DESK_UNIT, DESK_POLICY);
  const low = decide(m, start(), null, "set_minimum_inventory", { value: 0, reason: "notice" });
  assert.equal(low.verdict.k, "denied");
  assert.equal(low.verdict.k === "denied" && low.verdict.event, "lower_minimum.0");
  assert.equal(decide(m, start(), null, "set_minimum_inventory", { value: 19 }).verdict.k, "denied");
  assert.equal(decide(m, start(), null, "set_minimum_inventory", { value: 101 }).verdict.k, "refused");
  // After a denied lowering the reserve still holds at 20.
  assert.deepEqual(runDesk(m, [setMin(0), accept(2), accept(4), accept(1), accept(3), accept(5)]), ["denied", "allowed", "allowed", "allowed", "allowed", "refused"]);
  // Raised to 60, a 20 from 75 is refused until the minimum is back at 20.
  assert.deepEqual(runDesk(m, [setMin(60), accept(2), accept(4), setMin(20), accept(4), setMin(10)]), ["allowed", "allowed", "refused", "allowed", "allowed", "denied"]);
});

test("order desk: until an allowed call's result comes back, the policy takes no other attempt", () => {
  const m = machine(DESK_UNIT, DESK_POLICY);
  const a = decide(m, start(), null, "accept_order", { id: 1, reason: "fits" });
  assert.deepEqual(a.verdict, { k: "allowed", action: "accept.15", event: "accept.15" });
  const early = decide(m, a.state, null, "reject_order", { id: 2 }).verdict;
  assert.deepEqual(early, { k: "refused", action: "reject", event: "reject.2", reason: "the result of accept.15 hasn't come back yet" });
  const after = finish(m, a.state, null, "accept.15", true, OUT(20, 85));
  assert.equal(decide(m, after, null, "reject_order", { id: 2 }).verdict.k, "allowed");
});

test("order desk: calls outside the unit's domain or tools are refused, state kept", () => {
  const m = machine(DESK_UNIT, DESK_POLICY);
  const s = start();
  const noId = decide(m, s, null, "accept_order", { reason: "?" });
  assert.deepEqual(noId.verdict, { k: "refused", reason: "the call is outside the unit's domain (its assumption is false)" });
  assert.equal(noId.state, s);
  assert.equal(decide(m, s, null, "delete_order", { id: 1 }).verdict.k, "refused");
  assert.equal(decide(m, s, null, "accept_order", { id: "1" }).verdict.k, "refused");
});

test("two agents: a read by one refuses the other's read until the order is sent", () => {
  const m = machine(PAIR_UNIT, PAIR_POLICY);
  assert.deepEqual(m.policy.roles, ["agent_a", "agent_b"]);
  const a = decide(m, start(), "agent_a", "next_order", {});
  assert.equal(a.verdict.k, "allowed");
  let s = finish(m, a.state, "agent_a", "next", true, "Next order: Acme Co");
  const b = decide(m, s, "agent_b", "next_order", {});
  assert.deepEqual(b.verdict, { k: "refused", action: "next", event: "next", reason: "the policy doesn't take next from agent_b now" });
  assert.equal(b.state, s);
  // B can't send an order it hasn't read.
  assert.equal(decide(m, s, "agent_b", "send_to_recipient", { name: "Acme Co", quantity: 15 }).verdict.k, "refused");
  const send = decide(m, s, "agent_a", "send_to_recipient", { name: "Acme Co", quantity: 15, reason: "fits" });
  assert.deepEqual(send.verdict, { k: "allowed", action: "send", event: "send.Acme Co" });
  s = finish(m, send.state, "agent_a", "send", true, "Sent");
  assert.equal(decide(m, s, "agent_b", "next_order", {}).verdict.k, "allowed");
});

test("two agents: an unknown role is refused", () => {
  const m = machine(PAIR_UNIT, PAIR_POLICY);
  assert.match(decide(m, start(), "agent_c", "next_order", {}).verdict.k, /refused/);
});

test("edits are checked: syntax errors name their line", () => {
  const badPolicy = load(DESK_UNIT, DESK_POLICY.replace("Agent  = ControllableCHAOS\n", ""));
  assert.ok("errors" in badPolicy && badPolicy.errors.policy?.message.includes("Agent"));
  const badUnit = load(DESK_UNIT.replace("emit: reject", "emit: 'not an event'"), DESK_POLICY);
  assert.ok("errors" in badUnit && badUnit.errors.unit && badUnit.errors.unit.line > 1);
  const badCel = load(DESK_UNIT.replace("when: tool == 'accept_order' && id.value() == 3", "when: tool =="), DESK_POLICY);
  assert.ok("errors" in badCel && /accept_10\.when/.test(badCel.errors.unit!.message));
});

test("an action the policy's Act doesn't list is refused", () => {
  const m = machine(DESK_UNIT.replace("emit: reject", "emit: decline"), DESK_POLICY);
  const r = decide(m, start(), null, "reject_order", { id: 1 });
  assert.equal(r.verdict.k, "refused");
  assert.match(r.verdict.k === "refused" ? r.verdict.reason : "", /isn't an action/);
});

// A scripted agent for the two-agent run: reads, then sends what it read if it fits, and reads
// again after a refusal. Both agents ask at once each tick, as the page does.
const scripted: Ask = async (messages) => {
  const last = [...messages].reverse().find((m) => m.role === "tool") as { content: string } | undefined;
  const m = last && /customer (.+?), quantity (\d+),.*Current inventory: (\d+)\. Minimum inventory: (\d+)\./.exec(last.content);
  const call = (name: string, args: object) => ({ role: "assistant", tool_calls: [{ id: String(Math.random()), function: { name, arguments: JSON.stringify(args) } }] });
  if (!m) return call("next_order", {});
  const [, name, q, inv, min] = m;
  return Number(inv) - Number(q) >= Number(min) ? call("send_to_recipient", { name, quantity: Number(q), reason: "fits" }) : call("reject_order", { name, reason: "low" });
};

async function runPair(withComplier: boolean) {
  const m = withComplier ? machine(PAIR_UNIT, PAIR_POLICY) : undefined;
  let frames: Frame[] = [first(pairDesk)];
  for (let i = 0; i < 40 && !finished(frames[frames.length - 1]); i++) frames = [...frames, ...(await tick(frames[frames.length - 1], m, scripted))];
  return frames;
}

test("two agents without complier: both read the same order and ship it twice", async () => {
  const frames = await runPair(false);
  const last = frames[frames.length - 1];
  assert.ok(finished(last));
  assert.ok(last.desk.orders.some((o) => o.shipped > 1));
});

test("two agents with complier: the run finishes, every order once, reads refused while one is held", async () => {
  const frames = await runPair(true);
  const last = frames[frames.length - 1];
  assert.ok(finished(last), "the run finishes");
  assert.ok(last.desk.orders.every((o) => o.status !== "pending" && o.shipped <= 1));
  assert.ok(last.desk.inventory >= last.desk.minimum);
  assert.ok(frames.some((f) => f.step?.verdict?.k === "refused" && f.step.call === "next_order()"));
});
