// Abstract syntax of the CSP fragment the stepper runs.

export type Value = number | boolean;

export type Expr =
  | { k: "val"; v: Value }
  | { k: "var"; name: string }
  | { k: "not"; e: Expr }
  | { k: "neg"; e: Expr }
  | { k: "and"; a: Expr; b: Expr }
  | { k: "or"; a: Expr; b: Expr }
  | { k: "bin"; op: BinOp; a: Expr; b: Expr };

export type BinOp = "+" | "-" | "*" | "==" | "!=" | "<" | "<=" | ">" | ">=";

// c?x binds x to the value received; c!e and c.e send ⟦e⟧.
export type Field = { k: "in"; name: string } | { k: "out"; e: Expr };

export type Proc =
  | { k: "stop" }
  | { k: "skip" }
  | { k: "omega" }
  | { k: "pre"; chan: string; fields: Field[]; next: Proc }
  | { k: "ext"; l: Proc; r: Proc }
  | { k: "int"; l: Proc; r: Proc }
  | { k: "guard"; b: Expr; p: Proc }
  | { k: "seq"; l: Proc; r: Proc }
  | { k: "par"; sync: string[]; l: Proc; r: Proc }
  | { k: "call"; name: string; args: Expr[] };

export type Type = { k: "range"; lo: number; hi: number } | { k: "bool" };

export type Def = { name: string; params: { name: string; type: Type }[]; body: Proc; line: number };

export type Spec = { defs: Map<string, Def>; chans: Map<string, Type[]> };

export type Label = { k: "tau" } | { k: "tick" } | { k: "ev"; chan: string; values: Value[] };

// One application of a rule: the conclusion from --label--> to, the
// transitions it rests on, and the side conditions it checked.
export type Derivation = {
  rule: string;
  from: Proc;
  label: Label;
  to: Proc;
  premises: Derivation[];
  side: string[];
};
