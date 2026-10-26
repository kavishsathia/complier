// Cross-checks the stepper against FDR: for each spec, the stepper's traces up
// to a length must be exactly FDR's traces of the same source, cut to that
// length. Skipped unless FDR is found as fdr/env.sh finds it: FDR_HOME, or
// `refines` on PATH, with TINFO5_DIR where libtinfo.so.5 is missing.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { EXAMPLES } from "./example.ts";
import { parse } from "./parse.ts";
import { traces } from "./traces.ts";

function refines(): string | null {
  const home = process.env.FDR_HOME;
  if (home && existsSync(join(home, "bin/refines"))) return join(home, "bin/refines");
  try {
    return execFileSync("sh", ["-c", "command -v refines"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

const bin = refines();

// The builtin, as fdr/src/guard_driver.cc defines it for FDR.
const PRELUDE = `external prioritise
ControllableCHAOS(A, R) =
    (STOP |~| (|~| x:A @ x -> ControllableCHAOS(A, R)))
    [] ([] r:R @ r -> ControllableCHAOS(A, R))
LimitTraces(n) = n > 0 & ([] e:Events @ e -> LimitTraces(n - 1))
`;

// A process whose traces are exactly the given set (prefix-closed, no ✓).
function tree(ts: Set<string>): string {
  const defs: string[] = [];
  const build = (prefix: string[]): string => {
    const name = `StepperTrace${defs.length}`;
    defs.push("");
    const at = defs.length - 1;
    const next = new Set<string>();
    for (const t of ts) {
      const evs = t ? t.split(",") : [];
      if (evs.length > prefix.length && prefix.every((e, i) => evs[i] === e)) next.add(evs[prefix.length]!);
    }
    const branches = [...next].map((e) => `${e} -> ${build([...prefix, e])}`);
    defs[at] = `${name} = ${branches.length ? branches.join(" [] ") : "STOP"}`;
    return name;
  };
  build([]);
  return defs.join("\n");
}

// Runs the assertions in order and returns whether each passed.
function check(script: string): boolean[] {
  const dir = mkdtempSync(join(tmpdir(), "stepper-fdr-"));
  const file = join(dir, "check.csp");
  writeFileSync(file, script);
  const lib = [process.env.TINFO5_DIR, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":");
  const out = execFileSync(bin!, ["-f", "plain", file], {
    encoding: "utf8",
    env: { ...process.env, LD_LIBRARY_PATH: lib },
    timeout: 120_000,
  });
  return [...out.matchAll(/Result: (Passed|Failed)/g)].map((m) => m[1] === "Passed");
}

const DEPTH = 5;

const sameTraces = (name: string, src: string, depth = DEPTH) => {
  const spec = parse(src);
  const ts = traces(spec, spec.defs.get("MAIN")!.body, depth);
  assert.ok(![...ts].some((t) => t.includes("✓")), "these checks don't model termination");
  const script = `${PRELUDE}\n${src}\n${tree(ts)}\nBounded = MAIN [| Events |] LimitTraces(${depth})
assert StepperTrace0 [T= Bounded
assert Bounded [T= StepperTrace0
`;
  assert.deepEqual(check(script), [true, true], `${name}: the stepper's traces differ from FDR's`);
};

test("FDR agrees with the stepper on every example", { skip: !bin && "FDR not found" }, () => {
  for (const { name, src } of EXAMPLES) sameTraces(name, src);
});

test("FDR agrees on interleaving, internal choice and prioritise", { skip: !bin && "FDR not found" }, () => {
  const ch = "channel a, b, c\n";
  sameTraces("interleave", ch + "MAIN = (a -> b -> STOP) ||| (a -> c -> STOP)");
  sameTraces("internal choice", ch + "MAIN = (a -> MAIN |~| b -> MAIN) [] c -> STOP", 4);
  sameTraces("prioritise", ch + "MAIN = prioritise((a -> STOP [] (b -> STOP |~| c -> STOP)) ||| (b -> STOP), <{a}, {b}>)", 3);
});

// The check can tell the constructions apart: the historical guard, where a
// refusal interrupts and restarts the policy, has different traces.
test("FDR tells the interleaved guard from the historical reset guard", { skip: !bin && "FDR not found" }, () => {
  const src = EXAMPLES[0]!.src;
  const spec = parse(src);
  const ts = traces(spec, spec.defs.get("MAIN")!.body, DEPTH);
  const script = `${PRELUDE}\n${src}
RESET = POLICY /\\ (refuse -> RESET)
OLD = prioritise(ControllableCHAOS({draft, review, publish}, {refuse}) [| {draft, review, publish, refuse} |] RESET,
                 <{draft, review, publish}, {refuse}>)
${tree(ts)}
Bounded = OLD [| Events |] LimitTraces(${DEPTH})
assert Bounded [T= StepperTrace0
`;
  assert.deepEqual(check(script), [false]);
});
