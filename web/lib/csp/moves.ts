import { Branch, CspError, Expr, Program, SystemNode } from "./ast";
import { systemLeaves } from "./check";

// Symbolic transitions of the composed system. A move is one event the whole
// system can perform: the leaves that take part, each with the location it
// must be in and the branch it takes. Interleaving keeps moves separate;
// synchronisation pairs up moves on shared channels.

export interface Part {
  leaf: number;
  loc: string;
  branch: Branch;
}

export interface Move {
  channel: string;
  parts: Part[];
}

export interface Leaf {
  label: string; // the call as written in System, used to name things in output
  locations: string[]; // reachable process names, STOP included if reachable
  initial: { loc: string; args: Expr[] };
}

export const STOP = "STOP";
const MAX_COMBOS = 512;

function exprText(e: Expr): string {
  switch (e.kind) {
    case "int": return String(e.value);
    case "name": return e.name;
    case "unary": return e.op === "-" ? `-${exprText(e.arg)}` : `not ${exprText(e.arg)}`;
    case "binary": return `${exprText(e.left)} ${e.op} ${exprText(e.right)}`;
  }
}

export function buildLeaves(prog: Program): Leaf[] {
  const calls = systemLeaves(prog.system);
  return calls.map((call) => {
    const seen = new Set<string>([call.name]);
    const queue = [call.name];
    while (queue.length) {
      const name = queue.shift()!;
      if (name === STOP) continue;
      for (const b of prog.procs.get(name)!.branches) {
        const next = b.target ? b.target.name : STOP;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    // name a leaf by its process alone unless another leaf starts as the same process
    const unique = calls.filter((c) => c.name === call.name).length === 1;
    const label = unique || !call.args.length ? call.name : `${call.name}(${call.args.map(exprText).join(", ")})`;
    return { label, locations: [...seen], initial: { loc: call.name, args: call.args } };
  });
}

export function params(prog: Program, loc: string): string[] {
  return loc === STOP ? [] : prog.procs.get(loc)!.params;
}

export function buildMoves(prog: Program, leaves: Leaf[]): Move[] {
  let next = 0;
  const walk = (node: SystemNode): Move[] => {
    if (node.kind === "leaf") {
      const leaf = next++;
      return leaves[leaf].locations.flatMap((loc) =>
        loc === STOP
          ? []
          : prog.procs.get(loc)!.branches.map((branch) => ({
            channel: branch.channel,
            parts: [{ leaf, loc, branch }],
          })),
      );
    }
    const lefts = walk(node.left);
    const rights = walk(node.right);
    if (node.kind === "interleave") return [...lefts, ...rights];
    const shared = new Set(node.channels);
    const out = [...lefts, ...rights].filter((m) => !shared.has(m.channel));
    for (const l of lefts) {
      if (!shared.has(l.channel)) continue;
      for (const r of rights) {
        if (r.channel === l.channel) out.push({ channel: l.channel, parts: [...l.parts, ...r.parts] });
      }
    }
    return out;
  };
  return walk(prog.system);
}

// Every combination of leaf locations, i.e. every control state of the product.
export function buildCombos(leaves: Leaf[]): string[][] {
  let combos: string[][] = [[]];
  for (const leaf of leaves) {
    combos = combos.flatMap((c) => leaf.locations.map((loc) => [...c, loc]));
    if (combos.length > MAX_COMBOS) {
      throw new CspError(
        `the system has more than ${MAX_COMBOS} control states, which is beyond what the playground proves`, 0,
      );
    }
  }
  return combos;
}
