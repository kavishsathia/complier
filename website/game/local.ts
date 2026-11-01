import { existsSync, statSync } from "node:fs";
import path from "node:path";
import type { Completion, Message, Transport } from "./model.ts";
import { TOOLS } from "./model.ts";
import { LOCAL_MODEL, parseOutput, toTemplate } from "./qwen.ts";

// The small model run on this server's CPU (transformers.js with onnxruntime-node), for the
// guardrail's judge: a guardrail the visitor's browser ran could be skipped by the visitor. The same
// files are what the browser downloads for the agent (api/game/local-model). No network, no spend.
//
//   GAME_LOCAL_MODEL_DIR=/path/to/qwen2.5-0.5b-instruct-onnx   (holds LOCAL_MODEL.files)

export function localModelDir(env: Record<string, string | undefined> = process.env): string | { unavailable: string } {
  const dir = env.GAME_LOCAL_MODEL_DIR;
  if (!dir) return { unavailable: "no local model is configured for this server (GAME_LOCAL_MODEL_DIR is unset)" };
  const missing = LOCAL_MODEL.files.filter((f) => !existsSync(path.join(dir, f)));
  if (missing.length) return { unavailable: `the local model directory is missing ${missing.join(", ")}` };
  return dir;
}

export function localModelBytes(dir: string) {
  return LOCAL_MODEL.files.reduce((n, f) => n + statSync(path.join(dir, f)).size, 0);
}

type Loaded = { tokenizer: any; model: any };
const g = globalThis as unknown as { __complierLocalModel?: Promise<Loaded>; __complierLocalQueue?: Promise<unknown> };

async function load(dir: string): Promise<Loaded> {
  const { AutoTokenizer, AutoModelForCausalLM, env } = await import("@huggingface/transformers");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = path.dirname(dir) + path.sep;
  const id = path.basename(dir);
  const tokenizer = await AutoTokenizer.from_pretrained(id);
  const model = await AutoModelForCausalLM.from_pretrained(id, { dtype: LOCAL_MODEL.dtype, device: "cpu" });
  return { tokenizer, model };
}

export class LocalTransport implements Transport {
  readonly kind = "server-local" as const;
  private readonly dir: string;
  // Timings of the last call, for the event log and evidence.
  last: { promptTokens: number; newTokens: number; ms: number } | undefined;

  constructor(dir: string) {
    this.dir = dir;
  }

  async complete(messages: Message[], tools: typeof TOOLS | [] = TOOLS): Promise<Completion> {
    // One generation at a time: the CPU is shared, and the model isn't re-entrant.
    const run = (g.__complierLocalQueue ?? Promise.resolve()).then(() => this.generate(messages, tools));
    g.__complierLocalQueue = run.catch(() => undefined);
    return run;
  }

  private async generate(messages: Message[], tools: typeof TOOLS | []): Promise<Completion> {
    const loaded = (g.__complierLocalModel ??= load(this.dir).catch((e) => {
      g.__complierLocalModel = undefined;
      throw e;
    }));
    const { tokenizer, model } = await loaded;
    const inputs = tokenizer.apply_chat_template(toTemplate(messages), {
      ...(tools.length ? { tools } : {}),
      add_generation_prompt: true,
      return_dict: true,
    });
    const started = Date.now();
    const out = await model.generate({ ...inputs, max_new_tokens: LOCAL_MODEL.maxNewTokens, do_sample: false });
    const promptTokens = inputs.input_ids.dims[1];
    const generated = out.slice(null, [promptTokens, null]);
    const raw: string = tokenizer.decode(generated[0], { skip_special_tokens: false });
    this.last = { promptTokens, newTokens: generated.dims[1], ms: Date.now() - started };
    const parsed = parseOutput(raw);
    return { content: parsed.content, tool_calls: parsed.tool_calls.map((c, i) => ({ id: `local-${started}-${i}`, ...c })) };
  }
}
