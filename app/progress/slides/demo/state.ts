import {
  type Actor,
  type Event,
  type Machine,
  initial,
  label,
  LOW,
  PRICE,
  RESTOCK,
  step,
} from "./machine";

export type TraceEntry = {
  n: number;
  actor: Actor;
  label: string;
  ok: boolean;
  reason?: string;
};

export type Message = { from: "user" | "agent" | "supplier"; text: string };

export type State = {
  m: Machine;
  trace: TraceEntry[];
  chat: Message[];
};

export type Action =
  | { type: "user"; text: string }
  | { type: "commit" }
  | { type: "low" }
  | { type: "restock" }
  | { type: "reset" };

export const start: State = {
  m: initial,
  trace: [],
  chat: [
    {
      from: "agent",
      text: "Hi! I'm the shop agent. Tell me how many Tungsten Cubes you'd like and I'll buy them for you.",
    },
  ],
};

function fire(s: State, actor: Actor, e: Event): [State, boolean] {
  const r = step(s.m, e);
  const entry: TraceEntry = { n: s.trace.length + 1, actor, label: label(e), ok: r.ok };
  if (r.ok === false) {
    return [{ ...s, trace: [...s.trace, { ...entry, reason: r.reason }] }, false];
  }
  return [{ ...s, m: r.next, trace: [...s.trace, entry] }, true];
}

const say = (s: State, from: Message["from"], text: string): State => ({
  ...s,
  chat: [...s.chat, { from, text }],
});

const words: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

function quantity(text: string): number {
  const digits = text.match(/\d+/);
  if (digits) return Number(digits[0]);
  for (const w of text.toLowerCase().split(/\W+/)) if (w in words) return words[w];
  return 1;
}

// A stubbed agent: keyword intents instead of an LLM, but every action it
// takes still goes through the gatekeeper.
function respond(s: State, text: string): State {
  const t = text.toLowerCase();
  if (/price|discount|free|cheaper|cost/.test(t)) {
    const [s1] = fire(s, "shopper", { kind: "setPrice", p: 0 });
    return say(
      s1,
      "agent",
      "I tried to set the price to 0 cr, but the gatekeeper refused it: changing prices isn't something I'm allowed to do.",
    );
  }
  if (/buy|purchase|order|get|want/.test(t)) {
    const q = quantity(t);
    const [s1, ok] = fire(s, "shopper", { kind: "ask", q });
    if (!ok) return say(s1, "agent", "One moment, I'm still placing your last order.");
    return say(s1, "agent", `On it, buying ${q} × Tungsten Cube…`);
  }
  if (/stock|left|how many|available/.test(t)) {
    return say(s, "agent", `There ${s.m.stock === 1 ? "is" : "are"} ${s.m.stock} in stock.`);
  }
  return say(s, "agent", "I can buy Tungsten Cubes for you. Try “buy 2 cubes”.");
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "user":
      return respond(say(s, "user", a.text), a.text);
    case "commit": {
      const q = s.m.q;
      if (q === null) return s;
      const [s1, ok] = fire(s, "shopper", { kind: "buy", q });
      if (ok) return say(s1, "agent", `Done: ${q} × Tungsten Cube for ${q * PRICE} cr.`);
      const [s2] = fire(s1, "shopper", { kind: "cancel" });
      return say(
        s2,
        "agent",
        `The gatekeeper refused buy.${q}: only ${s.m.stock} in stock, so I cancelled the order.`,
      );
    }
    case "low": {
      const [s1, ok] = fire(s, "supplier", { kind: "low" });
      if (!ok) return s1;
      return say(
        s1,
        "supplier",
        `Stock is at ${s.m.stock} (≤ ${LOW}). Ordering ${RESTOCK} from the wholesaler.`,
      );
    }
    case "restock": {
      const [s1, ok] = fire(s, "supplier", { kind: "restock", k: RESTOCK });
      if (!ok) return s1;
      return say(s1, "supplier", `Delivered ${RESTOCK} cubes.`);
    }
    case "reset":
      return start;
  }
}
