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

// c?x binds x to the value received, and c?x:{lo..hi} only receives values
// in that range (CSPM's restricted input); c!e and c.e send ⟦e⟧.
export type Field = { k: "in"; name: string; range?: [Expr, Expr] } | { k: "out"; e: Expr };

export type Proc =
  | { k: "stop" }
  | { k: "skip" }
  | { k: "omega" }
  | { k: "pre"; mark?: Mark; chan: string; fields: Field[]; next: Proc }
  | { k: "ext"; l: Proc; r: Proc }
  | { k: "int"; l: Proc; r: Proc }
  | { k: "guard"; b: Expr; p: Proc }
  | { k: "seq"; l: Proc; r: Proc }
  | { k: "par"; sync: string[]; l: Proc; r: Proc }
  | { k: "call"; name: string; args: Expr[] }
  // A running role component: the process an agent joined, so events can be
  // attributed to the role that performs them.
  | { k: "role"; name: string; p: Proc };

export type Type = { k: "range"; lo: number; hi: number } | { k: "bool" };

// A definition marked role is a component an agent joins.
export type Def = { name: string; params: { name: string; type: Type }[]; body: Proc; line: number; role: boolean };

// Who submits a channel's events: the world (~c, uncontrollable), an agent
// (^c, controllable), or nobody (internal: they happen on their own).
export type Mark = "world" | "agent" | "internal";

export type Spec = { defs: Map<string, Def>; chans: Map<string, Type[]>; marks: Map<string, Mark> };

export type Event = { k: "ev"; chan: string; values: Value[] };

// τ, ✓ and events are process labels; ↓a (dropped) and ×a (refused) are the
// system's.
export type Label = { k: "tau" } | { k: "tick" } | Event | { k: "drop"; ev: Event } | { k: "refuse"; ev: Event };

// One application of a rule: the conclusion from --label--> to, the
// transitions it rests on, and the side conditions it checked.
export type Derivation = {
  rule: string;
  // Set when the transition is performed by a role's component.
  role?: string;
  from: Proc;
  label: Label;
  to: Proc;
  premises: Derivation[];
  side: string[];
};
