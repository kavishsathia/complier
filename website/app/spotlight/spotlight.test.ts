import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { arrange } from "../sequence/arrange.ts";
import { diagram } from "../sequence/diagram.ts";
import { parsePolicy } from "../sequence/policy.ts";
import { GET } from "../api/workflows/route.ts";
import { FIXTURES } from "./fixtures.ts";
import { acts, search } from "./search.ts";
import { loadSaved, parseAbout } from "./workflows.ts";

// A complier folder laid out as `complier workflow save` and `apply` leave it.
function complierHome() {
  const dir = mkdtempSync(join(tmpdir(), "spotlight-"));
  const w = join(dir, "workflows", "test-before-commit");
  mkdirSync(w, { recursive: true });
  writeFileSync(join(w, "workflow.toml"), 'description = "Only commit after the tests pass"\nnoticed = "fix add(), \\"run\\" npm test, commit"\ncreated = "2026-11-12 18:31"\n');
  writeFileSync(join(w, "policy.csp"), FIXTURES[0].spec!.src);
  writeFileSync(join(w, "claude-code.yaml"), FIXTURES[0].units[0].src);
  const g = join(dir, "workflows", "review-gate");
  mkdirSync(g, { recursive: true });
  writeFileSync(join(g, "workflow.toml"), 'description = "Publishing needs an approved review"\ncreated = "2026-11-12 19:00"\n');
  writeFileSync(join(g, "review-gate.csp"), FIXTURES[1].spec!.src);
  mkdirSync(join(dir, "sessions"));
  writeFileSync(join(dir, "sessions", "96c828f2.json"), JSON.stringify({ workflow: "review-gate", machine: "workflow-review-gate", role: "claude" }));
  writeFileSync(join(dir, "sessions", "broken.json"), "{not json");
  return dir;
}

const snapshot = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, withFileTypes: false } as never).map((p) => `${p}:${statSync(join(dir, String(p))).mtimeMs}`).sort();

test("saved workflows are read as complier saves them, with the sessions each is applied to", () => {
  const dir = complierHome();
  const ws = loadSaved(dir);
  assert.deepEqual(ws.map((w) => w.name), ["review-gate", "test-before-commit"]);
  const [gate, tbc] = ws;
  assert.equal(tbc.description, "Only commit after the tests pass");
  assert.equal(tbc.noticed, 'fix add(), "run" npm test, commit');
  assert.equal(tbc.spec?.file, "policy.csp");
  assert.deepEqual(tbc.units.map((u) => u.file), ["claude-code.yaml"]);
  assert.deepEqual(tbc.sessions, []);
  assert.deepEqual(gate.sessions, ["96c828f2"]);
  assert.ok(ws.every((w) => w.source === "saved"));
});

test("reading changes nothing in the complier folder", () => {
  const dir = complierHome();
  const before = snapshot(dir);
  loadSaved(dir);
  assert.deepEqual(snapshot(dir), before);
});

test("a missing folder means no saved workflows, not an error", () => {
  assert.deepEqual(loadSaved(join(tmpdir(), "no-such-complier-dir-xyz")), []);
});

test("workflow.toml values are unescaped", () => {
  assert.deepEqual(parseAbout('a = "x \\"y\\" \\\\ z"\nb = "line\\nnext"\nnot a pair'), { a: 'x "y" \\ z', b: "line\nnext" });
});

test("search needs every word, and ranks names above steps and spec text", () => {
  const ws = loadSaved(complierHome());
  assert.deepEqual(search(ws, "").map((w) => w.name), ["review-gate", "test-before-commit"]);
  assert.deepEqual(search(ws, "commit").map((w) => w.name), ["test-before-commit"]);
  assert.deepEqual(search(ws, "review publish").map((w) => w.name), ["review-gate"]);
  assert.deepEqual(search(ws, "commit nothing-like-this"), []);
  // "Untested" is only in test-before-commit's spec; "gate" is in review-gate's name.
  assert.deepEqual(search(ws, "untested").map((w) => w.name), ["test-before-commit"]);
  assert.deepEqual(search(ws, "GATE").map((w) => w.name), ["review-gate"]);
});

test("the steps shown are the spec's Act datatype", () => {
  assert.deepEqual(acts(FIXTURES[0]), ["edit", "test", "commit", "other"]);
  assert.deepEqual(acts(FIXTURES[1]), ["submit", "review", "publish", "other"]);
});

test("every fixture is labelled as one and draws as a sequence diagram", () => {
  for (const f of FIXTURES) {
    assert.equal(f.source, "fixture");
    assert.deepEqual(f.sessions, [], "a fixture is never shown as applied");
    const layout = arrange(diagram(parsePolicy(f.spec!.src)));
    assert.ok(layout.shapes.some((s) => s.k === "arrow" && s.kind === "attempt"), f.name);
  }
});

test("the API reads COMPLIER_DIR locally and answers nothing on Vercel", async () => {
  const dir = complierHome();
  process.env.COMPLIER_DIR = dir;
  try {
    const local = await GET().json();
    assert.equal(local.dir, dir);
    assert.deepEqual(local.workflows.map((w: { name: string }) => w.name), ["review-gate", "test-before-commit"]);
    process.env.VERCEL = "1";
    const hosted = GET();
    assert.equal(hosted.status, 404);
    assert.equal((await hosted.json()).workflows, undefined);
  } finally {
    delete process.env.VERCEL;
    delete process.env.COMPLIER_DIR;
  }
});
