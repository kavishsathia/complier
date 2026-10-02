import { Chc, Clause, Facts } from "./chc";

// Infer equalities between state variables of different processes that hold
// in every reachable state, Houdini style: start from every candidate
// equality, and repeatedly drop the ones some clause can break (assuming the
// survivors hold before the step) until nothing changes. What survives is an
// inductive invariant, so it can be assumed in clause bodies without
// changing what the clauses mean. Typical find: an agent's own count of the
// stock equals the real stock on the shelf.

type Run = (script: string) => Promise<string>;

interface Candidate {
  i: number;
  j: number;
}

const owner = (arg: string) => arg.match(/^[sn](\d+)_/)?.[1];

function candidates(args: string[]): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < args.length; i++) {
    for (let j = i + 1; j < args.length; j++) {
      // only across processes: one process copying another's state
      const a = owner(args[i]);
      const b = owner(args[j]);
      if (a !== undefined && b !== undefined && a !== b) out.push({ i, j });
    }
  }
  return out;
}

const render = (c: Candidate) => `(= a${c.i} a${c.j})`;
const on = (c: Candidate, args: string[]) => `(= ${args[c.i]} ${args[c.j]})`;

function parseValues(out: string): Map<string, number> {
  const values = new Map<string, number>();
  for (const m of out.matchAll(/\((\w+) (\(- \d+\)|-?\d+)\)/g)) {
    values.set(m[1], m[2].startsWith("(") ? -Number(m[2].slice(3, -1)) : Number(m[2]));
  }
  return values;
}

// Returns the surviving equalities per predicate, or an empty map if the
// fixpoint was not reached within the budget (nothing unproven is returned).
export async function inferEqualities(chc: Chc, run: Run, budgetMs: number): Promise<Facts> {
  const started = Date.now();
  // Head args of the first clause naming a predicate tell us which process
  // each position belongs to; every clause uses the same layout.
  const layout = new Map<string, string[]>();
  for (const c of chc.clauses) {
    if (c.body && !layout.has(c.body.pred)) layout.set(c.body.pred, c.body.args);
  }
  const cands = new Map<string, Candidate[]>();
  for (const [pred, args] of layout) cands.set(pred, candidates(args));

  const check = async (c: Clause): Promise<boolean> => {
    // true if this pass removed something
    const head = c.head!;
    const live = cands.get(head.pred) ?? [];
    if (!live.length) return false;
    const hs = head.args.map((_, k) => `h${k}`);
    const lines = [
      "(set-logic QF_LIA)",
      ...c.vars.map((v) => `(declare-const ${v} Int)`),
      ...hs.map((h) => `(declare-const ${h} Int)`),
      ...head.args.map((a, k) => `(assert (= ${hs[k]} ${a}))`),
      ...c.constraints.map((x) => `(assert ${x})`),
      ...(c.body ? (cands.get(c.body.pred) ?? []).map((x) => `(assert ${on(x, c.body!.args)})`) : []),
      `(assert (not (and true ${live.map((x) => on(x, hs)).join(" ")})))`,
      "(check-sat)",
      `(get-value (${hs.join(" ")}))`,
    ];
    const out = await run(lines.join("\n"));
    const verdict = out.trim().split("\n")[0].trim();
    if (verdict === "unsat") return false;
    if (verdict !== "sat") {
      cands.set(head.pred, []);
      return true;
    }
    const v = parseValues(out);
    const keep = live.filter((x) => v.get(`h${x.i}`) === v.get(`h${x.j}`));
    cands.set(head.pred, keep.length === live.length ? [] : keep);
    return true;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const c of chc.clauses) {
      if (!c.head) continue;
      while (await check(c)) {
        changed = true;
        if (Date.now() - started > budgetMs) return new Map();
      }
    }
  }
  const facts: Facts = new Map();
  for (const [pred, list] of cands) if (list.length) facts.set(pred, list.map(render));
  return facts;
}
