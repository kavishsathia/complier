import { Assertion, Branch, Expr, Program } from "./ast";
import { evalExpr } from "./monitor";
import { ANY, Leaf, Move, STOP, buildCombos, params } from "./moves";

// Compile the composed system to constrained Horn clauses (SMT-LIB, logic
// HORN). Each control state of the product gets one predicate over the
// parameters of the processes it is made of; each move becomes one clause; an
// assertion becomes one query per control state where its process is active.
// The clauses are satisfiable exactly when no reachable state violates the
// assertion, and the model Spacer returns is the inductive invariant.

type Resolve = (name: string) => string;

export function smt(prog: Program, e: Expr, resolve: Resolve): string {
  switch (e.kind) {
    case "int":
      return e.value < 0 ? `(- ${-e.value})` : String(e.value);
    case "name": {
      const c = prog.constructors.get(e.name);
      return c && !isBound(resolve, e.name) ? String(c.index) : resolve(e.name);
    }
    case "if":
      return `(ite ${smt(prog, e.cond, resolve)} ${smt(prog, e.then, resolve)} ${smt(prog, e.else, resolve)})`;
    case "unary":
      return e.op === "-" ? `(- ${smt(prog, e.arg, resolve)})` : `(not ${smt(prog, e.arg, resolve)})`;
    case "binary": {
      const l = smt(prog, e.left, resolve);
      const r = smt(prog, e.right, resolve);
      if (e.op === "==") return `(= ${l} ${r})`;
      if (e.op === "!=") return `(not (= ${l} ${r}))`;
      return `(${e.op} ${l} ${r})`;
    }
  }
}

function isBound(resolve: Resolve, name: string): boolean {
  try {
    resolve(name);
    return true;
  } catch {
    return false;
  }
}

function scoped(base: Map<string, string>): Resolve {
  return (name) => {
    const v = base.get(name);
    if (v === undefined) throw new Error(`unbound ${name}`);
    if (v === UNTRACKED) throw new Error(`untracked ${name}`);
    return v;
  };
}

// An argument that passes one of the caller's own parameters along unchanged.
function isCopy(prog: Program, loc: string, arg: Expr, param: string): boolean {
  return arg.kind === "name" && arg.name === param && params(prog, loc).includes(arg.name);
}

// The parameters an assertion can depend on: those it mentions, plus anything
// that flows into them through call arguments and shared event fields. Keys
// are "Process.param".
export function relevantParams(prog: Program, moves: Move[], assertion: Assertion): Set<string> {
  const names = (e: Expr, out: Set<string> = new Set()): Set<string> => {
    if (e.kind === "name") out.add(e.name);
    else if (e.kind === "unary") names(e.arg, out);
    else if (e.kind === "binary") { names(e.left, out); names(e.right, out); }
    else if (e.kind === "if") { names(e.cond, out); names(e.then, out); names(e.else, out); }
    return out;
  };
  const relevant = new Set<string>();
  const ownParams = new Set(params(prog, assertion.process));
  for (const n of names(assertion.property)) if (ownParams.has(n)) relevant.add(`${assertion.process}.${n}`);

  let changed = true;
  while (changed) {
    changed = false;
    const mark = (key: string) => {
      if (!relevant.has(key)) {
        relevant.add(key);
        changed = true;
      }
    };
    for (const move of moves) {
      // A move that changes a relevant parameter makes its guards and the
      // data it reads relevant too, since they decide when the change happens.
      const touches = move.parts.some((part) => {
        const t = part.branch.target;
        if (!t) return false;
        return params(prog, t.name).some((tp, i) => {
          if (!relevant.has(`${t.name}.${tp}`)) return false;
          return !isCopy(prog, part.loc, t.args[i], tp);
        });
      });
      if (touches) {
        for (const part of move.parts) {
          const own = new Set(params(prog, part.loc));
          const used = new Set<string>();
          if (part.branch.guard) names(part.branch.guard, used);
          for (const f of part.branch.fields) {
            if (f.kind === "out") names(f.expr, used);
            else if (f.range) { names(f.range.lo, used); names(f.range.hi, used); }
          }
          for (const n of used) if (own.has(n)) mark(`${part.loc}.${n}`);
        }
      }
      const fields = new Set<number>();
      // which event fields feed a relevant parameter
      for (const part of move.parts) {
        const b = part.branch;
        if (!b.target) continue;
        const inputs = new Map<string, number>();
        b.fields.forEach((f, k) => { if (f.kind === "in") inputs.set(f.name, k); });
        const own = new Set(params(prog, part.loc));
        params(prog, b.target.name).forEach((tp, i) => {
          if (!relevant.has(`${b.target!.name}.${tp}`)) return;
          for (const n of names(b.target!.args[i])) {
            if (inputs.has(n)) fields.add(inputs.get(n)!);
            else if (own.has(n)) mark(`${part.loc}.${n}`);
          }
        });
      }
      // and what determines those fields in every participant
      for (const part of move.parts) {
        const own = new Set(params(prog, part.loc));
        part.branch.fields.forEach((f, k) => {
          if (!fields.has(k)) return;
          const used = f.kind === "out" ? names(f.expr) : f.range ? names(f.range.lo, names(f.range.hi)) : new Set<string>();
          for (const n of used) if (own.has(n)) mark(`${part.loc}.${n}`);
        });
      }
    }
  }
  return relevant;
}

// Leaves whose behaviour an assertion can depend on: the ones holding a
// relevant parameter, plus any leaf that joins a move changing one.
export function relevantLeaves(
  prog: Program, leaves: Leaf[], moves: Move[], assertion: Assertion, keep: Set<string>,
): Set<number> {
  const out = new Set<number>();
  leaves.forEach((l, i) => {
    if (l.locations.includes(assertion.process)) out.add(i);
    for (const loc of l.locations) if (params(prog, loc).some((p) => keep.has(`${loc}.${p}`))) out.add(i);
  });
  for (const move of moves) {
    const changes = move.parts.some((part) => {
      const t = part.branch.target;
      return !!t && params(prog, t.name).some((tp, i) => {
        return keep.has(`${t.name}.${tp}`) && !isCopy(prog, part.loc, t.args[i], tp);
      });
    });
    if (changes) for (const part of move.parts) out.add(part.leaf);
  }
  return out;
}

// How the encoding treats one parameter of one leaf at one location: as a
// variable, as a known constant, or not at all (null, dropped by abstraction).
export type Slot = (leaf: number, loc: string, p: string) => "var" | number | null;

const numeral = (n: number) => (n < 0 ? `(- ${-n})` : String(n));

// The constraints one move puts on its event fields and the next values of the
// participating leaves. `cur(leaf, param)` and `nxt(leaf, loc, param)` name
// the variables, `ev(k)` names event field k. A constraint that mentions a
// dropped parameter is left out, which only adds behaviour, so a safety proof
// of the result still holds.
function moveConstraints(
  prog: Program,
  move: Move,
  cur: (leaf: number, p: string) => string,
  nxt: (leaf: number, p: string) => string,
  ev: (k: number) => string,
  slot: Slot,
): string[] {
  const out: string[] = [];
  const add = (make: () => string) => {
    try {
      out.push(make());
    } catch {
      // mentions an untracked parameter
    }
  };
  const types = prog.channels.get(move.channel)!;
  for (const part of move.parts) {
    const b: Branch = part.branch;
    const scope = new Map<string, string>();
    for (const p of params(prog, part.loc)) {
      const s = slot(part.leaf, part.loc, p);
      scope.set(p, s === "var" ? cur(part.leaf, p) : s === null ? UNTRACKED : numeral(s));
    }
    const resolve = scoped(scope);
    if (b.guard) add(() => smt(prog, b.guard!, resolve));
    b.fields.forEach((f, k) => {
      if (f.kind === "out") {
        add(() => `(= ${ev(k)} ${smt(prog, f.expr, resolve)})`);
        return;
      }
      const ctors = prog.datatypes.get(types[k]);
      if (ctors) out.push(`(<= 0 ${ev(k)})`, `(<= ${ev(k)} ${ctors.length - 1})`);
      if (f.range) {
        add(() => `(<= ${smt(prog, f.range!.lo, resolve)} ${ev(k)})`);
        add(() => `(<= ${ev(k)} ${smt(prog, f.range!.hi, resolve)})`);
      }
      scope.set(f.name, ev(k));
    });
    if (b.target) {
      const t = b.target;
      params(prog, t.name).forEach((tp, i) => {
        if (slot(part.leaf, t.name, tp) === "var") add(() => `(= ${nxt(part.leaf, tp)} ${smt(prog, t.args[i], resolve)})`);
      });
    }
  }
  return out;
}

// Marks a parameter the abstraction dropped; resolving it aborts the constraint.
const UNTRACKED = "\u0000untracked";

const and = (xs: string[]) => (xs.length === 0 ? "true" : xs.length === 1 ? xs[0] : `(and ${xs.join(" ")})`);
const forall = (vars: string[], body: string) =>
  vars.length ? `(forall (${vars.map((v) => `(${v} Int)`).join(" ")}) ${body})` : body;
const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");

export interface Chc {
  script: string;
  // predicate name to its control state and readable argument names
  predicates: Map<string, { state: string; args: string[] }>;
}

// Parameters that keep one value for the whole life of a leaf, such as the
// owner in Assistant(Alice), keyed "Process.param" per leaf. Inlining them
// saves the solver from rediscovering them.
export function leafConstants(prog: Program, leaf: Leaf): Map<string, number> {
  const known = new Map<string, number | "var">();
  const evalConst = (e: Expr, env: Map<string, number>): number | "var" => {
    try {
      return evalExpr(prog, e, env);
    } catch {
      return "var";
    }
  };
  const merge = (key: string, v: number | "var"): boolean => {
    const old = known.get(key);
    if (old === undefined) { known.set(key, v); return true; }
    if (old !== "var" && old !== v) { known.set(key, "var"); return true; }
    return false;
  };
  const queue: string[] = [];
  if (leaf.initial.loc !== ANY) {
    params(prog, leaf.initial.loc).forEach((p, i) =>
      merge(`${leaf.initial.loc}.${p}`, evalConst(leaf.initial.args[i], new Map())));
    queue.push(leaf.initial.loc);
  }
  const visited = new Set<string>();
  while (queue.length) {
    const loc = queue.shift()!;
    visited.add(loc);
    if (loc === STOP || loc === ANY) continue;
    const env = new Map<string, number>();
    for (const p of params(prog, loc)) {
      const v = known.get(`${loc}.${p}`);
      if (typeof v === "number") env.set(p, v);
    }
    for (const b of prog.procs.get(loc)!.branches) {
      if (!b.target) continue;
      // inputs shadow parameters, so a name bound by this prefix is never constant
      const inner = new Map(env);
      for (const f of b.fields) if (f.kind === "in") inner.delete(f.name);
      let changed = false;
      params(prog, b.target.name).forEach((tp, i) => {
        changed = merge(`${b.target!.name}.${tp}`, evalConst(b.target!.args[i], inner)) || changed;
      });
      if (changed || !visited.has(b.target.name)) queue.push(b.target.name);
    }
  }
  const out = new Map<string, number>();
  for (const [k, v] of known) if (typeof v === "number") out.set(k, v);
  return out;
}

// With `keep`, only those parameters ("Process.param") are tracked; see
// relevantParams. Without it the encoding is exact.
export function compileChc(
  prog: Program, leaves: Leaf[], moves: Move[], assertion: Assertion, keep?: Set<string>,
): Chc {
  const consts = leaves.map((l) => leafConstants(prog, l));
  const slot: Slot = (leaf, loc, p) => {
    const c = consts[leaf].get(`${loc}.${p}`);
    if (c !== undefined) return c;
    return !keep || keep.has(`${loc}.${p}`) ? "var" : null;
  };
  const vis = (leaf: number, loc: string) => params(prog, loc).filter((p) => slot(leaf, loc, p) === "var");
  const combos = buildCombos(leaves);
  const predName = (combo: string[]) => `at_${combo.map(sanitize).join("_")}`;
  const curVar = (leaf: number, p: string) => `s${leaf}_${sanitize(p)}`;
  const nxtVar = (leaf: number, p: string) => `n${leaf}_${sanitize(p)}`;
  const evVar = (k: number) => `ev${k}`;
  const args = (combo: string[], name: (leaf: number, p: string) => string) =>
    combo.flatMap((loc, leaf) => vis(leaf, loc).map((p) => name(leaf, p)));
  const app = (combo: string[], vars: string[]) =>
    vars.length ? `(${predName(combo)} ${vars.join(" ")})` : predName(combo);

  const lines = ["(set-logic HORN)"];
  const predicates = new Map<string, { state: string; args: string[] }>();
  for (const combo of combos) {
    const readable = combo.flatMap((loc, leaf) => vis(leaf, loc).map((p) => `${leaves[leaf].label}.${p}`));
    predicates.set(predName(combo), { state: combo.join(" ‖ "), args: readable });
    lines.push(`(declare-fun ${predName(combo)} (${readable.map(() => "Int").join(" ")}) Bool)`);
  }

  const init = leaves.map((l) => l.initial.loc);
  const initArgs = leaves.flatMap((l, leaf) => {
    const kept = new Set(vis(leaf, l.initial.loc));
    return params(prog, l.initial.loc).flatMap((p, i) =>
      kept.has(p) ? [smt(prog, l.initial.args[i], scoped(new Map()))] : [],
    );
  });
  lines.push(`(assert ${app(init, initArgs)})`);

  for (const combo of combos) {
    for (const move of moves) {
      if (!move.parts.every((p) => combo[p.leaf] === p.loc)) continue;
      const after = [...combo];
      for (const p of move.parts) after[p.leaf] = p.branch.target ? p.branch.target.name : STOP;
      const moving = new Set(move.parts.map((p) => p.leaf));
      const headArgs = after.flatMap((loc, leaf) =>
        vis(leaf, loc).map((p) => (moving.has(leaf) ? nxtVar(leaf, p) : curVar(leaf, p))),
      );
      const fieldCount = prog.channels.get(move.channel)!.length;
      const vars = [
        ...args(combo, curVar),
        ...Array.from({ length: fieldCount }, (_, k) => evVar(k)),
        ...after.flatMap((loc, leaf) => (moving.has(leaf) ? vis(leaf, loc).map((p) => nxtVar(leaf, p)) : [])),
      ];
      const body = and([app(combo, args(combo, curVar)), ...moveConstraints(prog, move, curVar, nxtVar, evVar, slot)]);
      lines.push(`(assert ${forall(vars, `(=> ${body} ${app(after, headArgs)})`)})`);
    }
  }

  for (const combo of combos) {
    combo.forEach((loc, leaf) => {
      if (loc !== assertion.process) return;
      const scope = new Map(params(prog, loc).map((p) => {
        const sl = slot(leaf, loc, p);
        return [p, sl === "var" ? curVar(leaf, p) : sl === null ? UNTRACKED : numeral(sl)];
      }));
      const bad = smt(prog, assertion.property, scoped(scope));
      const vars = args(combo, curVar);
      lines.push(`(assert ${forall(vars, `(=> (and ${app(combo, vars)} (not ${bad})) false)`)})`);
    });
  }

  lines.push("(check-sat)", "(get-model)");
  return { script: lines.join("\n"), predicates };
}

// Bounded unrolling used only after Spacer reports a violation, to recover a
// concrete shortest counterexample. Each leaf keeps a location index and one
// variable per (location, parameter); moves frame everything they don't touch.
export interface Bmc {
  script: string;
  values: string[]; // variables to read back from the model
}

export const bmcNames = {
  move: (t: number) => `mv_${t}`,
  ev: (t: number, k: number) => `ev_${t}_${k}`,
  loc: (t: number, leaf: number) => `l_${t}_${leaf}`,
  val: (t: number, leaf: number, li: number, pi: number) => `v_${t}_${leaf}_${li}_${pi}`,
};

export function compileBmc(prog: Program, leaves: Leaf[], moves: Move[], assertion: Assertion, depth: number): Bmc {
  const N = bmcNames;
  const maxFields = Math.max(0, ...[...prog.channels.values()].map((t) => t.length));
  const decls: string[] = [];
  const declare = (v: string) => decls.push(`(declare-const ${v} Int)`);
  const stateVars = (t: number) =>
    leaves.flatMap((leaf, i) => [
      N.loc(t, i),
      ...leaf.locations.flatMap((loc, li) => params(prog, loc).map((_, pi) => N.val(t, i, li, pi))),
    ]);

  for (let t = 0; t <= depth; t++) stateVars(t).forEach(declare);
  for (let t = 0; t < depth; t++) {
    declare(N.move(t));
    for (let k = 0; k < maxFields; k++) declare(N.ev(t, k));
  }

  const facts: string[] = [];
  leaves.forEach((leaf, i) => {
    const li = leaf.locations.indexOf(leaf.initial.loc);
    facts.push(`(= ${N.loc(0, i)} ${li})`);
    leaf.initial.args.forEach((a, pi) => facts.push(`(= ${N.val(0, i, li, pi)} ${smt(prog, a, scoped(new Map()))})`));
  });

  for (let t = 0; t < depth; t++) {
    const options = moves.map((move, m) => {
      const cs: string[] = [`(= ${N.move(t)} ${m})`];
      const assigned = new Set<string>();
      for (const p of move.parts) {
        const leaf = leaves[p.leaf];
        cs.push(`(= ${N.loc(t, p.leaf)} ${leaf.locations.indexOf(p.loc)})`);
        const dst = p.branch.target ? p.branch.target.name : STOP;
        const dli = leaf.locations.indexOf(dst);
        cs.push(`(= ${N.loc(t + 1, p.leaf)} ${dli})`);
        params(prog, dst).forEach((_, pi) => assigned.add(N.val(t + 1, p.leaf, dli, pi)));
      }
      const cur = (leaf: number, p: string) => {
        const part = move.parts.find((x) => x.leaf === leaf)!;
        const li = leaves[leaf].locations.indexOf(part.loc);
        return N.val(t, leaf, li, params(prog, part.loc).indexOf(p));
      };
      const nxt = (leaf: number, p: string) => {
        const part = move.parts.find((x) => x.leaf === leaf)!;
        const dst = part.branch.target!.name;
        const li = leaves[leaf].locations.indexOf(dst);
        return N.val(t + 1, leaf, li, params(prog, dst).indexOf(p));
      };
      cs.push(...moveConstraints(prog, move, cur, nxt, (k) => N.ev(t, k), () => "var"));
      const moving = new Set(move.parts.map((p) => p.leaf));
      leaves.forEach((leaf, i) => {
        if (!moving.has(i)) cs.push(`(= ${N.loc(t + 1, i)} ${N.loc(t, i)})`);
        leaf.locations.forEach((loc, li) =>
          params(prog, loc).forEach((_, pi) => {
            const v = N.val(t + 1, i, li, pi);
            if (!assigned.has(v)) cs.push(`(= ${v} ${N.val(t, i, li, pi)})`);
          }),
        );
      });
      return and(cs);
    });
    facts.push(options.length ? `(or ${options.join(" ")})` : "false");
  }

  const bad: string[] = [];
  leaves.forEach((leaf, i) => {
    const li = leaf.locations.indexOf(assertion.process);
    if (li < 0) return;
    const scope = new Map(params(prog, assertion.process).map((p, pi) => [p, N.val(depth, i, li, pi)]));
    bad.push(`(and (= ${N.loc(depth, i)} ${li}) (not ${smt(prog, assertion.property, scoped(scope))}))`);
  });
  facts.push(bad.length ? `(or ${bad.join(" ")})` : "false");

  const values = [
    ...Array.from({ length: depth + 1 }, (_, t) => stateVars(t)).flat(),
    ...Array.from({ length: depth }, (_, t) => [
      N.move(t),
      ...Array.from({ length: maxFields }, (_, k) => N.ev(t, k)),
    ]).flat(),
  ];
  const script = [
    "(set-logic QF_LIA)",
    ...decls,
    ...facts.map((f) => `(assert ${f})`),
    "(check-sat)",
    values.length ? `(get-value (${values.join(" ")}))` : "",
  ].join("\n");
  return { script, values };
}
