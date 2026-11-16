"use client";

// Pieces both illustrations share: recorded playback with pause and scrub, the specification
// (translation unit and contract, side by side as tabs), the complier switch, the controls and
// the play/pause flash.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import Editor from "../_landing/Editor";
import type { LoadErrors } from "./_complier/gate";

const PACE = 1100;

// Every state the run passes through is a frame. While playing, recorded frames are revealed at a
// steady pace; at the end, `more` asks the agents for the next ones. With focus in the
// illustration, Space plays and pauses, and while paused the arrows scrub.
export function usePlayback<F>(first: F, more: (last: F) => Promise<F[]>, done: (last: F) => boolean, blocked = false) {
  const [frames, setFrames] = useState<F[]>([first]);
  const [view, setView] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ icon: "play" | "pause"; n: number } | null>(null);
  const rounds = useRef(0);
  // Answers that arrive after a reset belong to the run before it.
  const epoch = useRef(0);
  const last = frames.length - 1;
  const finished = done(frames[last]) || rounds.current >= 40;

  const toggle = useCallback(() => {
    setPlaying((p) => {
      setFlash((f) => ({ icon: p ? "pause" : "play", n: (f?.n ?? 0) + 1 }));
      return !p;
    });
  }, []);

  const reset = useCallback(() => {
    epoch.current++;
    setFrames([first]);
    setView(0);
    setPlaying(false);
    setBusy(false);
    setError(null);
    rounds.current = 0;
  }, [first]);

  useEffect(() => {
    if (!playing) return;
    if (view < last) {
      const t = setTimeout(() => setView((v) => Math.min(v + 1, last)), PACE);
      return () => clearTimeout(t);
    }
    if (finished || busy) {
      if (finished) setPlaying(false);
      return;
    }
    if (blocked) {
      setPlaying(false);
      return;
    }
    const mine = epoch.current;
    setBusy(true);
    rounds.current++;
    more(frames[last])
      .then((next) => {
        if (mine !== epoch.current) return;
        setError(null);
        setFrames((fs) => [...fs, ...next]);
      })
      .catch((e: Error) => {
        if (mine !== epoch.current) return;
        setError(e.message.slice(0, 200));
        setPlaying(false);
      })
      .finally(() => {
        if (mine === epoch.current) setBusy(false);
      });
  }, [playing, view, last, finished, busy, blocked, frames, more]);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    // Typing in the spec or the password keeps its keys, and so do the buttons.
    if ((e.target as HTMLElement).closest("textarea, input, button, [role=tab]")) return;
    if (e.key === " ") {
      e.preventDefault();
      toggle();
      return;
    }
    if (playing) return;
    if (e.key === "ArrowLeft" && view > 0) {
      e.preventDefault();
      setView(view - 1);
    } else if (e.key === "ArrowRight" && view < last) {
      e.preventDefault();
      setView(view + 1);
    }
  };

  const seek = (i: number) => {
    setPlaying(false);
    setView(i);
  };

  return { frames, view, last, playing, busy, error, flash, reset, seek, toggle, onKeyDown, finished };
}

// The presenter's password, remembered in this browser. The demo routes refuse requests
// without it.
const KEY = "demo:password";

export function usePassword() {
  const [password, setPassword] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPassword(localStorage.getItem(KEY));
    } catch {}
  }, []);
  const save = useCallback((p: string | null) => {
    try {
      if (p) localStorage.setItem(KEY, p);
      else localStorage.removeItem(KEY);
    } catch {}
    setPassword(p);
  }, []);
  return [password, save] as const;
}

// Posts to a demo route with the password; a refusal forgets it.
export async function post(url: string, body: unknown, password: string | null, forget: () => void) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-demo-password": password ?? "" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    forget();
    throw new Error("Wrong password");
  }
  return res.json();
}

function PasswordBox({ id, onSubmit }: { id: string; onSubmit: (p: string) => void }) {
  return (
    <form
      className="il-password"
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem("password") as HTMLInputElement;
        if (input.value) onSubmit(input.value);
        input.blur();
      }}
    >
      <label className="sr-only" htmlFor={`${id}-password`}>
        Demo password
      </label>
      <input id={`${id}-password`} name="password" type="password" placeholder="Demo password" autoComplete="off" />
    </form>
  );
}

type Tab = "translation" | "contract";

// The specification complier checks calls against: the translation unit and the contract, two
// tabs side by side, in a box that slides down when complier is on.
export function SpecPane({
  id,
  open,
  unit,
  policy,
  errors,
  onUnit,
  onPolicy,
}: {
  id: string;
  open: boolean;
  unit: string;
  policy: string;
  errors: LoadErrors | null;
  onUnit: (s: string) => void;
  onPolicy: (s: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("contract");
  const error = errors && (errors[tab === "translation" ? "unit" : "policy"] ?? null);
  const status = !errors
    ? "Translation and contract parse. Agent calls are checked against them."
    : `${errors.unit ? "Translation" : "Contract"}, line ${(errors.unit ?? errors.policy)!.line}: ${(errors.unit ?? errors.policy)!.message}`;
  return (
    <div className={`il-pane${open ? " is-open" : ""}`} aria-hidden={!open} inert={!open}>
      <div className="il-pane-inner">
        <div className="il-pane-bar">
          <strong>Specification</strong>
          <div role="tablist" aria-label="Specification" className="tabs">
            {(["translation", "contract"] as const).map((t) => (
              <button
                key={t}
                role="tab"
                type="button"
                id={`${id}-tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`${id}-panel-${t}`}
                className="tab"
                onClick={() => setTab(t)}
              >
                {t === "translation" ? "Translation" : "Contract"}
                <span className="tab-kind">{t === "translation" ? "YAML + CEL" : "CSP"}</span>
                {errors?.[t === "translation" ? "unit" : "policy"] && <span className="tab-dot" aria-label="1 error" />}
              </button>
            ))}
          </div>
        </div>
        <div className="il-editor" role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`}>
          <Editor
            key={tab}
            id={`${id}-editor-${tab}`}
            label={tab === "translation" ? "Translation unit, YAML with CEL rules" : "Contract, CSP"}
            language={tab === "translation" ? "yaml" : "csp"}
            value={tab === "translation" ? unit : policy}
            onChange={tab === "translation" ? onUnit : onPolicy}
            errorLines={error ? [error.line] : []}
          />
        </div>
        <p className={`il-status${errors ? " is-bad" : ""}`} role="status">
          <span className={`status-dot ${errors ? "is-bad" : "is-ok"}`} aria-hidden="true" />
          {status}
        </p>
      </div>
    </div>
  );
}

export function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`game-defense il-switch${on ? " is-on" : ""}`} onClick={onToggle}>
      <span className="il-track" aria-hidden="true">
        <span className="il-thumb" />
      </span>
      complier
    </button>
  );
}

export function Controls({
  id,
  count,
  view,
  playing,
  busy,
  finished,
  seek,
  toggle,
  reset,
  password,
  onPassword,
}: {
  id: string;
  count: number;
  view: number;
  playing: boolean;
  busy: boolean;
  finished: boolean;
  seek: (i: number) => void;
  toggle: () => void;
  reset: () => void;
  password: string | null;
  onPassword: (p: string) => void;
}) {
  const atEnd = finished && view === count - 1;
  return (
    <footer className="il-controls">
      <div className="il-scrub" aria-label="States">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`State ${i}`}
            aria-current={i === view ? "step" : undefined}
            className={i === view ? "is-on" : i < view ? "is-past" : undefined}
            onClick={() => seek(i)}
          />
        ))}
      </div>
      {password ? (
        <>
          <button type="button" className="btn btn-run il-play" onClick={toggle} disabled={atEnd && !playing}>
            <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
              <path d={playing ? "M4 2.5h3v11H4zM9 2.5h3v11H9z" : "M4 2.5v11l9-5.5z"} fill="currentColor" />
            </svg>
            {playing ? (busy ? "Pause" : "Pause") : view === 0 ? "Start" : "Play"}
          </button>
          <span className="il-hint">{view === 0 && !playing ? "Space to start" : "Space play/pause · ← → step while paused"}</span>
        </>
      ) : (
        <PasswordBox id={id} onSubmit={onPassword} />
      )}
      <button type="button" className="btn btn-quiet il-reset" onClick={reset}>
        Reset
      </button>
    </footer>
  );
}

export function Thinking() {
  return (
    <li className="il-thinking" aria-label="The agent is thinking">
      <span />
      <span />
      <span />
    </li>
  );
}

export function Flash({ flash }: { flash: { icon: "play" | "pause"; n: number } | null }) {
  if (!flash) return null;
  return (
    <div key={flash.n} className="il-flash" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d={flash.icon === "play" ? "M8 5v14l11-7z" : "M7 5h4v14H7zM13 5h4v14h-4z"} />
      </svg>
    </div>
  );
}

// Keeps the newest log entry in view, scrolling only the log itself.
export function useFollow(dep: unknown) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const ol = ref.current;
    if (ol) ol.scrollTop = ol.scrollHeight;
  }, [dep]);
  return ref;
}

// The verdict a log entry shows under complier.
export function VerdictChip({ k }: { k: "allowed" | "denied" | "refused" }) {
  return <span className={`game-chip il-chip is-${k}`}>{k === "allowed" ? "allowed" : `${k} by complier`}</span>;
}
