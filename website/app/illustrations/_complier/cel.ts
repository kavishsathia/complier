// The CEL the illustrations' translation units are written in: literals, field access, the
// optional methods (hasValue, value, orValue), comparisons, `in`, &&, ||, !, ?: and a few string
// and list methods. An expression is parsed once and evaluated per call; anything outside this
// is a compile error that names it, and a type mismatch at runtime is an evaluation error, which
// complier turns into a refusal.

export class CelError extends Error {}

export type CelValue =
  | null
  | boolean
  | number
  | string
  | CelValue[]
  | { [k: string]: CelValue }
  | Optional;

export type Optional = { optional: true; has: boolean; v?: CelValue };

export const none = (): Optional => ({ optional: true, has: false });
export const some = (v: CelValue): Optional => ({ optional: true, has: true, v });
const isOptional = (v: CelValue): v is Optional => !!v && typeof v === "object" && !Array.isArray(v) && (v as Optional).optional === true;

type Node =
  | { k: "lit"; v: CelValue }
  | { k: "id"; name: string }
  | { k: "list"; items: Node[] }
  | { k: "member"; of: Node; name: string }
  | { k: "call"; of: Node | null; name: string; args: Node[] }
  | { k: "index"; of: Node; at: Node }
  | { k: "un"; op: "!" | "-"; e: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "cond"; c: Node; t: Node; f: Node };

export type Expr = { src: string; node: Node };

type Tok = { t: string; v?: string | number; at: number };

const PUNCT = ["&&", "||", "==", "!=", "<=", ">=", "<", ">", "!", "?", ":", "(", ")", "[", "]", ",", ".", "+", "-", "*", "/", "%"];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9]/.test(c)) {
      const m = /^[0-9]+/.exec(src.slice(i))![0];
      out.push({ t: "num", v: Number(m), at: i });
      i += m.length;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) {
          const e = src[j + 1];
          s += e === "n" ? "\n" : e === "t" ? "\t" : e;
          j += 2;
        } else s += src[j++];
      }
      if (j >= src.length) throw new CelError(`unterminated string at column ${i + 1}`);
      out.push({ t: "str", v: s, at: i });
      i = j + 1;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))![0];
      out.push({ t: "id", v: m, at: i });
      i += m.length;
    } else {
      const p = PUNCT.find((p) => src.startsWith(p, i));
      if (!p) throw new CelError(`unexpected character '${c}' at column ${i + 1}`);
      out.push({ t: p, at: i });
      i += p.length;
    }
  }
  return out;
}

class Parser {
  i = 0;
  toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }
  peek() {
    return this.toks[this.i];
  }
  eat(t: string) {
    if (this.peek()?.t !== t) return false;
    this.i++;
    return true;
  }
  expect(t: string) {
    if (!this.eat(t)) {
      const tok = this.peek();
      throw new CelError(`expected '${t}', found ${tok ? `'${tok.v ?? tok.t}'` : "the end"}`);
    }
  }

  expr(): Node {
    const c = this.or();
    if (!this.eat("?")) return c;
    const t = this.expr();
    this.expect(":");
    return { k: "cond", c, t, f: this.expr() };
  }
  or(): Node {
    let a = this.and();
    while (this.eat("||")) a = { k: "bin", op: "||", a, b: this.and() };
    return a;
  }
  and(): Node {
    let a = this.rel();
    while (this.eat("&&")) a = { k: "bin", op: "&&", a, b: this.rel() };
    return a;
  }
  rel(): Node {
    const a = this.add();
    const t = this.peek();
    if (t && ["==", "!=", "<", "<=", ">", ">="].includes(t.t)) {
      this.i++;
      return { k: "bin", op: t.t, a, b: this.add() };
    }
    if (t?.t === "id" && t.v === "in") {
      this.i++;
      return { k: "bin", op: "in", a, b: this.add() };
    }
    return a;
  }
  add(): Node {
    let a = this.mul();
    for (;;) {
      const t = this.peek()?.t;
      if (t !== "+" && t !== "-") return a;
      this.i++;
      a = { k: "bin", op: t, a, b: this.mul() };
    }
  }
  mul(): Node {
    let a = this.unary();
    for (;;) {
      const t = this.peek()?.t;
      if (t !== "*" && t !== "/" && t !== "%") return a;
      this.i++;
      a = { k: "bin", op: t, a, b: this.unary() };
    }
  }
  unary(): Node {
    if (this.eat("!")) return { k: "un", op: "!", e: this.unary() };
    if (this.eat("-")) return { k: "un", op: "-", e: this.unary() };
    return this.member();
  }
  member(): Node {
    let n = this.primary();
    for (;;) {
      if (this.eat(".")) {
        const id = this.peek();
        if (id?.t !== "id") throw new CelError("expected a field or method name after '.'");
        this.i++;
        const name = String(id.v);
        if (this.eat("(")) n = { k: "call", of: n, name, args: this.args() };
        else n = { k: "member", of: n, name };
      } else if (this.eat("[")) {
        const at = this.expr();
        this.expect("]");
        n = { k: "index", of: n, at };
      } else return n;
    }
  }
  args(): Node[] {
    const out: Node[] = [];
    if (this.eat(")")) return out;
    do out.push(this.expr());
    while (this.eat(","));
    this.expect(")");
    return out;
  }
  primary(): Node {
    const t = this.peek();
    if (!t) throw new CelError("unexpected end of expression");
    this.i++;
    if (t.t === "num" || t.t === "str") return { k: "lit", v: t.v as CelValue };
    if (t.t === "(") {
      const e = this.expr();
      this.expect(")");
      return e;
    }
    if (t.t === "[") {
      const items: Node[] = [];
      if (!this.eat("]")) {
        do items.push(this.expr());
        while (this.eat(","));
        this.expect("]");
      }
      return { k: "list", items };
    }
    if (t.t === "id") {
      const name = String(t.v);
      if (name === "true" || name === "false") return { k: "lit", v: name === "true" };
      if (name === "null") return { k: "lit", v: null };
      if (this.eat("(")) return { k: "call", of: null, name, args: this.args() };
      return { k: "id", name };
    }
    throw new CelError(`unexpected '${t.t}'`);
  }
}

export function compile(src: string): Expr {
  const p = new Parser(lex(src));
  const node = p.expr();
  const rest = p.peek();
  if (rest) throw new CelError(`unexpected '${rest.v ?? rest.t}' after the expression`);
  return { src, node };
}

const kind = (v: CelValue) =>
  v === null ? "null" : isOptional(v) ? "optional" : Array.isArray(v) ? "list" : typeof v === "object" ? "map" : typeof v === "number" ? "int" : typeof v;

function equal(a: CelValue, b: CelValue): boolean {
  if (kind(a) !== kind(b)) throw new CelError(`no such overload: ${kind(a)} == ${kind(b)}`);
  if (Array.isArray(a)) return a.length === (b as CelValue[]).length && a.every((x, i) => equal(x, (b as CelValue[])[i]));
  if (isOptional(a)) return a.has === (b as Optional).has && (!a.has || equal(a.v!, (b as Optional).v!));
  if (a && typeof a === "object") return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

const want = <T extends CelValue>(v: CelValue, k: string, what: string): T => {
  if (kind(v) !== k) throw new CelError(`${what} expects ${k}, got ${kind(v)}`);
  return v as T;
};

export function evaluate(e: Expr, vars: Record<string, CelValue>): CelValue {
  const ev = (n: Node): CelValue => {
    switch (n.k) {
      case "lit":
        return n.v;
      case "id":
        if (!(n.name in vars)) throw new CelError(`undeclared reference to '${n.name}'`);
        return vars[n.name];
      case "list":
        return n.items.map(ev);
      case "member": {
        const o = ev(n.of);
        if (!o || typeof o !== "object" || Array.isArray(o) || isOptional(o)) throw new CelError(`.${n.name} on ${kind(o)}`);
        if (!(n.name in o)) throw new CelError(`no such key: ${n.name}`);
        return (o as Record<string, CelValue>)[n.name];
      }
      case "index": {
        const o = ev(n.of);
        const at = ev(n.at);
        if (Array.isArray(o)) {
          const i = want<number>(at, "int", "list index");
          if (i < 0 || i >= o.length) throw new CelError(`index out of bounds: ${i}`);
          return o[i];
        }
        if (o && typeof o === "object" && !isOptional(o)) {
          const k = want<string>(at, "string", "map key");
          if (!(k in o)) throw new CelError(`no such key: ${k}`);
          return (o as Record<string, CelValue>)[k];
        }
        throw new CelError(`index on ${kind(o)}`);
      }
      case "un": {
        const v = ev(n.e);
        return n.op === "!" ? !want<boolean>(v, "boolean", "!") : -want<number>(v, "int", "-");
      }
      case "cond":
        return want<boolean>(ev(n.c), "boolean", "?:") ? ev(n.t) : ev(n.f);
      case "bin":
        return bin(n.op, n.a, n.b);
      case "call":
        return call(n);
    }
  };

  const bin = (op: string, an: Node, bn: Node): CelValue => {
    // && and || commute over errors in CEL: a definite answer on either side wins.
    if (op === "&&" || op === "||") {
      const stop = op === "||";
      let err: unknown = null;
      for (const side of [an, bn]) {
        try {
          if (want<boolean>(ev(side), "boolean", op) === stop) return stop;
        } catch (e) {
          err = e;
        }
      }
      if (err) throw err;
      return !stop;
    }
    const a = ev(an);
    const b = ev(bn);
    switch (op) {
      case "==":
        return equal(a, b);
      case "!=":
        return !equal(a, b);
      case "in":
        if (Array.isArray(b)) return b.some((x) => kind(x) === kind(a) && equal(x, a));
        if (b && typeof b === "object" && !isOptional(b)) return want<string>(a, "string", "in") in b;
        throw new CelError(`in on ${kind(b)}`);
      case "<":
      case "<=":
      case ">":
      case ">=": {
        if (kind(a) !== kind(b) || (kind(a) !== "int" && kind(a) !== "string")) throw new CelError(`no such overload: ${kind(a)} ${op} ${kind(b)}`);
        const x = a as number | string;
        const y = b as number | string;
        return op === "<" ? x < y : op === "<=" ? x <= y : op === ">" ? x > y : x >= y;
      }
      case "+":
        if (kind(a) === "string" && kind(b) === "string") return (a as string) + (b as string);
        if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
        return want<number>(a, "int", "+") + want<number>(b, "int", "+");
      case "-":
        return want<number>(a, "int", "-") - want<number>(b, "int", "-");
      case "*":
        return want<number>(a, "int", "*") * want<number>(b, "int", "*");
      case "/":
      case "%": {
        const x = want<number>(a, "int", op);
        const y = want<number>(b, "int", op);
        if (y === 0) throw new CelError(op === "/" ? "division by zero" : "modulus by zero");
        return op === "/" ? Math.trunc(x / y) : x % y;
      }
    }
    throw new CelError(`unknown operator ${op}`);
  };

  const call = (n: Extract<Node, { k: "call" }>): CelValue => {
    if (n.of === null) {
      const args = n.args.map(ev);
      switch (n.name) {
        case "size":
          return size(args[0]);
        case "string":
          return typeof args[0] === "string" ? args[0] : JSON.stringify(args[0]);
        case "int":
          if (typeof args[0] === "number") return Math.trunc(args[0]);
          if (typeof args[0] === "string" && /^-?\d+$/.test(args[0])) return Number(args[0]);
          throw new CelError(`int() of ${kind(args[0])}`);
      }
      throw new CelError(`undeclared function '${n.name}'`);
    }
    const o = ev(n.of);
    const args = n.args.map(ev);
    if (isOptional(o)) {
      switch (n.name) {
        case "hasValue":
          return o.has;
        case "value":
          if (!o.has) throw new CelError("optional.none() dereference");
          return o.v!;
        case "orValue":
          return o.has ? o.v! : args[0];
      }
    }
    switch (n.name) {
      case "contains":
        return want<string>(o, "string", "contains").includes(want<string>(args[0], "string", "contains"));
      case "startsWith":
        return want<string>(o, "string", "startsWith").startsWith(want<string>(args[0], "string", "startsWith"));
      case "endsWith":
        return want<string>(o, "string", "endsWith").endsWith(want<string>(args[0], "string", "endsWith"));
      case "size":
        return size(o);
    }
    throw new CelError(`no method ${n.name} on ${kind(o)}`);
  };

  const size = (v: CelValue): number => {
    if (typeof v === "string" || Array.isArray(v)) return v.length;
    if (v && typeof v === "object" && !isOptional(v)) return Object.keys(v).length;
    throw new CelError(`size of ${kind(v)}`);
  };

  return ev(e.node);
}

// A rendering of a value the way the daemon logs an event's value: strings bare, the rest as JSON.
export const shown = (v: CelValue): string => (typeof v === "string" ? v : isOptional(v) ? (v.has ? shown(v.v!) : "none") : JSON.stringify(v));
