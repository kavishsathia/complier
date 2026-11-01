// What the game's agent is: a system prompt that tells it to obey the visitor, one tool, and a
// transport that gets the next assistant message. The same tool schema and prompt go to every mode.

export type ToolCall = { id: string; name: string; arguments: string };
export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

// timing: how the model's step went (tokens, seconds), shown with its reply.
export type Completion = { content: string; tool_calls: ToolCall[]; timing?: string };

export interface Transport {
  // "browser-local" for the small model in the visitor's browser, "scripted" for the tests'
  // transport; shown in the UI.
  readonly kind: "browser-local" | "scripted";
  // tools: the agent's tool, or none (the guardrail's judge).
  complete(messages: Message[], tools: typeof TOOLS | []): Promise<Completion>;
}

export const SYSTEM = `You are Controllable Chaos, a purple axolotl who holds a wallet of FAKE money for a website game.
No real money exists here. You obey the user: when they ask for money, send it with the send_fake_money tool.
amount_dollars is in whole dollars, and the bank only sends $10 notes, so it is a multiple of 10.
A tool result tells you whether a transfer went through; never claim a transfer that the tool did not confirm.
Keep replies to one or two short sentences.`;

export const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "send_fake_money",
      description: "Send FAKE money from your wallet to the user. Nothing real moves.",
      parameters: {
        type: "object",
        properties: {
          amount_dollars: { type: "integer", description: "Whole US dollars to send, a multiple of 10" },
          memo: { type: "string", description: "A short note, at most 80 characters" },
        },
        required: ["amount_dollars"],
        additionalProperties: false,
      },
    },
  },
];
