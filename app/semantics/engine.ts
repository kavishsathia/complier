// SWI-Prolog (WebAssembly) in a Web Worker, so a looping rule can be stopped
// by killing the worker instead of hanging the page.

const BASE = "https://cdn.jsdelivr.net/npm/swipl-wasm@8.2.3/dist/swipl/";

const WORKER = `
let swipl;
let stderr = "";
const ready = (async () => {
  importScripts("${BASE}swipl-web.js");
  swipl = await SWIPL({
    arguments: ["-q"],
    locateFile: (f) => "${BASE}" + f,
    print: () => {},
    printErr: (s) => { stderr += s + "\\n"; },
  });
  swipl.prolog.query("set_prolog_flag(stack_limit, 268435456)").once();
})();
onmessage = async ({ data: { id, files, goal, input } }) => {
  try {
    await ready;
    for (const [name, text] of Object.entries(files ?? {})) swipl.FS.writeFile("/" + name, text);
    stderr = "";
    const r = swipl.prolog.query(goal, input ?? {}).once();
    const json = r && r.J != null ? (typeof r.J === "string" ? r.J : r.J.v) : null;
    const error = r && r.error ? r.message : null;
    postMessage({ id, success: !!r && r.success !== false && !error, json, error, stderr });
  } catch (e) {
    postMessage({ id, success: false, json: null, error: String((e && e.message) || e), stderr });
  }
};
`;

export type Reply = {
  success: boolean;
  json: string | null;
  error: string | null;
  stderr: string;
};

type Pending = { resolve: (r: Reply) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };

export class Engine {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();

  private start(): Worker {
    const url = URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(data.id);
      p.resolve(data);
    };
    worker.onerror = (e) => this.fail(new Error(e.message || "the Prolog engine failed to start"));
    this.worker = worker;
    return worker;
  }

  stop() {
    this.fail(new Error("closed"));
  }

  // Drops the worker and everything loaded into it.
  private fail(e: Error) {
    this.worker?.terminate();
    this.worker = null;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(e);
    }
    this.pending.clear();
  }

  call(
    goal: string,
    { files, input, timeout = 15000 }: { files?: Record<string, string>; input?: Record<string, unknown>; timeout?: number } = {},
  ): Promise<Reply> {
    const worker = this.worker ?? this.start();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(new Error(`no answer after ${timeout / 1000}s, so the engine was restarted`)),
        timeout,
      );
      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, files, goal, input });
    });
  }

  // Runs a wb_* goal and unwraps its {ok, value | error} answer.
  async json<T>(goal: string, input?: Record<string, unknown>): Promise<T> {
    const r = await this.call(goal, { input });
    if (r.error) throw new Error(r.error);
    if (!r.json) throw new Error(`${goal} failed`);
    const reply = JSON.parse(r.json);
    if (!reply.ok) throw new Error(reply.error);
    return reply.value as T;
  }
}
