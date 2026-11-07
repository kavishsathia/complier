// Parser for complier policies: the specs `complier machine up` loads (examples/demo/draft.csp,
// cli/tests/fixtures), read with the meaning complier-fdr's prelude gives them:
//
//   Permit(x, P) = attempt.x -> allow.x -> result.x?v : Returns(x) -> P(v)
//   Deny(x, P)   = attempt.x -> deny.x -> P
//
// so Permit and Deny are expanded into those prefixes here. With a `Role` datatype, every event
// also carries the role, as in the paper's encoding (README, fdr/README.md): Permit(r, x, P) is
// attempt.r.x -> allow.r.x -> result.r.x?v : Returns(x) -> P(v).
//
// The fragment is what policies are written in: datatypes of plain constructors, Returns, process
// definitions with patterns, [], prefixes on the prelude's channels, if-then-else and lambdas.
// Anything else is an error that names it, rather than a guess. A new item starts at column 0, as in
// the repository's specs; assertions and channel declarations are skipped (they don't change
// Policy). Definitions are parsed one by one, and a definition that doesn't parse is an error only
// if the diagram reaches it.

export class PolicyError extends Error {}

const fail = (line: number, msg: string): never => {
  throw new PolicyError(`line ${line}: ${msg}`);
};

// A value in source: a constructor or a variable (lowercase either way), or a constant once
// substituted.
export type Val = { k: "name"; name: string } | { k: "con"; name: string };

export type Cond =
  | { k: "bool"; v: boolean }
  | { k: "eq"; op: "==" | "!="; a: Val; b: Val }
  | { k: "member"; v: Val; set: SetE }
  | { k: "not"; c: Cond }
  | { k: "and" | "or"; a: Cond; b: Cond };

export type SetE = { k: "lit"; items: Val[] } | { k: "returns"; arg: Val } | { k: "type"; name: string };

export type Pat = { k: "any" } | { k: "var"; name: string } | { k: "con"; name: string };

export type Fn = { k: "lambda"; pat: Pat; body: Proc } | { k: "name"; name: string; line: number };

// c.a.b?x : S: outputs, then at most one input (the result's value).
export type Field = { k: "out"; v: Val } | { k: "in"; name: string; set?: SetE };

export type Proc =
  | { k: "stop" }
  | { k: "skip" }
  | { k: "pre"; chan: string; fields: Field[]; next: Proc; line: number }
  | { k: "ext"; l: Proc; r: Proc }
  | { k: "if"; c: Cond; then: Proc; else: Proc }
  | { k: "call"; name: string; args: Val[]; line: number }
  // P(v) for Permit's continuation P, a lambda or a process name.
  | { k: "apply"; fn: Fn; arg: Val; line: number };

export type Clause = { pats: Pat[]; head: string; line: number } & ({ body: Proc } | { error: string });

export type Policy = {
  // datatype name -> constructors
  types: Map<string, string[]>;
  // constructor -> its datatype
  cons: Map<string, string>;
  returns: { pat: Pat; set: SetE; line: number }[];
  defs: Map<string, Clause[]>;
  // The roles, if the spec declares a Role datatype; otherwise one agent.
  roles: string[] | null;
};

// Names the prelude defines.
const RESERVED = new Set(["Permit", "Deny", "ControllableCHAOS", "Await", "System", "ComplierGuard", "ComplierHandshake"]);
export const CHANNELS = ["attempt", "allow", "deny", "result"];

type Tok = { t: string; v?: string; line: number; col: number };

const PUNCT = [
  "|~|", "|||", "[|", "|]", "[T=", "[F=", "[FD=", "[]", "->", "==", "!=", "<=", ">=", "/\\", "[>",
  "(", ")", "{", "}", "<", ">", ",", ".", "?", "!", ":", "=", "\\", "@", "|", ";", "&", "+", "-", "*", "[", "]",
];
const UNICODE: Record<string, string> = { "→": "->", "□": "[]", "⊓": "|~|", "⫴": "|||" };

function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let line = 1;
  let lineStart = 0;
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const col = i - lineStart;
    if (c === "\n") {
      line++;
      i++;
      lineStart = i;
    } else if (/\s/.test(c)) {
      i++;
    } else if (src.startsWith("--", i)) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (src.startsWith("{-", i)) {
      const end = src.indexOf("-}", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) if (src[i] === "\n") (line++, (lineStart = i + 1));
    } else if (/[0-9]/.test(c)) {
      const m = /^[0-9]+/.exec(src.slice(i))![0];
      toks.push({ t: "num", v: m, line, col });
      i += m.length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_']*/.exec(src.slice(i))![0];
      toks.push({ t: m === "_" ? "_" : "id", v: m, line, col });
      i += m.length;
    } else if (UNICODE[c]) {
      toks.push({ t: UNICODE[c], line, col });
      i++;
    } else {
      const p = PUNCT.find((p) => src.startsWith(p, i));
      if (!p) fail(line, `unexpected character '${c}'`);
      toks.push({ t: p!, line, col });
      i += p!.length;
    }
  }
  return toks;
}

const show = (tok: Tok | undefined) => (!tok ? "the end of the definition" : tok.v !== undefined ? `'${tok.v}'` : `'${tok.t}'`);
const isUpper = (s: string) => /^[A-Z]/.test(s);
const KEYWORDS = new Set(["if", "then", "else", "and", "or", "not", "true", "false", "STOP", "SKIP", "member", "let", "within"]);

// Operators a policy may contain in CSPm that the diagram doesn't draw.
const UNSUPPORTED: Record<string, string> = {
  "|~|": "internal choice (|~|): complier admits only deterministic policies",
  "|||": "interleaving (|||) inside the policy",
  "[|": "parallel composition ([| .. |]) inside the policy",
  ";": "sequential composition (;)",
  "/\\": "interrupt (/\\)",
  "[>": "timeout ([>)",
  "&": "guards (b & P): write if b then P else STOP",
};

class Parser {
  i = 0;
  toks: Tok[];
  line: number;
  constructor(toks: Tok[], line: number) {
    this.toks = toks;
    this.line = line;
  }

  peek(k = 0): Tok | undefined {
    return this.toks[this.i + k];
  }
  is(t: string, v?: string) {
    const tok = this.peek();
    return !!tok && tok.t === t && (v === undefined || tok.v === v);
  }
  eat(t: string, v?: string) {
    if (!this.is(t, v)) return false;
    this.i++;
    return true;
  }
  at() {
    return this.peek()?.line ?? this.line;
  }
  expect(t: string, what = `'${t}'`) {
    if (!this.eat(t)) fail(this.at(), `expected ${what}, found ${show(this.peek())}`);
  }
  done() {
    if (this.peek()) {
      const t = this.peek()!.t;
      if (UNSUPPORTED[t]) fail(this.at(), `the diagram doesn't draw ${UNSUPPORTED[t]}`);
      fail(this.at(), `unexpected ${show(this.peek())}`);
    }
  }
  lower(what: string): string {
    const tok = this.peek();
    if (!tok || tok.t !== "id" || isUpper(tok.v!) || KEYWORDS.has(tok.v!)) fail(this.at(), `expected ${what}, found ${show(tok)}`);
    this.i++;
    return tok!.v!;
  }

  pat(): Pat {
    if (this.eat("_")) return { k: "any" };
    return { k: "var", name: this.lower("a pattern (a value, a variable or _)") };
  }

  val(): Val {
    return { k: "name", name: this.lower("a value") };
  }

  set(): SetE {
    if (this.eat("{")) {
      const items: Val[] = [];
      if (!this.is("}")) do items.push(this.val()); while (this.eat(","));
      this.expect("}", "'}' to close the set");
      return { k: "lit", items };
    }
    if (this.eat("id", "Returns")) {
      this.expect("(");
      const arg = this.val();
      this.expect(")");
      return { k: "returns", arg };
    }
    const tok = this.peek();
    if (tok?.t === "id" && isUpper(tok.v!)) {
      this.i++;
      return { k: "type", name: tok.v! };
    }
    return fail(this.at(), `expected a set, such as {done, failed} or Returns(x), found ${show(tok)}`);
  }

  cond(): Cond {
    let a = this.condAnd();
    while (this.eat("id", "or")) a = { k: "or", a, b: this.condAnd() };
    return a;
  }
  condAnd(): Cond {
    let a = this.condNot();
    while (this.eat("id", "and")) a = { k: "and", a, b: this.condNot() };
    return a;
  }
  condNot(): Cond {
    if (this.eat("id", "not")) return { k: "not", c: this.condNot() };
    if (this.eat("id", "true")) return { k: "bool", v: true };
    if (this.eat("id", "false")) return { k: "bool", v: false };
    if (this.eat("(")) {
      const c = this.cond();
      this.expect(")");
      return c;
    }
    if (this.eat("id", "member")) {
      this.expect("(");
      const v = this.val();
      this.expect(",");
      const set = this.set();
      this.expect(")");
      return { k: "member", v, set };
    }
    const a = this.val();
    const op = this.eat("==") ? "==" : this.eat("!=") ? "!=" : fail(this.at(), `expected == or != after ${a.name}, found ${show(this.peek())}`);
    return { k: "eq", op: op as "==" | "!=", a, b: this.val() };
  }

  proc(): Proc {
    let l = this.prefix();
    while (this.eat("[]")) l = { k: "ext", l, r: this.prefix() };
    const t = this.peek()?.t;
    if (t && UNSUPPORTED[t]) fail(this.at(), `the diagram doesn't draw ${UNSUPPORTED[t]}`);
    return l;
  }

  prefix(): Proc {
    const tok = this.peek();
    if (this.eat("id", "if")) {
      const c = this.cond();
      this.expect("id", "'then'");
      const then = this.proc();
      this.expect("id", "'else'");
      return { k: "if", c, then, else: this.proc() };
    }
    if (tok?.t === "id" && !isUpper(tok.v!) && !KEYWORDS.has(tok.v!)) {
      const line = tok.line;
      const chan = this.lower("a channel");
      const fields: Field[] = [];
      for (;;) {
        if (this.eat(".") || this.eat("!")) {
          if (fields.some((f) => f.k === "in")) fail(line, `${chan}: an output after ?${(fields.find((f) => f.k === "in") as { name: string }).name} isn't drawn`);
          fields.push({ k: "out", v: this.val() });
        } else if (this.eat("?")) {
          if (fields.some((f) => f.k === "in")) fail(line, `${chan}: only one input (?v) is drawn`);
          const name = this.lower("a variable after ?");
          fields.push({ k: "in", name, set: this.eat(":") ? this.set() : undefined });
        } else break;
      }
      this.expect("->", `'->' after the event ${chan}`);
      return { k: "pre", chan, fields, next: this.prefix(), line };
    }
    if (this.is("[]")) fail(this.at(), "the diagram doesn't draw replicated choice ([] x : S @ P); write the choices out");
    if (this.is("|~|")) fail(this.at(), `the diagram doesn't draw ${UNSUPPORTED["|~|"]}`);
    return this.atom();
  }

  atom(): Proc {
    const tok = this.peek();
    const line = this.at();
    if (this.eat("id", "STOP")) return { k: "stop" };
    if (this.eat("id", "SKIP")) return { k: "skip" };
    if (this.eat("(")) {
      const p = this.proc();
      this.expect(")");
      return p;
    }
    if (this.eat("id", "Permit") || this.eat("id", "Deny")) {
      const permit = tok!.v === "Permit";
      this.expect("(", `'(' after ${tok!.v}`);
      const vals: Val[] = [this.val()];
      this.expect(",");
      // Permit(x, P) or Permit(r, x, P): a second value means the first was the role.
      if (!this.is("id") || isUpper(this.peek()!.v!) || this.peek(1)?.t !== ",") {
        // P comes next
      } else {
        vals.push(this.val());
        this.expect(",");
      }
      const [role, act] = vals.length === 2 ? vals : [null, vals[0]];
      const head = (): Field[] => [...(role ? [{ k: "out", v: role } as Field] : []), { k: "out", v: act }];
      let out: Proc;
      if (permit) {
        const fn = this.fn();
        const v: Val = { k: "name", name: "v'" };
        out = {
          k: "pre", chan: "attempt", fields: head(), line, next: {
            k: "pre", chan: "allow", fields: head(), line, next: {
              k: "pre", chan: "result", fields: [...head(), { k: "in", name: "v'", set: { k: "returns", arg: act } }], line,
              next: { k: "apply", fn, arg: v, line },
            },
          },
        };
      } else {
        const next = this.proc();
        out = { k: "pre", chan: "attempt", fields: head(), line, next: { k: "pre", chan: "deny", fields: head(), line, next } };
      }
      this.expect(")", `')' to close ${tok!.v}`);
      return out;
    }
    if (tok?.t === "id" && isUpper(tok.v!) && !KEYWORDS.has(tok.v!)) {
      this.i++;
      const args: Val[] = [];
      if (this.eat("(")) {
        do args.push(this.val()); while (this.eat(","));
        this.expect(")");
      }
      return { k: "call", name: tok.v!, args, line };
    }
    if (this.is("\\")) fail(line, "a lambda (\\ v @ P) is drawn only as Permit's continuation");
    return fail(line, `expected a process, found ${show(tok)}`);
  }

  // Permit's continuation: \ v @ P, or a process taking the value.
  fn(): Fn {
    if (this.eat("(")) {
      const f = this.fn();
      this.expect(")");
      return f;
    }
    if (this.eat("\\")) {
      const pat = this.pat();
      this.expect("@", "'@' in the lambda");
      return { k: "lambda", pat, body: this.proc() };
    }
    const tok = this.peek();
    if (tok?.t === "id" && isUpper(tok.v!) && !KEYWORDS.has(tok.v!)) {
      this.i++;
      return { k: "name", name: tok.v!, line: tok.line };
    }
    return fail(this.at(), `expected Permit's continuation (\\ v @ P, or a process name), found ${show(tok)}`);
  }
}

const IGNORED = new Set(["assert", "channel", "transparent", "external", "print"]);

export function parsePolicy(src: string): Policy {
  const toks = lex(src);
  // Items start at column 0.
  const items: Tok[][] = [];
  for (const tok of toks) {
    if (tok.col === 0 || !items.length) items.push([]);
    items[items.length - 1].push(tok);
  }
  const types = new Map<string, string[]>();
  const cons = new Map<string, string>();
  const returns: Policy["returns"] = [];
  const defs = new Map<string, Clause[]>();

  for (const item of items) {
    const first = item[0];
    const line = first.line;
    if (first.t === "id" && IGNORED.has(first.v!)) continue;
    const p = new Parser(item, line);
    if (first.t === "id" && first.v === "datatype") {
      p.i++;
      const tok = p.peek();
      if (tok?.t !== "id" || !isUpper(tok.v!)) fail(line, `expected the datatype's name, found ${show(tok)}`);
      p.i++;
      const name = tok!.v!;
      if (types.has(name)) fail(line, `datatype ${name} is declared twice`);
      p.expect("=");
      const cs: string[] = [];
      do {
        const c = p.lower(`a constructor of ${name}`);
        if (p.is(".")) fail(line, `${name}.${c}: constructors that carry data aren't drawn`);
        if (cons.has(c)) fail(line, `${c} is a constructor of both ${cons.get(c)} and ${name}`);
        cons.set(c, name);
        cs.push(c);
      } while (p.eat("|"));
      p.done();
      types.set(name, cs);
      continue;
    }
    if (first.t === "id" && first.v === "Returns") {
      p.i++;
      p.expect("(", "'(' after Returns");
      const pat = p.pat();
      p.expect(")");
      p.expect("=");
      const set = p.set();
      p.done();
      returns.push({ pat, set, line });
      continue;
    }
    if (first.t !== "id" || !isUpper(first.v!)) {
      if (first.t === "id" && ["include", "nametype", "subtype", "module"].includes(first.v!))
        fail(line, `'${first.v}' isn't supported here: give the policy in one file, with plain datatypes`);
      fail(line, `expected a definition (Name = ...), a datatype or Returns, found ${show(first)}`);
    }
    const name = first.v!;
    if (RESERVED.has(name) || name.startsWith("Complier")) fail(line, `${name} is defined by complier's prelude`);
    p.i++;
    const pats: Pat[] = [];
    if (p.eat("(")) {
      do pats.push(p.pat()); while (p.eat(","));
      p.expect(")");
    }
    const head = pats.length ? `${name}(${pats.map((x) => (x.k === "any" ? "_" : x.k === "var" ? x.name : x.name)).join(", ")})` : name;
    const clauses = defs.get(name) ?? [];
    defs.set(name, clauses);
    try {
      p.expect("=", `'=' in the definition of ${name}`);
      const body = p.proc();
      p.done();
      clauses.push({ pats, head, line, body });
    } catch (e) {
      if (!(e instanceof PolicyError)) throw e;
      clauses.push({ pats, head, line, error: e.message });
    }
  }

  // Lowercase names in patterns are constructors when a datatype declares them.
  const fixPat = (x: Pat): Pat => (x.k === "var" && cons.has(x.name) ? { k: "con", name: x.name } : x);
  for (const clauses of defs.values()) for (const c of clauses) c.pats = c.pats.map(fixPat);
  for (const r of returns) r.pat = fixPat(r.pat);
  for (const [name, clauses] of defs) {
    const arity = clauses[0].pats.length;
    for (const c of clauses) if (c.pats.length !== arity) fail(c.line, `${name} is defined with ${arity} and ${c.pats.length} parameters`);
  }

  if (!types.has("Act")) fail(1, "declare the actions: datatype Act = ...");
  if (!types.has("Value")) fail(1, "declare what calls return: datatype Value = ...");
  if (!defs.has("Policy")) fail(1, "define Policy, the process complier enforces");
  return { types, cons, returns, defs, roles: types.get("Role") ?? null };
}
