// Turn the SMT-LIB terms Z3 prints for an invariant into infix arithmetic:
// inline `let`, rewrite `(+ a (* (- 1) b))` as `a - b`, and push `not` into
// comparisons so `(not (<= bal (- 1)))` reads as `bal >= 0`.

type S = string | S[];

function read(text: string): S {
  const tokens = text.replace(/\(/g, " ( ").replace(/\)/g, " ) ").trim().split(/\s+/);
  let i = 0;
  const walk = (): S => {
    const t = tokens[i++];
    if (t !== "(") return t;
    const list: S[] = [];
    while (tokens[i] !== ")") list.push(walk());
    i++;
    return list;
  };
  return walk();
}

function inline(s: S, env: Map<string, S>): S {
  if (typeof s === "string") return env.get(s) ?? s;
  if (s[0] === "let") {
    const next = new Map(env);
    for (const b of s[1] as S[][]) next.set(b[0] as string, inline(b[1], env));
    return inline(s[2], next);
  }
  return s.map((x) => inline(x, env));
}

const NEGATE: Record<string, string> = { "<=": ">", "<": ">=", ">=": "<", ">": "<=", "=": "!=" };

function num(s: S): number | null {
  if (typeof s === "string") return /^\d+$/.test(s) ? Number(s) : null;
  if (s[0] === "-" && s.length === 2) {
    const n = num(s[1]);
    return n === null ? null : -n;
  }
  return null;
}

// A linear term as signed summands, e.g. [[1, "x"], [-1, "held"], [3, ""]].
function summands(s: S): [number, string][] {
  const n = num(s);
  if (n !== null) return [[n, ""]];
  if (typeof s === "string") return [[1, s]];
  if (s[0] === "+") return s.slice(1).flatMap(summands);
  if (s[0] === "-" && s.length === 3) {
    return [...summands(s[1]), ...summands(s[2]).map(([c, v]) => [-c, v] as [number, string])];
  }
  if (s[0] === "*" && s.length === 3) {
    const c = num(s[1]);
    if (c !== null) return summands(s[2]).map(([k, v]) => [k * c, v]);
  }
  return [[1, raw(s)]];
}

function raw(s: S): string {
  return typeof s === "string" ? s : `(${s.map(raw).join(" ")})`;
}

function linear(terms: [number, string][]): string {
  const parts: string[] = [];
  for (const [c, v] of terms) {
    if (c === 0) continue;
    const mag = Math.abs(c);
    const body = v === "" ? String(mag) : mag === 1 ? v : `${mag}*${v}`;
    parts.push(parts.length === 0 ? (c < 0 ? `-${body}` : body) : `${c < 0 ? "-" : "+"} ${body}`);
  }
  return parts.length ? parts.join(" ") : "0";
}

// Integers only, so strict bounds tighten: `a < c` is `a <= c - 1`. Positive
// terms stay left, negative ones move right: `x - held <= 0` reads `x <= held`.
const FLIP: Record<string, string> = { "<=": ">=", ">=": "<=", "==": "==", "!=": "!=" };

function comparison(op: string, l: S, r: S): string {
  const terms = [...summands(l), ...summands(r).map(([c, v]) => [-c, v] as [number, string])];
  let k = -terms.filter(([, v]) => v === "").reduce((a, [c]) => a + c, 0);
  if (op === "<") { op = "<="; k -= 1; }
  if (op === ">") { op = ">="; k += 1; }
  const pos = terms.filter(([c, v]) => v !== "" && c > 0);
  const neg = terms.filter(([c, v]) => v !== "" && c < 0).map(([c, v]) => [-c, v] as [number, string]);
  const right = (vars: [number, string][], constant: number) =>
    linear([...vars, ...(constant !== 0 || !vars.length ? [[constant, ""] as [number, string]] : [])]);
  if (!pos.length) return `${linear(neg)} ${FLIP[op]} ${right([], -k)}`;
  return `${linear(pos)} ${op} ${right(neg, k)}`;
}

function infix(s: S): string {
  if (typeof s === "string") return s;
  const [op, ...args] = s;
  if (op === "not") {
    const inner = args[0];
    if (Array.isArray(inner) && typeof inner[0] === "string" && NEGATE[inner[0]]) {
      return comparison(NEGATE[inner[0]], inner[1], inner[2]);
    }
    return `not (${infix(inner)})`;
  }
  if (op === "and" || op === "or") {
    return args.map((a) => (Array.isArray(a) && (a[0] === "and" || a[0] === "or") ? `(${infix(a)})` : infix(a))).join(` ${op} `);
  }
  if (typeof op === "string" && ["<=", "<", ">=", ">", "="].includes(op)) {
    return comparison(op === "=" ? "==" : op, args[0], args[1]);
  }
  return linear(summands(s));
}

// The invariant as a list of facts that all hold (its top-level conjuncts).
// `names[i]` replaces Z3's argument x!i; names may contain any characters.
export function prettyFacts(text: string, names: string[]): string[] {
  const s = inline(read(text), new Map());
  const parts = Array.isArray(s) && s[0] === "and" ? s.slice(1) : [s];
  return parts.map((p) => infix(p).replace(/x!(\d+)/g, (m, i) => names[Number(i)] ?? m));
}
