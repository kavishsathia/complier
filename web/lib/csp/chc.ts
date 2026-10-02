import { Assertion, Branch, Expr, Program } from "./ast";
import { Leaf, Move, STOP, buildCombos, params } from "./moves";

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
    return v;
  };
}

// The constraints one move puts on its event fields and the next values of the
// participating leaves. `cur(leaf, param)` and `nxt(leaf, loc, param)` name
// the variables, `ev(k)` names event field k.
function moveConstraints(
  prog: Program,
  move: Move,
  cur: (leaf: number, p: string) => string,
  nxt: (leaf: number, p: string) => string,
  ev: (k: number) => string,
): string[] {
  const out: string[] = [];
  const types = prog.channels.get(move.channel)!;
  for (const part of move.parts) {
    const b: Branch = part.branch;
    const scope = new Map(params(prog, part.loc).map((p) => [p, cur(part.leaf, p)]));
    if (b.guard) out.push(smt(prog, b.guard, scoped(scope)));
    b.fields.forEach((f, k) => {
      if (f.kind === "out") {
        out.push(`(= ${ev(k)} ${smt(prog, f.expr, scoped(scope))})`);
        return;
      }
      const ctors = prog.datatypes.get(types[k]);
      if (ctors) out.push(`(<= 0 ${ev(k)})`, `(<= ${ev(k)} ${ctors.length - 1})`);
      if (f.range) {
        out.push(`(<= ${smt(prog, f.range.lo, scoped(scope))} ${ev(k)})`);
        out.push(`(<= ${ev(k)} ${smt(prog, f.range.hi, scoped(scope))})`);
      }
      scope.set(f.name, ev(k));
    });
    if (b.target) {
      const targetParams = params(prog, b.target.name);
      b.target.args.forEach((a, i) => {
        out.push(`(= ${nxt(part.leaf, targetParams[i])} ${smt(prog, a, scoped(scope))})`);
      });
    }
  }
  return out;
}

const and = (xs: string[]) => (xs.length === 0 ? "true" : xs.length === 1 ? xs[0] : `(and ${xs.join(" ")})`);
const forall = (vars: string[], body: string) =>
  vars.length ? `(forall (${vars.map((v) => `(${v} Int)`).join(" ")}) ${body})` : body;
const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_]/g, "_");

export interface Chc {
  script: string;
  // predicate name to its control state and readable argument names
  predicates: Map<string, { state: string; args: string[] }>;
}

export function compileChc(prog: Program, leaves: Leaf[], moves: Move[], assertion: Assertion): Chc {
  const combos = buildCombos(leaves);
  const predName = (combo: string[]) => `at_${combo.map(sanitize).join("_")}`;
  const curVar = (leaf: number, p: string) => `s${leaf}_${sanitize(p)}`;
  const nxtVar = (leaf: number, p: string) => `n${leaf}_${sanitize(p)}`;
  const evVar = (k: number) => `ev${k}`;
  const args = (combo: string[], name: (leaf: number, p: string) => string) =>
    combo.flatMap((loc, leaf) => params(prog, loc).map((p) => name(leaf, p)));
  const app = (combo: string[], vars: string[]) =>
    vars.length ? `(${predName(combo)} ${vars.join(" ")})` : predName(combo);

  const lines = ["(set-logic HORN)"];
  const predicates = new Map<string, { state: string; args: string[] }>();
  for (const combo of combos) {
    const readable = combo.flatMap((loc, leaf) => params(prog, loc).map((p) => `${leaves[leaf].label}.${p}`));
    predicates.set(predName(combo), { state: combo.join(" ‖ "), args: readable });
    lines.push(`(declare-fun ${predName(combo)} (${readable.map(() => "Int").join(" ")}) Bool)`);
  }

  const init = leaves.map((l) => l.initial.loc);
  const initArgs = leaves.flatMap((l) => l.initial.args.map((a) => smt(prog, a, scoped(new Map()))));
  lines.push(`(assert ${app(init, initArgs)})`);

  for (const combo of combos) {
    for (const move of moves) {
      if (!move.parts.every((p) => combo[p.leaf] === p.loc)) continue;
      const after = [...combo];
      for (const p of move.parts) after[p.leaf] = p.branch.target ? p.branch.target.name : STOP;
      const moving = new Set(move.parts.map((p) => p.leaf));
      const headArgs = after.flatMap((loc, leaf) =>
        params(prog, loc).map((p) => (moving.has(leaf) ? nxtVar(leaf, p) : curVar(leaf, p))),
      );
      const fieldCount = prog.channels.get(move.channel)!.length;
      const vars = [
        ...args(combo, curVar),
        ...Array.from({ length: fieldCount }, (_, k) => evVar(k)),
        ...after.flatMap((loc, leaf) => (moving.has(leaf) ? params(prog, loc).map((p) => nxtVar(leaf, p)) : [])),
      ];
      const body = and([app(combo, args(combo, curVar)), ...moveConstraints(prog, move, curVar, nxtVar, evVar)]);
      lines.push(`(assert ${forall(vars, `(=> ${body} ${app(after, headArgs)})`)})`);
    }
  }

  for (const combo of combos) {
    combo.forEach((loc, leaf) => {
      if (loc !== assertion.process) return;
      const scope = new Map(params(prog, loc).map((p) => [p, curVar(leaf, p)]));
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
      cs.push(...moveConstraints(prog, move, cur, nxt, (k) => N.ev(t, k)));
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
