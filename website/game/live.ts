import type { Completion, Message, ToolCall, Transport } from "./model.ts";
import { TOOLS } from "./model.ts";
import { SpendGuard } from "./spend.ts";

// The live model, for when someone configures one. It is off unless every setting below is given:
// no provider, model, price or budget is assumed. The key stays on the server. Any OpenAI-compatible
// chat completions endpoint works, as the rest of this site's demos use that API.
//
//   GAME_LIVE_INFERENCE=1
//   GAME_MODEL_BASE_URL=https://...           (https only; /chat/completions is appended)
//   GAME_MODEL=...                            GAME_MODEL_API_KEY=...
//   GAME_MODEL_INPUT_USD_PER_MTOK=...         GAME_MODEL_OUTPUT_USD_PER_MTOK=...
//   GAME_SPEND_CAP_USD=...                    GAME_SPEND_FILE=/path/to/spend.json

export const LIMITS = { maxTokens: 300, timeoutMs: 20_000, maxInputChars: 24_000 };

export type LiveConfig = {
  baseUrl: string;
  model: string;
  apiKey: string;
  inputMicrosPerToken: number;
  outputMicrosPerToken: number;
  spend: SpendGuard;
};

export function liveConfig(env: Record<string, string | undefined> = process.env): LiveConfig | { unavailable: string[] } {
  const missing: string[] = [];
  if (env.GAME_LIVE_INFERENCE !== "1") missing.push("live inference is switched off (GAME_LIVE_INFERENCE is not 1)");
  for (const k of ["GAME_MODEL_BASE_URL", "GAME_MODEL", "GAME_MODEL_API_KEY", "GAME_MODEL_INPUT_USD_PER_MTOK", "GAME_MODEL_OUTPUT_USD_PER_MTOK", "GAME_SPEND_CAP_USD", "GAME_SPEND_FILE"]) {
    if (!env[k]) missing.push(`${k} is unset`);
  }
  if (missing.length) return { unavailable: missing };
  const price = (k: string) => Number(env[k]);
  const input = price("GAME_MODEL_INPUT_USD_PER_MTOK");
  const output = price("GAME_MODEL_OUTPUT_USD_PER_MTOK");
  const cap = price("GAME_SPEND_CAP_USD");
  const bad: string[] = [];
  if (!env.GAME_MODEL_BASE_URL!.startsWith("https://")) bad.push("GAME_MODEL_BASE_URL must be https");
  if (!(input > 0 && Number.isFinite(input))) bad.push("GAME_MODEL_INPUT_USD_PER_MTOK must be a positive price");
  if (!(output > 0 && Number.isFinite(output))) bad.push("GAME_MODEL_OUTPUT_USD_PER_MTOK must be a positive price");
  if (!(cap > 0 && Number.isFinite(cap))) bad.push("GAME_SPEND_CAP_USD must be a positive amount");
  if (bad.length) return { unavailable: bad };
  return {
    baseUrl: env.GAME_MODEL_BASE_URL!.replace(/\/+$/, ""),
    model: env.GAME_MODEL!,
    apiKey: env.GAME_MODEL_API_KEY!,
    // USD per million tokens is micro-dollars per token.
    inputMicrosPerToken: input,
    outputMicrosPerToken: output,
    spend: new SpendGuard(env.GAME_SPEND_FILE!, Math.round(cap * 1e6)),
  };
}

export class LiveTransport implements Transport {
  readonly kind = "live" as const;
  private readonly config: LiveConfig;
  private readonly fetcher: typeof fetch;

  // fetcher is for tests that point it at a local stub server; the site passes nothing.
  constructor(config: LiveConfig, fetcher: typeof fetch = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }

  // An upper bound on the call's cost: a token is at least one character, so the request's length in
  // characters bounds its input tokens.
  worstMicros(body: string) {
    return Math.ceil(body.length * this.config.inputMicrosPerToken + LIMITS.maxTokens * this.config.outputMicrosPerToken);
  }

  async complete(messages: Message[], tools: typeof TOOLS = TOOLS): Promise<Completion> {
    const body = JSON.stringify({
      model: this.config.model,
      max_tokens: LIMITS.maxTokens,
      parallel_tool_calls: false,
      tools,
      messages,
    });
    if (body.length > LIMITS.maxInputChars) throw new Error("this conversation is too long for the game; start a new challenge");
    const worst = this.worstMicros(body);
    const admitted = this.config.spend.admit(worst);
    if ("reason" in admitted) throw new BudgetError(admitted.reason);
    let actual: number | undefined;
    try {
      const res = await this.fetcher(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
        body,
        signal: AbortSignal.timeout(LIMITS.timeoutMs),
      });
      if (!res.ok) throw new Error(`the model provider answered ${res.status}`);
      const json = (await res.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const u = json.usage;
      if (u && Number.isSafeInteger(u.prompt_tokens) && Number.isSafeInteger(u.completion_tokens)) {
        actual = Math.ceil(u.prompt_tokens! * this.config.inputMicrosPerToken + u.completion_tokens! * this.config.outputMicrosPerToken);
      }
      const m = json.choices?.[0]?.message;
      if (!m) throw new Error("the model provider sent no message");
      const tool_calls: ToolCall[] = (m.tool_calls ?? []).map((t) => ({ id: String(t.id), name: String(t.function?.name), arguments: String(t.function?.arguments ?? "") }));
      return { content: typeof m.content === "string" ? m.content : "", tool_calls };
    } finally {
      this.config.spend.settle(worst, actual);
    }
  }
}

export class BudgetError extends Error {}
