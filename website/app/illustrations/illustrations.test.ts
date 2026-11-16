// The illustrations' complier: their units and policies load, and calls are allowed, denied or
// refused as complier's daemon decides them (cli/src/daemon.rs), with a refusal leaving the policy
// where it was.

import assert from "node:assert/strict";
import { test } from "node:test";
import { compile, evaluate, none, some } from "./_complier/cel.ts";
import { decide, finish, load, start, type Machine } from "./_complier/gate.ts";
import { offered } from "./_complier/policy.ts";
import { POLICY as DESK_POLICY, UNIT as DESK_UNIT } from "./_desk/spec.ts";
import { POLICY as PAIR_POLICY, UNIT as PAIR_UNIT } from "./_pair/spec.ts";

const machine = (unit: string, policy: string): Machine => {
  const m = load(unit, policy);
  if (!("machine" in m)) throw new Error(JSON.stringify(m.errors));
  return m.machine;
};

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

test("order desk: the unit and policy load", () => {
  const m = machine(DESK_UNIT, DESK_POLICY);
  assert.deepEqual(m.unit.rules.map((r) => r.emit), ["accept", "reject", "set_minimum", "lower_minimum"]);
  assert.deepEqual(offered(m.policy, start(), null).sort(), ["accept", "lower_minimum", "reject", "set_minimum"]);
});

test("order desk: accept is allowed and its result returns the policy to Desk", () => {
  const m = machine(DESK_UNIT, DESK_POLICY);
  const a = decide(m, start(), null, "accept_order", { id: 1, reason: "fits" });
  assert.deepEqual(a.verdict, { k: "allowed", action: "accept", event: "accept.1" });
  // Until the result comes back, the policy takes no other attempt.
  const early = decide(m, a.state, null, "reject_order", { id: 2 }).verdict;
  assert.deepEqual(early, { k: "refused", action: "reject", event: "reject.2", reason: "the result of accept hasn't come back yet" });
  const after = finish(m, a.state, null, "accept", true, "Done.");
  assert.equal(decide(m, after, null, "reject_order", { id: 2 }).verdict.k, "allowed");
});

test("order desk: lowering the minimum below 20 is denied; raising it is allowed", () => {
  const m = machine(DESK_UNIT, DESK_POLICY);
  const low = decide(m, start(), null, "set_minimum_inventory", { value: 0, reason: "notice" });
  assert.equal(low.verdict.k, "denied");
  assert.equal(low.verdict.k === "denied" && low.verdict.event, "lower_minimum.0");
  // Deny(lower_minimum, Desk): the policy is back at Desk and takes the next order.
  assert.equal(decide(m, low.state, null, "accept_order", { id: 3 }).verdict.k, "allowed");
  assert.equal(decide(m, start(), null, "set_minimum_inventory", { value: 19 }).verdict.k, "denied");
  assert.equal(decide(m, start(), null, "set_minimum_inventory", { value: 20 }).verdict.k, "allowed");
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
  const badCel = load(DESK_UNIT.replace("when: tool == 'accept_order'", "when: tool =="), DESK_POLICY);
  assert.ok("errors" in badCel && /accept\.when/.test(badCel.errors.unit!.message));
});

test("an action the policy's Act doesn't list is refused", () => {
  const m = machine(DESK_UNIT.replace("emit: reject", "emit: decline"), DESK_POLICY);
  const r = decide(m, start(), null, "reject_order", { id: 1 });
  assert.equal(r.verdict.k, "refused");
  assert.match(r.verdict.k === "refused" ? r.verdict.reason : "", /isn't an action/);
});
