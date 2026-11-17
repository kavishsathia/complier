// Runs the two agents. Each tick, every agent still working takes one turn at
// the same time; each tool call takes effect on the shared desk the moment its
// response arrives, so arrival order is the order of effect.

import { decide, finish, start, told, type Machine } from "../_complier/gate.ts";
import type { PState } from "../_complier/policy.ts";
import { next, reject, send, type AgentName, type Desk, type Step } from "./model.ts";

export type Message = Record<string, unknown>;
type ToolCall = { id: string; function: { name: string; arguments: string } };

// One turn of the model for one agent: its conversation so far in, its next message out.
export type Ask = (messages: Message[]) => Promise<Message & { tool_calls?: ToolCall[] }>;

export const AGENTS: AgentName[] = ["A", "B"];

// The role each agent joins the policy as.
const ROLE: Record<AgentName, string> = { A: "agent_a", B: "agent_b" };

export type Frame = {
  desk: Desk;
  step?: Step;
  state?: PState;
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

export async function tick(f: Frame, machine: Machine | undefined, ask: Ask): Promise<Frame[]> {
  const out: Frame[] = [];
  let { desk, state } = f;
  // Under complier the run starts from the policy's initial state.
  if (machine && !state) state = start();
  const convo = { ...f.convo };
  const done = { ...f.done };
  const emit = (step: Step) => out.push({ desk, state, step, convo: { ...convo }, done: { ...done } });

  // Under complier, decides the call: the unit names its action and the policy allows, denies
  // or refuses it as the agent's role.
  function check(agent: AgentName, tool: string, args: Record<string, unknown>) {
    if (!machine || !state) return undefined;
    const out = decide(machine, state, ROLE[agent], tool, args);
    state = out.state;
    return out.verdict;
  }

  // An allowed call ran and returned `output`: the policy follows its result.
  function ran(agent: AgentName, verdict: Step["verdict"], output: string) {
    if (machine && state && verdict?.k === "allowed") state = finish(machine, state, ROLE[agent], verdict.action, true, output);
    return output;
  }

  function perform(agent: AgentName, name: string, args: Record<string, unknown>): string {
    if (name === "next_order") {
      const o = next(desk);
      if (!o) {
        done[agent] = true;
        emit({ agent, kind: "read", call: "next_order()", detail: "no pending orders" });
        return "No pending orders. You are done.";
      }
      const verdict = check(agent, name, args);
      if (verdict && verdict.k !== "allowed") {
        emit({ agent, kind: "read", call: "next_order()", detail: "the other agent is mid-order", verdict });
        return `${told(name, verdict)} Call next_order again.`;
      }
      emit({
        agent,
        kind: "read",
        call: "next_order()",
        detail: `${o.name}, ${o.quantity} units · inventory ${desk.inventory}`,
        order: o.id,
        verdict,
      });
      return ran(
        agent,
        verdict,
        `Next order: customer ${o.name}, quantity ${o.quantity}, note: ${o.note || "(none)"}. Current inventory: ${desk.inventory}. Minimum inventory: ${desk.minimum}.`,
      );
    }

    const who = String(args.name ?? "");
    const quantity = Number(args.quantity ?? 0);
    const sending = name === "send_to_recipient";
    const verdict = check(agent, name, args);
    const refused = !!verdict && verdict.k !== "allowed";
    const target = desk.orders.find((o) => o.name.toLowerCase() === who.trim().toLowerCase());
    if (!refused) desk = sending ? send(desk, agent, who, quantity) : reject(desk, agent, who);
    emit({
      agent,
      kind: sending ? "send" : "reject",
      call: sending ? `send_to_recipient("${who}", ${quantity})` : `reject_order("${who}")`,
      detail: String(args.reason ?? ""),
      order: target?.id,
      verdict,
    });
    if (refused) return `${told(name, verdict!)} Call next_order to continue.`;
    return ran(agent, verdict, sending ? `Sent ${quantity} to ${who}. Inventory is now ${desk.inventory}.` : `Rejected ${who}'s order.`);
  }

  await Promise.all(
    AGENTS.filter((a) => !done[a]).map(async (agent) => {
      const message = await ask(convo[agent]);
      const msgs = [...convo[agent], message];
      for (const t of message.tool_calls ?? []) {
        const content = perform(agent, t.function.name, JSON.parse(t.function.arguments || "{}"));
        msgs.push({ role: "tool", tool_call_id: t.id, content });
      }
      convo[agent] = msgs;
    }),
  );

  // Carry the agents' conversations, and the policy's state once every allowed call's result has
  // come back, on the last frame of the tick: the next tick starts from it.
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], state, convo: { ...convo }, done: { ...done } };
  return out;
}
