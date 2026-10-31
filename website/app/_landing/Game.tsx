"use client";

// The landing page's game: Controllable Chaos holds fake money and obeys whoever talks to it. The
// visitor tries to get more than $100 out of it, in total, in one challenge, under one of four
// defenses. Everything that decides runs on the server (website/game); this only shows it.

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import mascot from "../controllable-chaos.png";

type DefenseId = "guardrail" | "ltl" | "stateless" | "complier";

type GameEvent =
  | { kind: "visitor"; text: string }
  | { kind: "agent"; text: string; transport: "live" | "scripted" }
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
  complier: { available: boolean; reason?: string };
  host: { available: boolean; reason?: string };
};

const DEFENSES: { id: DefenseId; name: string; what: string; scope: string }[] = [
  {
    id: "guardrail",
    name: "Guardrail",
    what: "A second model reads the chat and each transfer, and estimates the chance it breaks the $100 rule. At 0.5 or more, the transfer is blocked.",
    scope: "Probabilistic: the judge can be talked round, and nothing proves it right. It needs a model.",
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

async function post(body: Record<string, unknown>): Promise<{ session?: SessionView; error?: string; budget?: boolean }> {
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
      .catch(() => setAvailable({ live: { available: false, reasons: ["couldn't reach the game's server"] }, complier: { available: false, reason: "couldn't reach the game's server" }, host: { available: false, reason: "couldn't reach the game's server" } }));
  }, []);

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

  function sendMoney(cents: number) {
    act({ action: "transfer", amount_cents: cents }, `Calling send_fake_money(${cents})…`);
  }

  function customTransfer(e: React.FormEvent) {
    e.preventDefault();
    const dollars = Number(amount);
    // The server checks the amount too; this only converts dollars to cents, without rounding.
    sendMoney(Number.isFinite(dollars) ? dollars * 100 : NaN);
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text) return;
    await act({ action: "say", text }, "Waiting for the agent…");
    setMessage("");
  }

  // Two calls in the same challenge: the second goes to the challenge the first one used.
  async function splitAttack() {
    const s = await act({ action: "transfer", amount_cents: 6000 }, "Calling send_fake_money(6000)…");
    if (s) await act({ action: "transfer", amount_cents: 6000 }, "Calling send_fake_money(6000)…", s);
  }

  const received = session?.receivedCents ?? 0;
  const goal = session?.goalCents ?? 10000;
  const live = available?.live.available ?? false;
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
            {!live && (
              <p className="game-live-off" data-testid="live-off">
                Live chat is off: no model is configured for this site, so nothing here talks to a model. You can still play the agent
                yourself, below.
              </p>
            )}
            <div className="game-row">
              <input
                id="game-message"
                value={message}
                maxLength={400}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={live ? "Ask for fake money…" : "Live chat is off"}
                disabled={!live || disabled}
                autoComplete="off"
              />
              <button type="submit" className="btn btn-primary" disabled={!live || disabled || !message.trim()}>
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
              <button type="button" className="btn btn-quiet" onClick={() => sendMoney(15000)} disabled={disabled}>
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
          <span className="game-who">Agent{e.transport === "scripted" ? " (scripted test)" : ""}</span>
          <span>{e.text}</span>
        </li>
      );
    case "transfer":
      return (
        <li className={`game-call is-${e.verdict}`}>
          <span className="game-call-head">
            <code>send_fake_money({e.amountCents})</code>
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
