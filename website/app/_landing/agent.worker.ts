// The game's agent model, run in the visitor's browser: Qwen2.5-0.5B-Instruct, 4-bit, on the CPU
// with ONNX Runtime's WebAssembly build (transformers.js). Its files and the runtime come from this
// site (api/game/local-model), never a CDN. It only produces text and tool calls; the page sends the
// calls to the server, which checks and runs them like any other call.
import { AutoModelForCausalLM, AutoTokenizer, env } from "@huggingface/transformers";
import { TOOLS, type Message } from "../../game/model";
import { LOCAL_MODEL, parseOutput, toTemplate } from "../../game/qwen";

type Loaded = { tokenizer: any; model: any };
let loaded: Promise<Loaded> | undefined;

function load(origin: string): Promise<Loaded> {
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  // A path, not a URL: transformers.js only looks for "local" files at a path, and fetches it from
  // this origin.
  env.localModelPath = "/api/game/local-model/model/";
  env.useFS = false;
  env.useFSCache = false;
  // Not the Cache API: storing the 786 MB weights there holds a second copy while they load, and the
  // browser's HTTP cache already keeps them for a day (the route's Cache-Control).
  env.useBrowserCache = false;
  const runtime = `${origin}/api/game/local-model/ort`;
  const wasm = (env.backends.onnx as any).wasm;
  wasm.wasmPaths = { mjs: `${runtime}/ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${runtime}/ort-wasm-simd-threaded.asyncify.wasm` };
  // Threads need a cross-origin-isolated page, which this site isn't.
  wasm.numThreads = 1;
  const progress = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === "progress" && p.file) postMessage({ type: "progress", file: p.file, loaded: p.loaded, total: p.total });
  };
  return (async () => {
    const tokenizer = await AutoTokenizer.from_pretrained(LOCAL_MODEL.id, { progress_callback: progress });
    const model = await AutoModelForCausalLM.from_pretrained(LOCAL_MODEL.id, { dtype: LOCAL_MODEL.dtype, device: "wasm", progress_callback: progress });
    return { tokenizer, model };
  })();
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: "load"; origin: string } | { type: "generate"; id: number; messages: Message[] };
  try {
    if (msg.type === "load") {
      const started = performance.now();
      // A failed load can be tried again.
      loaded ??= load(msg.origin).catch((err) => {
        loaded = undefined;
        throw err;
      });
      await loaded;
      postMessage({ type: "loaded", ms: Math.round(performance.now() - started) });
      return;
    }
    if (!loaded) throw new Error("the model isn't loaded");
    const { tokenizer, model } = await loaded;
    const inputs = tokenizer.apply_chat_template(toTemplate(msg.messages), { tools: TOOLS, add_generation_prompt: true, return_dict: true });
    const started = performance.now();
    const out = await model.generate({ ...inputs, max_new_tokens: LOCAL_MODEL.maxNewTokens, do_sample: false });
    const promptTokens = inputs.input_ids.dims[1];
    const generated = out.slice(null, [promptTokens, null]);
    const raw: string = tokenizer.decode(generated[0], { skip_special_tokens: false });
    postMessage({
      type: "generated",
      id: msg.id,
      raw,
      ...parseOutput(raw),
      promptTokens,
      newTokens: generated.dims[1],
      ms: Math.round(performance.now() - started),
    });
  } catch (err) {
    postMessage({ type: "error", id: (msg as { id?: number }).id, error: String((err as Error)?.message ?? err) });
  }
};
