// Parser for the spec language.
//
//   channel c : {0..2}.Bool
//   COUNT(n : {0..3}) = n < 3 & up -> COUNT(n + 1) [] n > 0 & down -> COUNT(n - 1)
//
// Process names start uppercase; channels and variables lowercase. A channel
// used without a declaration carries no data. Binding, loosest first:
// [| {c, ..} |] and |||, then |~|, then [], then ;, then b & P, then
// c?x!e -> P. Inside !e and .e, compound expressions need parentheses.
//
// Two forms take sets of channels, each standing for every event on them:
//
//   prioritise(P, <{a, b}, {r}>)        FDR's priority: a and b before r
//   ControllableCHAOS({a, b}, {r})      the builtin agent: any of A, or none, and R always

import type { BinOp, Def, Expr, Field, Proc, Spec, Type } from "./syntax.ts";

type Tok = { t: string; v?: string | number; line: number };

export class SpecError extends Error {}

// The builtin's name, which no definition may take.
export const CHAOS = "ControllableCHAOS";

const fail = (line: number, msg: string): never => {
  throw new SpecError(`line ${line}: ${msg}`);
};

const PUNCT = [
  "|||", "|~|", "[|", "|]", "[]", "->", "..", "==", "!=", "<=", ">=",
  "<", ">", "+", "-", "*", "(", ")", "{", "}", ",", ":", "=", "&", ";", "?", "!", ".",
];
const UNICODE: Record<string, string> = { "→": "->", "□": "[]", "⊓": "|~|", "⫴": "|||" };

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let line = 1;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (src.startsWith("--", i)) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (/[0-9]/.test(c)) {
      const m = /^[0-9]+/.exec(src.slice(i))![0];
      toks.push({ t: "num", v: Number(m), line });
      i += m.length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_']*/.exec(src.slice(i))![0];
      toks.push({ t: "id", v: m, line });
      i += m.length;
    } else if (UNICODE[c]) {
      toks.push({ t: UNICODE[c], line });
      i++;
    } else {
      const p = PUNCT.find((p) => src.startsWith(p, i));
      if (!p) fail(line, `unexpected character '${c}'`);
      toks.push({ t: p!, line });
      i += p!.length;
    }
  }
  toks.push({ t: "eof", line });
  return toks;
}

const KEYWORDS = new Set(["channel", "and", "or", "not", "true", "false", "STOP", "SKIP", "Bool", "prioritise", CHAOS]);
const isUpper = (s: string) => /^[A-Z]/.test(s);

const show = (tok: Tok) =>
  tok.t === "eof" ? "end of input" : tok.t === "num" || tok.t === "id" ? `'${tok.v}'` : `'${tok.t}'`;

class Parser {
  i = 0;
  toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }

  peek(k = 0) {
    return this.toks[Math.min(this.i + k, this.toks.length - 1)];
  }
  is(t: string, v?: string) {
    const tok = this.peek();
    return tok.t === t && (v === undefined || tok.v === v);
  }
  eat(t: string, v?: string) {
    if (!this.is(t, v)) return false;
    this.i++;
    return true;
  }
  expect(t: string, what = `'${t}'`) {
    if (!this.eat(t)) fail(this.peek().line, `expected ${what}, found ${show(this.peek())}`);
  }

  name(kind: "process" | "lower", what: string): string {
    const tok = this.peek();
    const s = tok.v as string;
    if (tok.t !== "id" || KEYWORDS.has(s) || isUpper(s) !== (kind === "process"))
      fail(tok.line, `expected ${what}, found ${show(tok)}`);
    this.i++;
    return s;
  }

  // Items: channel declarations and definitions.
  spec() {
    const chans: { name: string; types: Type[]; line: number }[] = [];
    const defs: Def[] = [];
    while (!this.is("eof")) {
      const line = this.peek().line;
      if (this.eat("id", "channel")) {
        const names: string[] = [];
        do names.push(this.name("lower", "a channel name"));
        while (this.eat(","));
        const types: Type[] = [];
        if (this.eat(":")) do types.push(this.type()); while (this.eat("."));
        names.forEach((name) => chans.push({ name, types, line }));
      } else {
        const name = this.name("process", "a process definition (NAME = ...)");
        const params: Def["params"] = [];
        if (this.eat("(")) {
          do {
            const p = this.name("lower", "a parameter name");
            this.expect(":");
            params.push({ name: p, type: this.type() });
          } while (this.eat(","));
          this.expect(")");
        }
        this.expect("=");
        defs.push({ name, params, body: this.proc(), line });
      }
    }
    return { chans, defs };
  }

  type(): Type {
    if (this.eat("id", "Bool")) return { k: "bool" };
    this.expect("{", "a type ({lo..hi} or Bool)");
    const lo = this.int();
    this.expect("..");
    const hi = this.int();
    this.expect("}");
    return { k: "range", lo, hi };
  }

  int(): number {
    const sign = this.eat("-") ? -1 : 1;
    const tok = this.peek();
    if (tok.t !== "num") fail(tok.line, `expected a number, found ${show(tok)}`);
    this.i++;
    return sign * (tok.v as number);
  }

  proc(): Proc {
    let l = this.int_();
    for (;;) {
      if (this.eat("[|")) {
        const sync = this.set();
        this.expect("|]");
        l = { k: "par", sync, l, r: this.int_() };
      } else if (this.eat("|||")) {
        l = { k: "inter", l, r: this.int_() };
      } else return l;
    }
  }

  // {a, b}: a set of channels.
  set(): string[] {
    this.expect("{", "a set of channels, such as {a, b}");
    const out: string[] = [];
    if (!this.is("}")) do out.push(this.name("lower", "a channel name")); while (this.eat(","));
    this.expect("}");
    return out;
  }

  int_(): Proc {
    let l = this.ext();
    while (this.eat("|~|")) l = { k: "int", l, r: this.ext() };
    return l;
  }

  ext(): Proc {
    let l = this.seq();
    while (this.eat("[]")) l = { k: "ext", l, r: this.seq() };
    return l;
  }

  seq(): Proc {
    let l = this.guarded();
    while (this.eat(";")) l = { k: "seq", l, r: this.guarded() };
    return l;
  }

  // b & P needs a look ahead: try an expression, and fall back to a prefix if
  // no & follows it.
  guarded(): Proc {
    const start = this.i;
    try {
      const b = this.expr();
      if (this.eat("&")) return { k: "guard", b, p: this.guarded() };
    } catch (e) {
      if (!(e instanceof SpecError)) throw e;
    }
    this.i = start;
    return this.prefix();
  }

  prefix(): Proc {
    if (this.is("id") && !isUpper(this.peek().v as string) && !KEYWORDS.has(this.peek().v as string)) {
      const chan = this.name("lower", "a channel name");
      const fields: Field[] = [];
      for (;;) {
        if (this.eat("?")) {
          const name = this.name("lower", "a variable after ?");
          let range: [Expr, Expr] | undefined;
          if (this.eat(":")) {
            this.expect("{", `'{' after ?${name}:`);
            const lo = this.expr();
            this.expect("..", "'..' in a range");
            const hi = this.expr();
            this.expect("}", "'}' after a range");
            range = [lo, hi];
          }
          fields.push({ k: "in", name, range });
        }
        else if (this.eat("!") || this.eat(".")) fields.push({ k: "out", e: this.primary() });
        else break;
      }
      this.expect("->", `'->' after ${chan}`);
      return { k: "pre", chan, fields, next: this.guarded() };
    }
    return this.atom();
  }

  atom(): Proc {
    const tok = this.peek();
    if (this.eat("id", "STOP")) return { k: "stop" };
    if (this.eat("id", "SKIP")) return { k: "skip" };
    if (this.eat("id", "prioritise")) {
      this.expect("(", "'(' after prioritise");
      const p = this.proc();
      this.expect(",", "',' and then the priority classes, such as <{a}, {b}>");
      this.expect("<", "'<' before the priority classes");
      const classes: string[][] = [];
      do classes.push(this.set());
      while (this.eat(","));
      this.expect(">", "'>' after the priority classes");
      this.expect(")");
      return { k: "prio", p, classes };
    }
    if (this.eat("id", CHAOS)) {
      this.expect("(", `'(' after ${CHAOS}: it takes two sets of channels, A and R`);
      const a = this.set();
      this.expect(",", `',' and then R, the set of refusal channels`);
      const r = this.set();
      this.expect(")");
      return { k: "chaos", a, r };
    }
    if (this.eat("(")) {
      const p = this.proc();
      this.expect(")");
      return p;
    }
    if (tok.t === "id" && isUpper(tok.v as string) && !KEYWORDS.has(tok.v as string)) {
      this.i++;
      const args: Expr[] = [];
      if (this.eat("(")) {
        do args.push(this.expr()); while (this.eat(","));
        this.expect(")");
      }
      return { k: "call", name: tok.v as string, args };
    }
    return fail(tok.line, `expected a process, found ${show(tok)}`);
  }

  expr(): Expr {
    let a = this.and();
    while (this.eat("id", "or")) a = { k: "or", a, b: this.and() };
    return a;
  }

  and(): Expr {
    let a = this.not();
    while (this.eat("id", "and")) a = { k: "and", a, b: this.not() };
    return a;
  }

  not(): Expr {
    if (this.eat("id", "not")) return { k: "not", e: this.not() };
    const a = this.sum();
    const op = ["==", "!=", "<=", ">=", "<", ">"].find((o) => this.is(o));
    if (!op) return a;
    this.i++;
    return { k: "bin", op: op as BinOp, a, b: this.sum() };
  }

  sum(): Expr {
    let a = this.product();
    for (;;) {
      const op = this.is("+") ? "+" : this.is("-") ? "-" : null;
      if (!op) return a;
      this.i++;
      a = { k: "bin", op, a, b: this.product() };
    }
  }

  product(): Expr {
    let a = this.unary();
    while (this.eat("*")) a = { k: "bin", op: "*", a, b: this.unary() };
    return a;
  }

  unary(): Expr {
    if (this.eat("-")) return { k: "neg", e: this.unary() };
    return this.primary();
  }

  primary(): Expr {
    const tok = this.peek();
    if (tok.t === "num") {
      this.i++;
      return { k: "val", v: tok.v as number };
    }
    if (this.eat("id", "true")) return { k: "val", v: true };
    if (this.eat("id", "false")) return { k: "val", v: false };
    if (this.eat("(")) {
      const e = this.expr();
      this.expect(")");
      return e;
    }
    return { k: "var", name: this.name("lower", "an expression") };
  }
}

// Parses and checks a spec: no duplicate names, every call defined with the
// right arity, every channel's fields matching its declaration, every
// variable bound by a parameter or an earlier input, and the sets given to
// prioritise and ControllableCHAOS well formed.
export function parse(src: string): Spec {
  const { chans: decls, defs } = new Parser(lex(src)).spec();
  const chans = new Map<string, Type[]>();
  for (const c of decls) {
    if (chans.has(c.name)) fail(c.line, `channel ${c.name} is declared twice`);
    chans.set(c.name, c.types);
  }
  const table = new Map<string, Def>();
  for (const d of defs) {
    if (table.has(d.name)) fail(d.line, `${d.name} is defined twice`);
    table.set(d.name, d);
  }
  for (const d of defs) {
    const at = (msg: string) => fail(d.line, `in ${d.name}: ${msg}`);
    const bound = (e: Expr, scope: Set<string>): void => {
      if (e.k === "var") {
        if (!scope.has(e.name)) at(`${e.name} is not bound here`);
      } else if (e.k === "not" || e.k === "neg") bound(e.e, scope);
      else if (e.k === "and" || e.k === "or" || e.k === "bin") {
        bound(e.a, scope);
        bound(e.b, scope);
      }
    };
    const known = (cs: string[]) => cs.forEach((c) => chans.has(c) || chans.set(c, []));
    const disjoint = (sets: string[][], what: string) => {
      const seen = new Set<string>();
      for (const c of sets.flat()) {
        if (seen.has(c)) at(`${c} appears twice in ${what}; the sets must not overlap`);
        seen.add(c);
      }
    };
    const walk = (p: Proc, scope: Set<string>): void => {
      switch (p.k) {
        case "pre": {
          const types = chans.get(p.chan);
          if (!types) {
            if (p.fields.length) at(`channel ${p.chan} carries data, so declare its type`);
            chans.set(p.chan, []);
          } else if (p.fields.length && p.fields.length !== types.length)
            at(`${p.chan} carries ${types.length} field(s), not ${p.fields.length}`);
          const inner = new Set(scope);
          for (const f of p.fields) {
            if (f.k === "out") bound(f.e, scope);
            else {
              f.range?.forEach((e) => bound(e, scope));
              inner.add(f.name);
            }
          }
          return walk(p.next, inner);
        }
        case "ext":
        case "int":
        case "seq":
        case "inter":
          walk(p.l, scope);
          return walk(p.r, scope);
        case "par":
          known(p.sync);
          walk(p.l, scope);
          return walk(p.r, scope);
        case "prio":
          known(p.classes.flat());
          disjoint(p.classes, "prioritise's classes");
          return walk(p.p, scope);
        case "chaos":
          if (!p.a.length) at(`${CHAOS}'s A is empty: give it the agent's actions`);
          if (!p.r.length) at(`${CHAOS}'s R is empty: give it the refusal channel`);
          known([...p.a, ...p.r]);
          return disjoint([p.a, p.r], `${CHAOS}'s A and R`);
        case "guard":
          bound(p.b, scope);
          return walk(p.p, scope);
        case "call": {
          const def = table.get(p.name);
          if (!def) at(`process ${p.name} is used but never defined`);
          if (def!.params.length !== p.args.length)
            at(`${p.name} takes ${def!.params.length} argument(s), not ${p.args.length}`);
          return p.args.forEach((e) => bound(e, scope));
        }
      }
    };
    walk(d.body, new Set(d.params.map((p) => p.name)));
  }
  return { defs: table, chans };
}
