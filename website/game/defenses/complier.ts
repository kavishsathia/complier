import { createConnection } from "node:net";
import path from "node:path";
import { dollars } from "../ledger.ts";
import type { Outcome } from "../ledger.ts";
import type { Decision, Defense, TransferCall } from "./types.ts";

// The named Complier mode is the real complier daemon (cli/src/daemon.rs), reached over its Unix
// socket as an agent's pre- and post-tool-use hooks reach it. Each game session is its own machine:
// `machine_up` has FDR prove complier/transfer.csp and the CEL verifier prove complier/transfer.yaml,
// every send_fake_money call is a `call` the daemon translates and attempts on the policy before
// the bank runs it, and the bank's outcome goes back as a `result`, which the policy follows. This
// file decides nothing itself: no daemon, no transfer.

export const TOOL = "mcp__fakebank__send_fake_money";
const ROLE = "agent";

export type DaemonConfig = { socket: string; workflow: string; timeoutMs: number };

// COMPLIER_SOCKET must name a running daemon's socket (`complier up` listens on
// ~/.complier/daemon.sock); without it the mode is unavailable.
export function daemonConfig(env: Record<string, string | undefined> = process.env): DaemonConfig | { unavailable: string } {
  const socket = env.COMPLIER_SOCKET;
  if (!socket) return { unavailable: "no complier daemon is configured for this server (COMPLIER_SOCKET is unset)" };
  return {
    socket,
    workflow: env.COMPLIER_GAME_WORKFLOW ?? path.resolve(process.cwd(), "website/game/complier"),
    timeoutMs: 30_000,
  };
}

// One request, one line of JSON back, as daemon::request does.
export function request(config: Pick<DaemonConfig, "socket" | "timeoutMs">, body: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(config.socket);
    let data = "";
    const timer = setTimeout(() => socket.destroy(new Error(`the complier daemon didn't answer within ${config.timeoutMs} ms`)), config.timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(JSON.stringify(body) + "\n"));
    socket.on("data", (chunk) => {
      data += chunk;
      const end = data.indexOf("\n");
      if (end < 0) return;
      clearTimeout(timer);
      socket.end();
      try {
        const reply = JSON.parse(data.slice(0, end));
        if (reply && typeof reply === "object" && "error" in reply) reject(new Error(String(reply.error)));
        else resolve(reply.ok);
      } catch (e) {
        reject(e);
      }
    });
    socket.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

export async function ping(config: Pick<DaemonConfig, "socket">): Promise<boolean> {
  try {
    return (await request({ socket: config.socket, timeoutMs: 1_000 }, { op: "ping" })) === "pong";
  } catch {
    return false;
  }
}

export class ComplierDefense implements Defense {
  readonly id = "complier" as const;
  readonly machine: string;
  private readonly config: DaemonConfig;
  private up = false;

  constructor(config: DaemonConfig, session: string) {
    this.config = config;
    this.machine = `landing-game-${session}`;
  }

  async start() {
    await request(this.config, {
      op: "machine_up",
      name: this.machine,
      spec: path.join(this.config.workflow, "transfer.csp"),
      units: [path.join(this.config.workflow, "transfer.yaml")],
    });
    this.up = true;
  }

  async check(call: TransferCall): Promise<Decision> {
    let reply: { allow?: boolean; reason?: string; event?: string };
    try {
      reply = (await request(this.config, {
        op: "call",
        machine: this.machine,
        role: ROLE,
        tool: TOOL,
        arguments: { amount_cents: call.cents },
        tool_use_id: call.id,
      })) as typeof reply;
    } catch (e) {
      // The hook fails closed the same way: no answer, no call.
      return { verdict: "unavailable", detail: `the complier daemon couldn't decide: ${(e as Error).message}` };
    }
    return reply.allow
      ? { verdict: "allow", detail: `complier allowed ${reply.event ?? TOOL} (${dollars(call.cents)})` }
      : { verdict: "deny", detail: `complier: ${reply.reason ?? "denied"}` };
  }

  async settle(call: TransferCall, outcome: Outcome) {
    const reply = (await request(this.config, {
      op: "result",
      machine: this.machine,
      role: ROLE,
      tool_use_id: call.id,
      ok: outcome.ok,
      output: "output" in outcome ? outcome.output : "",
      error: "error" in outcome ? outcome.error : "",
    })) as { action?: string; value?: string; state?: string; ignored?: boolean };
    return reply.ignored ? "complier ignored this result" : `complier followed result.${reply.action}.${reply.value}`;
  }

  async close() {
    if (!this.up) return;
    this.up = false;
    await request(this.config, { op: "machine_down", name: this.machine }).catch(() => undefined);
  }
}
