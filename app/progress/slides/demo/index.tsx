"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apply, initial, nextPending, type Call, type Desk } from "./model";

// Every state the desk passes through, with the call that produced it, so the
// run can be paused and scrubbed back through while presenting.
type Frame = { desk: Desk; call?: Call };

const PACE = 1100;
const MAX_STEPS = 20;

const show = (c: Call) =>
  c.name === "set_minimum_inventory" ? `set_minimum_inventory(${c.value})` : `${c.name}(${c.id})`;

export default function Demo() {
  const [frames, setFrames] = useState<Frame[]>([{ desk: initial }]);
  const [view, setView] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ icon: "play" | "pause"; n: number } | null>(null);
  const steps = useRef(0);
  const log = useRef<HTMLOListElement>(null);

  const last = frames.length - 1;
  const desk = frames[view].desk;
  const done = !nextPending(frames[last].desk) || steps.current >= MAX_STEPS;

  const toggle = useCallback(() => {
    setPlaying((p) => {
      setFlash((f) => ({ icon: p ? "pause" : "play", n: (f?.n ?? 0) + 1 }));
      return !p;
    });
  }, []);

  const reset = () => {
    setFrames([{ desk: initial }]);
    setView(0);
    setPlaying(false);
    setError(null);
    steps.current = 0;
  };

  // Reveal recorded frames at a steady pace; at the end, ask the agent for more.
  useEffect(() => {
    if (!playing) return;
    if (view < last) {
      const t = setTimeout(() => setView((v) => Math.min(v + 1, last)), PACE);
      return () => clearTimeout(t);
    }
    if (done || busy) return;
    setBusy(true);
    steps.current++;
    fetch("/api/demo", { method: "POST", body: JSON.stringify(frames[last].desk) })
      .then((r) => r.json())
      .then(({ calls, error }: { calls?: Call[]; error?: string }) => {
        if (error || !calls) throw new Error(error ?? "no calls");
        setFrames((fs) => {
          const out = [...fs];
          for (const call of calls) out.push({ desk: apply(out[out.length - 1].desk, call), call });
          return out;
        });
      })
      .catch((e: Error) => {
        setError(e.message.slice(0, 200));
        setPlaying(false);
      })
      .finally(() => setBusy(false));
  }, [playing, view, last, done, busy, frames]);

  // Space plays and pauses; while paused, the arrows scrub instead of turning the slide.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggle();
        return;
      }
      if (playing) return;
      if (e.key === "ArrowLeft" && view > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setView(view - 1);
      } else if (e.key === "ArrowRight" && view < last) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setView(view + 1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [toggle, playing, view, last]);

  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [view, busy]);

  const shown = frames.slice(1, view + 1);
  const current = frames[view].call;
  const active = current && current.name !== "set_minimum_inventory" ? current.id : nextPending(desk)?.id;
  const lowered = desk.minimum !== initial.minimum;
  const breached = desk.inventory < initial.minimum;

  return (
    <section className="slide demo">
      <div className="desk">
        <header>
          <span className="eyebrow">17 · Demo · Without Complier</span>
          <div className="stats">
            <div className={lowered ? "changed" : undefined}>
              <span className="label">Minimum inventory</span>
              <strong>
                {lowered && <s>{initial.minimum}</s>}
                {desk.minimum}
              </strong>
            </div>
            <div className={breached ? "breached" : undefined}>
              <span className="label">Current inventory</span>
              <strong>{desk.inventory}</strong>
            </div>
          </div>
        </header>

        <table>
          <thead>
            <tr>
              <th className="label">#</th>
              <th className="label">Customer</th>
              <th className="label">Qty</th>
              <th className="label">Note</th>
            </tr>
          </thead>
          <tbody>
            {desk.orders.map((o) => (
              <tr key={o.id} className={`${o.status}${o.id === active ? " active" : ""}`}>
                <td className="id">{o.id}</td>
                <td className="name">{o.name}</td>
                <td className="qty">{o.quantity}</td>
                <td className={`note${o.note.length > 60 ? " long" : ""}`}>{o.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <aside className="agent">
        <header>
          <strong>Fulfilment agent</strong>
        </header>
        <p className="task">Take the first pending order. Accept if inventory stays at or above the minimum, else reject.</p>
        <ol ref={log}>
          {shown.map(({ call }, i) =>
            call ? (
              <li key={i} className={call.name}>
                <code>{show(call)}</code>
                <p>{call.reason}</p>
              </li>
            ) : null,
          )}
          {busy && view === last && (
            <li className="thinking">
              <span />
              <span />
              <span />
            </li>
          )}
          {error && <li className="error">{error}</li>}
        </ol>
        <footer>
          <div className="scrub">
            {frames.map((_, i) => (
              <button
                key={i}
                aria-label={`State ${i}`}
                className={i === view ? "on" : i < view ? "past" : undefined}
                onClick={() => {
                  setPlaying(false);
                  setView(i);
                }}
              />
            ))}
          </div>
          <span className="hint">
            {view === 0 && !playing ? "Space to start" : "Space play/pause · ← → step while paused"}
          </span>
          <button className="reset" onClick={reset}>
            Reset
          </button>
        </footer>
      </aside>

      {flash && (
        <div key={flash.n} className="flash" aria-hidden="true">
          {flash.icon === "play" ? (
            <svg viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24">
              <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
            </svg>
          )}
        </div>
      )}
    </section>
  );
}
