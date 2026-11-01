// The game's agent model (and the guardrail's judge), run in the visitor's browser:
// Qwen2.5-0.5B-Instruct, 4-bit, on the CPU with ONNX Runtime's WebAssembly build, by transformers.js.
// transformers.js downloads the model from the Hugging Face hub at a pinned revision, and its
// runtime from jsDelivr at the version it bundles; the browser's Cache API keeps the files for the
// next visit. The model only produces text and tool calls: the page checks and runs the calls.
import { AutoModelForCausalLM, AutoTokenizer, env } from "@huggingface/transformers";
import { TOOLS, type Message } from "../../game/model";
import { LOCAL_MODEL, parseOutput, toTemplate } from "../../game/qwen";

type Loaded = { tokenizer: any; model: any };
let loaded: Promise<Loaded> | undefined;

function load(): Promise<Loaded> {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  const wasm = (env.backends.onnx as any).wasm;
  // Threads need a cross-origin-isolated page, which this site isn't.
  wasm.numThreads = 1;
  const progress = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === "progress" && p.file) postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total });
  };
  const options = { revision: LOCAL_MODEL.revision, progress_callback: progress };
  return (async () => {
    const tokenizer = await AutoTokenizer.from_pretrained(LOCAL_MODEL.repo, options);
    const model = await AutoModelForCausalLM.from_pretrained(LOCAL_MODEL.repo, { ...options, dtype: LOCAL_MODEL.dtype, device: "wasm" });
    return { tokenizer, model };
  })();
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: "load" } | { type: "generate"; id: number; messages: Message[]; tools: boolean };
  try {
    if (msg.type === "load") {
      const started = performance.now();
      // A failed load can be tried again.
      loaded ??= load().catch((err) => {
        loaded = undefined;
        throw err;
      });
      await loaded;
      postMessage({ type: "loaded", ms: Math.round(performance.now() - started) });
      return;
    }
    if (!loaded) throw new Error("the model isn't loaded");
    const { tokenizer, model } = await loaded;
    const inputs = tokenizer.apply_chat_template(toTemplate(msg.messages), { ...(msg.tools ? { tools: TOOLS } : {}), add_generation_prompt: true, return_dict: true });
    const started = performance.now();
    const out = await model.generate({ ...inputs, max_new_tokens: LOCAL_MODEL.maxNewTokens, do_sample: false });
    const promptTokens = inputs.input_ids.dims[1];
    const generated = out.slice(null, [promptTokens, null]);
    const raw: string = tokenizer.decode(generated[0], { skip_special_tokens: false });
    postMessage({ type: "generated", id: msg.id, raw, ...parseOutput(raw), promptTokens, newTokens: generated.dims[1], ms: Math.round(performance.now() - started) });
  } catch (err) {
    postMessage({ type: "error", id: (msg as { id?: number }).id, error: String((err as Error)?.message ?? err) });
  }
};
