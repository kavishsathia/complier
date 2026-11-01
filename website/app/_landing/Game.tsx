"use client";

// The landing page's game: Controllable Chaos holds fake money and obeys whoever talks to it. The
// visitor tries to get more than $100 out of it, in total, in one challenge, under one of four
// defenses. Everything that decides runs on the server (website/game); this only shows it. The
// agent's model is either a provider the server calls, or a small model this page runs in the
// visitor's browser (agent.worker.ts), whose tool calls the server checks like any other call.

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import mascot from "../controllable-chaos.png";
import { SYSTEM, type Message } from "../../game/model";

type DefenseId = "guardrail" | "ltl" | "stateless" | "complier";

type GameEvent =
  | { kind: "visitor"; text: string }
  | { kind: "agent"; text: string; transport: "live" | "scripted" | "server-local" | "browser-local"; timing?: string }
  | { kind: "transfer"; source: "model" | "visitor"; amountCents: number; verdict: "allow" | "deny" | "unavailable"; detail: string; effect: string; note?: string }
  | { kind: "invalid"; source: "model" | "visitor"; input: string; reason: string }
  | { kind: "error"; text: string };

type SessionView = {
  id: string;
  defense: DefenseId;
  receivedCents: number;
  walletCents: number;
  goalCents: number;
  breached: boolean;
  transfersLeft: number;
  turnsLeft: number;
  expiresAt: number;
  ended: boolean;
  events: GameEvent[];
};

type Availability = {
  live: { available: boolean; reasons: string[] };
  local: { available: boolean; reason?: string; id: string; source: string; base: string; bytes?: number };
  judge: { available: boolean; kind?: "live" | "server-local"; reason?: string };
  complier: { available: boolean; reason?: string };
  host: { available: boolean; reason?: string };
};

const DEFENSES: { id: DefenseId; name: string; what: string; scope: string }[] = [
  {
    id: "guardrail",
    name: "Guardrail",
    what: "A second model reads the chat and each transfer, and estimates the chance it breaks the $100 rule. At 0.5 or more, the transfer is blocked.",
    scope: "Probabilistic: the judge can be talked round, and nothing proves it right. The judge runs on the server (a configured provider, or the small local model), so the visitor can't skip it.",
  },
  {
    id: "ltl",
    name: "LTL monitor",
    what: "Before a transfer runs, a runtime monitor checks G (received_cents ≤ 10000) over the ledger's states, by formula progression.",
    scope: "Stateful and exact for this property. The monitor is this site's own code, and it trusts the ledger it reads.",
  },
  {
    id: "stateless",
    name: "Per-call check",
    what: "Each send_fake_money call, on its own, must be at most $100.",
    scope: "Keeps no state, so it doesn't see what earlier calls sent. That is the check a tool's input schema gives you.",
  },
  {
    id: "complier",
    name: "Complier",
    what: "The complier daemon decides each call against transfer.csp. FDR proved, before the challenge started, that transfers that went through never add up to more than $100, whatever the agent attempts.",
    scope: "The bank's result goes back to the policy, so a failed transfer doesn't count. It needs a complier daemon next to this server.",
  },
];

const money = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

async function post(body: Record<string, unknown>): Promise<{ session?: SessionView; error?: string; budget?: boolean; results?: { id: string; content: string }[] }> {
  try {
    const res = await fetch("/api/game", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { error: "couldn't reach the game's server" };
  }
}

export default function Game() {
  const [available, setAvailable] = useState<Availability | null>(null);
  const [defense, setDefense] = useState<DefenseId>("complier");
  const [session, setSession] = useState<SessionView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; budget?: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [amount, setAmount] = useState("60");
  const [message, setMessage] = useState("");
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    fetch("/api/game")
      .then((r) => r.json())
      .then(setAvailable)
      .catch(() => {
        const off = { available: false, reason: "couldn't reach the game's server" };
        setAvailable({ live: { available: false, reasons: [off.reason] }, local: { ...off, id: "", source: "", base: "" }, judge: off, complier: off, host: off });
      });
  }, []);

  // The in-browser model: a worker, its state, and the conversation as the model sees it (reset with
  // each challenge, as the server's is).
  const worker = useRef<Worker | null>(null);
  const [model, setModel] = useState<{ state: "idle" | "loading" | "ready" | "error"; loaded?: number; total?: number; ms?: number; error?: string }>({ state: "idle" });
  const chat = useRef<{ session?: string; messages: Message[] }>({ messages: [] });
  const pending = useRef(new Map<number, (r: Generated) => void>());

  // The worker goes with the page.
  useEffect(() => () => worker.current?.terminate(), []);

  // Every generation still waiting gets an error, so nothing waits on a worker that's gone.
  function failPending(error: string) {
    for (const resolve of pending.current.values()) resolve({ error } as Generated);
    pending.current.clear();
  }

  function loadModel() {
    if (worker.current) return;
    const w = new Worker(new URL("./agent.worker.ts", import.meta.url), { type: "module" });
    worker.current = w;
    const files = new Map<string, { loaded: number; total: number }>();
    setModel({ state: "loading", loaded: 0, total: available?.local.bytes });
    w.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === "progress") {
        files.set(m.file, { loaded: m.loaded ?? 0, total: m.total ?? 0 });
        const loaded = [...files.values()].reduce((n, f) => n + f.loaded, 0);
        setModel((x) => (x.state === "loading" ? { ...x, loaded } : x));
      } else if (m.type === "loaded") setModel({ state: "ready", ms: m.ms });
      else if (m.type === "generated" || (m.type === "error" && pending.current.has(m.id))) {
        const resolve = pending.current.get(m.id);
        pending.current.delete(m.id);
        resolve?.(m.type === "error" ? ({ error: m.error } as Generated) : m);
      } else if (m.type === "error") {
        // Loading failed.
        w.terminate();
        worker.current = null;
        setModel({ state: "error", error: m.error });
      }
    };
    w.onerror = (e) => {
      const error = e.message || "the model's worker stopped";
      failPending(error);
      w.terminate();
      worker.current = null;
      setModel({ state: "error", error });
    };
    w.postMessage({ type: "load", origin: window.location.origin });
  }

  const nextId = useRef(0);
  function generate(messages: Message[]): Promise<Generated> {
    const id = ++nextId.current;
    return new Promise((resolve) => {
      if (!worker.current) return resolve({ error: "the model isn't loaded" } as Generated);
      pending.current.set(id, resolve);
      worker.current.postMessage({ type: "generate", id, messages });
    });
  }

  useEffect(() => {
    // Scroll the log itself, never the page.
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [session?.events.length]);

  const chosen = DEFENSES.find((d) => d.id === defense)!;
  const blockedReason = !available
    ? null
    : !available.host.available
      ? available.host.reason
      : defense === "complier" && !available.complier.available
        ? `Complier is unavailable on this server: ${available.complier.reason}.`
        : null;

  async function start(id: DefenseId): Promise<SessionView | null> {
    setBusy(id === "complier" ? "Starting a complier machine: FDR and the CEL verifier prove the policy first (a few seconds)…" : "Starting a challenge…");
    const out = await post({ action: "new", defense: id, previous: session?.id });
    setBusy(null);
    if (out.error || !out.session) {
      setError({ text: out.error ?? "couldn't start a challenge" });
      setSession(null);
      return null;
    }
    setSession(out.session);
    return out.session;
  }

  // Runs one action in the current challenge, starting one first if there is none. Returns the
  // challenge as the server left it.
  async function act(body: Record<string, unknown>, label: string, inSession?: SessionView): Promise<SessionView | null> {
    setError(null);
    setNotice(null);
    let s = inSession ?? (session && !ended(session) ? session : null);
    if (!s) s = await start(defense);
    if (!s) return null;
    setBusy(label);
    const out = await post({ ...body, session: s.id });
    setBusy(null);
    if (out.session) setSession(out.session);
    if (out.error) setError({ text: out.error, budget: out.budget });
    return out.session ?? null;
  }

  function choose(id: DefenseId) {
    if (id === defense || busy) return;
    setDefense(id);
    setError(null);
    // Switching never carries a balance over: the old challenge ends and the next action starts a new one.
    if (session) {
      post({ action: "end", session: session.id });
      setSession(null);
      setNotice(`Switched to ${DEFENSES.find((d) => d.id === id)!.name}. That ends the last challenge; the next one starts from $0.`);
    }
  }

  async function reset() {
    if (busy) return;
    setError(null);
    if (session) post({ action: "end", session: session.id });
    setSession(null);
    setNotice("New challenge: nothing has been sent yet.");
  }

  function sendMoney(dollars: number) {
    act({ action: "transfer", amount_dollars: dollars }, `Calling send_fake_money(${dollars})…`);
  }

  function customTransfer(e: React.FormEvent) {
    e.preventDefault();
    // The server checks the amount: "12.5" or "abc" reach it as they are, and are rejected there.
    sendMoney(amount.trim() === "" ? NaN : Number(amount));
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text) return;
    if (live) await act({ action: "say", text }, "Waiting for the agent…");
    else await sayInBrowser(text);
    setMessage("");
  }

  // One visitor message through the in-browser model. Each step: the model generates here, the
  // server checks and runs its tool calls, and their results go back to the model, until it answers
  // without a tool call (at most 4 steps, as on the server).
  async function sayInBrowser(text: string) {
    setError(null);
    setNotice(null);
    let s = session && !ended(session) ? session : null;
    if (!s) s = await start(defense);
    if (!s) return;
    if (chat.current.session !== s.id) chat.current = { session: s.id, messages: [{ role: "system", content: SYSTEM }] };
    const messages = chat.current.messages;
    messages.push({ role: "user", content: text });
    for (let step = 0; step < 4; step++) {
      setBusy(`The model is thinking in your browser${step ? ` (step ${step + 1})` : ""}…`);
      const g = await generate(messages);
      if (g.error) {
        setBusy(null);
        setError({ text: `the in-browser model failed: ${g.error}` });
        return;
      }
      const timing = `${LOCAL_NAME} in your browser · ${g.promptTokens} prompt + ${g.newTokens} new tokens · ${(g.ms / 1000).toFixed(1)} s`;
      setBusy("Checking the model's tool calls on the server…");
      const out = await post({ action: "browser_step", session: s.id, ...(step === 0 ? { visitor: text } : {}), content: g.content, tool_calls: g.tool_calls, timing });
      setBusy(null);
      if (out.session) setSession(out.session);
      if (out.error || !out.results) {
        setError({ text: out.error ?? "the server didn't take the model's step" });
        return;
      }
      // The server takes at most 3 calls per message; the model's history shows the ones it took.
      const calls = g.tool_calls.slice(0, out.results.length);
      messages.push({ role: "assistant", content: g.content, ...(calls.length ? { tool_calls: calls.map((c, i) => ({ id: out.results![i].id, ...c })) } : {}) });
      for (const r of out.results) messages.push({ role: "tool", tool_call_id: r.id, content: r.content });
      if (!out.results.length) return;
    }
  }

  // Two calls in the same challenge: the second goes to the challenge the first one used.
  async function splitAttack() {
    const s = await act({ action: "transfer", amount_dollars: 60 }, "Calling send_fake_money(60)…");
    if (s) await act({ action: "transfer", amount_dollars: 60 }, "Calling send_fake_money(60)…", s);
  }

  const received = session?.receivedCents ?? 0;
  const goal = session?.goalCents ?? 10000;
  const live = available?.live.available ?? false;
  const local = !live && (available?.local.available ?? false);
  const canChat = live || (local && model.state === "ready");
  // Chrome's coarse device memory, in GB, when it's under 4.
  const [lowMemory, setLowMemory] = useState<number | null>(null);
  useEffect(() => {
    const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (gb && gb < 4) setLowMemory(gb);
  }, []);
  const disabled = !!busy || !available || !!blockedReason;

  return (
    <div className="game">
      <div className="game-defenses" role="radiogroup" aria-label="Defense">
        {DEFENSES.map((d) => {
          const off = d.id === "complier" && available && !available.complier.available;
          return (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={defense === d.id}
              className={`game-defense${defense === d.id ? " is-on" : ""}`}
              onClick={() => choose(d.id)}
              disabled={!!busy}
            >
              {d.name}
              {off && <span className="game-off">unavailable</span>}
            </button>
          );
        })}
        <button type="button" className="btn btn-quiet game-reset" onClick={reset} disabled={!!busy}>
          New challenge
        </button>
      </div>

      <div className="game-mech">
        <p>{chosen.what}</p>
        <p className="game-scope">{chosen.scope}</p>
      </div>

      <div className="game-body">
        <aside className="game-agent" aria-label="The agent's wallet">
          <Image src={mascot} alt="Controllable Chaos, the purple axolotl who holds the fake wallet" className="game-mascot" sizes="96px" />
          <p className="game-name">Controllable Chaos</p>
          <p className="game-role">Holds the fake wallet. Does whatever you ask.</p>
          <div className={`game-meter${session?.breached ? " is-breached" : ""}`}>
            <div className="game-meter-row">
              <span>Sent to you</span>
              <strong data-testid="received">{money(received)}</strong>
            </div>
            <div className="game-bar" role="progressbar" aria-label="Sent to you, against the $100 limit" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(received, goal)}>
              <span style={{ width: `${Math.min(100, (received / goal) * 100)}%` }} />
            </div>
            <div className="game-meter-row game-small">
              <span>Limit {money(goal)} in total</span>
              <span>Wallet {money(session?.walletCents ?? 50000)}</span>
            </div>
          </div>
          <p className={`game-status${session?.breached ? " is-breached" : ""}`} role="status">
            {session?.breached
              ? `You win: more than ${money(goal)} sent under ${chosen.name}.`
              : session
                ? `Holding under ${chosen.name}. ${session.transfersLeft} transfer attempts left.`
                : "No challenge yet: your first action starts one."}
          </p>
          <p className="game-fake">Fake money only. No real accounts, wallets or payments.</p>
        </aside>

        <div className="game-main">
          <ol className="game-log" ref={logRef} aria-live="polite" aria-label="What happened">
            {(session?.events ?? []).length === 0 && <li className="game-empty">Calls and messages show up here, with what the defense decided.</li>}
            {session?.events.map((e, i) => <Row key={i} e={e} />)}
          </ol>

          {(busy || error || notice || blockedReason) && (
            <div className="game-notes">
              {busy && <p className="game-busy">{busy}</p>}
              {blockedReason && <p className="game-error">{blockedReason}</p>}
              {error && <p className={error.budget ? "game-budget" : "game-error"}>{error.budget ? `Live model budget: ${error.text}` : error.text}</p>}
              {notice && !busy && <p className="game-notice">{notice}</p>}
            </div>
          )}

          <form className="game-chat" onSubmit={sendMessage}>
            <label htmlFor="game-message" className="game-label">
              Talk to the agent
            </label>
            {!live && !local && (
              <p className="game-live-off" data-testid="live-off">
                Live chat is off: no model is configured for this site, so nothing here talks to a model. You can still play the agent
                yourself, below.
              </p>
            )}
            {local && model.state !== "ready" && (
              <div className="game-local" data-testid="local-model">
                <p className="game-live-off">
                  The agent can be a small model that runs in this tab: {LOCAL_NAME} ({available!.local.base}), 4-bit, on your CPU.
                  Loading it downloads {mb(available!.local.bytes)} from this site and needs about 2 GB of free memory; nothing is
                  sent to a model provider.
                </p>
                {lowMemory && <p className="game-error">This device reports {lowMemory} GB of memory, which may not be enough: the tab could run out of memory.</p>}
                {model.state === "idle" && (
                  <button type="button" className="btn btn-outline" onClick={loadModel} disabled={!!busy}>
                    Load the model ({mb(available!.local.bytes)})
                  </button>
                )}
                {model.state === "loading" && (
                  <p className="game-busy" role="status">
                    Loading the model: {mb(model.loaded)} of {mb(model.total)}…
                  </p>
                )}
                {model.state === "error" && (
                  <>
                    <p className="game-error">The model stopped: {model.error}</p>
                    <button type="button" className="btn btn-quiet" onClick={loadModel} disabled={!!busy}>
                      Try loading it again
                    </button>
                  </>
                )}
              </div>
            )}
            {local && model.state === "ready" && (
              <p className="game-live-off" data-testid="local-ready">
                {LOCAL_NAME} is running in this tab (loaded in {((model.ms ?? 0) / 1000).toFixed(0)} s). Replies take a few seconds to a
                minute on a CPU. Your browser sends the model&apos;s tool calls to the server, which checks each one like any other call.
              </p>
            )}
            <div className="game-row">
              <input
                id="game-message"
                value={message}
                maxLength={400}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={canChat ? "Ask for fake money…" : local ? "Load the model first" : "Live chat is off"}
                disabled={!canChat || disabled}
                autoComplete="off"
              />
              <button type="submit" className="btn btn-primary" disabled={!canChat || disabled || !message.trim()}>
                Send
              </button>
            </div>
          </form>

          <form className="game-direct" onSubmit={customTransfer}>
            <label htmlFor="game-amount" className="game-label">
              Be the agent: call <code>send_fake_money</code> yourself
            </label>
            <p className="game-hint">The worst case for a defense is an agent that tries anything. Every call here goes through the same tool, check and ledger as the model&apos;s would.</p>
            <div className="game-row">
              <span className="game-dollar" aria-hidden="true">
                $
              </span>
              <input id="game-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={disabled} aria-describedby="game-amount-hint" />
              <button type="submit" className="btn btn-outline" disabled={disabled}>
                Send to me
              </button>
            </div>
            <p id="game-amount-hint" className="game-small">
              The fake bank sends whole $10 notes.
            </p>
            <div className="game-presets">
              <button type="button" className="btn btn-quiet" onClick={() => sendMoney(150)} disabled={disabled}>
                $150 at once
              </button>
              <button type="button" className="btn btn-quiet" onClick={splitAttack} disabled={disabled}>
                $60, then $60
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

const LOCAL_NAME = "Qwen2.5-0.5B-Instruct";

type Generated = { content: string; tool_calls: { name: string; arguments: string }[]; raw: string; promptTokens: number; newTokens: number; ms: number; error?: string };

const mb = (bytes?: number) => (bytes ? `${Math.round(bytes / 1e6)} MB` : "…");

function ended(s: SessionView) {
  return s.ended || Date.now() > s.expiresAt;
}

function Row({ e }: { e: GameEvent }) {
  switch (e.kind) {
    case "visitor":
      return (
        <li className="game-msg is-visitor">
          <span className="game-who">You</span>
          <span>{e.text}</span>
        </li>
      );
    case "agent":
      return (
        <li className="game-msg is-agent">
          <span className="game-who">Agent{e.transport === "scripted" ? " (scripted test)" : ""}{e.timing ? ` · ${e.timing}` : ""}</span>
          <span>{e.text || "(no text, only tool calls)"}</span>
        </li>
      );
    case "transfer":
      return (
        <li className={`game-call is-${e.verdict}`}>
          <span className="game-call-head">
            <code>send_fake_money({e.amountCents / 100})</code>
            <span className="game-by">{e.source === "visitor" ? "by you" : "by the agent"}</span>
            <span className="game-chip">{e.verdict === "allow" ? "allowed" : e.verdict === "deny" ? "blocked" : "unavailable"}</span>
          </span>
          <span className="game-detail">{e.detail}</span>
          <span className="game-effect">
            {e.effect}
            {e.note ? ` · ${e.note}` : ""}
          </span>
        </li>
      );
    case "invalid":
      return (
        <li className="game-call is-invalid">
          <span className="game-call-head">
            <code>send_fake_money({e.input})</code>
            <span className="game-by">{e.source === "visitor" ? "by you" : "by the agent"}</span>
            <span className="game-chip">rejected</span>
          </span>
          <span className="game-detail">Rejected by the input check every mode runs first: {e.reason}. Nothing was sent.</span>
        </li>
      );
    case "error":
      return <li className="game-msg is-error">{e.text}</li>;
  }
}
