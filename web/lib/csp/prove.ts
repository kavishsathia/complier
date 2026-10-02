import "server-only";
import { init } from "z3-solver";
import { CspError, Program } from "./ast";
import { paramTypes } from "./check";
import { bmcNames, Chc, compileBmc, compileChc, relevantLeaves, relevantParams, renderChc } from "./chc";
import { inferEqualities } from "./houdini";
import { formatEvent, formatValue } from "./monitor";
import { buildLeaves, buildMoves, collapse, Leaf, params, STOP } from "./moves";
import { parse } from "./parser";
import { prettyFacts } from "./pretty";

const TIMEOUT_MS = 20000;
const MAX_TRACE = 16;
const INFER_BUDGET_MS = 8000;

export interface TraceStep {
  event: string | null; // null for the initial state
  state: string[];
}

export interface AssertionResult {
  assertion: string;
  process: string;
  status: "holds" | "violated" | "unknown";
  // the inductive invariant Spacer found, per control state of the system
  certificate?: { state: string; facts: string[] }[];
  trace?: TraceStep[];
  note?: string;
  ms: number;
}

export type ProveResponse =
  | { ok: true; results: AssertionResult[] }
  | { ok: false; error: string; line: number };

type Z3 = Awaited<ReturnType<typeof init>>["Z3"];
let z3: Promise<Z3> | null = null;
let queue: Promise<unknown> = Promise.resolve();

// Z3's wasm build runs one query at a time, so calls are serialised.
function run(script: string): Promise<string> {
  z3 ??= init().then((m) => {
    m.Z3.global_param_set("timeout", String(TIMEOUT_MS));
    return m.Z3;
  });
  const job = queue.then(async () => {
    const api = await z3!;
    const cfg = api.mk_config();
    const ctx = api.mk_context(cfg);
    api.del_config(cfg);
    try {
      return await api.eval_smtlib2_string(ctx, script);
    } finally {
      api.del_context(ctx);
    }
  });
  queue = job.catch(() => undefined);
  return job;
}

function firstLine(out: string): string {
  return out.trim().split("\n")[0].trim();
}

// Z3 names predicate arguments x!0, x!1 ...; put the parameter names back and
// print each control state's invariant as plain facts.
function readableModel(model: string, predicates: Map<string, { state: string; args: string[] }>) {
  const defs = model.split(/\n(?=\s*\(define-fun )/).map((d) => d.trim()).filter((d) => d.startsWith("(define-fun"));
  return defs.map((d) => {
    const name = d.match(/^\(define-fun (\S+)/)?.[1] ?? "";
    const pred = predicates.get(name);
    const body = d.replace(/^\(define-fun \S+ \([\s\S]*?\) Bool\s*/, "").replace(/\)\s*$/, "").trim();
    return { state: pred?.state ?? name, facts: prettyFacts(body, pred?.args ?? []) };
  });
}

function parseValues(out: string): Map<string, number> {
  const values = new Map<string, number>();
  for (const m of out.matchAll(/\((\w+) (\(- \d+\)|-?\d+)\)/g)) {
    const raw = m[2].startsWith("(") ? -Number(m[2].slice(3, -1)) : Number(m[2]);
    values.set(m[1], raw);
  }
  return values;
}

function describeState(prog: Program, leaves: Leaf[], v: Map<string, number>, t: number): string[] {
  const types = paramTypes(prog);
  return leaves.map((leaf, i) => {
    const li = v.get(bmcNames.loc(t, i)) ?? 0;
    const loc = leaf.locations[li];
    if (loc === STOP) return STOP;
    const ps = params(prog, loc);
    if (!ps.length) return loc;
    const shown = ps.map((p, pi) => `${p}=${formatValue(prog, v.get(bmcNames.val(t, i, li, pi)) ?? 0, types.get(loc)![pi])}`);
    return `${loc}(${shown.join(", ")})`;
  });
}

async function findTrace(prog: Program, leaves: Leaf[], moves: ReturnType<typeof buildMoves>, a: Program["assertions"][number]) {
  for (let depth = 0; depth <= MAX_TRACE; depth++) {
    const bmc = compileBmc(prog, leaves, moves, a, depth);
    const out = await run(bmc.script);
    if (firstLine(out) !== "sat") continue;
    const v = parseValues(out);
    const steps: TraceStep[] = [{ event: null, state: describeState(prog, leaves, v, 0) }];
    for (let t = 0; t < depth; t++) {
      const move = moves[v.get(bmcNames.move(t)) ?? 0];
      const arity = prog.channels.get(move.channel)!.length;
      const values = Array.from({ length: arity }, (_, k) => v.get(bmcNames.ev(t, k)) ?? 0);
      steps.push({
        event: formatEvent(prog, { channel: move.channel, values }),
        state: describeState(prog, leaves, v, t + 1),
      });
    }
    return steps;
  }
  return null;
}

// Equalities between processes are inferred first and assumed in the
// clauses; they are proven invariants, and they spare Spacer from
// rediscovering, say, that an agent's count of the stock matches the shelf.
async function solve(chc: Chc): Promise<string> {
  const facts = await inferEqualities(chc, run, INFER_BUDGET_MS);
  return run(renderChc(chc, facts));
}

export async function prove(source: string): Promise<ProveResponse> {
  let prog: Program;
  try {
    prog = parse(source);
  } catch (e) {
    if (e instanceof CspError) return { ok: false, error: e.message, line: e.line };
    throw e;
  }
  if (!prog.assertions.length) {
    return { ok: false, error: "add an assertion to prove, e.g. assert Account :[always bal >= 0]", line: 0 };
  }
  try {
    const leaves = buildLeaves(prog);
    const moves = buildMoves(prog, leaves);
    const results: AssertionResult[] = [];
    for (const a of prog.assertions) {
      const started = Date.now();
      // Try first with only the processes and parameters the assertion can
      // depend on. That over-approximates the system, so "holds" is final;
      // anything else is retried on the exact encoding.
      const keep = relevantParams(prog, moves, a);
      const live = relevantLeaves(prog, leaves, moves, a, keep);
      const drop = new Set(leaves.map((_, i) => i).filter((i) => !live.has(i)));
      const total = [...prog.procs.values()].reduce((n, d) => n + d.params.length, 0);
      const small = collapse(leaves, moves, drop);
      let chc = compileChc(prog, small.leaves, small.moves, a, keep);
      let out = await solve(chc);
      let verdict = firstLine(out);
      if (verdict !== "sat" && (keep.size < total || drop.size > 0)) {
        chc = compileChc(prog, leaves, moves, a);
        out = await solve(chc);
        verdict = firstLine(out);
      }
      const base = { assertion: a.text, process: a.process, ms: 0 };
      if (verdict === "sat") {
        results.push({
          ...base,
          status: "holds",
          certificate: readableModel(out.slice(out.indexOf("\n")), chc.predicates),
          ms: Date.now() - started,
        });
      } else if (verdict === "unsat") {
        const trace = await findTrace(prog, leaves, moves, a);
        results.push({
          ...base,
          status: "violated",
          trace: trace ?? undefined,
          note: trace ? undefined : `the shortest violating run is longer than ${MAX_TRACE} events`,
          ms: Date.now() - started,
        });
      } else {
        results.push({
          ...base,
          status: "unknown",
          note: verdict.startsWith("(error") ? verdict : `the solver gave up after ${TIMEOUT_MS / 1000}s`,
          ms: Date.now() - started,
        });
      }
    }
    return { ok: true, results };
  } catch (e) {
    if (e instanceof CspError) return { ok: false, error: e.message, line: e.line };
    throw e;
  }
}
