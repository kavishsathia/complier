// The pattern pages show what complier does, so they're checked against complier itself:
// - compiled.ts holds the library and example specs exactly as they are in patterns/, and (with
//   complier-fdr built) the automata FDR compiles from them today;
// - every flow does what its steps say (`expect`), walked over those automata;
// - (with the complier binary built, cargo build in cli/) every flow, replayed by hand against a real
//   daemon, gets the same verdicts, refusal reasons included.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "./_data/build.mjs";
import { EXAMPLES, LIBRARY } from "./_data/compiled.ts";
import { PATTERNS } from "./_data/patterns.ts";
import { commands, play } from "./flow.ts";

const root = join(import.meta.dirname, "../../..");
const driver = join(root, "fdr/build/complier-fdr");
const bin = join(root, "cli/target/debug/complier");

test("compiled.ts holds the library and examples as they are in patterns/", () => {
  assert.equal(LIBRARY, readFileSync(join(root, "patterns/patterns.csp"), "utf8"));
  assert.deepEqual(Object.keys(EXAMPLES).sort(), PATTERNS.map((p) => p.slug).sort());
  for (const [slug, example] of Object.entries(EXAMPLES)) {
    assert.equal(example.spec, readFileSync(join(root, `patterns/examples/${slug}.csp`), "utf8"), slug);
  }
});

test("compiled.ts holds the automata FDR compiles now", { skip: !existsSync(driver) && "complier-fdr isn't built" }, () => {
  const fresh = build();
  for (const [slug, example] of Object.entries(EXAMPLES)) {
    assert.deepEqual(example.automaton, fresh.examples[slug].automaton, `${slug}: run node website/app/patterns/_data/build.mjs`);
  }
});

test("every flow does what its steps say", () => {
  for (const p of PATTERNS) {
    const { played } = play(p);
    for (const [i, { step, happened }] of played.entries()) {
      if ("act" in step) assert.equal(happened[0]!.kind === "act" && happened[0]!.outcome, step.expect, `${p.slug} step ${i + 1}`);
    }
    // Every role in the spec is on the stage, and every held call is answered by the end.
    assert.deepEqual(p.nodes.map((n) => n.role).sort(), [...EXAMPLES[p.slug]!.roles].sort(), p.slug);
    assert.deepEqual(played.at(-1)!.after.held, {}, p.slug);
  }
});

// A throwaway HOME for a daemon, borrowing the real FDR licence read-only, as cli/tests/e2e.rs does.
function daemon() {
  const home = mkdtempSync(join(tmpdir(), "complier-patterns-"));
  const licence = join(homedir(), ".config/fdr");
  if (existsSync(licence)) {
    mkdirSync(join(home, ".config"));
    symlinkSync(licence, join(home, ".config/fdr"));
  }
  const env = { ...process.env, HOME: home };
  const up = spawn(bin, ["up"], { env, stdio: "ignore" });
  const socket = join(home, ".complier/daemon.sock");
  for (let i = 0; i < 200 && !existsSync(socket); i++) spawnSync("sleep", ["0.05"]);
  const run = (args: string[]) => {
    const r = spawnSync(bin, args, { env, encoding: "utf8" });
    return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
  };
  const stop = () => {
    up.kill();
    rmSync(home, { recursive: true, force: true });
  };
  return { env, run, stop };
}

test("every flow gets the same verdicts from the real daemon", { skip: (!existsSync(bin) || !existsSync(driver)) && "complier or complier-fdr isn't built" }, async () => {
  const d = daemon();
  try {
    for (const p of PATTERNS) {
      const up = d.run(["machine", "up", p.slug, "--spec", join(root, `patterns/examples/${p.slug}.csp`)]);
      assert.ok(up.ok, `${p.slug}: ${up.out}`);
      const { played } = play(p);
      const lines = commands(p);
      // A held call's command waits for its verdict, so it runs in the background, as on the page; the
      // commands after it run straight away, as they do when the page's block is pasted, and its
      // verdict is checked at the end.
      const waiting = new Map<string, Promise<string>[]>();
      const verdicts = new Map<string, { act: string; outcome: string }[]>();
      for (const [i, { step, happened }] of played.entries()) {
        const args = lines[i]!.command.replace(/ & sleep 1$/, "").split(" ").slice(1);
        if (lines[i]!.held) {
          const child = spawn(bin, args, { env: d.env });
          let out = "";
          child.stdout.on("data", (c) => (out += c));
          child.stderr.on("data", (c) => (out += c));
          waiting.set(step.role, [...(waiting.get(step.role) ?? []), new Promise((done) => child.on("close", () => done(out)))]);
          await new Promise((r) => setTimeout(r, 1000)); // the page's `sleep 1`
          continue;
        }
        const { ok, out } = d.run(args);
        const own = happened[0]!;
        if (own.kind === "act") {
          assert.equal(ok, own.outcome === "allowed", `${p.slug} step ${i + 1}: ${out}`);
          assert.ok(out.includes(own.outcome === "allowed" ? `${own.act} allowed` : own.reason), `${p.slug} step ${i + 1}: ${out}`);
        } else assert.ok(ok, `${p.slug} step ${i + 1}: ${out}`);
        // The step that answers a held call says so, and the held call's own command prints it too.
        for (const h of happened) {
          if (h.kind !== "verdict") continue;
          assert.ok(out.includes(`so ${h.role}'s held ${h.act} is ${h.outcome}`), `${p.slug} step ${i + 1}: ${out}`);
          verdicts.set(h.role, [...(verdicts.get(h.role) ?? []), h]);
        }
      }
      // Each held call printed its own verdict.
      for (const [role, outs] of waiting) {
        const expected = verdicts.get(role) ?? [];
        assert.equal(outs.length, expected.length, `${p.slug}: ${role}'s held calls`);
        for (const [i, out] of (await Promise.all(outs)).entries()) {
          const h = expected[i]!;
          assert.ok(out.includes(`${h.act} held`) && out.includes(h.outcome === "allowed" ? `${h.act} allowed` : `${h.act} denied`), `${p.slug}: ${out}`);
        }
      }
      const ls = d.run(["machine", "ls"]).out.split("\n").find((l) => l.startsWith(`${p.slug}\t`));
      assert.ok(ls?.includes(`\t${played.at(-1)!.after.status}\t`), `${p.slug}: ${ls}`);
      d.run(["machine", "down", p.slug]);
    }
  } finally {
    d.stop();
  }
});

