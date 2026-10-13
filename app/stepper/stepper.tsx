"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import katex from "katex";
import { EXAMPLE } from "./csp/example.ts";
import { parse } from "./csp/parse.ts";
import { step } from "./csp/step.ts";
import { alphabet, readEvent, showEvent, submit } from "./csp/system.ts";
import type { Derivation, Event, Label, Mark, Proc, Spec } from "./csp/syntax.ts";
import { texDerivation, texLabel, texProc } from "./csp/tex.ts";

const KEY = "stepper:spec";

function TeX({ tex, display = false, className = "" }: { tex: string; display?: boolean; className?: string }) {
  const html = useMemo(
    () => katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore" }),
    [tex, display],
  );
  return <span className={`tex ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

// IO-ExtL(IO-Guard-True(IO-Prefix)): the rules used, outermost first.
const rules = (d: Derivation): string =>
  d.premises.length ? `${d.rule}(${d.premises.map(rules).join(", ")})` : d.rule;

function Tree({ d }: { d: Derivation }) {
  const [copied, setCopied] = useState(false);
  const tex = texDerivation(d);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tex);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <figure className="tree">
      <div className="tree-scroll">
        <TeX tex={tex} display />
      </div>
      <figcaption>
        <code>{rules(d)}</code>
        <button className="btn ghost sm" onClick={copy}>
          {copied ? "Copied" : "Copy LaTeX"}
        </button>
      </figcaption>
    </figure>
  );
}

const MARKS: { mark: Mark; title: string; sign: string }[] = [
  { mark: "world", title: "World", sign: "~" },
  { mark: "agent", title: "Agent", sign: "^" },
  { mark: "internal", title: "Internal", sign: "" },
];

const markOf = (spec: Spec, l: Label): Mark | null => (l.k === "ev" ? (spec.marks.get(l.chan) ?? "internal") : null);

type Sent = { event: Event; tone: "ok" | "warn" | "bad" | "info"; text: string; note?: string };

const starts = (spec: Spec) => [...spec.defs.values()].filter((d) => d.params.length === 0).map((d) => d.name);

const tryParse = (text: string): { spec: Spec; error: "" } | { spec: null; error: string } => {
  try {
    return { spec: parse(text), error: "" };
  } catch (e) {
    return { spec: null, error: e instanceof Error ? e.message : String(e) };
  }
};

export default function Stepper() {
  const [src, setSrc] = useState(EXAMPLE);
  const [loaded, setLoaded] = useState<{ text: string; spec: Spec } | null>(null);
  const [start, setStart] = useState("MAIN");
  const [history, setHistory] = useState<Derivation[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [typed, setTyped] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const [typedError, setTypedError] = useState("");
  const gutter = useRef<HTMLPreElement>(null);

  // Parsed as you type, so errors show before loading.
  const draft = useMemo(() => tryParse(src), [src]);
  const spec = loaded?.spec ?? null;
  const dirty = loaded !== null && loaded.text !== src;

  const load = useCallback(
    (text: string) => {
      const r = tryParse(text);
      if (!r.spec) return;
      const names = starts(r.spec);
      setLoaded({ text, spec: r.spec });
      setStart((s) => (names.includes(s) ? s : names.includes("MAIN") ? "MAIN" : (names[0] ?? "")));
      setHistory([]);
      setOpen(null);
      setSent(null);
    },
    [],
  );

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    if (saved !== null) setSrc(saved);
    load(saved ?? EXAMPLE);
  }, [load]);

  const edit = (text: string) => {
    setSrc(text);
    try {
      if (text === EXAMPLE) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, text);
    } catch {}
  };

  const initial: Proc | null = spec && start ? { k: "call", name: start, args: [] } : null;
  const current = history.length ? history[history.length - 1].to : initial;

  const next = useMemo(() => {
    if (!spec || !current) return { ds: [] as Derivation[], error: "" };
    try {
      return { ds: step(spec, current), error: "" };
    } catch (e) {
      return { ds: [] as Derivation[], error: e instanceof Error ? e.message : String(e) };
    }
  }, [spec, current]);

  const take = useCallback((d: Derivation) => {
    setHistory((h) => [...h, d]);
    setOpen(null);
    setSent(null);
  }, []);
  const back = useCallback(() => (setHistory((h) => h.slice(0, -1)), setOpen(null), setSent(null)), []);
  const restart = useCallback(() => (setHistory([]), setOpen(null), setSent(null)), []);

  const sigma = useMemo(() => (spec ? alphabet(spec) : []), [spec]);

  // Submits an event from outside and reports what the system did with it.
  const send = (event: Event) => {
    if (!spec || !current) return;
    const name = showEvent(event);
    const out = submit(spec, current, event);
    const stable =
      "unstable" in out && out.unstable
        ? "This state can still take a τ step, so it hasn't settled; with a stability premise (S has no τ) the event would wait instead."
        : undefined;
    if (out.k === "accepted" && out.ds.length === 1) {
      take(out.ds[0]);
      setSent({ event, tone: "ok", text: `${name} happened.` });
    } else if (out.k === "accepted") {
      setOpen(null);
      setSent({ event, tone: "info", text: `${out.ds.length} transitions are labelled ${name} here. Pick one below.` });
    } else if (out.k === "blocked") {
      setSent({
        event,
        tone: "bad",
        text: `${name} is internal and not offered here, so nothing happens. Internal events only fire when the process offers them.`,
        note: stable,
      });
    } else {
      setHistory((h) => [...h, out.d]);
      setOpen(null);
      setSent({
        event,
        tone: "warn",
        text:
          out.k === "dropped"
            ? `${name} was dropped: it comes from the world, and this state doesn't offer it [IO-Drop].`
            : `${name} was refused: it comes from an agent, and this state doesn't offer it [IO-Refuse].`,
        note: stable,
      });
    }
  };

  const sendTyped = () => {
    if (!spec) return;
    const ev = readEvent(spec, typed);
    if (typeof ev === "string") return setTypedError(ev);
    setTypedError("");
    send(ev);
  };

  // 1-9 take a transition, Backspace steps back, R restarts.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("textarea, input, select") || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && next.ds[n - 1]) take(next.ds[n - 1]);
      else if (e.key === "Backspace") back();
      else if (e.key === "r") restart();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, take, back, restart]);

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      load(src);
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = el;
      edit(src.slice(0, s) + "    " + src.slice(end));
      requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
    }
  };

  const last = history[history.length - 1];
  const lines = src.split("\n").length;
  const names = spec ? starts(spec) : [];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">complier</span>
          <span className="sep">/</span>
          <span>Stepper</span>
        </div>
        <p className="tagline">Operational semantics of CSP, one derivation at a time.</p>
      </header>

      <div className="workspace">
        <aside className="pane editor">
          <div className="pane-head">
            <span className="file">spec.csp</span>
            {dirty && <span className="pill">unloaded changes</span>}
            <div className="grow" />
            <button className="btn ghost sm" onClick={() => edit(EXAMPLE)} disabled={src === EXAMPLE}>
              Reset
            </button>
            <button className="btn primary sm" onClick={() => load(src)} disabled={!draft.spec}>
              Load <kbd>⌘↵</kbd>
            </button>
          </div>
          <div className="code">
            <pre ref={gutter} className="gutter" aria-hidden>
              {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
            </pre>
            <textarea
              value={src}
              onChange={(e) => edit(e.target.value)}
              onKeyDown={keys}
              onScroll={(e) => gutter.current && (gutter.current.scrollTop = e.currentTarget.scrollTop)}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              wrap="off"
              aria-label="spec source"
            />
          </div>
          <div className={`status ${draft.error ? "bad" : ""}`}>
            {draft.error ? (
              draft.error
            ) : (
              <>
                <span className="ok-dot" />
                {draft.spec!.defs.size} process{draft.spec!.defs.size === 1 ? "" : "es"}, {draft.spec!.chans.size} channel
                {draft.spec!.chans.size === 1 ? "" : "s"}
              </>
            )}
          </div>
        </aside>

        <main className="pane main">
          <div className="column">
            <section className="card">
              <div className="card-head">
                <h2>Current state</h2>
                <div className="grow" />
                <div className="controls">
                  <label className="field">
                    <span>Start</span>
                    <select value={start} onChange={(e) => (setStart(e.target.value), restart())}>
                      {names.map((n) => (
                        <option key={n}>{n}</option>
                      ))}
                    </select>
                  </label>
                  <button className="btn sm" onClick={back} disabled={!history.length} title="Back (⌫)">
                    Back
                  </button>
                  <button className="btn sm" onClick={restart} disabled={!history.length} title="Restart (R)">
                    Restart
                  </button>
                </div>
              </div>
              <div className="state">{current && <TeX tex={texProc(current)} />}</div>
              <div className="trace" aria-label="trace">
                <button className={`chip ${history.length === 0 ? "on" : ""}`} onClick={restart}>
                  start
                </button>
                {history.map((d, i) => (
                  <button
                    key={i}
                    className={`chip ${i === history.length - 1 ? "on" : ""}`}
                    onClick={() => (setHistory((h) => h.slice(0, i + 1)), setOpen(null))}
                    title={`Go back to after step ${i + 1}`}
                  >
                    <TeX tex={texLabel(d.label)} />
                  </button>
                ))}
              </div>
            </section>

            {spec && (
              <section className="card">
                <div className="card-head">
                  <h2>Send an event</h2>
                  <div className="grow" />
                  <span className="hint">world ~ is dropped, agent ^ is refused, when not offered</span>
                </div>
                <form
                  className="send"
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendTyped();
                  }}
                >
                  <input
                    value={typed}
                    onChange={(e) => (setTyped(e.target.value), setTypedError(""))}
                    placeholder="coin, or c.1 for data"
                    list="sigma"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    aria-label="event to send"
                  />
                  <datalist id="sigma">
                    {sigma.map(({ event }) => (
                      <option key={showEvent(event)} value={showEvent(event)} />
                    ))}
                  </datalist>
                  <button className="btn primary sm" type="submit" disabled={!typed.trim()}>
                    Send
                  </button>
                </form>
                {typedError && <p className="note bad">{typedError}</p>}
                <div className="sigma">
                  {MARKS.map(({ mark, title, sign }) => {
                    const evs = sigma.filter((e) => e.mark === mark);
                    if (!evs.length) return null;
                    return (
                      <div key={mark} className="sigma-row">
                        <span className={`mark ${mark}`}>
                          {title}
                          {sign && <code>{sign}</code>}
                        </span>
                        <div className="sigma-events">
                          {evs.map(({ event }) => (
                            <button
                              key={showEvent(event)}
                              className={`chip ev ${mark}`}
                              onClick={() => (setTyped(showEvent(event)), setTypedError(""), send(event))}
                            >
                              <TeX tex={texLabel(event)} />
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {sent && (
                  <div className={`outcome ${sent.tone}`} role="status">
                    <p>{sent.text}</p>
                    {sent.note && <p className="muted">{sent.note}</p>}
                  </div>
                )}
              </section>
            )}

            <section className="card">
              <div className="card-head">
                <h2>
                  Transitions <span className="count">{next.ds.length}</span>
                </h2>
                <div className="grow" />
                <span className="hint">
                  <kbd>1</kbd>–<kbd>9</kbd> take
                </span>
              </div>
              {next.error && <p className="note bad">{next.error}</p>}
              {current && !next.error && next.ds.length === 0 && (
                <p className="note">
                  {current.k === "omega"
                    ? "Terminated: Ω has no transitions."
                    : "Stuck: no rule applies to this state."}
                </p>
              )}
              <ol className="transitions">
                {next.ds.map((d, i) => (
                  <li
                    key={i}
                    className={[
                      open === i ? "open" : "",
                      sent?.tone === "info" && d.label.k === "ev" && showEvent(d.label) === showEvent(sent.event)
                        ? "hit"
                        : "",
                    ].join(" ")}
                  >
                    <div className="tr">
                      <button className="tr-main" onClick={() => take(d)}>
                        <span className="idx">{i + 1}</span>
                        <span className="tr-label">
                          <TeX tex={texLabel(d.label)} />
                          {spec && markOf(spec, d.label) && (
                            <span className={`tag ${markOf(spec, d.label)}`}>{markOf(spec, d.label)}</span>
                          )}
                        </span>
                        <span className="tr-body">
                          <TeX tex={texProc(d.to)} className="tr-target" />
                          <code className="tr-rules">{rules(d)}</code>
                        </span>
                      </button>
                      <button
                        className="btn ghost sm tr-why"
                        onClick={() => setOpen(open === i ? null : i)}
                        aria-expanded={open === i}
                      >
                        {open === i ? "Hide" : "Derivation"}
                      </button>
                    </div>
                    {open === i && <Tree d={d} />}
                  </li>
                ))}
              </ol>
            </section>

            {last && (
              <section className="card">
                <div className="card-head">
                  <h2>
                    Derivation <span className="muted">of step {history.length}</span>
                  </h2>
                  <div className="grow" />
                  <TeX tex={texLabel(last.label)} className="muted" />
                </div>
                <Tree d={last} />
              </section>
            )}

            {history.length > 1 && (
              <section className="card">
                <div className="card-head">
                  <h2>Earlier steps</h2>
                </div>
                <ol className="history">
                  {history
                    .slice(0, -1)
                    .map((d, i) => ({ d, i }))
                    .reverse()
                    .map(({ d, i }) => (
                      <li key={i}>
                        <details>
                          <summary>
                            <span className="idx">{i + 1}</span>
                            <TeX tex={texLabel(d.label)} />
                            <code className="tr-rules">{rules(d)}</code>
                          </summary>
                          <Tree d={d} />
                        </details>
                      </li>
                    ))}
                </ol>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
