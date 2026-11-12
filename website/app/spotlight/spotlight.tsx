"use client";

// A Spotlight-style view of the person's saved complier workflows: type to search, arrows to move,
// and each workflow's policy is drawn as its sequence diagram. This page only reads. Applying a
// workflow happens in the Claude Code session it is for, where Claude asks first and Claude Code
// asks the person to confirm; the page shows how, and never does it.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { arrange } from "../sequence/arrange.ts";
import { diagram } from "../sequence/diagram.ts";
import { parsePolicy } from "../sequence/policy.ts";
import { SequenceSvg } from "../sequence/svg.tsx";
import { FIXTURES } from "./fixtures.ts";
import { acts, search, type Workflow } from "./search.ts";

type Loaded = { dir: string; workflows: Workflow[]; error?: string };

function draw(w: Workflow) {
  if (!w.spec) return { error: "this workflow has no .csp spec" };
  try {
    return { layout: arrange(diagram(parsePolicy(w.spec.src))) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <span className="spot-cmd">
      <code>{text}</code>
      <button
        className="btn ghost sm"
        onClick={() => {
          navigator.clipboard?.writeText(text).then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1200);
          });
        }}
      >
        {done ? "copied" : "copy"}
      </button>
    </span>
  );
}

export default function Spotlight() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [query, setQuery] = useState("");
  const [fixtures, setFixtures] = useState(false);
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/workflows")
      .then((r) => r.json())
      .then((d: Partial<Loaded>) => {
        // Off this computer (on Vercel) the API has nothing to read: show the fixtures, labelled.
        const workflows = Array.isArray(d.workflows) ? d.workflows : [];
        setLoaded({ dir: d.dir ?? "", workflows, error: d.error });
        if (!workflows.length) setFixtures(true);
      })
      .catch((e) => setLoaded({ dir: "", workflows: [], error: String(e) }));
    const key = (e: globalThis.KeyboardEvent) => {
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && document.activeElement !== input.current)) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const all = useMemo(() => [...(loaded?.workflows ?? []), ...(fixtures ? FIXTURES : [])], [loaded, fixtures]);
  const found = useMemo(() => search(all, query), [all, query]);
  const sel = found[Math.min(at, found.length - 1)] ?? null;
  const drawn = useMemo(() => (sel ? draw(sel) : null), [sel]);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") (e.preventDefault(), setAt((i) => Math.min(i + 1, found.length - 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setAt((i) => Math.max(i - 1, 0)));
    else if (e.key === "Escape") (setQuery(""), setAt(0));
  };

  const saved = loaded?.workflows.length ?? 0;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Link href="/" className="logo">
            complier
          </Link>
          <span className="sep">/</span>
          <span className="title">Workflows</span>
        </div>
        <p className="tagline">Your saved workflows: find one, see what it makes an agent do, and how to use it.</p>
        <nav className="topnav" aria-label="Site">
          <Link href="/sequence">Sequence</Link>
          <Link href="/stepper">Stepper</Link>
        </nav>
      </header>

      <div className="spot-scroll">
      <div className="spot">
        <div className="spot-box">
          <input
            ref={input}
            autoFocus
            className="spot-input"
            placeholder="Search workflows: a name, a step, or what you asked for…"
            value={query}
            onChange={(e) => (setQuery(e.target.value), setAt(0))}
            onKeyDown={onKey}
            aria-label="Search workflows"
          />
          <div className="spot-meta">
            {!loaded ? (
              "reading saved workflows…"
            ) : (
              <>
                {saved} saved on this computer{loaded.dir ? ` (${loaded.dir})` : ""}
                {loaded.error ? ` · ${loaded.error}` : ""}
                <label className="spot-toggle">
                  <input type="checkbox" checked={fixtures} onChange={(e) => setFixtures(e.target.checked)} /> show demonstration fixtures
                </label>
              </>
            )}
          </div>
        </div>

        <div className="spot-body">
          <ul className="spot-list" role="listbox" aria-label="Workflows">
            {found.map((w, i) => (
              <li
                key={`${w.source}:${w.name}`}
                role="option"
                aria-selected={w === sel}
                className={`spot-item ${w === sel ? "on" : ""}`}
                onMouseDown={() => setAt(i)}
              >
                <div className="spot-name">
                  {w.name}
                  {w.source === "fixture" ? <span className="pill">fixture</span> : null}
                  {w.sessions.length ? <span className="pill live">applied</span> : null}
                </div>
                <div className="spot-desc">{w.description || "no description"}</div>
                <div className="spot-acts">{acts(w).join(" · ")}</div>
              </li>
            ))}
            {loaded && !found.length && <li className="spot-empty">No workflow matches “{query}”.</li>}
          </ul>

          {sel && (
            <section className="card spot-detail">
              <div className="card-head">
                <span className="card-title">{sel.name}</span>
                <span className="pill">{sel.source === "saved" ? "saved on this computer" : "demonstration fixture: not saved here"}</span>
                <span className={`pill ${sel.sessions.length ? "live" : ""}`}>
                  {sel.sessions.length ? `applied to ${sel.sessions.length} session(s)` : "not applied to any session"}
                </span>
              </div>
              <div className="spot-about">
                <p>{sel.description}</p>
                {sel.noticed && (
                  <p className="muted">
                    Saved from: <em>{sel.noticed}</em>
                    {sel.created ? ` · ${sel.created}` : ""}
                  </p>
                )}
              </div>

              <h3 className="spot-h">What it makes the agent do</h3>
              <div className="seq-scroll">
                {drawn?.layout ? <SequenceSvg layout={drawn.layout} title={`${sel.name}: the policy's happy path`} /> : <p className="muted">Can't draw this policy: {drawn?.error}</p>}
              </div>

              <h3 className="spot-h">Use it with an agent</h3>
              {sel.source === "fixture" ? (
                <p className="muted">
                  This is an example, not one of your saved workflows. To use it, save it first (complier proves it with FDR and the CEL
                  verifier): <Copy text={`complier workflow save ${sel.name} <folder with its .csp and .yaml>`} />
                </p>
              ) : (
                <ol className="spot-steps">
                  <li>
                    In the Claude Code session you want it in, ask: <Copy text={`Apply the ${sel.name} complier workflow to this session.`} /> Claude asks
                    you first, and Claude Code asks you to confirm the command it runs (<code>complier workflow apply {sel.name}</code>).
                  </li>
                  <li>From then on complier checks that session's tool calls against this workflow, until the policy finishes.</li>
                  <li>
                    To stop it early, from your own terminal: <Copy text={`complier workflow release ${sel.name}`} />
                  </li>
                </ol>
              )}
              <p className="spot-note">This page only reads your workflows. It never saves, applies or releases one.</p>

              <details className="spot-src">
                <summary>Spec and units</summary>
                {sel.spec && (
                  <>
                    <div className="file">{sel.spec.file}</div>
                    <pre>{sel.spec.src}</pre>
                  </>
                )}
                {sel.units.map((u) => (
                  <div key={u.file}>
                    <div className="file">{u.file}</div>
                    <pre>{u.src}</pre>
                  </div>
                ))}
              </details>
            </section>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
