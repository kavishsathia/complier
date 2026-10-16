// Runs the two agents. Each tick, every agent still working takes one turn at
// the same time; each tool call takes effect on the shared desk the moment its
// response arrives, so arrival order is the order of effect.

import type { Proc, Spec } from "../../../stepper/csp/syntax.ts";
import { gateEvent, start } from "../demo/gatekeeper";
import { event } from "./gatekeeper";
import { next, reject, send, type AgentName, type Desk, type Step } from "./model";

type Message = Record<string, unknown>;
type ToolCall = { id: string; function: { name: string; arguments: string } };

export const AGENTS: AgentName[] = ["A", "B"];

export type Frame = {
  desk: Desk;
  step?: Step;
  state?: Proc;
  convo: Record<AgentName, Message[]>;
  done: Record<AgentName, boolean>;
};

const SYSTEM = `You are one of two fulfilment agents working the same warehouse order desk.
Work through the orders: call next_order to read the next pending order and the current inventory.
If sending its quantity keeps inventory at or above the minimum inventory, call send_to_recipient
with the customer's name and the quantity; otherwise call reject_order. Then call next_order again.
Make exactly one tool call per turn, and give a one-sentence reason where asked.`;

const opening = (): Message[] => [
  { role: "system", content: SYSTEM },
  { role: "user", content: "Start working through the orders." },
];

export const first = (desk: Desk): Frame => ({
  desk,
  convo: { A: opening(), B: opening() },
  done: { A: false, B: false },
});

export const finished = (f: Frame) => AGENTS.every((a) => f.done[a]);

export async function tick(f: Frame, spec?: Spec, base = ""): Promise<Frame[]> {
  const out: Frame[] = [];
  let { desk, state } = f;
  // Under Complier the run starts from the spec's initial state.
  if (spec && !state) state = start(spec);
  const convo = { ...f.convo };
  const done = { ...f.done };
  const emit = (step: Step) => out.push({ desk, state, step, convo: { ...convo }, done: { ...done } });

  // Performs one call on the shared desk and returns what the agent is told.
  // Checks the call's event with Complier, if it is on. A call with no event
  // passes through.
  function check(agent: AgentName, tool: string): boolean {
    if (!spec || !state) return true;
    const gate = gateEvent(spec, state, event(tool), agent === "A" ? "agent_a" : "agent_b");
    state = gate.state;
    return gate.ok;
  }

  function perform(agent: AgentName, name: string, args: Record<string, unknown>): string {
    if (name === "next_order") {
      const o = next(desk);
      if (!o) {
        done[agent] = true;
        emit({ agent, kind: "read", call: "next_order()", detail: "no pending orders", refused: false });
        return "No pending orders. You are done.";
      }
      if (!check(agent, name)) {
        emit({ agent, kind: "read", call: "next_order()", detail: "the other agent is mid-order", refused: true });
        return "Refused by Complier: another agent is between reading an order and sending it. Nothing changed. Call next_order again.";
      }
      emit({
        agent,
        kind: "read",
        call: "next_order()",
        detail: `${o.name}, ${o.quantity} units · inventory ${desk.inventory}`,
        order: o.id,
        refused: false,
      });
      return `Next order: customer ${o.name}, quantity ${o.quantity}, note: ${o.note || "(none)"}. Current inventory: ${desk.inventory}. Minimum inventory: ${desk.minimum}.`;
    }

    const who = String(args.name ?? "");
    const quantity = Number(args.quantity ?? 0);
    const sending = name === "send_to_recipient";
    const refused = !check(agent, name);
    const target = desk.orders.find((o) => o.name.toLowerCase() === who.trim().toLowerCase());
    if (!refused) desk = sending ? send(desk, agent, who, quantity) : reject(desk, agent, who);
    emit({
      agent,
      kind: sending ? "send" : "reject",
      call: sending ? `send_to_recipient("${who}", ${quantity})` : `reject_order("${who}")`,
      detail: String(args.reason ?? ""),
      order: target?.id,
      refused,
    });
    if (refused) return `Refused by Complier: ${name} is not permitted by the specification in the current state. Nothing changed. Call next_order to continue.`;
    return sending ? `Sent ${quantity} to ${who}. Inventory is now ${desk.inventory}.` : `Rejected ${who}'s order.`;
  }

  await Promise.all(
    AGENTS.filter((a) => !done[a]).map(async (agent) => {
      const res = await fetch(`${base}/api/demo2`, { method: "POST", body: JSON.stringify({ messages: convo[agent] }) });
      const { message, error } = (await res.json()) as { message?: Message & { tool_calls?: ToolCall[] }; error?: string };
      if (error || !message) throw new Error(error ?? "no reply");
      const msgs = [...convo[agent], message];
      for (const t of message.tool_calls ?? []) {
        const content = perform(agent, t.function.name, JSON.parse(t.function.arguments || "{}"));
        msgs.push({ role: "tool", tool_call_id: t.id, content });
      }
      convo[agent] = msgs;
    }),
  );

  // Carry the agents' conversations on the last frame of the tick.
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], convo: { ...convo }, done: { ...done } };
  return out;
}
