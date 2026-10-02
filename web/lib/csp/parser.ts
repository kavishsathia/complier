import {
  Assertion, BinOp, Branch, Call, CspError, Expr, Field, Program, SystemNode,
} from "./ast";
import { check } from "./check";

interface Token {
  kind: "ident" | "int" | "sym" | "eof";
  text: string;
  line: number;
  start: number;
  end: number;
}

const SYMBOLS = [
  "|||", "[|", "|]", "{|", "|}", "[]", "->", "..", ":[", "==", "!=", "<=", ">=",
  "&", "!", "?", ".", ":", ",", "(", ")", "{", "}", "[", "]", "=", "<", ">", "+", "-", "*", "|",
];

const KEYWORDS = new Set([
  "datatype", "channel", "assert", "STOP", "and", "or", "not", "always", "if", "then", "else",
]);

export function lex(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  while (i < source.length) {
    const c = source[i];
    if (c === "\n") { line++; i++; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (source.startsWith("--", i)) {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < source.length && /[0-9]/.test(source[i])) i++;
      tokens.push({ kind: "int", text: source.slice(start, i), line, start, end: i });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < source.length && /[A-Za-z0-9_']/.test(source[i])) i++;
      tokens.push({ kind: "ident", text: source.slice(start, i), line, start, end: i });
      continue;
    }
    const sym = SYMBOLS.find((s) => source.startsWith(s, i));
    if (!sym) throw new CspError(`unexpected character '${c}'`, line);
    tokens.push({ kind: "sym", text: sym, line, start: i, end: i + sym.length });
    i += sym.length;
  }
  tokens.push({ kind: "eof", text: "end of input", line, start: i, end: i });
  return tokens;
}

class Parser {
  pos = 0;
  constructor(private tokens: Token[], private source: string) {}

  peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)];
  }

  next(): Token {
    const t = this.peek();
    this.pos++;
    return t;
  }

  isSym(text: string, offset = 0): boolean {
    const t = this.peek(offset);
    return t.kind === "sym" && t.text === text;
  }

  isWord(text: string): boolean {
    const t = this.peek();
    return t.kind === "ident" && t.text === text;
  }

  expectSym(text: string): Token {
    const t = this.next();
    if (t.kind !== "sym" || t.text !== text) {
      throw new CspError(`expected '${text}' but found '${t.text}'`, t.line);
    }
    return t;
  }

  expectName(what: string): Token {
    const t = this.next();
    if (t.kind !== "ident" || KEYWORDS.has(t.text)) {
      throw new CspError(`expected ${what} but found '${t.text}'`, t.line);
    }
    return t;
  }

  nameList(what: string): string[] {
    const names = [this.expectName(what).text];
    while (this.isSym(",")) {
      this.next();
      names.push(this.expectName(what).text);
    }
    return names;
  }

  // expressions, lowest precedence first

  expr(): Expr {
    let left = this.andExpr();
    while (this.isWord("or")) {
      this.next();
      left = { kind: "binary", op: "or", left, right: this.andExpr() };
    }
    return left;
  }

  andExpr(): Expr {
    let left = this.notExpr();
    while (this.isWord("and")) {
      this.next();
      left = { kind: "binary", op: "and", left, right: this.notExpr() };
    }
    return left;
  }

  notExpr(): Expr {
    if (this.isWord("not")) {
      this.next();
      return { kind: "unary", op: "not", arg: this.notExpr() };
    }
    return this.compare();
  }

  compare(): Expr {
    const left = this.additive();
    const t = this.peek();
    if (t.kind === "sym" && ["==", "!=", "<", "<=", ">", ">="].includes(t.text)) {
      this.next();
      return { kind: "binary", op: t.text as BinOp, left, right: this.additive() };
    }
    return left;
  }

  additive(): Expr {
    let left = this.term();
    while (this.isSym("+") || this.isSym("-")) {
      const op = this.next().text as BinOp;
      left = { kind: "binary", op, left, right: this.term() };
    }
    return left;
  }

  term(): Expr {
    let left = this.atom();
    while (this.isSym("*")) {
      this.next();
      left = { kind: "binary", op: "*", left, right: this.atom() };
    }
    return left;
  }

  atom(): Expr {
    if (this.isWord("if")) {
      this.next();
      const cond = this.expr();
      if (!this.isWord("then")) throw new CspError("expected 'then'", this.peek().line);
      this.next();
      const then = this.expr();
      if (!this.isWord("else")) throw new CspError("expected 'else'", this.peek().line);
      this.next();
      return { kind: "if", cond, then, else: this.expr() };
    }
    const t = this.next();
    if (t.kind === "int") return { kind: "int", value: Number(t.text) };
    if (t.kind === "ident" && !KEYWORDS.has(t.text)) return { kind: "name", name: t.text };
    if (t.kind === "sym" && t.text === "-") return { kind: "unary", op: "-", arg: this.atom() };
    if (t.kind === "sym" && t.text === "(") {
      const e = this.expr();
      this.expectSym(")");
      return e;
    }
    throw new CspError(`expected an expression but found '${t.text}'`, t.line);
  }

  // processes

  call(): Call {
    const name = this.expectName("a process name").text;
    const args: Expr[] = [];
    if (this.isSym("(")) {
      this.next();
      if (!this.isSym(")")) {
        args.push(this.expr());
        while (this.isSym(",")) {
          this.next();
          args.push(this.expr());
        }
      }
      this.expectSym(")");
    }
    return { name, args };
  }

  fields(): Field[] {
    const fields: Field[] = [];
    for (;;) {
      if (this.isSym("!") || this.isSym(".")) {
        this.next();
        fields.push({ kind: "out", expr: this.atom() });
      } else if (this.isSym("?")) {
        this.next();
        const name = this.expectName("an input variable").text;
        if (this.isSym(":")) {
          this.next();
          this.expectSym("{");
          const lo = this.expr();
          this.expectSym("..");
          const hi = this.expr();
          this.expectSym("}");
          fields.push({ kind: "in", name, range: { lo, hi } });
        } else {
          fields.push({ kind: "in", name });
        }
      } else {
        return fields;
      }
    }
  }

  branch(): Branch {
    const line = this.peek().line;
    let guard: Expr | undefined;
    const save = this.pos;
    try {
      const e = this.expr();
      if (this.isSym("&")) {
        this.next();
        guard = e;
      } else {
        this.pos = save;
      }
    } catch {
      this.pos = save;
    }
    const channel = this.expectName("a channel").text;
    const fields = this.fields();
    this.expectSym("->");
    let target: Call | null = null;
    if (this.isWord("STOP")) {
      this.next();
    } else {
      if (this.isSym("(")) {
        throw new CspError(
          "after '->' the fragment only allows a call like Name(args) or STOP", this.peek().line,
        );
      }
      target = this.call();
      if (this.isSym("!") || this.isSym("?") || this.isSym(".") || this.isSym("->")) {
        throw new CspError(
          "nested prefixes are outside the fragment: split them into a named process", this.peek().line,
        );
      }
    }
    return { guard, channel, fields, target, line };
  }

  procBody(): Branch[] {
    if (this.isWord("STOP")) {
      this.next();
      return [];
    }
    const branches = [this.branch()];
    while (this.isSym("[]")) {
      this.next();
      branches.push(this.branch());
    }
    if (this.isSym("|||") || this.isSym("[|")) {
      throw new CspError("parallel composition is only allowed in System", this.peek().line);
    }
    return branches;
  }

  systemAtom(): SystemNode {
    if (this.isSym("(")) {
      this.next();
      const node = this.system();
      this.expectSym(")");
      return node;
    }
    return { kind: "leaf", call: this.call() };
  }

  system(): SystemNode {
    let left = this.systemAtom();
    for (;;) {
      if (this.isSym("|||")) {
        this.next();
        left = { kind: "interleave", left, right: this.systemAtom() };
      } else if (this.isSym("[|")) {
        this.next();
        this.expectSym("{|");
        const channels = this.isSym("|}") ? [] : this.nameList("a channel");
        this.expectSym("|}");
        this.expectSym("|]");
        left = { kind: "sync", channels, left, right: this.systemAtom() };
      } else {
        return left;
      }
    }
  }

  assertion(): Assertion {
    const line = this.next().line; // assert
    const process = this.expectName("a process name").text;
    this.expectSym(":[");
    if (!this.isWord("always")) {
      throw new CspError("the playground supports assertions of the form P :[always expr]", line);
    }
    this.next();
    const startTok = this.peek();
    const property = this.expr();
    const endTok = this.tokens[this.pos - 1];
    this.expectSym("]");
    return {
      process,
      property,
      text: this.source.slice(startTok.start, endTok.end),
      line,
    };
  }

  program(): Program {
    const prog: Program = {
      datatypes: new Map(),
      constructors: new Map(),
      channels: new Map(),
      procs: new Map(),
      system: { kind: "leaf", call: { name: "", args: [] } },
      assertions: [],
    };
    let sawSystem = false;
    while (this.peek().kind !== "eof") {
      const t = this.peek();
      if (this.isWord("datatype")) {
        this.next();
        const name = this.expectName("a type name").text;
        this.expectSym("=");
        const ctors = [this.expectName("a constructor").text];
        while (this.isSym("|")) {
          this.next();
          ctors.push(this.expectName("a constructor").text);
        }
        prog.datatypes.set(name, ctors);
        ctors.forEach((c, index) => prog.constructors.set(c, { type: name, index }));
      } else if (this.isWord("channel")) {
        this.next();
        const names = this.nameList("a channel name");
        let types: string[] = [];
        if (this.isSym(":")) {
          this.next();
          types = [this.expectName("a type").text];
          while (this.isSym(".")) {
            this.next();
            types.push(this.expectName("a type").text);
          }
        }
        for (const n of names) prog.channels.set(n, types);
      } else if (this.isWord("assert")) {
        prog.assertions.push(this.assertion());
      } else if (t.kind === "ident") {
        const name = this.expectName("a definition").text;
        const params: string[] = [];
        if (this.isSym("(")) {
          this.next();
          if (!this.isSym(")")) params.push(...this.nameList("a parameter"));
          this.expectSym(")");
        }
        this.expectSym("=");
        if (name === "System") {
          if (params.length) throw new CspError("System takes no parameters", t.line);
          prog.system = this.system();
          sawSystem = true;
        } else {
          if (prog.procs.has(name)) throw new CspError(`${name} is defined twice`, t.line);
          prog.procs.set(name, { name, params, branches: this.procBody(), line: t.line });
        }
      } else {
        throw new CspError(`unexpected '${t.text}'`, t.line);
      }
    }
    if (!sawSystem) throw new CspError("define the composed system as System = ...", this.peek().line);
    return prog;
  }
}

export function parse(source: string): Program {
  const prog = new Parser(lex(source), source).program();
  check(prog);
  return prog;
}
