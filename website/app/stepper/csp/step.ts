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

    // [IO-Skip]
    case "skip":
      return [node("IO-Skip", p, { k: "tick" }, { k: "omega" })];

    // [IO-Prefix]
    case "pre":
      return comms(spec, p.chan, p.fields).map(({ label, sigma }) =>
        node("IO-Prefix", p, label, subst(p.next, sigma), [], [
          `(${texLabel(label)}, ${texSubst(sigma)}) \\in \\mathrm{comms}(${texMsg(p.chan, p.fields)})`,
        ]),
      );

    // [IO-ExtL] [IO-ExtR] [IO-ExtTauL] [IO-ExtTauR]
    case "ext": {
      const out: Derivation[] = [];
      for (const [side, d] of [
        ...step(spec, p.l).map((d) => ["L", d] as const),
        ...step(spec, p.r).map((d) => ["R", d] as const),
      ]) {
        if (d.label.k === "tau") {
          const to: Proc = side === "L" ? { ...p, l: d.to } : { ...p, r: d.to };
          out.push(node(`IO-ExtTau${side}`, p, d.label, to, [d]));
        } else {
          out.push(node(`IO-Ext${side}`, p, d.label, d.to, [d], [`${texLabel(d.label)} \\in \\Sigma^{\\checkmark}`]));
        }
      }
      return out;
    }

    // [IO-IntL] [IO-IntR]
    case "int":
      return [node("IO-IntL", p, { k: "tau" }, p.l), node("IO-IntR", p, { k: "tau" }, p.r)];

    // [IO-Guard-True]
    case "guard": {
      if (eval_(p.b) !== true) return [];
      const side = `[\\![ ${texExpr(p.b)} ]\\!] = \\mathit{true}`;
      return step(spec, p.p).map((d) => node("IO-Guard-True", p, d.label, d.to, [d], [side]));
    }

    // [IO-Seq] [IO-SeqTerm]
    case "seq":
      return step(spec, p.l).map((d) =>
        d.label.k === "tick"
          ? node("IO-SeqTerm", p, { k: "tau" }, p.r, [d])
          : node("IO-Seq", p, d.label, { ...p, l: d.to }, [d], [`${texLabel(d.label)} \\neq \\checkmark`]),
      );

    // [IO-ParL] [IO-ParR] [IO-Sync] [IO-ParTermL] [IO-ParTermR] [IO-ParTerm]
    case "par": {
      const out: Derivation[] = [];
      const X = texSet(p.sync);
      const ls = step(spec, p.l);
      const rs = step(spec, p.r);
      for (const [side, ds] of [["L", ls], ["R", rs]] as const) {
        for (const d of ds) {
          if (d.label.k === "tick") {
            const to: Proc = side === "L" ? { ...p, l: { k: "omega" } } : { ...p, r: { k: "omega" } };
            out.push(node(`IO-ParTerm${side}`, p, { k: "tau" }, to, [d]));
          } else if (!synced(d.label, p.sync)) {
            const to: Proc = side === "L" ? { ...p, l: d.to } : { ...p, r: d.to };
            out.push(
              node(`IO-Par${side}`, p, d.label, to, [d], [`${texLabel(d.label)} \\notin ${X} \\cup \\{\\checkmark\\}`]),
            );
          }
        }
      }
      for (const l of ls.filter((d) => synced(d.label, p.sync)))
        for (const r of rs.filter((d) => sameLabel(l.label, d.label)))
          out.push(node("IO-Sync", p, l.label, { ...p, l: l.to, r: r.to }, [l, r], [`${texLabel(l.label)} \\in ${X}`]));
      if (p.l.k === "omega" && p.r.k === "omega") out.push(node("IO-ParTerm", p, { k: "tick" }, { k: "omega" }));
      return out;
    }

    // [IO-Call]
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
      const body = subst(def.body, sigma);
      return [node("IO-Call", p, { k: "tau" }, def.role ? { k: "role", name: def.role, p: body } : body, [], side)];
    }

    // A role's component steps as its process does; each transition is
    // attributed to the role. A role that calls itself stays one component.
    case "role":
      return step(spec, p.p).map((d) => {
        const inner = d.to.k === "role" && d.to.name === p.name ? d.to.p : d.to;
        return { ...d, from: p, to: d.to.k === "omega" ? d.to : { k: "role", name: p.name, p: inner }, role: p.name };
      });
  }
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
    case "call":
      return { ...p, args: p.args.map(e) };
    case "role":
      return { ...p, p: subst(p.p, sigma) };
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
