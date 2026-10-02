import { CspError, Expr, Program, SystemNode } from "./ast";
import { paramTypes } from "./check";

// Concrete operational semantics of the fragment. The monitor tracks the set
// of states the system could be in (a singleton unless two branches accept the
// same event) and steps it one event at a time. An event is allowed exactly
// when some state has a transition on it.

export type StateTree =
  | { kind: "leaf"; proc: string; args: number[] }
  | { kind: "interleave"; left: StateTree; right: StateTree }
  | { kind: "sync"; channels: string[]; left: StateTree; right: StateTree };

export interface Event {
  channel: string;
  values: number[];
}

// One field of an offered event: every value in [lo, hi], null meaning unbounded.
export interface Dom {
  lo: number | null;
  hi: number | null;
}

export interface Pattern {
  channel: string;
  fields: Dom[];
}

const STOP = "STOP";

export function evalExpr(prog: Program, e: Expr, env: Map<string, number>): number {
  switch (e.kind) {
    case "int":
      return e.value;
    case "name": {
      if (env.has(e.name)) return env.get(e.name)!;
      const c = prog.constructors.get(e.name);
      if (c) return c.index;
      throw new CspError(`'${e.name}' has no value here`, 0);
    }
    case "if":
      return evalExpr(prog, e.cond, env) ? evalExpr(prog, e.then, env) : evalExpr(prog, e.else, env);
    case "unary": {
      const v = evalExpr(prog, e.arg, env);
      return e.op === "-" ? -v : v ? 0 : 1;
    }
    case "binary": {
      const l = evalExpr(prog, e.left, env);
      if (e.op === "and" && !l) return 0;
      if (e.op === "or" && l) return 1;
      const r = evalExpr(prog, e.right, env);
      switch (e.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "==": return +(l === r);
        case "!=": return +(l !== r);
        case "<": return +(l < r);
        case "<=": return +(l <= r);
        case ">": return +(l > r);
        case ">=": return +(l >= r);
        case "and":
        case "or": return r ? 1 : 0;
      }
    }
  }
}

function build(prog: Program, node: SystemNode): StateTree {
  if (node.kind === "leaf") {
    return {
      kind: "leaf",
      proc: node.call.name,
      args: node.call.args.map((a) => evalExpr(prog, a, new Map())),
    };
  }
  const left = build(prog, node.left);
  const right = build(prog, node.right);
  return node.kind === "sync"
    ? { kind: "sync", channels: node.channels, left, right }
    : { kind: "interleave", left, right };
}

function fieldRange(prog: Program, type: string): Dom {
  const ctors = prog.datatypes.get(type);
  return ctors ? { lo: 0, hi: ctors.length - 1 } : { lo: null, hi: null };
}

function stepLeaf(prog: Program, leaf: { proc: string; args: number[] }, ev: Event): StateTree[] {
  if (leaf.proc === STOP) return [];
  const def = prog.procs.get(leaf.proc)!;
  const out: StateTree[] = [];
  for (const b of def.branches) {
    if (b.channel !== ev.channel) continue;
    const env = new Map(def.params.map((p, i) => [p, leaf.args[i]]));
    if (b.guard && !evalExpr(prog, b.guard, env)) continue;
    const types = prog.channels.get(b.channel)!;
    const ok = b.fields.every((f, i) => {
      const v = ev.values[i];
      if (f.kind === "out") return evalExpr(prog, f.expr, env) === v;
      const dom = fieldRange(prog, types[i]);
      if (dom.lo !== null && (v < dom.lo || v > dom.hi!)) return false;
      if (f.range) {
        if (v < evalExpr(prog, f.range.lo, env) || v > evalExpr(prog, f.range.hi, env)) return false;
      }
      env.set(f.name, v);
      return true;
    });
    if (!ok) continue;
    out.push(
      b.target
        ? { kind: "leaf", proc: b.target.name, args: b.target.args.map((a) => evalExpr(prog, a, env)) }
        : { kind: "leaf", proc: STOP, args: [] },
    );
  }
  return out;
}

function step(prog: Program, t: StateTree, ev: Event): StateTree[] {
  if (t.kind === "leaf") return stepLeaf(prog, t, ev);
  const lefts = step(prog, t.left, ev);
  const rights = step(prog, t.right, ev);
  if (t.kind === "sync" && t.channels.includes(ev.channel)) {
    return lefts.flatMap((left) => rights.map((right) => ({ ...t, left, right })));
  }
  return [
    ...lefts.map((left) => ({ ...t, left })),
    ...rights.map((right) => ({ ...t, right })),
  ];
}

function intersect(a: Dom, b: Dom): Dom | null {
  const lo = a.lo === null ? b.lo : b.lo === null ? a.lo : Math.max(a.lo, b.lo);
  const hi = a.hi === null ? b.hi : b.hi === null ? a.hi : Math.min(a.hi, b.hi);
  return lo !== null && hi !== null && lo > hi ? null : { lo, hi };
}

function offersLeaf(prog: Program, leaf: { proc: string; args: number[] }): Pattern[] {
  if (leaf.proc === STOP) return [];
  const def = prog.procs.get(leaf.proc)!;
  const out: Pattern[] = [];
  for (const b of def.branches) {
    const env = new Map(def.params.map((p, i) => [p, leaf.args[i]]));
    if (b.guard && !evalExpr(prog, b.guard, env)) continue;
    const types = prog.channels.get(b.channel)!;
    const fields: (Dom | null)[] = b.fields.map((f, i) => {
      if (f.kind === "out") {
        try {
          const v = evalExpr(prog, f.expr, env);
          return { lo: v, hi: v };
        } catch {
          return fieldRange(prog, types[i]); // depends on an earlier input
        }
      }
      let dom: Dom | null = fieldRange(prog, types[i]);
      if (f.range) {
        try {
          dom = intersect(dom, {
            lo: evalExpr(prog, f.range.lo, env),
            hi: evalExpr(prog, f.range.hi, env),
          });
        } catch {
          // the bound mentions an earlier input; show the field as unbounded
        }
      }
      return dom;
    });
    if (fields.every((f) => f !== null)) out.push({ channel: b.channel, fields: fields as Dom[] });
  }
  return out;
}

function offers(prog: Program, t: StateTree): Pattern[] {
  if (t.kind === "leaf") return offersLeaf(prog, t);
  const lefts = offers(prog, t.left);
  const rights = offers(prog, t.right);
  if (t.kind === "interleave") return [...lefts, ...rights];
  const out: Pattern[] = [];
  for (const p of [...lefts, ...rights]) {
    if (!t.channels.includes(p.channel)) out.push(p);
  }
  for (const l of lefts) {
    if (!t.channels.includes(l.channel)) continue;
    for (const r of rights) {
      if (r.channel !== l.channel) continue;
      const fields = l.fields.map((f, i) => intersect(f, r.fields[i]));
      if (fields.every((f) => f !== null)) out.push({ channel: l.channel, fields: fields as Dom[] });
    }
  }
  return out;
}

export function formatValue(prog: Program, v: number, type: string | undefined): string {
  const ctors = type ? prog.datatypes.get(type) : undefined;
  return ctors?.[v] ?? String(v);
}

export function formatEvent(prog: Program, ev: Event): string {
  const types = prog.channels.get(ev.channel) ?? [];
  return [ev.channel, ...ev.values.map((v, i) => formatValue(prog, v, types[i]))].join(".");
}

// Offered events as text, one line per pattern, with datatype fields spelled out.
export function formatPatterns(prog: Program, patterns: Pattern[]): string[] {
  const lines = new Set<string>();
  const expand = (channel: string, fields: Dom[], i: number, acc: string[]) => {
    if (i === fields.length) {
      lines.add([channel, ...acc].join("."));
      return;
    }
    const type = prog.channels.get(channel)![i];
    const { lo, hi } = fields[i];
    if (prog.datatypes.has(type)) {
      for (let v = lo!; v <= hi!; v++) expand(channel, fields, i + 1, [...acc, formatValue(prog, v, type)]);
      return;
    }
    const text =
      lo !== null && lo === hi ? String(lo)
      : lo === null && hi === null ? "{any}"
      : `{${lo ?? ""}..${hi ?? ""}}`;
    expand(channel, fields, i + 1, [...acc, text]);
  };
  for (const p of patterns) expand(p.channel, p.fields, 0, []);
  return [...lines];
}

export function parseEvent(prog: Program, text: string): Event {
  const parts = text.trim().split(".");
  const channel = parts[0];
  const types = prog.channels.get(channel);
  if (!types) throw new CspError(`there is no channel called '${channel}'`, 0);
  if (parts.length - 1 !== types.length) {
    throw new CspError(`${channel} carries ${types.length} field(s), e.g. ${channel}${types.map((t) => "." + (prog.datatypes.get(t)?.[0] ?? "10")).join("")}`, 0);
  }
  const values = parts.slice(1).map((p, i) => {
    const ctors = prog.datatypes.get(types[i]);
    if (ctors) {
      const idx = ctors.indexOf(p);
      if (idx < 0) throw new CspError(`'${p}' is not a ${types[i]} (one of ${ctors.join(", ")})`, 0);
      return idx;
    }
    if (!/^-?\d+$/.test(p)) throw new CspError(`'${p}' is not a whole number`, 0);
    return Number(p);
  });
  return { channel, values };
}

function leafList(t: StateTree): { proc: string; args: number[] }[] {
  return t.kind === "leaf" ? [t] : [...leafList(t.left), ...leafList(t.right)];
}

export class Monitor {
  states: StateTree[];
  private types: Map<string, (string | undefined)[]>;

  constructor(private prog: Program, states?: StateTree[]) {
    this.states = states ?? [build(prog, prog.system)];
    this.types = paramTypes(prog);
  }

  // Returns false (and leaves the state alone) when no state accepts the event.
  fire(ev: Event): boolean {
    const seen = new Map<string, StateTree>();
    for (const s of this.states) {
      for (const n of step(this.prog, s, ev)) seen.set(JSON.stringify(n), n);
    }
    if (seen.size === 0) return false;
    this.states = [...seen.values()];
    return true;
  }

  offered(): string[] {
    return formatPatterns(this.prog, this.states.flatMap((s) => offers(this.prog, s)));
  }

  describe(): string[][] {
    return this.states.map((s) =>
      leafList(s).map(({ proc, args }) => {
        if (proc === STOP) return STOP;
        const def = this.prog.procs.get(proc)!;
        const types = this.types.get(proc)!;
        const shown = def.params.map((p, i) => `${p}=${formatValue(this.prog, args[i], types[i])}`);
        return shown.length ? `${proc}(${shown.join(", ")})` : proc;
      }),
    );
  }
}
