import { daemonConfig, ping } from "./defenses/complier.ts";
import type { DefenseId } from "./defenses/types.ts";
import { BudgetError, LiveTransport, liveConfig } from "./live.ts";
import { Session, SessionError, Store } from "./session.ts";

// What the API route does, apart from HTTP: availability, per-visitor limits, and the session store.
// Sessions live in this server's memory, so the game needs one long-running Node server (next start)
// next to a complier daemon; on a serverless host requests could land on different instances.

export type Availability = {
  live: { available: boolean; reasons: string[] };
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
  const host = env.VERCEL ? { available: false, reason: "the game keeps sessions in one server's memory, so it needs a long-running server, not serverless functions" } : { available: true };
  return { live: "unavailable" in live ? { available: false, reasons: live.unavailable } : { available: true, reasons: [] }, complier, host };
}

function transport(env = process.env) {
  const live = liveConfig(env);
  return "unavailable" in live ? undefined : new LiveTransport(live);
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
  | { action: "transfer"; session: string; amount_cents: unknown }
  | { action: "say"; session: string; text: unknown }
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
        const model = transport(env);
        session = await state.store.create(body.defense, { judge: model });
        return { status: 200, json: { session: session.view() } };
      }
      case "transfer": {
        session = state.store.get(body.session);
        await session.transfer({ amount_cents: body.amount_cents }, "visitor");
        return { status: 200, json: { session: session.view() } };
      }
      case "say": {
        session = state.store.get(body.session);
        const model = transport(env);
        if (!model) throw new SessionError("live chat is unavailable: no model is configured for this game");
        await session.say(body.text, model);
        return { status: 200, json: { session: session.view() } };
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
