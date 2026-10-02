// The CSP fragment the playground accepts. Everything is a plain value tree so
// the same AST can be shipped between the browser and the prove route.

export type Expr =
  | { kind: "int"; value: number }
  | { kind: "name"; name: string }
  | { kind: "unary"; op: "-" | "not"; arg: Expr }
  | { kind: "binary"; op: BinOp; left: Expr; right: Expr }
  | { kind: "if"; cond: Expr; then: Expr; else: Expr };

export type BinOp =
  | "+" | "-" | "*"
  | "==" | "!=" | "<" | "<=" | ">" | ">="
  | "and" | "or";

// One field of an event prefix: `!e`, `.e`, `?x` or `?x:{lo..hi}`.
export type Field =
  | { kind: "out"; expr: Expr }
  | { kind: "in"; name: string; range?: { lo: Expr; hi: Expr } };

export interface Call {
  name: string;
  args: Expr[];
}

// `guard & chan fields -> Target(args)`; target is null for STOP.
export interface Branch {
  guard?: Expr;
  channel: string;
  fields: Field[];
  target: Call | null;
  line: number;
}

export interface ProcDef {
  name: string;
  params: string[];
  branches: Branch[]; // empty means STOP
  line: number;
}

export type SystemNode =
  | { kind: "leaf"; call: Call }
  | { kind: "interleave"; left: SystemNode; right: SystemNode }
  | { kind: "sync"; channels: string[]; left: SystemNode; right: SystemNode };

export interface Assertion {
  process: string;
  property: Expr;
  text: string;
  line: number;
}

export interface Program {
  datatypes: Map<string, string[]>; // type name to constructors
  constructors: Map<string, { type: string; index: number }>;
  channels: Map<string, string[]>; // channel to field types ("Int" or a datatype)
  procs: Map<string, ProcDef>;
  system: SystemNode;
  assertions: Assertion[];
}

export class CspError extends Error {
  constructor(message: string, public line: number) {
    super(message);
  }
}
