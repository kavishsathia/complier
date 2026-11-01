// The worker that runs the small model (agent.worker.ts), as the game's Transport: the agent and the
// guardrail's judge both call complete(). Loading happens only when the visitor asks for it.
import { JudgeUnavailable } from "../../game/defenses/guardrail";
import type { Completion, Message, Transport } from "../../game/model";
import { LOCAL_MODEL } from "../../game/qwen";

export type ModelState = { state: "idle" | "loading" | "ready" | "error"; loaded?: number; ms?: number; error?: string };

// What the game needs of its model: a Transport it can load and stop.
export type AgentModel = Transport & { state: ModelState; load(): void; terminate(): void };

// The game's model: the small model in a worker. Browser tests (website/game/browser/check.mjs) run
// where the 793 MB model can't load, so they define window.__complierGameTestModel before the page
// starts, and its transport (kind "scripted", labelled as a scripted test wherever it shows) stands
// in. A visitor's page never has it.
export function makeAgentModel(onState: (s: ModelState) => void): AgentModel {
  const test = (globalThis as { __complierGameTestModel?: (onState: (s: ModelState) => void) => AgentModel }).__complierGameTestModel;
  return typeof test === "function" ? test(onState) : new BrowserModel(onState);
}

type Reply = { type: "generated"; content: string; tool_calls: { name: string; arguments: string }[]; promptTokens: number; newTokens: number; ms: number } | { type: "error"; error: string };

export class BrowserModel implements Transport {
  readonly kind = "browser-local" as const;
  private worker: Worker | null = null;
  private readonly pending = new Map<number, (r: Reply) => void>();
  private nextId = 0;
  state: ModelState = { state: "idle" };
  private readonly onState: (s: ModelState) => void;

  constructor(onState: (s: ModelState) => void) {
    this.onState = onState;
  }

  private set(s: ModelState) {
    this.state = s;
    this.onState(s);
  }

  load() {
    if (this.worker) return;
    const w = new Worker(new URL("./agent.worker.ts", import.meta.url), { type: "module" });
    this.worker = w;
    const files = new Map<string, number>();
    this.set({ state: "loading", loaded: 0 });
    w.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "progress") {
        files.set(m.file, m.loaded ?? 0);
        if (this.state.state === "loading") this.set({ state: "loading", loaded: [...files.values()].reduce((a, b) => a + b, 0) });
      } else if (m.type === "loaded") this.set({ state: "ready", ms: m.ms });
      else if (m.id !== undefined && this.pending.has(m.id)) {
        const resolve = this.pending.get(m.id)!;
        this.pending.delete(m.id);
        resolve(m);
      } else if (m.type === "error") this.fail(m.error);
    };
    w.onerror = (e) => this.fail(e.message || "the model's worker stopped");
    w.postMessage({ type: "load" });
  }

  // The worker is gone (it failed to load, or crashed): whatever waited on it gets an error, and it
  // can be loaded again.
  private fail(error: string) {
    for (const resolve of this.pending.values()) resolve({ type: "error", error });
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    this.set({ state: "error", error });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }

  async complete(messages: Message[], tools: unknown[]): Promise<Completion> {
    if (!this.worker || this.state.state !== "ready") throw new JudgeUnavailable("load the model first: it is the agent and the guardrail's judge");
    const id = ++this.nextId;
    const reply = await new Promise<Reply>((resolve) => {
      this.pending.set(id, resolve);
      this.worker!.postMessage({ type: "generate", id, messages, tools: tools.length > 0 });
    });
    if (reply.type === "error") throw new Error(`the in-browser model failed: ${reply.error}`);
    return {
      content: reply.content,
      tool_calls: reply.tool_calls.map((c, i) => ({ id: `m${id}-${i}`, ...c })),
      timing: `${LOCAL_MODEL.name} in your browser · ${reply.promptTokens} prompt + ${reply.newTokens} new tokens · ${(reply.ms / 1000).toFixed(1)} s`,
    };
  }
}
