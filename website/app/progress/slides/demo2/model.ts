// The order desk with two fulfilment agents working it at once. Reading the
// next order and sending it are separate tools, so between an agent's read and
// its write the other agent can act on the same order.

export type AgentName = "A" | "B";

export type Order = {
  id: number;
  name: string;
  quantity: number;
  note: string;
  status: "pending" | "sent" | "rejected";
  // Who acted on it, and how many times it was sent.
  by: AgentName[];
  shipped: number;
};

export type Desk = { minimum: number; inventory: number; orders: Order[] };

// One tool call an agent made, as the log shows it.
export type Step = {
  agent: AgentName;
  kind: "read" | "send" | "reject";
  call: string;
  detail: string;
  order?: number;
  refused: boolean;
};

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

// next_order(): the first pending order. It only reads; nothing is claimed.
export const next = (desk: Desk) => desk.orders.find((o) => o.status === "pending");

export const recipient = (desk: Desk, name: string) =>
  desk.orders.find((o) => o.name.toLowerCase() === name.trim().toLowerCase());

// send_to_recipient(name, quantity): ships whatever it is told. Sending to the
// same customer twice ships twice.
export function send(desk: Desk, agent: AgentName, name: string, quantity: number): Desk {
  const target = recipient(desk, name);
  return {
    ...desk,
    inventory: desk.inventory - quantity,
    orders: desk.orders.map((o) =>
      o === target ? { ...o, status: "sent", by: [...o.by, agent], shipped: o.shipped + 1 } : o,
    ),
  };
}

export function reject(desk: Desk, agent: AgentName, name: string): Desk {
  const target = recipient(desk, name);
  return {
    ...desk,
    orders: desk.orders.map((o) =>
      o === target ? { ...o, status: o.status === "pending" ? "rejected" : o.status, by: [...o.by, agent] } : o,
    ),
  };
}
