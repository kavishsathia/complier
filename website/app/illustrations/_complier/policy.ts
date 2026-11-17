// Walks a complier policy the way the daemon walks the automaton FDR compiles from it
// (cli/src/daemon.rs). Permit and Deny mean what complier-fdr's prelude makes them:
//
//   Permit(x, P) = attempt.x -> allow.x -> result.x?v : Returns(x) -> P(v)
//   Deny(x, P)   = attempt.x -> deny.x -> P
//
// with the role first in every event when the spec declares `datatype Role`. An agent's call is
// attempt.<role>.<action>: if the policy's current state offers it, the policy's own allow or deny
// edge is the verdict; if not, the call is refused and the policy stays where it was. An allowed
// call's result then moves the policy along result.<role>.<action>.<value>.
//
// The policies are CSPm, read here in the fragment they're written in: datatypes whose
// constructors may carry one field (accept.{10, 15}), Returns, parameterised process definitions
// with patterns (Minimum(stock, _, minimum.m)), integers with + and -, comparisons, [], guards
// (b & P), replicated choice ([] q : S @ P), if-then-else, and Permit/Deny with a lambda or a
// process name as Permit's continuation. Anything else is an error that names its line. Items
// start at column 0, as in the repository's specs; `assert` and `channel` items are skipped (they
// don't change Policy).

export class PolicyError extends Error {}

const fail = (line: number, msg: string): never => {
  throw new PolicyError(`line ${line}: ${msg}`);
};

// Expressions: values are strings as FDR prints them (15, accept.15, minimum.40, agent_a).
export type Expr =
  | { k: "num"; v: number }
  | { k: "name"; name: string }
  | { k: "dot"; a: Expr; b: Expr }
  | { k: "arith"; op: "+" | "-"; a: Expr; b: Expr }
  | { k: "cmp"; op: "==" | "!=" | "<" | "<=" | ">" | ">="; a: Expr; b: Expr }
  | { k: "bool"; v: boolean }
  | { k: "not"; e: Expr }
  | { k: "logic"; op: "and" | "or"; a: Expr; b: Expr }
  | { k: "member"; v: Expr; set: SetE };

export type SetE =
  | { k: "lit"; items: Expr[] }
  | { k: "range"; from: Expr; to: Expr }
  | { k: "prod"; cons: string[] }
  | { k: "returns"; arg: Expr }
  | { k: "type"; name: string };

export type Pat = { k: "any" } | { k: "var"; name: string } | { k: "lit"; v: string } | { k: "con"; name: string; field?: Pat };

export type Fn = { k: "lambda"; pat: Pat; body: Proc } | { k: "name"; name: string; line: number };

// c.a.b?x : S: outputs, then at most one input (the result's value).
export type Field = { k: "out"; v: Expr } | { k: "in"; name: string; set?: SetE };

export type Proc =
  | { k: "stop" }
  | { k: "skip" }
  | { k: "pre"; chan: string; fields: Field[]; next: Proc; line: number }
  | { k: "ext"; l: Proc; r: Proc }
  | { k: "guard"; c: Expr; p: Proc }
  | { k: "rep"; v: string; set: SetE; p: Proc }
  | { k: "if"; c: Expr; then: Proc; else: Proc }
  | { k: "call"; name: string; args: Expr[]; line: number }
  // P(v) for Permit's continuation P, a lambda or a process name.
  | { k: "apply"; fn: Fn; arg: Expr; line: number };

export type Clause = { pats: Pat[]; line: number; body: Proc };

export type Policy = {
  // datatype name -> its values, as FDR prints them
  types: Map<string, string[]>;
  // constructor -> its datatype
  cons: Map<string, string>;
  returns: { pat: Pat; set: SetE; line: number }[];
  defs: Map<string, Clause[]>;
  // The roles, if the spec declares a Role datatype (Agent is one ControllableCHAOS per role);
  // otherwise one agent.
  roles: string[] | null;
};

// A state of the policy: a process and the values its variables are bound to. Plain data, so it
// travels between the browser and the demo's route as JSON.
export type PState = { p: Proc; env: Record<string, string> };

// Names the prelude defines.
const RESERVED = new Set(["Permit", "Deny", "ControllableCHAOS", "Await", "ComplierGuard", "ComplierHandshake"]);

type Tok = { t: string; v?: string; line: number; col: number };

const PUNCT = [
  "{|", "|}", "|~|", "|||", "[|", "|]", "[T=", "[F=", "[FD=", "[]", "->", "==", "!=", "<=", ">=", "..", "/\\", "[>",
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

const UNSUPPORTED: Record<string, string> = {
  "|~|": "internal choice (|~|): complier admits only deterministic policies",
  "|||": "interleaving (|||) inside the policy",
  "[|": "parallel composition ([| .. |]) inside the policy",
  ";": "sequential composition (;)",
  "/\\": "interrupt (/\\)",
  "[>": "timeout ([>)",
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
      if (UNSUPPORTED[t]) fail(this.at(), `this policy can't use ${UNSUPPORTED[t]}`);
      fail(this.at(), `unexpected ${show(this.peek())}`);
    }
  }
  lower(what: string): string {
    const tok = this.peek();
    if (!tok || tok.t !== "id" || isUpper(tok.v!) || KEYWORDS.has(tok.v!)) fail(this.at(), `expected ${what}, found ${show(tok)}`);
    this.i++;
    return tok!.v!;
  }
  upperNext() {
    const tok = this.peek();
    return tok?.t === "id" && isUpper(tok.v!) && !KEYWORDS.has(tok.v!);
  }

  // Patterns: _, a variable, a number, a constructor, or a constructor with its field (minimum.m).
  // Which lowercase names are constructors is settled once the datatypes are known.
  pat(): Pat {
    if (this.eat("_")) return { k: "any" };
    const tok = this.peek();
    if (tok?.t === "num") {
      this.i++;
      return { k: "lit", v: tok.v! };
    }
    // An uppercase parameter takes a process: Others(S) = ... S.
    if (this.upperNext()) {
      this.i++;
      return { k: "var", name: tok!.v! };
    }
    const name = this.lower("a pattern (a value, a variable, a number or _)");
    if (this.eat(".")) return { k: "con", name, field: this.pat() };
    return { k: "var", name };
  }

  // Values: numbers with + and -, names, and dotted values (accept.q).
  expr(): Expr {
    let a = this.dotted();
    for (;;) {
      if (this.eat("+")) a = { k: "arith", op: "+", a, b: this.dotted() };
      else if (this.eat("-")) a = { k: "arith", op: "-", a, b: this.dotted() };
      else return a;
    }
  }
  dotted(): Expr {
    let a = this.atomE();
    while (this.is(".") && this.peek(1)?.t !== ".") {
      this.i++;
      a = { k: "dot", a, b: this.atomE() };
    }
    return a;
  }
  atomE(): Expr {
    const tok = this.peek();
    if (tok?.t === "num") {
      this.i++;
      return { k: "num", v: Number(tok.v) };
    }
    if (this.eat("(")) {
      const e = this.expr();
      this.expect(")");
      return e;
    }
    // A process passed by name (Held(agent_a) takes a value; Others(Writing) a process).
    if (this.upperNext()) {
      this.i++;
      return { k: "name", name: tok!.v! };
    }
    return { k: "name", name: this.lower("a value") };
  }

  set(): SetE {
    if (this.eat("{|")) {
      const cons: string[] = [];
      do cons.push(this.lower("a constructor")); while (this.eat(","));
      this.expect("|}", "'|}' to close the set");
      return { k: "prod", cons };
    }
    if (this.eat("{")) {
      if (this.eat("}")) return { k: "lit", items: [] };
      const first = this.expr();
      if (this.eat("..")) {
        const to = this.expr();
        this.expect("}", "'}' to close the range");
        return { k: "range", from: first, to };
      }
      const items = [first];
      while (this.eat(",")) items.push(this.expr());
      this.expect("}", "'}' to close the set");
      return { k: "lit", items };
    }
    if (this.eat("id", "Returns")) {
      this.expect("(");
      const arg = this.expr();
      this.expect(")");
      return { k: "returns", arg };
    }
    if (this.upperNext()) return { k: "type", name: this.toks[this.i++].v! };
    return fail(this.at(), `expected a set, such as {done, failed}, {20..100} or Returns(x), found ${show(this.peek())}`);
  }

  cond(): Expr {
    let a = this.condAnd();
    while (this.eat("id", "or")) a = { k: "logic", op: "or", a, b: this.condAnd() };
    return a;
  }
  condAnd(): Expr {
    let a = this.condNot();
    while (this.eat("id", "and")) a = { k: "logic", op: "and", a, b: this.condNot() };
    return a;
  }
  condNot(): Expr {
    if (this.eat("id", "not")) return { k: "not", e: this.condNot() };
    if (this.eat("id", "true")) return { k: "bool", v: true };
    if (this.eat("id", "false")) return { k: "bool", v: false };
    if (this.is("(")) {
      // A parenthesised condition, or a parenthesised value compared below.
      const save = this.i;
      this.i++;
      try {
        const c = this.cond();
        this.expect(")");
        if (!this.isCmp()) return c;
      } catch (e) {
        if (!(e instanceof PolicyError)) throw e;
      }
      this.i = save;
    }
    if (this.eat("id", "member")) {
      this.expect("(");
      const v = this.expr();
      this.expect(",");
      const set = this.set();
      this.expect(")");
      return { k: "member", v, set };
    }
    const a = this.expr();
    const op = this.peek()?.t;
    if (!this.isCmp()) return fail(this.at(), `expected a comparison (==, !=, <, <=, >, >=), found ${show(this.peek())}`);
    this.i++;
    return { k: "cmp", op: op as "==", a, b: this.expr() };
  }
  isCmp() {
    const t = this.peek()?.t;
    return t === "==" || t === "!=" || t === "<" || t === "<=" || t === ">" || t === ">=";
  }

  proc(): Proc {
    let l = this.guarded();
    while (this.eat("[]")) l = { k: "ext", l, r: this.guarded() };
    const t = this.peek()?.t;
    if (t && UNSUPPORTED[t]) fail(this.at(), `this policy can't use ${UNSUPPORTED[t]}`);
    return l;
  }

  // b & P, tried before a process: a condition followed by & is a guard.
  guarded(): Proc {
    const save = this.i;
    try {
      const c = this.cond();
      if (this.eat("&")) return { k: "guard", c, p: this.guarded() };
    } catch (e) {
      if (!(e instanceof PolicyError)) throw e;
    }
    this.i = save;
    return this.prefix();
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
    if (this.eat("[]")) {
      const v = this.lower("the variable of the replicated choice");
      this.expect(":", "':' in [] x : S @ P");
      const set = this.set();
      this.expect("@", "'@' in [] x : S @ P");
      return { k: "rep", v, set, p: this.proc() };
    }
    if (tok?.t === "id" && !isUpper(tok.v!) && !KEYWORDS.has(tok.v!)) {
      const line = tok.line;
      const chan = this.lower("a channel");
      const fields: Field[] = [];
      for (;;) {
        if (this.eat(".") || this.eat("!")) {
          if (fields.some((f) => f.k === "in")) fail(line, `${chan}: an output after the input isn't supported`);
          fields.push({ k: "out", v: this.atomE() });
        } else if (this.eat("?")) {
          if (fields.some((f) => f.k === "in")) fail(line, `${chan}: only one input (?v) is supported`);
          const name = this.lower("a variable after ?");
          fields.push({ k: "in", name, set: this.eat(":") ? this.set() : undefined });
        } else break;
      }
      this.expect("->", `'->' after the event ${chan}`);
      return { k: "pre", chan, fields, next: this.prefix(), line };
    }
    if (this.is("|~|")) fail(this.at(), `this policy can't use ${UNSUPPORTED["|~|"]}`);
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
      const vals: Expr[] = [this.expr()];
      this.expect(",");
      // Permit(x, P) or Permit(r, x, P): a second value means the first was the role.
      if (this.is("id") && !isUpper(this.peek()!.v!) && !this.is("\\")) {
        const save = this.i;
        const second = this.expr();
        if (this.eat(",")) vals.push(second);
        else this.i = save;
      }
      const [role, act] = vals.length === 2 ? vals : [null, vals[0]];
      const head = (): Field[] => [...(role ? [{ k: "out", v: role } as Field] : []), { k: "out", v: act }];
      let out: Proc;
      if (permit) {
        const fn = this.fn();
        out = {
          k: "pre", chan: "attempt", fields: head(), line, next: {
            k: "pre", chan: "allow", fields: head(), line, next: {
              k: "pre", chan: "result", fields: [...head(), { k: "in", name: "v'", set: { k: "returns", arg: act } }], line,
              next: { k: "apply", fn, arg: { k: "name", name: "v'" }, line },
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
    if (this.upperNext()) {
      this.i++;
      const args: Expr[] = [];
      if (this.eat("(")) {
        do args.push(this.expr()); while (this.eat(","));
        this.expect(")");
      }
      return { k: "call", name: tok!.v!, args, line };
    }
    if (this.is("\\")) fail(line, "a lambda (\\ v @ P) goes only in Permit's continuation");
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
    if (this.upperNext()) {
      const tok = this.toks[this.i++];
      return { k: "name", name: tok.v!, line: tok.line };
    }
    return fail(this.at(), `expected Permit's continuation (\\ v @ P, or a process name), found ${show(this.peek())}`);
  }
}

const IGNORED = new Set(["assert", "channel", "transparent", "external", "print"]);

// Agent and System as complier admits them, token by token.
const words = (toks: Tok[]) => toks.map((t) => t.v ?? t.t);
const PLAIN_AGENT = "ControllableCHAOS";
const ROLE_AGENT = "||| r : Role @ ControllableCHAOS(r)";
const SYSTEM = "prioritise(Agent [| {|attempt, allow, deny, result, refuse|} |] ComplierGuard(Policy), <{|attempt|}, {refuse}>)";
const SYSTEMS = [
  SYSTEM,
  SYSTEM.replace("{refuse}>", "{|refuse|}>"),
  "prioritise(ComplierGuard(Policy) [| {|attempt, allow, deny, result, refuse|} |] Agent, <{|attempt|}, {refuse}>)",
  "prioritise(ComplierGuard(Policy) [| {|attempt, allow, deny, result, refuse|} |] Agent, <{|attempt|}, {|refuse|}>)",
].map((x) => words(lex(x)).join(" "));
const sameAs = (body: Tok[], src: string) => words(body).join(" ") === words(lex(src)).join(" ");

// A constant expression in a datatype or Returns: evaluated with no variables bound.
const constSet = (types: Map<string, string[]>, cons: Map<string, string>, s: SetE): string[] =>
  setOf({ types, cons, returns: [], defs: new Map(), roles: null }, s, {});

export function parsePolicy(src: string): Policy {
  const toks = lex(src);
  const items: Tok[][] = [];
  for (const tok of toks) {
    if (tok.col === 0 || !items.length) items.push([]);
    items[items.length - 1].push(tok);
  }
  const types = new Map<string, string[]>();
  const cons = new Map<string, string>();
  const returns: Policy["returns"] = [];
  const defs = new Map<string, Clause[]>();
  let agent: { body: Tok[]; line: number } | null = null;
  let system: { body: Tok[]; line: number } | null = null;

  for (const item of items) {
    const first = item[0];
    const line = first.line;
    if (first.t === "id" && IGNORED.has(first.v!)) continue;
    if (first.t === "id" && (first.v === "Agent" || first.v === "System")) {
      if (item[1]?.t !== "=") fail(line, `${first.v} takes no parameters: ${first.v} = ...`);
      const def = { body: item.slice(2), line };
      if (first.v === "Agent") {
        if (agent) fail(line, "Agent is defined twice");
        agent = def;
      } else {
        if (system) fail(line, "System is defined twice");
        system = def;
      }
      continue;
    }
    const p = new Parser(item, line);
    if (first.t === "id" && first.v === "datatype") {
      p.i++;
      const tok = p.peek();
      if (tok?.t !== "id" || !isUpper(tok.v!)) fail(line, `expected the datatype's name, found ${show(tok)}`);
      p.i++;
      const name = tok!.v!;
      if (types.has(name)) fail(line, `datatype ${name} is declared twice`);
      p.expect("=");
      const values: string[] = [];
      do {
        const c = p.lower(`a constructor of ${name}`);
        if (cons.has(c)) fail(line, `${c} is a constructor of both ${cons.get(c)} and ${name}`);
        cons.set(c, name);
        if (p.eat(".")) {
          const field = p.set();
          for (const v of constSet(types, cons, field)) values.push(`${c}.${v}`);
        } else values.push(c);
      } while (p.eat("|"));
      p.done();
      types.set(name, values);
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
        fail(line, `'${first.v}' isn't supported here: give the policy in one file`);
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
    p.expect("=", `'=' in the definition of ${name}`);
    const body = p.proc();
    p.done();
    const clauses = defs.get(name) ?? [];
    clauses.push({ pats, line, body });
    defs.set(name, clauses);
  }

  // Lowercase names in patterns are constructors when a datatype declares them.
  const fixPat = (x: Pat): Pat =>
    x.k === "var" && cons.has(x.name) ? { k: "con", name: x.name } : x.k === "con" && x.field ? { ...x, field: fixPat(x.field) } : x;
  const fixLambdas = (p: Proc): void => {
    switch (p.k) {
      case "pre":
        return fixLambdas(p.next);
      case "ext":
        return (fixLambdas(p.l), fixLambdas(p.r));
      case "guard":
      case "rep":
        return fixLambdas(p.p);
      case "if":
        return (fixLambdas(p.then), fixLambdas(p.else));
      case "apply":
        if (p.fn.k === "lambda") {
          p.fn.pat = fixPat(p.fn.pat);
          fixLambdas(p.fn.body);
        }
        return;
    }
  };
  for (const clauses of defs.values())
    for (const c of clauses) {
      c.pats = c.pats.map(fixPat);
      fixLambdas(c.body);
    }
  for (const r of returns) r.pat = fixPat(r.pat);
  for (const [name, clauses] of defs) {
    const arity = clauses[0].pats.length;
    for (const c of clauses) if (c.pats.length !== arity) fail(c.line, `${name} is defined with ${arity} and ${c.pats.length} parameters`);
  }

  if (!types.has("Act")) fail(1, "declare the actions: datatype Act = ...");
  if (!types.has("Value")) fail(1, "declare what calls return: datatype Value = ...");
  if (!defs.has("Policy")) fail(1, "define Policy, the process complier enforces");
  const roles = types.get("Role") ?? null;
  const want = roles ? ROLE_AGENT : PLAIN_AGENT;
  if (!agent) fail(1, `define the agent explicitly: Agent = ${want}`);
  const a = agent!;
  const w = words(a.body);
  const roleAgent = w.length === 9 && /^[a-z]/.test(w[1]) && w[7] === w[1] && sameAs([...a.body.slice(0, 1), ...a.body.slice(2, 7), ...a.body.slice(8)], "||| : Role @ ControllableCHAOS( )");
  if (roles ? !roleAgent : !sameAs(a.body, PLAIN_AGENT))
    fail(a.line, `Agent must be ${want}${roles ? ", one ControllableCHAOS per role" : ", the most general agent"}: complier proves the policy against it`);
  if (!system) fail(1, `define the system explicitly: System = ${SYSTEM}`);
  const sys = system!;
  if (!SYSTEMS.includes(words(sys.body).join(" ")))
    fail(sys.line, `System must be ${SYSTEM}: complier admits only the agent against the guarded policy`);
  return { types, cons, returns, defs, roles };
}

export function loadPolicy(src: string): { ok: true; policy: Policy } | { ok: false; error: { line: number; message: string } } {
  try {
    return { ok: true, policy: parsePolicy(src) };
  } catch (e) {
    if (!(e instanceof PolicyError)) throw e;
    const m = /^line (\d+): ([\s\S]*)$/.exec(e.message);
    return { ok: false, error: { line: m ? Number(m[1]) : 1, message: m ? m[2] : e.message } };
  }
}

export const start = (): PState => ({ p: { k: "call", name: "Policy", args: [], line: 1 }, env: {} });

type Pre = Extract<Proc, { k: "pre" }>;
type Head = { pre: Pre; env: Record<string, string> } | { done: true };
type Env = Record<string, string>;

const DEPTH = 400;

const int = (s: string, what: string) => {
  if (!/^-?[0-9]+$/.test(s)) throw new PolicyError(`${what}: ${s} isn't a number`);
  return Number(s);
};

function value(policy: Policy, e: Expr, env: Env): string {
  switch (e.k) {
    case "num":
      return String(e.v);
    case "name":
      if (e.name in env) return env[e.name];
      if (policy.cons.has(e.name) || policy.defs.has(e.name)) return e.name;
      throw new PolicyError(`${e.name} is neither a value of a datatype nor bound here`);
    case "dot":
      return `${value(policy, e.a, env)}.${value(policy, e.b, env)}`;
    case "arith": {
      const a = int(value(policy, e.a, env), e.op);
      const b = int(value(policy, e.b, env), e.op);
      return String(e.op === "+" ? a + b : a - b);
    }
    default:
      return String(cond(policy, e, env));
  }
}

function cond(policy: Policy, c: Expr, env: Env): boolean {
  switch (c.k) {
    case "bool":
      return c.v;
    case "not":
      return !cond(policy, c.e, env);
    case "logic":
      return c.op === "and" ? cond(policy, c.a, env) && cond(policy, c.b, env) : cond(policy, c.a, env) || cond(policy, c.b, env);
    case "member":
      return setOf(policy, c.set, env).includes(value(policy, c.v, env));
    case "cmp": {
      const a = value(policy, c.a, env);
      const b = value(policy, c.b, env);
      if (c.op === "==") return a === b;
      if (c.op === "!=") return a !== b;
      const x = int(a, c.op);
      const y = int(b, c.op);
      return c.op === "<" ? x < y : c.op === "<=" ? x <= y : c.op === ">" ? x > y : x >= y;
    }
    default:
      throw new PolicyError(`${value(policy, c, env)} isn't a condition`);
  }
}

function setOf(policy: Policy, s: SetE, env: Env): string[] {
  switch (s.k) {
    case "lit":
      return s.items.map((v) => value(policy, v, env));
    case "range": {
      const from = int(value(policy, s.from, env), "..");
      const to = int(value(policy, s.to, env), "..");
      return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => String(from + i));
    }
    case "prod": {
      const out: string[] = [];
      for (const c of s.cons) {
        const t = policy.cons.get(c);
        if (!t) throw new PolicyError(`${c} isn't a constructor of a datatype`);
        out.push(...policy.types.get(t)!.filter((v) => v === c || v.startsWith(`${c}.`)));
      }
      return out;
    }
    case "type": {
      const t = policy.types.get(s.name);
      if (!t) throw new PolicyError(`${s.name} isn't a datatype`);
      return t;
    }
    case "returns":
      return returns(policy, value(policy, s.arg, env));
  }
}

function match(policy: Policy, pats: Pat[], args: string[]): Env | null {
  const env: Env = {};
  const one = (p: Pat, a: string): boolean => {
    switch (p.k) {
      case "any":
        return true;
      case "var":
        env[p.name] = a;
        return true;
      case "lit":
        return p.v === a;
      case "con":
        if (!p.field) return p.name === a;
        return a.startsWith(`${p.name}.`) && one(p.field, a.slice(p.name.length + 1));
    }
  };
  for (let i = 0; i < pats.length; i++) if (!one(pats[i], args[i])) return null;
  return env;
}

export function returns(policy: Policy, act: string): string[] {
  for (const r of policy.returns) {
    const env = match(policy, [r.pat], [act]);
    if (env) return setOf(policy, r.set, env);
  }
  throw new PolicyError(`Returns(${act}) isn't defined`);
}

// The prefixes a state offers next: named processes, ifs, guards, replicated choices and Permit's
// continuations are unfolded, and both sides of [] are offered. SKIP means the policy has finished.
function heads(policy: Policy, s: PState, depth = 0): Head[] {
  if (depth > DEPTH) throw new PolicyError("the policy unfolds without offering an event");
  const { p, env } = s;
  switch (p.k) {
    case "stop":
      return [];
    case "skip":
      return [{ done: true }];
    case "pre":
      return [{ pre: p, env }];
    case "ext":
      return [...heads(policy, { p: p.l, env }, depth + 1), ...heads(policy, { p: p.r, env }, depth + 1)];
    case "guard":
      return cond(policy, p.c, env) ? heads(policy, { p: p.p, env }, depth + 1) : [];
    case "rep":
      return setOf(policy, p.set, env).flatMap((x) => heads(policy, { p: p.p, env: { ...env, [p.v]: x } }, depth + 1));
    case "if":
      return heads(policy, { p: cond(policy, p.c, env) ? p.then : p.else, env }, depth + 1);
    case "apply": {
      const arg = value(policy, p.arg, env);
      if (p.fn.k === "lambda") {
        const bound = match(policy, [p.fn.pat], [arg]);
        if (!bound) throw new PolicyError(`the continuation's pattern doesn't match ${arg}`);
        return heads(policy, { p: p.fn.body, env: { ...env, ...bound } }, depth + 1);
      }
      return heads(policy, { p: { k: "call", name: p.fn.name, args: [{ k: "name", name: "v'" }], line: p.fn.line }, env: { ...env, "v'": arg } }, depth + 1);
    }
    case "call": {
      // A process parameter stands for the process passed in.
      const name = !p.args.length && p.name in env ? env[p.name] : p.name;
      const args = p.args.map((a) => value(policy, a, env));
      const clauses = policy.defs.get(name);
      if (!clauses) throw new PolicyError(`${name} is used but never defined`);
      for (const clause of clauses) {
        const bound = match(policy, clause.pats, args);
        if (bound) return heads(policy, { p: clause.body, env: bound }, depth + 1);
      }
      throw new PolicyError(`no definition of ${name} matches ${name}(${args.join(", ")})`);
    }
  }
}

// The event's output fields, as FDR prints them: agent_a.next, accept.15.
const outs = (policy: Policy, h: { pre: Pre; env: Env }) =>
  h.pre.fields
    .filter((f): f is Extract<Field, { k: "out" }> => f.k === "out")
    .map((f) => value(policy, f.v, h.env))
    .join(".");

const key = (role: string | null, act: string) => (role ? `${role}.${act}` : act);

type Live = Exclude<Head, { done: true }>;
const live = (h: Head): h is Live => !("done" in h);

export type Attempt =
  | { k: "allowed"; state: PState }
  | { k: "denied"; state: PState; reason: string }
  | { k: "refused"; reason: string };

// The agent attempts `act` as `role` (null without roles).
export function attempt(policy: Policy, s: PState, role: string | null, act: string): Attempt {
  if (policy.roles && (!role || !policy.roles.includes(role))) return { k: "refused", reason: `${role} isn't a role of the spec (its Role lists ${policy.roles.join(", ")})` };
  if (!policy.types.get("Act")!.includes(act)) return { k: "refused", reason: `${act} isn't an action of the spec (its Act doesn't list it)` };
  const hs = heads(policy, s);
  if (hs.some((h) => "done" in h)) return { k: "refused", reason: "the policy has finished" };
  const waiting = hs.filter(live).find((h) => h.pre.chan === "result");
  if (waiting) return { k: "refused", reason: `the result of ${outs(policy, waiting)} hasn't come back yet` };
  const want = key(policy.roles ? role : null, act);
  const taken = hs.filter(live).find((h) => h.pre.chan === "attempt" && outs(policy, h) === want);
  if (!taken) return { k: "refused", reason: policy.roles ? `the policy doesn't take ${act} from ${role} now` : `the policy doesn't take ${act} now` };
  const answer = heads(policy, { p: taken.pre.next, env: taken.env })
    .filter(live)
    .find((h) => (h.pre.chan === "allow" || h.pre.chan === "deny") && outs(policy, h) === want);
  if (!answer) throw new PolicyError(`attempt.${want} has no allow or deny`);
  const next = { p: answer.pre.next, env: answer.env };
  return answer.pre.chan === "allow" ? { k: "allowed", state: next } : { k: "denied", state: next, reason: `the policy denied ${act}` };
}

// The allowed call's result came back as `v`: the policy follows result.<role>.<act>.v.
export function result(policy: Policy, s: PState, role: string | null, act: string, v: string): PState {
  const want = key(policy.roles ? role : null, act);
  for (const h of heads(policy, s).filter(live)) {
    if (h.pre.chan !== "result" || outs(policy, h) !== want) continue;
    const input = h.pre.fields.find((f) => f.k === "in");
    if (!input || input.k !== "in") continue;
    const allowed = input.set ? setOf(policy, input.set, h.env) : policy.types.get("Value")!;
    if (!allowed.includes(v)) throw new PolicyError(`${act} returned ${v}, which the policy doesn't accept: the unit and the spec's Returns(${act}) disagree`);
    return { p: h.pre.next, env: { ...h.env, [input.name]: v } };
  }
  throw new PolicyError(`the policy isn't waiting for ${act}'s result`);
}

// The actions a role could take now.
export function offered(policy: Policy, s: PState, role: string | null): string[] {
  const out: string[] = [];
  for (const h of heads(policy, s).filter(live)) {
    if (h.pre.chan !== "attempt") continue;
    const ev = outs(policy, h);
    if (!policy.roles) out.push(ev);
    else if (ev.startsWith(`${role}.`)) out.push(ev.slice(role!.length + 1));
  }
  return out;
}
