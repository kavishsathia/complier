// The small local model's side of the agent loop, shared by the browser worker and the server: the
// model's identity, the chat-template shape of our messages, and reading tool calls out of its text.
// Qwen2.5's chat template asks for each call as <tool_call>{"name": ..., "arguments": {...}}</tool_call>.
import type { Completion, Message } from "./model.ts";

export const LOCAL_MODEL = {
  // The directory name the files are served under, and where they came from.
  id: "qwen2.5-0.5b-instruct-onnx",
  source: "onnx-community/Qwen2.5-0.5B-Instruct",
  base: "Qwen/Qwen2.5-0.5B-Instruct (Apache-2.0)",
  dtype: "q4" as const,
  // What the browser downloads: the 4-bit weights and the tokenizer.
  files: ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "onnx/model_q4.onnx"],
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
