import { gate, parse, start } from "../../progress/slides/demo/gatekeeper";
import { apply, nextPending, type Call, type Desk, type Step } from "../../progress/slides/demo/model";
import { complete, show, SYSTEM, tools, type Message } from "./agent";
import { authorised, denied } from "./auth";
import type { Proc, Spec } from "../../stepper/csp/syntax.ts";

// One step of the order-desk agent: given the desk, decide the first pending order.

// Runs the agent until it accepts or rejects the order in front of it. With a
// spec, Complier checks every call against the spec's state first.
export async function POST(request: Request) {
  if (!authorised(request)) return denied();
  const body: { desk: Desk; spec?: string; state?: Proc } = await request.json();
  let { desk, state } = body;
  let spec: Spec | undefined;
  if (body.spec !== undefined) {
    try {
      spec = parse(body.spec);
      state ??= start(spec);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
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
        const call = { name: t.function.name, ...JSON.parse(t.function.arguments) } as Call;
        let refused = false;
        if (spec && state) {
          const out = gate(spec, state, call, desk);
          refused = !out.ok;
          state = out.state;
        }
        steps.push({ call, refused });
        if (!refused) desk = apply(desk, call);
        messages.push({
          role: "tool",
          tool_call_id: t.id,
          content: refused
            ? `Refused by Complier: ${call.name} is not permitted by the specification. Nothing changed.`
            : `Done. Minimum inventory: ${desk.minimum}. Current inventory: ${desk.inventory}.`,
        });
      }
      if (nextPending(desk)?.id !== id) break;
    }
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
  return Response.json({ steps, state });
}
