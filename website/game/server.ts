import { daemonConfig, ping } from "./defenses/complier.ts";
import type { DefenseId } from "./defenses/types.ts";
import { BudgetError, LiveTransport, liveConfig } from "./live.ts";
import { LocalTransport, localModelBytes, localModelDir } from "./local.ts";
import { LOCAL_MODEL } from "./qwen.ts";
import { Session, SessionError, Store } from "./session.ts";

// What the API route does, apart from HTTP: availability, per-visitor limits, and the session store.
// Sessions live in this server's memory, so the game needs one long-running Node server (next start)
// next to a complier daemon; on a serverless host requests could land on different instances.

export type Availability = {
  live: { available: boolean; reasons: string[] };
  // The small model the visitor's browser can download and run as the agent; the guardrail's judge
  // runs the same model on this server.
  local: { available: boolean; reason?: string; id: string; source: string; base: string; bytes?: number };
  judge: { available: boolean; kind?: "live" | "server-local"; reason?: string };
  complier: { available: boolean; reason?: string };
  host: { available: boolean; reason?: string };
};

const g = globalThis as unknown as { __complierGame?: { store: Store; created: Map<string, number[]> } };
const state = (g.__complierGame ??= { store: new Store(), created: new Map() });

export async function availability(env = process.env): Promise<Availability> {
  const live = liveConfig(env);
  const daemon = daemonConfig(env);
  let complier: Availability["complier"];
  if ("unavailable" in daemon) complier = { available: false, reason: daemon.unavailable };
  else if (!(await ping(daemon))) complier = { available: false, reason: "no complier daemon answers on this server" };
  else complier = { available: true };
  const dir = localModelDir(env);
  const local: Availability["local"] =
    typeof dir === "string"
      ? { available: true, id: LOCAL_MODEL.id, source: LOCAL_MODEL.source, base: LOCAL_MODEL.base, bytes: localModelBytes(dir) }
      : { available: false, reason: dir.unavailable, id: LOCAL_MODEL.id, source: LOCAL_MODEL.source, base: LOCAL_MODEL.base };
  const judge: Availability["judge"] = !("unavailable" in live)
    ? { available: true, kind: "live" }
    : typeof dir === "string"
      ? { available: true, kind: "server-local" }
      : { available: false, reason: "no model is configured for the guardrail's judge" };
  const host = env.VERCEL ? { available: false, reason: "the game keeps sessions in one server's memory, so it needs a long-running server, not serverless functions" } : { available: true };
  return { live: "unavailable" in live ? { available: false, reasons: live.unavailable } : { available: true, reasons: [] }, local, judge, complier, host };
}

function transport(env = process.env) {
  const live = liveConfig(env);
  return "unavailable" in live ? undefined : new LiveTransport(live);
}

// The guardrail's judge: the configured provider if there is one, else the local model on this server.
function judge(env = process.env) {
  const live = transport(env);
  if (live) return live;
  const dir = localModelDir(env);
  return typeof dir === "string" ? new LocalTransport(dir) : undefined;
}

// At most 12 new challenges per visitor address in 10 minutes.
function admitVisitor(ip: string, now = Date.now()) {
  const recent = (state.created.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  if (recent.length >= 12) throw new SessionError("too many new challenges from here; wait a few minutes");
  recent.push(now);
  state.created.set(ip, recent);
  if (state.created.size > 10_000) state.created.clear();
}

export type Action =
  | { action: "new"; defense: DefenseId; previous?: string }
  | { action: "transfer"; session: string; amount_dollars: unknown }
  | { action: "say"; session: string; text: unknown }
  | { action: "browser_step"; session: string; visitor?: unknown; content?: unknown; tool_calls?: unknown; timing?: unknown }
  | { action: "end"; session: string };

export async function handle(body: Action, ip: string): Promise<{ status: number; json: unknown }> {
  const env = process.env;
  if (env.VERCEL) return { status: 503, json: { error: (await availability(env)).host.reason } };
  let session: Session | undefined;
  try {
    switch (body.action) {
      case "new": {
        // A new challenge always ends the previous one, so nothing carries over.
        if (body.previous) await state.store.end(body.previous).catch(() => undefined);
        admitVisitor(ip);
        session = await state.store.create(body.defense, { judge: judge(env) });
        return { status: 200, json: { session: session.view() } };
      }
      case "transfer": {
        session = state.store.get(body.session);
        await session.transfer({ amount_dollars: body.amount_dollars }, "visitor");
        return { status: 200, json: { session: session.view() } };
      }
      case "say": {
        session = state.store.get(body.session);
        const model = transport(env);
        if (!model) throw new SessionError("live chat is unavailable: no model is configured for this game");
        await session.say(body.text, model);
        return { status: 200, json: { session: session.view() } };
      }
      case "browser_step": {
        session = state.store.get(body.session);
        if (typeof localModelDir(env) !== "string") throw new SessionError("the in-browser model isn't offered on this server");
        const results = await session.browserStep(body);
        return { status: 200, json: { session: session.view(), results } };
      }
      case "end": {
        await state.store.end(body.session);
        return { status: 200, json: { ended: true } };
      }
      default:
        return { status: 400, json: { error: "unknown action" } };
    }
  } catch (e) {
    const known = e instanceof SessionError || e instanceof BudgetError;
    const message = known ? e.message : "the game hit an error on the server";
    if (!known) console.error("game:", e);
    return { status: known ? 400 : 500, json: { error: message, budget: e instanceof BudgetError, session: session?.view() } };
  }
}
