// Where everything in a sequence diagram goes. Agents' lifelines are on the left, the monitor's on
// the right, so every exchange meets the left side of the monitor's activation bar: attempt in,
// allow out, result in. The agent's own bar runs from allow to result, while the call runs.

import type { Diagram, Item } from "./diagram.ts";

export type ArrowKind = "attempt" | "allow" | "result";

export type Shape =
  | { k: "actor"; x: number; y: number; w: number; h: number; title: string; sub: string }
  | { k: "life"; x: number; y1: number; y2: number }
  | { k: "bar"; x: number; y1: number; y2: number; who: "agent" | "monitor" }
  | { k: "arrow"; x1: number; x2: number; y: number; label: string; kind: ArrowKind }
  | { k: "pill"; x: number; y: number; w: number; label: string; kind: "state" | "loop" | "stop" | "skip" | "denied" }
  | { k: "frag"; x: number; y: number; w: number; h: number; tag: string; tagW: number; kind: "choice" | "results" }
  | { k: "sep"; x1: number; x2: number; y: number }
  | { k: "guard"; x: number; y: number; label: string }
  | { k: "note"; x: number; y: number; label: string; anchor: "start" | "end" };

export type Layout = { width: number; height: number; shapes: Shape[] };

// Text widths are estimated from the character count: labels are monospaced.
const CHAR = 7.2;
const SMALL = 6.6;
const textW = (s: string, c = CHAR) => Math.ceil(s.length * c);

const ACTOR_W = 176;
const ACTOR_H = 48;
const TOP = 16;
const BAR = 12;
const PAD = 100; // fragments reach this far past the outer lifelines
const INSET = 12; // and step in this much per level of nesting

export const resultLabel = (ev: string, values: string[]) =>
  values.length === 1 ? `result.${ev}.${values[0]}` : `result.${ev}?v : {${values.join(", ")}}`;

export function arrange(d: Diagram): Layout {
  const ev = (role: string | null, act: string) => (role ? `${role}.${act}` : act);

  // The widest arrow label sets the gap between the agents and the monitor.
  let widest = 0;
  const measure = (items: Item[]) => {
    for (const it of items) {
      if (it.k === "exchange") {
        const e = ev(it.role, it.act);
        widest = Math.max(widest, textW(`attempt.${e}`), textW(it.values ? resultLabel(e, it.values) : `allow.${e}`));
      } else if (it.k === "results") {
        for (const op of it.ops) widest = Math.max(widest, textW(resultLabel(ev(it.role, it.act), op.values)));
        it.ops.forEach((op) => measure(op.items));
      } else if (it.k === "choice") it.ops.forEach((op) => measure(op.items));
    }
  };
  measure(d.items);

  const left = PAD + 20;
  const agentX = d.agents.map((_, i) => left + i * (ACTOR_W + 40));
  const lastAgent = agentX[agentX.length - 1];
  const monitorX = lastAgent + Math.max(300, widest + 90);
  const xOf = (role: string | null) => (role === null ? agentX[0] : agentX[d.agents.indexOf(role)] ?? agentX[0]);
  const width = monitorX + PAD + 20;

  const shapes: Shape[] = [];
  const top = TOP + ACTOR_H;

  const pill = (y: number, label: string, kind: Extract<Shape, { k: "pill" }>["kind"]) => {
    shapes.push({ k: "pill", x: monitorX, y, w: textW(label) + 26, label, kind });
    return y + 40;
  };

  // The three arrows of an exchange (two if results branch), on the monitor's bar.
  const arrow = (role: string | null, y: number, label: string, kind: ArrowKind) => {
    const a = xOf(role);
    const toMonitor = kind !== "allow";
    shapes.push({ k: "arrow", x1: toMonitor ? a + BAR / 2 : monitorX - BAR / 2, x2: toMonitor ? monitorX - BAR / 2 : a + BAR / 2, y, label, kind });
  };

  const fragment = (
    y: number,
    depth: number,
    kind: "choice" | "results",
    tag: string,
    ops: { label: string; items: Item[]; lead?: (y: number) => number }[],
  ) => {
    const x1 = agentX[0] - PAD + depth * INSET;
    const x2 = monitorX + PAD - depth * INSET;
    const tagW = textW(tag, SMALL) + 22;
    const frag: Extract<Shape, { k: "frag" }> = { k: "frag", x: x1, y, w: x2 - x1, h: 0, tag, tagW, kind };
    shapes.push(frag);
    let oy = y + 26;
    ops.forEach((op, i) => {
      if (i > 0) shapes.push({ k: "sep", x1, x2, y: oy });
      shapes.push({ k: "guard", x: x1 + (i === 0 ? tagW + 10 : 10), y: (i === 0 ? y : oy) + 16, label: `[${op.label}]` });
      oy += i === 0 ? 8 : 30;
      if (op.lead) oy = op.lead(oy);
      oy = lay(op.items, oy, depth + 1) + 4;
    });
    frag.h = oy - y;
    return oy + 14;
  };

  const lay = (items: Item[], y: number, depth: number): number => {
    for (const it of items) {
      switch (it.k) {
        case "state":
          y = pill(y, it.label, "state");
          break;
        case "loop":
          y = pill(y, `↺ ${it.label}`, "loop");
          break;
        case "stop":
          y = pill(y, "STOP · takes no more attempts", "stop");
          break;
        case "skip":
          y = pill(y, "SKIP · terminated ✓", "skip");
          break;
        case "denied":
          y = pill(y, `no allowed action${it.events.length ? `: only ${it.events.join(", ")}` : ""}`, "denied");
          break;
        case "exchange": {
          const e = ev(it.role, it.act);
          const a = xOf(it.role);
          arrow(it.role, y + 20, `attempt.${e}`, "attempt");
          arrow(it.role, y + 50, `allow.${e}`, "allow");
          if (it.values) {
            arrow(it.role, y + 80, resultLabel(e, it.values), "result");
            shapes.push({ k: "bar", x: monitorX, y1: y + 8, y2: y + 90, who: "monitor" });
            shapes.push({ k: "bar", x: a, y1: y + 50, y2: y + 80, who: "agent" });
            shapes.push({ k: "note", x: a - BAR, y: y + 69, label: "call runs", anchor: "end" });
            y += 104;
          } else {
            shapes.push({ k: "bar", x: monitorX, y1: y + 8, y2: y + 62, who: "monitor" });
            shapes.push({ k: "bar", x: a, y1: y + 50, y2: y + 62, who: "agent" });
            y += 74;
          }
          break;
        }
        case "results": {
          const e = ev(it.role, it.act);
          const a = xOf(it.role);
          y = fragment(
            y,
            depth,
            "results",
            `result of ${e}`,
            it.ops.map((op) => ({
              label: op.values.length === 1 ? `v = ${op.values[0]}` : `v ∈ {${op.values.join(", ")}}`,
              items: op.items,
              lead: (oy: number) => {
                arrow(it.role, oy + 20, resultLabel(e, op.values), "result");
                shapes.push({ k: "bar", x: monitorX, y1: oy + 4, y2: oy + 30, who: "monitor" });
                shapes.push({ k: "bar", x: a, y1: oy + 4, y2: oy + 20, who: "agent" });
                shapes.push({ k: "note", x: a - BAR, y: oy + 16, label: "call runs", anchor: "end" });
                return oy + 42;
              },
            })),
          );
          break;
        }
        case "choice":
          y = fragment(y, depth, "choice", "[] external choice", it.ops);
          break;
      }
    }
    return y;
  };

  const end = lay(d.items, top + 18, 0) + 10;
  d.agents.forEach((name, i) =>
    shapes.unshift(
      { k: "actor", x: agentX[i], y: TOP, w: ACTOR_W, h: ACTOR_H, title: d.roles ? name : "ControllableCHAOS", sub: d.roles ? "ControllableCHAOS" : "the agent" },
      { k: "life", x: agentX[i], y1: top, y2: end },
    ),
  );
  shapes.unshift(
    { k: "actor", x: monitorX, y: TOP, w: ACTOR_W, h: ACTOR_H, title: "Monitor", sub: "ComplierGuard(Policy)" },
    { k: "life", x: monitorX, y1: top, y2: end },
  );
  return { width, height: end + 16, shapes };
}
