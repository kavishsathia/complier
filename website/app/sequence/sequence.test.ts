// Tests for the sequence diagrams: the policy parser, what's drawn, and the geometry the user asked
// for (attempt, allow and result on the left of one monitor bar). Run with `npm test`.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { arrange, type Shape } from "./arrange.ts";
import { AGENT, diagram, type Item } from "./diagram.ts";
import { EXAMPLES } from "./examples.ts";
import { parsePolicy } from "./policy.ts";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const draw = (src: string) => diagram(parsePolicy(src));
const head = "datatype Act = a | b | c | other\ndatatype Value = done | failed\nReturns(_) = {done, failed}\n";

// The happy path as text: exchanges, states, loops and fragments.
const outline = (items: Item[]): string[] =>
  items.map((it) => {
    switch (it.k) {
      case "exchange":
        return `${it.role ? `${it.role}.` : ""}${it.act}${it.values ? `:${it.values.join("|")}` : ""}`;
      case "state":
        return `(${it.label})`;
      case "loop":
        return `↺${it.label}`;
      case "choice":
        return `[] ${it.ops.map((o) => `{${o.label}: ${outline(o.items).join(" ")}}`).join(" ")}`;
      case "results":
        return `result ${it.ops.map((o) => `{${o.values.join("|")}: ${outline(o.items).join(" ")}}`).join(" ")}`;
      case "denied":
        return `denied(${it.events.join(",")})`;
      default:
        return it.k;
    }
  });

test("the default example is the demo machine's spec, as complier machine up loads it", () => {
  assert.equal(EXAMPLES[0].src, read("examples/demo/draft.csp"));
  assert.equal(EXAMPLES[2].src, read("cli/tests/fixtures/gate.csp"));
});

test("the demo machine: one agent, one monitor, and the denials left out", () => {
  const d = draw(read("examples/demo/draft.csp"));
  assert.deepEqual(d.agents, [AGENT]);
  assert.deepEqual(outline(d.items), ["(Policy = Draft)", "draft:done|failed", "(Recreate)", "recreate:done|failed", "↺Draft"]);
  assert.deepEqual(
    d.omitted.map((o) => `${o.event}@${o.at}`).sort(),
    ["deny.other@Draft", "deny.other@Recreate"],
  );
});

test("external choice stays a choice: each operand is offered, and is taken by an attempt", () => {
  const d = draw(read("cli/tests/fixtures/unsafe.csp"));
  assert.deepEqual(outline(d.items), [
    "(Policy)",
    "[] {attempts appended: appended:done|failed ↺Policy} {attempts replaced: replaced:done|failed ↺Policy}",
  ]);
  // [] is associative: nested choices are one fragment.
  const nested = draw(head + "Policy = Permit(a, \\ _ @ Policy) [] (Permit(b, \\ _ @ STOP) [] Permit(c, \\ _ @ SKIP))");
  assert.deepEqual(outline(nested.items), [
    "(Policy)",
    "[] {attempts a: a:done|failed ↺Policy} {attempts b: b:done|failed stop} {attempts c: c:done|failed skip}",
  ]);
});

test("a result that decides the way on is a fragment over the call's values", () => {
  const d = draw(read("cli/tests/fixtures/gate.csp"));
  assert.deepEqual(outline(d.items), [
    "(Policy)",
    "check",
    "result {big: (Checked(big)) write:done|failed ↺Policy} {small|failed: (Checked(_)) ↺Policy}",
  ]);
  const review = draw(EXAMPLES[1].src);
  const results = JSON.stringify(outline(review.items));
  assert.match(results, /result \{approved: \(Approved\)/);
  assert.match(results, /\{rejected: ↺Drafted\}/);
});

test("Permit is the prelude's three events: writing them out draws the same diagram", () => {
  const permit = draw(head + "Policy = Permit(a, \\ _ @ Policy) [] Deny(other, Policy)");
  const raw = draw(head + "Policy = attempt.a -> allow.a -> result.a?v : Returns(a) -> Policy [] attempt.other -> deny.other -> Policy");
  assert.deepEqual(raw.items, permit.items);
  assert.deepEqual(raw.omitted, permit.omitted);
  // A policy that accepts only some of the call's results isn't admissible.
  assert.throws(() => draw(head + "Policy = attempt.a -> allow.a -> result.a.done -> Policy"), /doesn't accept result\.a\.failed/);
});

test("denials and refusals are never drawn; a state with only denials says so", () => {
  for (const { src } of EXAMPLES) {
    const shapes = arrange(draw(src)).shapes;
    assert.ok(!shapes.some((s) => s.k === "arrow" && /^(deny|refuse)/.test(s.label)));
  }
  const d = draw(head + "Policy = Permit(a, \\ _ @ Closed)\nClosed = Deny(other, Closed)");
  assert.deepEqual(outline(d.items), ["(Policy)", "a:done|failed", "(Closed)", "denied(deny.other)"]);
});

// The user's notation: one activation bar on the monitor per allowed call, with attempt in, allow
// out and result in, all on its left.
test("each exchange is three arrows on the left of one monitor bar", () => {
  for (const { name, src } of EXAMPLES) {
    const { shapes } = arrange(draw(src));
    const monitor = shapes.find((s): s is Extract<Shape, { k: "actor" }> => s.k === "actor" && s.title === "Monitor")!;
    const bars = shapes.filter((s): s is Extract<Shape, { k: "bar" }> => s.k === "bar" && s.who === "monitor");
    const arrows = shapes.filter((s): s is Extract<Shape, { k: "arrow" }> => s.k === "arrow");
    assert.ok(arrows.length >= 3, name);
    for (const a of arrows) {
      const end = a.kind === "allow" ? a.x1 : a.x2;
      const start = a.kind === "allow" ? a.x2 : a.x1;
      assert.ok(start < end, `${name}: ${a.label} runs between an agent on the left and the monitor`);
      const bar = bars.find((b) => b.y1 < a.y && a.y < b.y2);
      assert.ok(bar, `${name}: ${a.label} meets a monitor bar`);
      assert.equal(end, bar!.x - 6, `${name}: ${a.label} meets the bar's left side`);
      assert.equal(bar!.x, monitor.x);
    }
    // Where the results don't branch, every bar holds exactly attempt, allow and result.
    for (const b of bars) {
      const kinds = arrows.filter((a) => b.y1 < a.y && a.y < b.y2).map((a) => a.kind);
      assert.ok(
        ["attempt,allow,result", "attempt,allow", "result"].includes(kinds.join(",")),
        `${name}: a bar holds ${kinds.join(",")}`,
      );
    }
  }
});

test("roles: one ControllableCHAOS lifeline per role, and each arrow starts at its role's", () => {
  const d = draw(EXAMPLES[3].src);
  assert.deepEqual(d.agents, ["writer", "reviewer"]);
  const { shapes } = arrange(d);
  const x = (title: string) => (shapes.find((s) => s.k === "actor" && s.title === title) as { x: number }).x;
  for (const s of shapes) {
    if (s.k !== "arrow") continue;
    const role = s.label.split(".")[1];
    const agentEnd = s.kind === "allow" ? s.x2 : s.x1;
    assert.equal(agentEnd, x(role) + 6, s.label);
  }
  assert.match(outline(d.items).join(" "), /\{reviewer attempts approve: reviewer\.approve/);
  assert.throws(() => draw(EXAMPLES[3].src.replace("Permit(writer, draft", "Permit(editor, draft")), /editor/);
});

test("the repository's policies draw, and the one FDR rejects for an unanswered attempt is refused here too", () => {
  const dir = new URL("cli/tests/fixtures/", root);
  const specs = readdirSync(dir).filter((f) => f.endsWith(".csp"));
  assert.ok(specs.length >= 4);
  for (const f of specs) {
    const src = readFileSync(new URL(f, dir), "utf8");
    if (f === "unanswered.csp") assert.throws(() => draw(src), /attempt\.replaced must be answered/);
    else assert.ok(draw(src).items.length > 1, f);
  }
});

test("what isn't drawn is an error that names it", () => {
  const cases: [string, RegExp][] = [
    ["Policy = Permit(a, \\ _ @ Policy) |~| Permit(b, \\ _ @ Policy)", /internal choice/],
    ["Policy = Permit(a, \\ _ @ Policy) ||| Permit(b, \\ _ @ Policy)", /interleaving/],
    ["Policy = [] x : {a, b} @ Permit(x, \\ _ @ Policy)", /replicated choice/],
    ["Policy = tick -> Policy", /tick isn't drawn/],
    ["Policy = allow.a -> Policy", /comes before any attempt/],
    ["Policy = Permit(zap, \\ _ @ Policy)", /zap is neither/],
    ["Policy = Next", /Next is used but never defined/],
    ["ControllableCHAOS = STOP\nPolicy = STOP", /prelude/],
  ];
  for (const [src, error] of cases) assert.throws(() => draw(head + src), error, src);
  // A definition that doesn't parse matters only once the policy reaches it.
  assert.doesNotThrow(() => draw(head + "Policy = Permit(a, \\ _ @ Policy)\nUnused = a |~| b"));
  assert.throws(() => draw(head + "Policy = Permit(a, \\ _ @ Unused)\nUnused = a |~| b"), /line 5/);
  assert.throws(() => draw("datatype Value = done\nPolicy = STOP"), /datatype Act/);
});

test("assertions and helper processes in a spec are skipped", () => {
  const d = draw(read("cli/tests/fixtures/unsafe.csp"));
  assert.equal(d.items[0].k, "state");
});
