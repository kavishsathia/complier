"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import katex from "katex";
import { EXAMPLE } from "./csp/example.ts";
import { parse } from "./csp/parse.ts";
import { step } from "./csp/step.ts";
import type { Derivation, Proc, Spec } from "./csp/syntax.ts";
import { texDerivation, texLabel, texProc } from "./csp/tex.ts";

const KEY = "stepper:spec";

function TeX({ tex, display = false }: { tex: string; display?: boolean }) {
  const html = useMemo(
    () => katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: "ignore" }),
    [tex, display],
  );
  return <span className="tex" dangerouslySetInnerHTML={{ __html: html }} />;
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
    <div className="tree">
      <button className="quiet copy" onClick={copy}>
        {copied ? "Copied" : "Copy LaTeX"}
      </button>
      <div className="tree-body">
        <TeX tex={tex} display />
      </div>
    </div>
  );
}

const starts = (spec: Spec) => [...spec.defs.values()].filter((d) => d.params.length === 0).map((d) => d.name);

export default function Stepper() {
  const [src, setSrc] = useState(EXAMPLE);
  const [spec, setSpec] = useState<Spec | null>(null);
  const [error, setError] = useState("");
  const [start, setStart] = useState("MAIN");
  const [history, setHistory] = useState<Derivation[]>([]);
  const [open, setOpen] = useState<number | null>(null);

  const load = (text: string, from?: string) => {
    try {
      const s = parse(text);
      const names = starts(s);
      setSpec(s);
      setError("");
      setStart(from && names.includes(from) ? from : names.includes("MAIN") ? "MAIN" : (names[0] ?? ""));
      setHistory([]);
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {}
    if (saved !== null) setSrc(saved);
    load(saved ?? EXAMPLE);
  }, []);

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

  const take = (d: Derivation) => {
    setHistory((h) => [...h, d]);
    setOpen(null);
  };

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      load(src, start);
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

  return (
    <div className="st">
      <header className="st-head">
        <div>
          <h1>CSP stepper</h1>
          <p>Pick a transition to take it. Every step shows the derivation that proves it.</p>
        </div>
      </header>

      <div className="st-top">
        <section className="st-editor">
          <div className="st-bar">
            <span className="muted small">spec</span>
            <button className="quiet" onClick={() => edit(EXAMPLE)} disabled={src === EXAMPLE}>
              Reset
            </button>
            <button className="primary" onClick={() => load(src, start)}>
              Load <kbd>⌘↵</kbd>
            </button>
          </div>
          <div className="st-code">
            <pre className="st-gutter" aria-hidden id="st-gutter">
              {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
            </pre>
            <textarea
              value={src}
              onChange={(e) => edit(e.target.value)}
              onKeyDown={keys}
              onScroll={(e) => {
                const g = document.getElementById("st-gutter");
                if (g) g.scrollTop = e.currentTarget.scrollTop;
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              wrap="off"
              aria-label="spec source"
            />
          </div>
          {error && <pre className="st-error">{error}</pre>}
        </section>

        <section className="st-panel st-now">
          <div className="st-bar">
            <h2>State</h2>
            {spec && (
              <select value={start} onChange={(e) => (setStart(e.target.value), setHistory([]))} aria-label="start process">
                {starts(spec).map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            )}
            <button className="quiet" onClick={() => setHistory((h) => h.slice(0, -1))} disabled={!history.length}>
              Back
            </button>
            <button className="quiet" onClick={() => setHistory([])} disabled={!history.length}>
              Restart
            </button>
          </div>
          <div className="st-state">{current && <TeX tex={texProc(current)} display />}</div>
          {history.length > 0 && (
            <p className="st-trace">
              <span className="muted">trace</span>{" "}
              <TeX tex={`\\langle ${history.map((d) => texLabel(d.label)).join(", ")} \\rangle`} />
            </p>
          )}

          <h3>Transitions</h3>
          {next.error && <pre className="st-error">{next.error}</pre>}
          {current && !next.error && next.ds.length === 0 && (
            <p className="st-stuck">
              No transitions{current.k === "omega" ? ": terminated." : ": this state is stuck."}
            </p>
          )}
          <ul className="st-next">
            {next.ds.map((d, i) => (
              <li key={i}>
                <div className="st-tr">
                  <button className="st-take" onClick={() => take(d)}>
                    <span className="label">
                      <TeX tex={texLabel(d.label)} />
                    </span>
                    <span className="target">
                      <TeX tex={texProc(d.to)} />
                    </span>
                  </button>
                  <button className="quiet small" onClick={() => setOpen(open === i ? null : i)}>
                    {open === i ? "Hide" : "Why"}
                  </button>
                </div>
                <div className="rules">{rules(d)}</div>
                {open === i && <Tree d={d} />}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {last && (
        <section className="st-panel">
          <div className="st-bar">
            <h2>
              Step {history.length} <span className="muted">derivation</span>
            </h2>
          </div>
          <Tree d={last} />
        </section>
      )}

      {history.length > 1 && (
        <section className="st-panel">
          <h2>Earlier steps</h2>
          <ol className="st-history">
            {history
              .slice(0, -1)
              .map((d, i) => ({ d, i }))
              .reverse()
              .map(({ d, i }) => (
                <li key={i}>
                  <details>
                    <summary>
                      <span className="muted">Step {i + 1}</span> <TeX tex={texLabel(d.label)} />{" "}
                      <span className="rules">{rules(d)}</span>
                    </summary>
                    <Tree d={d} />
                  </details>
                </li>
              ))}
          </ol>
        </section>
      )}
    </div>
  );
}
