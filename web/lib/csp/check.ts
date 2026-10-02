import { Call, CspError, Expr, Program, SystemNode } from "./ast";

// Static checks that keep a parsed program inside the fragment the monitor and
// the CHC compiler both understand: declared channels with matching arity,
// calls to defined processes, and every name bound by a parameter, an input
// or a datatype constructor.

function namesIn(e: Expr, out: Set<string> = new Set()): Set<string> {
  if (e.kind === "name") out.add(e.name);
  else if (e.kind === "unary") namesIn(e.arg, out);
  else if (e.kind === "binary") {
    namesIn(e.left, out);
    namesIn(e.right, out);
  } else if (e.kind === "if") {
    namesIn(e.cond, out);
    namesIn(e.then, out);
    namesIn(e.else, out);
  }
  return out;
}

function checkScope(prog: Program, e: Expr, scope: Set<string>, line: number) {
  for (const n of namesIn(e)) {
    if (!scope.has(n) && !prog.constructors.has(n)) {
      throw new CspError(`'${n}' is not a parameter, an input or a constructor here`, line);
    }
  }
}

function checkCall(prog: Program, call: Call, scope: Set<string>, line: number) {
  const def = prog.procs.get(call.name);
  if (!def) throw new CspError(`process ${call.name} is not defined`, line);
  if (def.params.length !== call.args.length) {
    throw new CspError(
      `${call.name} takes ${def.params.length} argument(s) but got ${call.args.length}`, line,
    );
  }
  for (const a of call.args) checkScope(prog, a, scope, line);
}

function leaves(node: SystemNode): Call[] {
  if (node.kind === "leaf") return [node.call];
  return [...leaves(node.left), ...leaves(node.right)];
}

function checkSystem(prog: Program, node: SystemNode) {
  if (node.kind === "sync") {
    for (const c of node.channels) {
      if (!prog.channels.has(c)) throw new CspError(`channel ${c} is not declared`, 0);
    }
  }
  if (node.kind !== "leaf") {
    checkSystem(prog, node.left);
    checkSystem(prog, node.right);
  }
}

export function check(prog: Program) {
  for (const def of prog.procs.values()) {
    for (const b of def.branches) {
      const types = prog.channels.get(b.channel);
      if (!types) throw new CspError(`channel ${b.channel} is not declared`, b.line);
      if (types.length !== b.fields.length) {
        throw new CspError(
          `${b.channel} carries ${types.length} field(s) but this event gives ${b.fields.length}`, b.line,
        );
      }
      const scope = new Set(def.params);
      if (b.guard) checkScope(prog, b.guard, scope, b.line);
      b.fields.forEach((f, i) => {
        const type = types[i];
        if (type !== "Int" && !prog.datatypes.has(type)) {
          throw new CspError(`type ${type} is not declared`, b.line);
        }
        if (f.kind === "out") {
          checkScope(prog, f.expr, scope, b.line);
        } else {
          if (f.range) {
            checkScope(prog, f.range.lo, scope, b.line);
            checkScope(prog, f.range.hi, scope, b.line);
          }
          scope.add(f.name);
        }
      });
      if (b.target) checkCall(prog, b.target, scope, b.line);
    }
  }
  checkSystem(prog, prog.system);
  for (const call of leaves(prog.system)) checkCall(prog, call, new Set(), 0);
  for (const a of prog.assertions) {
    const def = prog.procs.get(a.process);
    if (!def) throw new CspError(`process ${a.process} is not defined`, a.line);
    checkScope(prog, a.property, new Set(def.params), a.line);
  }
}

export function systemLeaves(node: SystemNode): Call[] {
  return leaves(node);
}

// Which datatype (if any) each process parameter holds, so values can be shown
// as Alice instead of 0. Found by propagating constructor arguments and typed
// inputs through calls until nothing changes.
export function paramTypes(prog: Program): Map<string, (string | undefined)[]> {
  const types = new Map<string, (string | undefined)[]>();
  for (const def of prog.procs.values()) types.set(def.name, def.params.map(() => undefined));

  const typeOf = (e: Expr, local: Map<string, string | undefined>): string | undefined => {
    if (e.kind !== "name") return undefined;
    if (local.has(e.name)) return local.get(e.name);
    return prog.constructors.get(e.name)?.type;
  };

  const assign = (call: Call, local: Map<string, string | undefined>): boolean => {
    let changed = false;
    const target = types.get(call.name)!;
    call.args.forEach((a, i) => {
      const t = typeOf(a, local);
      if (t && !target[i]) {
        target[i] = t;
        changed = true;
      }
    });
    return changed;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const call of leaves(prog.system)) changed = assign(call, new Map()) || changed;
    for (const def of prog.procs.values()) {
      for (const b of def.branches) {
        const local = new Map<string, string | undefined>();
        def.params.forEach((p, i) => local.set(p, types.get(def.name)![i]));
        const chanTypes = prog.channels.get(b.channel)!;
        b.fields.forEach((f, i) => {
          if (f.kind === "in") {
            local.set(f.name, prog.datatypes.has(chanTypes[i]) ? chanTypes[i] : undefined);
          }
        });
        if (b.target) changed = assign(b.target, local) || changed;
      }
    }
  }
  return types;
}
