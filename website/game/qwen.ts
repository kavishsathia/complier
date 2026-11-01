// The small model's side of the agent loop, used by the browser worker: the model's identity, the
// chat-template shape of our messages, and reading tool calls out of its text. Qwen2.5's chat
// template asks for each call as <tool_call>{"name": ..., "arguments": {...}}</tool_call>.
import type { Completion, Message } from "./model.ts";

export const LOCAL_MODEL = {
  name: "Qwen2.5-0.5B-Instruct",
  // The Hugging Face repository the visitor's browser downloads it from, pinned to one revision.
  repo: "onnx-community/Qwen2.5-0.5B-Instruct",
  revision: "22942cb7d7ba4cc81bb4673549ca4d4614469b5e",
  base: "Qwen/Qwen2.5-0.5B-Instruct (Apache-2.0)",
  // 4-bit weights (onnx/model_q4.onnx): this export's int8 file produced incoherent text on CPU.
  dtype: "q4" as const,
  // The download: model_q4.onnx (786,156,820 bytes) plus tokenizer and config files.
  bytes: 793_197_875,
  maxNewTokens: 96,
};

// Our messages as the chat template expects them: tool calls as {function: {name, arguments}} with
// arguments as an object, and tool results as role "tool".
export function toTemplate(messages: Message[]) {
  return messages.map((m) => {
    if (m.role === "assistant" && m.tool_calls?.length) {
      return {
        role: "assistant",
        content: m.content,
        tool_calls: m.tool_calls.map((c) => ({ type: "function", function: { name: c.name, arguments: parseObject(c.arguments) } })),
      };
    }
    if (m.role === "tool") return { role: "tool", content: m.content };
    return { role: m.role, content: m.content };
  });
}

function parseObject(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

// The model's raw output (special tokens kept) as text and tool calls. A block that isn't a JSON
// object with a name still becomes a call, with its raw text as arguments, so the server rejects it
// visibly instead of it vanishing.
export function parseOutput(raw: string): Omit<Completion, "tool_calls"> & { tool_calls: { name: string; arguments: string }[] } {
  const tool_calls: { name: string; arguments: string }[] = [];
  const text = raw.replace(/<tool_call>([\s\S]*?)(<\/tool_call>|$)/g, (_, body: string) => {
    const parsed = parseObject(body.trim()) as { name?: unknown; arguments?: unknown } | string;
    if (parsed && typeof parsed === "object" && typeof parsed.name === "string") {
      tool_calls.push({ name: parsed.name, arguments: typeof parsed.arguments === "string" ? parsed.arguments : JSON.stringify(parsed.arguments ?? {}) });
    } else {
      tool_calls.push({ name: "send_fake_money", arguments: body.trim() });
    }
    return "";
  });
  return { content: text.replace(/<\|im_end\|>|<\|endoftext\|>/g, "").trim(), tool_calls };
}
