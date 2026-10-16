// Pieces both demos share: recorded playback with pause and scrub, the spec
// editor, the Complier switch, the controls and the play/pause flash.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { parse } from "../../../stepper/csp/parse.ts";

const PACE = 1100;

// Every state the run passes through is a frame. While playing, recorded
// frames are revealed at a steady pace; at the end, `more` asks the agents
// for the next ones. Space plays and pauses; while paused, the arrows scrub
// instead of turning the slide.
export function usePlayback<F>(first: F, more: (last: F) => Promise<F[]>, done: (last: F) => boolean, blocked = false) {
  const [frames, setFrames] = useState<F[]>([first]);
  const [view, setView] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ icon: "play" | "pause"; n: number } | null>(null);
  const rounds = useRef(0);
  const last = frames.length - 1;
  const finished = done(frames[last]) || rounds.current >= 40;

  const toggle = useCallback(() => {
    setPlaying((p) => {
      setFlash((f) => ({ icon: p ? "pause" : "play", n: (f?.n ?? 0) + 1 }));
      return !p;
    });
  }, []);

  const reset = useCallback(() => {
    setFrames([first]);
    setView(0);
    setPlaying(false);
    setError(null);
    rounds.current = 0;
  }, [first]);

  useEffect(() => {
    if (!playing) return;
    if (view < last) {
      const t = setTimeout(() => setView((v) => Math.min(v + 1, last)), PACE);
      return () => clearTimeout(t);
    }
    if (finished || busy) return;
    if (blocked) {
      setPlaying(false);
      return;
    }
    setBusy(true);
    rounds.current++;
    more(frames[last])
      .then((next) => {
        setError(null);
        setFrames((fs) => [...fs, ...next]);
      })
      .catch((e: Error) => {
        setError(e.message.slice(0, 200));
        setPlaying(false);
      })
      .finally(() => setBusy(false));
  }, [playing, view, last, finished, busy, blocked, frames, more]);

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

  const seek = (i: number) => {
    setPlaying(false);
    setView(i);
  };

  return { frames, view, last, playing, busy, error, flash, reset, seek };
}

// The presenter's password, remembered in this browser. The demo routes
// refuse requests without it.
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

function PasswordBox({ onSubmit }: { onSubmit: (p: string) => void }) {
  return (
    <form
      className="password"
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem("password") as HTMLInputElement;
        if (input.value) onSubmit(input.value);
        input.blur();
      }}
    >
      <input name="password" type="password" placeholder="Demo password" autoComplete="off" />
    </form>
  );
}

// Tokens of the spec language, for highlighting: comments, the channel
// keyword, process names, ~ and ^ marks, numbers and operators.
const TOKEN = /(--.*)|(\bchannel\b|\[\[\w+\]\])|([A-Z][A-Za-z0-9_']*)|([~^])(?=[a-z])|(\d+)|(->|\[\]|\[\||\|\]|\|~\||\|\|\||\.\.|[?!:=&;{}])/g;
const KINDS = ["comment", "keyword", "process", "mark", "number", "op"];

function highlight(src: string) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const m of src.matchAll(TOKEN)) {
    if (m.index > at) out.push(src.slice(at, m.index));
    const kind = KINDS[m.slice(1).findIndex((g) => g !== undefined)];
    out.push(
      <span key={m.index} className={`tk-${kind}`}>
        {m[0]}
      </span>,
    );
    at = m.index + m[0].length;
  }
  out.push(src.slice(at) + "\n");
  return out;
}

export function check(src: string): string | null {
  try {
    parse(src);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

// The editable spec, highlighted, in a box that slides down when open.
export function SpecPane({ open, spec, error, onChange }: { open: boolean; spec: string; error: string | null; onChange: (s: string) => void }) {
  const code = useRef<HTMLPreElement>(null);
  return (
    <div className={`pane${open ? " open" : ""}`} aria-hidden={!open}>
      <div className="inner">
        <header>
          <strong>Specification</strong>
          <span className="label">CSPio</span>
        </header>
        <div className="editor">
          <pre ref={code} aria-hidden="true">
            {highlight(spec)}
          </pre>
          <textarea
            spellCheck={false}
            value={spec}
            tabIndex={open ? 0 : -1}
            onScroll={(e) => {
              if (code.current) {
                code.current.scrollTop = e.currentTarget.scrollTop;
                code.current.scrollLeft = e.currentTarget.scrollLeft;
              }
            }}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        <p className={`status${error ? " bad" : ""}`}>{error ?? "Spec parses. Agent calls are checked against it."}</p>
      </div>
    </div>
  );
}

export function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      className={`switch${on ? " on" : ""}`}
      onClick={(e) => {
        e.currentTarget.blur();
        onToggle();
      }}
    >
      <span className="track">
        <span className="thumb" />
      </span>
      Complier
    </button>
  );
}

export function Controls({
  count,
  view,
  playing,
  seek,
  reset,
  password,
  onPassword,
}: {
  count: number;
  view: number;
  playing: boolean;
  seek: (i: number) => void;
  reset: () => void;
  password: string | null;
  onPassword: (p: string) => void;
}) {
  return (
    <footer>
      <div className="scrub">
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            aria-label={`State ${i}`}
            className={i === view ? "on" : i < view ? "past" : undefined}
            onClick={() => seek(i)}
          />
        ))}
      </div>
      {password ? (
        <span className="hint">{view === 0 && !playing ? "Space to start" : "Space play/pause · ← → step while paused"}</span>
      ) : (
        <PasswordBox onSubmit={onPassword} />
      )}
      <button className="reset" onClick={reset}>
        Reset
      </button>
    </footer>
  );
}

export function Thinking() {
  return (
    <li className="thinking">
      <span />
      <span />
      <span />
    </li>
  );
}

export function Flash({ flash }: { flash: { icon: "play" | "pause"; n: number } | null }) {
  if (!flash) return null;
  return (
    <div key={flash.n} className="flash" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d={flash.icon === "play" ? "M8 5v14l11-7z" : "M7 5h4v14H7zM13 5h4v14h-4z"} />
      </svg>
    </div>
  );
}

// Keeps the newest log entry in view.
export function useFollow(dep: unknown) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    ref.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
  }, [dep]);
  return ref;
}
