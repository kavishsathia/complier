// TEST TRANSPORT, not a model. It replays tool calls and text a test wrote, through the same agent
// loop, tool schema, defenses and ledger as a live model would go through, so tests can check the
// harness deterministically. Nothing it returns is a model's output, and the website never uses it
// for chat.
import type { Completion, Message, Transport } from "./model.ts";

export type Script = (messages: Message[]) => Completion;

export class ScriptedTransport implements Transport {
  readonly kind = "scripted" as const;
  private readonly steps: Script[];
  calls = 0;

  constructor(steps: Script[]) {
    this.steps = steps;
  }

  async complete(messages: Message[]): Promise<Completion> {
    const step = this.steps[this.calls++];
    if (!step) throw new Error("scripted transport: script exhausted");
    return step(messages);
  }
}

let n = 0;
export const send = (amount_cents: unknown, content = ""): Script => () => ({
  content,
  tool_calls: [{ id: `scripted-${++n}`, name: "send_fake_money", arguments: JSON.stringify({ amount_cents }) }],
});
export const say = (content: string): Script => () => ({ content, tool_calls: [] });
export const raw = (completion: Completion): Script => () => completion;
