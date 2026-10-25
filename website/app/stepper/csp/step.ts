// The operational rules. step(spec, P) returns every transition of P, each
// with the derivation that proves it.

import type { Derivation, Expr, Field, Label, Proc, Spec, Type, Value } from "./syntax.ts";
import { texExpr, texLabel, texMsg, texProc, texSet, texSubst, texType, texValue } from "./tex.ts";

const sameLabel = (a: Label, b: Label) =>
  a.k === b.k &&
  (a.k !== "ev" || (b.k === "ev" && a.chan === b.chan && a.values.every((v, i) => v === b.values[i])));

const synced = (l: Label, sync: string[]) => l.k === "ev" && sync.includes(l.chan);

const node = (rule: string, from: Proc, label: Label, to: Proc, premises: Derivation[] = [], side: string[] = []) =>
  ({ rule, from, label, to, premises, side }) satisfies Derivation;

export function step(spec: Spec, p: Proc): Derivation[] {
  switch (p.k) {
    case "stop":
    case "omega":
      return [];

    // [Skip]
    case "skip":
      return [node("Skip", p, { k: "tick" }, { k: "omega" })];

    // [Prefix]
    case "pre":
      return comms(spec, p.chan, p.fields).map(({ label, sigma }) =>
        node("Prefix", p, label, subst(p.next, sigma), [], [
          `(${texLabel(label)}, ${texSubst(sigma)}) \\in \\mathrm{comms}(${texMsg(p.chan, p.fields)})`,
        ]),
      );

    // [ExtL] [ExtR] [ExtTauL] [ExtTauR]
    case "ext": {
      const out: Derivation[] = [];
      for (const [side, d] of [
        ...step(spec, p.l).map((d) => ["L", d] as const),
        ...step(spec, p.r).map((d) => ["R", d] as const),
      ]) {
        if (d.label.k === "tau") {
          const to: Proc = side === "L" ? { ...p, l: d.to } : { ...p, r: d.to };
          out.push(node(`ExtTau${side}`, p, d.label, to, [d]));
        } else {
          out.push(node(`Ext${side}`, p, d.label, d.to, [d], [`${texLabel(d.label)} \\in \\Sigma^{\\checkmark}`]));
        }
      }
      return out;
    }

    // [IntL] [IntR]
    case "int":
      return [node("IntL", p, { k: "tau" }, p.l), node("IntR", p, { k: "tau" }, p.r)];

    // [Guard-True]
    case "guard": {
      if (eval_(p.b) !== true) return [];
      const side = `[\\![ ${texExpr(p.b)} ]\\!] = \\mathit{true}`;
      return step(spec, p.p).map((d) => node("Guard-True", p, d.label, d.to, [d], [side]));
    }

    // [Seq] [SeqTerm]
    case "seq":
      return step(spec, p.l).map((d) =>
        d.label.k === "tick"
          ? node("SeqTerm", p, { k: "tau" }, p.r, [d])
          : node("Seq", p, d.label, { ...p, l: d.to }, [d], [`${texLabel(d.label)} \\neq \\checkmark`]),
      );

    // [ParL] [ParR] [Sync] [ParTermL] [ParTermR] [ParTerm]
    case "par": {
      const out: Derivation[] = [];
      const X = texSet(p.sync);
      const ls = step(spec, p.l);
      const rs = step(spec, p.r);
      for (const [side, ds] of [["L", ls], ["R", rs]] as const) {
        for (const d of ds) {
          if (d.label.k === "tick") {
            const to: Proc = side === "L" ? { ...p, l: { k: "omega" } } : { ...p, r: { k: "omega" } };
            out.push(node(`ParTerm${side}`, p, { k: "tau" }, to, [d]));
          } else if (!synced(d.label, p.sync)) {
            const to: Proc = side === "L" ? { ...p, l: d.to } : { ...p, r: d.to };
            out.push(
              node(`Par${side}`, p, d.label, to, [d], [`${texLabel(d.label)} \\notin ${X} \\cup \\{\\checkmark\\}`]),
            );
          }
        }
      }
      for (const l of ls.filter((d) => synced(d.label, p.sync)))
        for (const r of rs.filter((d) => sameLabel(l.label, d.label)))
          out.push(node("Sync", p, l.label, { ...p, l: l.to, r: r.to }, [l, r], [`${texLabel(l.label)} \\in ${X}`]));
      if (p.l.k === "omega" && p.r.k === "omega") out.push(node("ParTerm", p, { k: "tick" }, { k: "omega" }));
      return out;
    }

    // [InterL] [InterR] [InterTermL] [InterTermR] [InterTerm]
    // Every move belongs to one side; the other side is left exactly as it
    // was. Both sides offering the same event gives two transitions.
    case "inter": {
      const out: Derivation[] = [];
      for (const [side, ds] of [["L", step(spec, p.l)], ["R", step(spec, p.r)]] as const) {
        for (const d of ds) {
          if (d.label.k === "tick") {
            const to: Proc = side === "L" ? { ...p, l: { k: "omega" } } : { ...p, r: { k: "omega" } };
            out.push(node(`InterTerm${side}`, p, { k: "tau" }, to, [d]));
          } else {
            const to: Proc = side === "L" ? { ...p, l: d.to } : { ...p, r: d.to };
            out.push(node(`Inter${side}`, p, d.label, to, [d], [`${texLabel(d.label)} \\neq \\checkmark`]));
          }
        }
      }
      if (p.l.k === "omega" && p.r.k === "omega") out.push(node("InterTerm", p, { k: "tick" }, { k: "omega" }));
      return out;
    }

    // [Prio] A transition of P survives unless P also has one in a stronger
    // class. τ and ✓ rank with the first class, and an event in no class is
    // never held back (as FDR's prioritise does).
    case "prio": {
      const rank = (l: Label) => (l.k === "ev" ? p.classes.findIndex((c) => c.includes(l.chan)) : 0);
      const ds = step(spec, p.p);
      const out: Derivation[] = [];
      for (const d of ds) {
        const i = rank(d.label);
        if (i > 0 && ds.some((e) => { const j = rank(e.label); return j >= 0 && j < i; })) continue;
        const to: Proc = d.to.k === "omega" ? d.to : { ...p, p: d.to };
        const union = (cs: string[][]) => texSet([...new Set(cs.flat())]);
        const side =
          i > 0
            ? [
                `${texLabel(d.label)} \\in ${texSet(p.classes[i])}`,
                `\\mathit{initials}(P) \\cap (\\{\\tau, \\checkmark\\} \\cup ${union(p.classes.slice(0, i))}) = \\emptyset`,
              ]
            : i === 0 && d.label.k === "ev"
              ? [`${texLabel(d.label)} \\in ${texSet(p.classes[0])}`]
              : d.label.k === "ev"
                ? [`${texLabel(d.label)} \\notin ${union(p.classes)}`]
                : [`${texLabel(d.label)} \\text{ ranks with the first class}`];
        out.push(node("Prio", p, d.label, to, [d], side));
      }
      return out;
    }

    // [Call]
    case "call": {
      const def = spec.defs.get(p.name)!;
      const vs = p.args.map(eval_);
      if (def.params.some((x, i) => !has(x.type, vs[i]))) return [];
      const sigma = def.params.map((x, i) => [x.name, vs[i]] as [string, Value]);
      const head = def.params.length
        ? `\\mathit{${def.name}}(${def.params.map((x) => `\\mathit{${x.name}} : ${texType(x.type)}`).join(", ")})`
        : `\\mathit{${def.name}}`;
      const side = [`${head} = ${texProc(def.body)}`];
      def.params.forEach((x, i) =>
        side.push(`[\\![ ${texExpr(p.args[i])} ]\\!] = ${texValue(vs[i])} \\in ${texType(x.type)}`),
      );
      return [node("Call", p, { k: "tau" }, subst(def.body, sigma), [], side)];
    }

    // [Call], for the builtin: it unfolds to its definition like any named
    // process,
    //   ControllableCHAOS(A, R) = (STOP |~| (|~| x:A @ x -> ControllableCHAOS(A, R)))
    //                             [] ([] r:R @ r -> ControllableCHAOS(A, R))
    // with the replicated choices written out over the events of A and R.
    case "chaos":
      return [node("Call", p, { k: "tau" }, chaosBody(spec, p), [], [chaosDef, `A = ${texSet(p.a)},\\; R = ${texSet(p.r)}`])];
  }
}

const chaosDef =
  "\\mathit{ControllableCHAOS}(A, R) = (\\mathit{STOP} \\sqcap (\\sqcap\\, x{:}A \\bullet x \\to \\mathit{ControllableCHAOS}(A, R))) \\mathbin{\\square} (\\square\\, r{:}R \\bullet r \\to \\mathit{ControllableCHAOS}(A, R))";

// The events on a set of channels, as prefixes that lead back to `next`.
function prefixes(spec: Spec, chans: string[], next: Proc): Proc[] {
  return chans.flatMap((chan) => {
    let tuples: Value[][] = [[]];
    for (const t of spec.chans.get(chan) ?? []) tuples = tuples.flatMap((vs) => values(t).map((v) => [...vs, v]));
    return tuples.map(
      (vs): Proc => ({ k: "pre", chan, fields: vs.map((v) => ({ k: "out", e: { k: "val", v } })), next }),
    );
  });
}

// A replicated choice over a non-empty list, as nested binary choices.
const fold = (k: "int" | "ext", ps: Proc[]): Proc => ps.reduceRight((r, l) => ({ k, l, r }));

export function chaosBody(spec: Spec, p: Extract<Proc, { k: "chaos" }>): Proc {
  const actions = prefixes(spec, p.a, p);
  const refusals = prefixes(spec, p.r, p);
  return {
    k: "ext",
    l: { k: "int", l: { k: "stop" }, r: fold("int", actions) },
    r: fold("ext", refusals),
  };
}

// comms(m): each event the message can perform, with the substitution binding
// its inputs. c?x ranges over the field's type; c!e sends ⟦e⟧, and a value
// outside the field's type is no event.
function comms(spec: Spec, chan: string, fields: Field[]) {
  const types = spec.chans.get(chan) ?? [];
  let out: { values: Value[]; sigma: [string, Value][] }[] = [{ values: [], sigma: [] }];
  fields.forEach((f, i) => {
    const t = types[i];
    if (f.k === "in") {
      const [lo, hi] = f.range ? f.range.map((e) => eval_(e) as number) : [-Infinity, Infinity];
      const vs = values(t).filter((v) => typeof v !== "number" || (v >= lo && v <= hi));
      out = out.flatMap((o) => vs.map((v) => ({ values: [...o.values, v], sigma: [...o.sigma, [f.name, v] as [string, Value]] })));
    } else {
      const v = eval_(f.e);
      out = has(t, v) ? out.map((o) => ({ ...o, values: [...o.values, v] })) : [];
    }
  });
  return out.map(({ values, sigma }) => ({ label: { k: "ev", chan, values } as Label, sigma }));
}

// ⟦τ⟧
const values = (t: Type): Value[] =>
  t.k === "bool" ? [true, false] : Array.from({ length: Math.max(0, t.hi - t.lo + 1) }, (_, i) => t.lo + i);

const has = (t: Type, v: Value) =>
  t.k === "bool" ? typeof v === "boolean" : typeof v === "number" && v >= t.lo && v <= t.hi;

// ⟦e⟧ of a closed expression.
export function eval_(e: Expr): Value {
  const num = (x: Expr) => {
    const v = eval_(x);
    if (typeof v !== "number") throw new Error(`${texExpr(x)} is not a number`);
    return v;
  };
  const bool = (x: Expr) => {
    const v = eval_(x);
    if (typeof v !== "boolean") throw new Error(`${texExpr(x)} is not a boolean`);
    return v;
  };
  switch (e.k) {
    case "val":
      return e.v;
    case "var":
      throw new Error(`${e.name} is unbound`);
    case "not":
      return !bool(e.e);
    case "neg":
      return -num(e.e);
    case "and":
      return bool(e.a) && bool(e.b);
    case "or":
      return bool(e.a) || bool(e.b);
    case "bin":
      switch (e.op) {
        case "==":
          return eval_(e.a) === eval_(e.b);
        case "!=":
          return eval_(e.a) !== eval_(e.b);
        case "+":
          return num(e.a) + num(e.b);
        case "-":
          return num(e.a) - num(e.b);
        case "*":
          return num(e.a) * num(e.b);
        case "<":
          return num(e.a) < num(e.b);
        case "<=":
          return num(e.a) <= num(e.b);
        case ">":
          return num(e.a) > num(e.b);
        case ">=":
          return num(e.a) >= num(e.b);
      }
  }
}

// Pσ: replace free variables by values. An input c?x rebinds x for the rest
// of the prefix, so σ stops there.
export function subst(p: Proc, sigma: [string, Value][]): Proc {
  if (!sigma.length) return p;
  const e = (x: Expr) => substExpr(x, sigma);
  switch (p.k) {
    case "stop":
    case "skip":
    case "omega":
      return p;
    case "pre": {
      const bound = new Set(p.fields.flatMap((f) => (f.k === "in" ? [f.name] : [])));
      return {
        ...p,
        fields: p.fields.map((f) =>
          f.k === "out" ? { k: "out", e: e(f.e) } : f.range ? { ...f, range: [e(f.range[0]), e(f.range[1])] } : f,
        ),
        next: subst(p.next, sigma.filter(([x]) => !bound.has(x))),
      };
    }
    case "ext":
    case "int":
    case "seq":
    case "par":
      return { ...p, l: subst(p.l, sigma), r: subst(p.r, sigma) };
    case "guard":
      return { ...p, b: e(p.b), p: subst(p.p, sigma) };
    case "inter":
      return { ...p, l: subst(p.l, sigma), r: subst(p.r, sigma) };
    case "prio":
      return { ...p, p: subst(p.p, sigma) };
    case "call":
      return { ...p, args: p.args.map(e) };
    case "chaos":
      return p;
  }
}

function substExpr(e: Expr, sigma: [string, Value][]): Expr {
  switch (e.k) {
    case "val":
      return e;
    case "var": {
      const hit = sigma.find(([x]) => x === e.name);
      return hit ? { k: "val", v: hit[1] } : e;
    }
    case "not":
    case "neg":
      return { ...e, e: substExpr(e.e, sigma) };
    case "and":
    case "or":
    case "bin":
      return { ...e, a: substExpr(e.a, sigma), b: substExpr(e.b, sigma) };
  }
}
