import { decide, finish, load, start, told, type Machine } from "../../illustrations/_complier/gate";
import type { PState } from "../../illustrations/_complier/policy";
import { apply, nextPending, type Call, type Desk, type Step } from "../../illustrations/_desk/model";
import { complete, show, SYSTEM, tools, type Message } from "./agent";
import { authorised, denied } from "./auth";

// One step of the order-desk agent: given the desk, decide the first pending order.

// Runs the agent until it accepts or rejects the order in front of it. With a unit and a
// policy, complier decides every call first: the unit names its action and the policy allows,
// denies or refuses it. Only an allowed call runs.
export async function POST(request: Request) {
  if (!authorised(request)) return denied();
  const body: { desk: Desk; unit?: string; policy?: string; state?: PState } = await request.json();
  let { desk, state } = body;
  let machine: Machine | undefined;
  if (body.unit !== undefined && body.policy !== undefined) {
    const loaded = load(body.unit, body.policy);
    if ("errors" in loaded) {
      const e = loaded.errors.unit ?? loaded.errors.policy!;
      return Response.json({ error: `line ${e.line}: ${e.message}` }, { status: 400 });
    }
    machine = loaded.machine;
    state ??= start();
  }

  const id = nextPending(desk)?.id;
  const messages: Message[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: show(desk) },
  ];
  const steps: Step[] = [];
  try {
    for (let turn = 0; turn < 4; turn++) {
      const message = await complete(messages, tools);
      messages.push(message);
      for (const t of message.tool_calls ?? []) {
        const args = JSON.parse(t.function.arguments);
        const call = { name: t.function.name, ...args } as Call;
        let content: string;
        if (machine && state) {
          const out = decide(machine, state, null, call.name, args);
          state = out.state;
          steps.push({ call, verdict: out.verdict });
          if (out.verdict.k === "allowed") {
            desk = apply(desk, call);
            content = `Done. Minimum inventory: ${desk.minimum}. Current inventory: ${desk.inventory}.`;
            state = finish(machine, state, null, out.verdict.action, true, content);
          } else content = told(call.name, out.verdict);
        } else {
          steps.push({ call });
          desk = apply(desk, call);
          content = `Done. Minimum inventory: ${desk.minimum}. Current inventory: ${desk.inventory}.`;
        }
        messages.push({ role: "tool", tool_call_id: t.id, content });
      }
      if (nextPending(desk)?.id !== id) break;
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
  return Response.json({ steps, state });
}
