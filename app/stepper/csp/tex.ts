// LaTeX for terms, labels and derivations, in the notation of the rules.

import type { Derivation, Expr, Field, Label, Proc, Type, Value } from "./syntax.ts";

const id = (s: string) => `\\mathit{${s.replace(/_/g, "\\_")}}`;

// How tightly each operator binds; a looser term in a tighter spot gets parentheses.
const LEVEL: Partial<Record<Proc["k"], number>> = { par: 1, int: 2, ext: 3, seq: 4, guard: 5, pre: 6 };

export function texProc(p: Proc, ctx = 0): string {
  const s = texProc_(p);
  return (LEVEL[p.k] ?? 7) < ctx ? `(${s})` : s;
}

function texProc_(p: Proc): string {
  switch (p.k) {
    case "stop":
      return "\\mathit{STOP}";
    case "skip":
      return "\\mathit{SKIP}";
    case "omega":
      return "\\Omega";
    case "call":
      return p.args.length ? `${id(p.name)}(${p.args.map((e) => texExpr(e)).join(", ")})` : id(p.name);
    case "pre":
      return `${texMsg(p.chan, p.fields)} \\to ${texProc(p.next, 5)}`;
    case "guard":
      return `${texExpr(p.b)} \\mathbin{\\&} ${texProc(p.p, 5)}`;
    case "seq":
      return `${texProc(p.l, 4)} \\mathbin{;} ${texProc(p.r, 5)}`;
    case "ext":
      return `${texProc(p.l, 3)} \\mathbin{\\square} ${texProc(p.r, 4)}`;
    case "int":
      return `${texProc(p.l, 2)} \\sqcap ${texProc(p.r, 3)}`;
    case "par":
      return `${texProc(p.l, 1)} \\parallel_{${texSet(p.sync)}} ${texProc(p.r, 2)}`;
  }
}

export const texSet = (cs: string[]) => (cs.length ? `\\{${cs.map(id).join(", ")}\\}` : "\\emptyset");

export const texMsg = (chan: string, fields: Field[]) => id(chan) + fields.map(texField).join("");

const texField = (f: Field) => (f.k === "in" ? `?${id(f.name)}` : `!${texPrimary(f.e)}`);

const texPrimary = (e: Expr) => (e.k === "val" || e.k === "var" ? texExpr(e) : `(${texExpr(e)})`);

const OPS: Record<string, string> = { "==": "=", "!=": "\\neq", "<=": "\\leq", ">=": "\\geq", "*": "\\times" };

export function texExpr(e: Expr): string {
  switch (e.k) {
    case "val":
      return texValue(e.v);
    case "var":
      return id(e.name);
    case "not":
      return `\\neg ${texPrimary(e.e)}`;
    case "neg":
      return `-${texPrimary(e.e)}`;
    case "and":
      return `${texPrimary(e.a)} \\land ${texPrimary(e.b)}`;
    case "or":
      return `${texPrimary(e.a)} \\lor ${texPrimary(e.b)}`;
    case "bin":
      return `${texPrimary(e.a)} ${OPS[e.op] ?? e.op} ${texPrimary(e.b)}`;
  }
}

export const texValue = (v: Value) => (typeof v === "boolean" ? `\\mathit{${v}}` : String(v));

export const texType = (t: Type) => (t.k === "bool" ? "\\mathbb{B}" : `\\{${t.lo}..${t.hi}\\}`);

export function texLabel(l: Label): string {
  if (l.k === "tau") return "\\tau";
  if (l.k === "tick") return "\\checkmark";
  return [id(l.chan), ...l.values.map(texValue)].join(".");
}

export const texSubst = (s: [string, Value][]) =>
  s.length ? `\\{${s.map(([x, v]) => `${id(x)} \\mapsto ${texValue(v)}`).join(", ")}\\}` : "\\emptyset";

export const texStep = (from: Proc, l: Label, to: Proc) =>
  `${texProc(from)} \\xrightarrow{${texLabel(l)}} ${texProc(to)}`;

// The whole tree, as nested fractions: premises and side conditions above the
// line, the transition below, the rule's name on the right.
export function texDerivation(d: Derivation): string {
  const above = [...d.premises.map(texDerivation), ...d.side].join(" \\qquad ");
  return `\\dfrac{${above}}{${texStep(d.from, d.label, d.to)}} \\;\\textsf{[${d.rule}]}`;
}
