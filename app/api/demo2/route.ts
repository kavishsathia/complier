import { complete, type Message } from "../demo/agent";
import { authorised, denied } from "../demo/auth";

// One turn of one fulfilment agent in demo 2. The tools run in the browser,
// against the desk both agents share, so this only asks the model for its
// next call.

const reason = { type: "string", description: "One sentence explaining the call" };

const tools = [
  {
    type: "function",
    function: {
      name: "next_order",
      description: "Read the next pending order and the current inventory. Does not reserve the order.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "send_to_recipient",
      description: "Ship a quantity of stock to a customer, deducting it from inventory",
      parameters: {
        type: "object",
        properties: { name: { type: "string" }, quantity: { type: "integer" }, reason },
        required: ["name", "quantity", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reject_order",
      description: "Reject a customer's order",
      parameters: {
        type: "object",
        properties: { name: { type: "string" }, reason },
        required: ["name", "reason"],
      },
    },
  },
];

export async function POST(request: Request) {
  if (!authorised(request)) return denied();
  const { messages }: { messages: Message[] } = await request.json();
  try {
    return Response.json({ message: await complete(messages, tools) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
