"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Proc } from "../../../stepper/csp/syntax.ts";
import { parse, SPEC } from "./gatekeeper";
import { apply, initial, nextPending, type Call, type Desk, type Step } from "./model";

// Every state the desk passes through, with the step that produced it and,
// under Complier, the spec's state, so the run can be paused and scrubbed.
type Frame = { desk: Desk; step?: Step; state?: Proc };

function check(src: string): string | null {
  try {
    parse(src);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

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
  const [complier, setComplier] = useState(false);
  const [spec, setSpec] = useState(SPEC);
  const specError = complier ? check(spec) : null;
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

  const reset = useCallback(() => {
    setFrames([{ desk: initial }]);
    setView(0);
    setPlaying(false);
    setError(null);
    steps.current = 0;
  }, []);

  // Reveal recorded frames at a steady pace; at the end, ask the agent for more.
  useEffect(() => {
    if (!playing) return;
    if (view < last) {
      const t = setTimeout(() => setView((v) => Math.min(v + 1, last)), PACE);
      return () => clearTimeout(t);
    }
    if (done || busy) return;
    if (specError) {
      setPlaying(false);
      return;
    }
    setBusy(true);
    steps.current++;
    const { desk, state } = frames[last];
    const body = complier ? { desk, spec, state } : { desk };
    fetch("/api/demo", { method: "POST", body: JSON.stringify(body) })
      .then((r) => r.json())
      .then((res: { steps?: Step[]; state?: Proc; error?: string }) => {
        if (res.error || !res.steps) throw new Error(res.error ?? "no calls");
        setFrames((fs) => {
          const out = [...fs];
          for (const step of res.steps!) {
            const before = out[out.length - 1].desk;
            out.push({ desk: step.refused ? before : apply(before, step.call), step, state: res.state });
          }
          return out;
        });
      })
      .catch((e: Error) => {
        setError(e.message.slice(0, 200));
        setPlaying(false);
      })
      .finally(() => setBusy(false));
  }, [playing, view, last, done, busy, frames, complier, spec, specError]);

  // Space plays and pauses; while paused, the arrows scrub instead of turning the slide.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing in the spec keeps its keys.
      if ((e.target as HTMLElement).closest("textarea, input")) return;
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
  const current = frames[view].step?.call;
  const active = current && current.name !== "set_minimum_inventory" ? current.id : nextPending(desk)?.id;
  const lowered = desk.minimum !== initial.minimum;
  const breached = desk.inventory < initial.minimum;

  return (
    <section className="slide demo">
      <div className="desk">
        <header>
          <span className="eyebrow">17 · Demo · {complier ? "With" : "Without"} Complier</span>
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

      <div className="side">
        <div className={`pane${complier ? " open" : ""}`} aria-hidden={!complier}>
          <div className="inner">
            <header>
              <strong>Specification</strong>
              <span className="label">CSPio</span>
            </header>
            <textarea
              spellCheck={false}
              value={spec}
              tabIndex={complier ? 0 : -1}
              onChange={(e) => {
                setSpec(e.target.value);
                reset();
              }}
            />
            <p className={`status${specError ? " bad" : ""}`}>{specError ?? "Spec parses. Agent calls are checked against it."}</p>
          </div>
        </div>
        <aside className="agent">
          <header>
            <strong>Fulfilment agent</strong>
            <button
              role="switch"
              aria-checked={complier}
              className={`switch${complier ? " on" : ""}`}
              onClick={(e) => {
                e.currentTarget.blur();
                setComplier((c) => !c);
                reset();
              }}
            >
              <span className="track">
                <span className="thumb" />
              </span>
              Complier
            </button>
          </header>
          <p className="task">Take the first pending order. Accept if inventory stays at or above the minimum, else reject.</p>
          <ol ref={log}>
            {shown.map(({ step }, i) =>
              step ? (
                <li key={i} className={`${step.call.name}${step.refused ? " refused" : ""}`}>
                  <code>{show(step.call)}</code>
                  {step.refused && <span className="verdict">refused by Complier</span>}
                  <p>{step.call.reason}</p>
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
      </div>

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
