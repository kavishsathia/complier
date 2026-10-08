// The gatekeeper for the storefront demo: three CSP processes composed in
// parallel, stepped one event at a time. Guards mirror the spec shown in the
// panel, so a refused event is exactly one the composition does not offer.

export const LOW = 2;
export const RESTOCK = 5;
export const PRICE = 30;
export const START = 5;

export type Actor = "shopper" | "supplier";

export type Event =
  | { kind: "ask"; q: number }
  | { kind: "buy"; q: number }
  | { kind: "cancel" }
  | { kind: "low" }
  | { kind: "restock"; k: number }
  | { kind: "setPrice"; p: number };

export type Machine = {
  stock: number;
  shopper: "idle" | "buying";
  supplier: "idle" | "ordering";
  q: number | null;
};

export const initial: Machine = {
  stock: START,
  shopper: "idle",
  supplier: "idle",
  q: null,
};

export function label(e: Event): string {
  switch (e.kind) {
    case "ask":
    case "buy":
      return `${e.kind}.${e.q}`;
    case "restock":
      return `restock.${e.k}`;
    case "setPrice":
      return `setPrice.${e.p}`;
    default:
      return e.kind;
  }
}

export type Result =
  | { ok: true; next: Machine }
  | { ok: false; reason: string };

export function step(m: Machine, e: Event): Result {
  switch (e.kind) {
    case "ask":
      if (m.shopper !== "idle") return { ok: false, reason: "Shopper is mid-purchase" };
      return { ok: true, next: { ...m, shopper: "buying", q: e.q } };
    case "buy":
      if (m.shopper !== "buying" || m.q !== e.q)
        return { ok: false, reason: "Shopper did not ask for this" };
      if (e.q < 1 || e.q > m.stock)
        return { ok: false, reason: `guard q ∈ {1..n} fails, n = ${m.stock}` };
      return { ok: true, next: { ...m, stock: m.stock - e.q, shopper: "idle", q: null } };
    case "cancel":
      if (m.shopper !== "buying") return { ok: false, reason: "Nothing to cancel" };
      return { ok: true, next: { ...m, shopper: "idle", q: null } };
    case "low":
      if (m.stock > LOW) return { ok: false, reason: `guard n ≤ ${LOW} fails` };
      if (m.supplier !== "idle") return { ok: false, reason: "Supplier is not ready" };
      return { ok: true, next: { ...m, supplier: "ordering" } };
    case "restock":
      if (m.supplier !== "ordering") return { ok: false, reason: "Supplier has not ordered" };
      return { ok: true, next: { ...m, stock: m.stock + e.k, supplier: "idle" } };
    case "setPrice":
      return { ok: false, reason: "setPrice is not in any process's alphabet" };
  }
}

// The events the composition offers in state m, as shown under "Offered".
export function offered(m: Machine): string[] {
  const out: string[] = [];
  if (m.shopper === "idle") out.push("ask.q");
  if (m.shopper === "buying" && m.q !== null) {
    if (m.q <= m.stock) out.push(`buy.${m.q}`);
    out.push("cancel");
  }
  if (m.stock <= LOW && m.supplier === "idle") out.push("low");
  if (m.supplier === "ordering") out.push(`restock.${RESTOCK}`);
  return out;
}
