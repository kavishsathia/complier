import { gateEvent, parse, start } from "../../progress/slides/demo/gatekeeper";
import { event } from "../../progress/slides/demo2/gatekeeper";
import { apply, assign, type AgentName, type Call, type Desk, type Order, type Step } from "../../progress/slides/demo2/model";
import type { Proc, Spec } from "../../stepper/csp/syntax.ts";
import { complete, tools, type Message } from "../demo/agent";

// One round of two fulfilment agents. Both read the same desk at the same
// moment, then each decides its own order. Their calls land on the shared desk
// in the order they arrive, checked first by Complier when there is a spec.

const SYSTEM = `You are one of two fulfilment agents working a warehouse order desk.
You are shown the desk and the order assigned to you. Handle that order:
accept it if fulfilling it keeps the inventory at or above the minimum inventory, otherwise reject it.
Act only through the tools, and give a one-sentence reason in every call.`;

const decide = tools.filter((t) => t.function.name !== "set_minimum_inventory");

const show = (desk: Desk, o: Order) =>
  [
    `Minimum inventory: ${desk.minimum}`,
    `Current inventory: ${desk.inventory}`,
    "",
    "Your order:",
    `id: ${o.id}`,
    `customer: ${o.name}`,
    `quantity: ${o.quantity}`,
    `note: ${o.note || "(none)"}`,
  ].join("\n");

export async function POST(request: Request) {
  const body: { desk: Desk; spec?: string; state?: Proc } = await request.json();
  const snapshot = body.desk;
  let desk = snapshot;
  let state = body.state;
  let spec: Spec | undefined;
  if (body.spec !== undefined) {
    try {
      spec = parse(body.spec);
      state ??= start(spec);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  const steps: Step[] = [];

  // Runs until the agent has made its decision. Gating and applying happen
  // synchronously as each call arrives, so arrival order is the order of effect.
  async function run(agent: AgentName, order: Order) {
    const messages: Message[] = [
      { role: "system", content: SYSTEM },
      { role: "user", content: show(snapshot, order) },
    ];
    for (let turn = 0; turn < 3; turn++) {
      const message = await complete(messages, decide);
      messages.push(message);
      let decided = false;
      for (const t of message.tool_calls ?? []) {
        const call = { name: t.function.name, ...JSON.parse(t.function.arguments) } as Call;
        let refused = false;
        if (spec && state) {
          const out = gateEvent(spec, state, event(call, desk));
          refused = !out.ok;
          state = out.state;
        }
        steps.push({ agent, call, refused });
        if (!refused) desk = apply(desk, agent, call);
        decided = true;
        messages.push({
          role: "tool",
          tool_call_id: t.id,
          content: refused
            ? `Refused by Complier: ${call.name} is not permitted by the specification. Nothing changed.`
            : `Done.`,
        });
      }
      if (decided) return;
    }
  }

  const picks = assign(snapshot);
  try {
    await Promise.all(
      (Object.entries(picks) as [AgentName, Order | undefined][]).flatMap(([agent, order]) => (order ? [run(agent, order)] : [])),
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
  return Response.json({ steps, state });
}
