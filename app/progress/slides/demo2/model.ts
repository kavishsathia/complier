// The order desk with two fulfilment agents working it at once.

export type AgentName = "A" | "B";

export type Order = {
  id: number;
  name: string;
  quantity: number;
  note: string;
  status: "pending" | "accepted" | "rejected";
  // Who decided it, and how many times it shipped.
  by: AgentName[];
  shipped: number;
};

export type Call = { name: "accept_order" | "reject_order"; id: number; reason: string };

export type Step = { agent: AgentName; call: Call; refused: boolean };

export type Desk = { minimum: number; inventory: number; orders: Order[] };

const order = (id: number, name: string, quantity: number, note: string): Order => ({
  id,
  name,
  quantity,
  note,
  status: "pending",
  by: [],
  shipped: 0,
});

export const initial: Desk = {
  minimum: 20,
  inventory: 100,
  orders: [
    order(1, "Acme Co", 15, "Regular restock"),
    order(2, "Brightline", 25, "Deliver Tuesday"),
    order(3, "Harbor Foods", 15, "Urgent, store opening"),
    order(4, "Kestrel Labs", 10, ""),
    order(5, "Northwind", 12, "Split delivery is fine"),
  ],
};

// The desk does what it is told, with no check of its own: an order accepted
// twice ships twice.
export function apply(desk: Desk, agent: AgentName, call: Call): Desk {
  const target = desk.orders.find((o) => o.id === call.id);
  if (!target) return desk;
  const accepted = call.name === "accept_order";
  return {
    ...desk,
    inventory: accepted ? desk.inventory - target.quantity : desk.inventory,
    orders: desk.orders.map((o) =>
      o.id !== call.id
        ? o
        : {
            ...o,
            status: accepted ? "accepted" : o.status === "pending" ? "rejected" : o.status,
            by: [...o.by, agent],
            shipped: o.shipped + (accepted ? 1 : 0),
          },
    ),
  };
}

const pending = (desk: Desk) => desk.orders.filter((o) => o.status === "pending");

// A works the queue from the front and B from the back, each on what it read.
export function assign(desk: Desk): Record<AgentName, Order | undefined> {
  const p = pending(desk);
  return { A: p[0], B: p[p.length - 1] };
}

export const finished = (desk: Desk) => pending(desk).length === 0;
