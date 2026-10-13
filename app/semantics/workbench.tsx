"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Engine } from "./engine";

type Files = { spec: string; semantics: string; parser: string };
type Tab = keyof Files;

type Transition = { label: string; kind: "step" | "drop" | "refuse"; rule: string; target: number; text: string };
type Summary = { id: number; text: string; steps: number; status: "live" | "deadlock" | "terminated" };
type Channel = { name: string; mark: string; types: string };
type Solutions = { solutions: string[][]; output: string };
type Taken = { label: string; from: number };

const TABS: { key: Tab; name: string; file: string }[] = [
  { key: "spec", name: "Spec", file: "spec.csp" },
  { key: "semantics", name: "Semantics", file: "semantics.pl" },
  { key: "parser", name: "Parser", file: "parser.pl" },
];

const KINDS: { kind: Transition["kind"]; title: string; note: string }[] = [
  { kind: "step", title: "Steps", note: "P --x--> P'" },
  { kind: "drop", title: "Dropped", note: "a ∈ Σ~, not offered" },
  { kind: "refuse", title: "Refused", note: "a ∈ Σ^, not offered" },
];

const stored = (tab: Tab) => {
  try {
    return localStorage.getItem(`semantics:${tab}`);
  } catch {
    return null;
  }
};

const store = (tab: Tab, text: string | null) => {
  try {
    if (text === null) localStorage.removeItem(`semantics:${tab}`);
    else localStorage.setItem(`semantics:${tab}`, text);
  } catch {}
};

export default function Workbench({ defaults, glue }: { defaults: Files; glue: string }) {
  const engine = useRef<Engine | null>(null);
  const [files, setFiles] = useState<Files>(defaults);
  const [tab, setTab] = useState<Tab>("spec");
  const [busy, setBusy] = useState("Loading SWI-Prolog…");
  const [log, setLog] = useState("");
  const [error, setError] = useState("");
  const [channels, setChannels] = useState<Channel[]>([]);

  const [initial, setInitial] = useState<number | null>(null);
  const [current, setCurrent] = useState<{ id: number; text: string } | null>(null);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [trace, setTrace] = useState<Taken[]>([]);
  const [reachable, setReachable] = useState<{ states: Summary[]; truncated: boolean } | null>(null);

  const [query, setQuery] = useState("offered(call('MAIN', []), As)");
  const [answer, setAnswer] = useState<Solutions | string | null>(null);

  const call = useCallback(async <T,>(goal: string, input?: Record<string, unknown>) => {
    engine.current ??= new Engine();
    return engine.current.json<T>(goal, input);
  }, []);

  const visit = useCallback(
    async (id: number) => {
      const [state, out] = await Promise.all([
        call<{ id: number; text: string }>("wb_state(I, J)", { I: id }),
        call<{ transitions: Transition[] }>("wb_transitions(I, J)", { I: id }),
      ]);
      setCurrent(state);
      setTransitions(out.transitions);
    },
    [call],
  );

  const guard = useCallback(async (what: string, work: () => Promise<void>) => {
    setBusy(what);
    try {
      await work();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (message !== "closed") setError(message);
    } finally {
      setBusy("");
    }
  }, []);

  const run = useCallback(
    (f: Files) =>
      guard("Running…", async () => {
        setError("");
        setReachable(null);
        setAnswer(null);
        setCurrent(null);
        setTransitions([]);
        setTrace([]);
        engine.current ??= new Engine();
        const loaded = await engine.current.call(
          "consult(['/workbench.pl', '/semantics.pl', '/parser.pl'])",
          { files: { "workbench.pl": glue, "semantics.pl": f.semantics, "parser.pl": f.parser }, timeout: 60000 },
        );
        setLog(loaded.stderr.trim());
        if (loaded.error) throw new Error(loaded.error);
        const spec = await call<{ initial: number; channels: Channel[] }>("wb_load(T, J)", { T: f.spec });
        setChannels(spec.channels);
        setInitial(spec.initial);
        await visit(spec.initial);
      }),
    [call, glue, guard, visit],
  );

  useEffect(() => {
    const saved = { ...defaults };
    for (const { key } of TABS) saved[key] = stored(key) ?? defaults[key];
    setFiles(saved);
    run(saved);
    return () => {
      engine.current?.stop();
      engine.current = null;
    };
  }, [defaults, run]);

  const edit = (text: string) => {
    setFiles((f) => ({ ...f, [tab]: text }));
    store(tab, text === defaults[tab] ? null : text);
  };

  const reset = () => edit(defaults[tab]);

  const take = (t: Transition) =>
    guard("Stepping…", async () => {
      if (current) setTrace((tr) => [...tr, { label: t.label, from: current.id }]);
      await visit(t.target);
    });

  const back = () =>
    guard("Stepping…", async () => {
      const last = trace[trace.length - 1];
      if (!last) return;
      setTrace((tr) => tr.slice(0, -1));
      await visit(last.from);
    });

  const restart = () =>
    guard("Stepping…", async () => {
      if (initial === null) return;
      setTrace([]);
      await visit(initial);
    });

  const jump = (id: number) =>
    guard("Stepping…", async () => {
      setTrace([]);
      await visit(id);
    });

  const explore = () =>
    guard("Exploring…", async () => {
      if (current === null) return;
      setReachable(await call("wb_explore(I, M, J)", { I: current.id, M: 500 }));
    });

  const ask = () =>
    guard("Querying…", async () => {
      try {
        setAnswer(await call<Solutions>("wb_query(Q, M, J)", { Q: query, M: 50 }));
      } catch (e) {
        setAnswer(e instanceof Error ? e.message : String(e));
      }
    });

  const keys = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      run(files);
    } else if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = el;
      edit(files[tab].slice(0, s) + "    " + files[tab].slice(end));
      requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
    }
  };

  const gutter = useRef<HTMLPreElement>(null);
  const lines = files[tab].split("\n").length;

  return (
    <div className="wb">
      <header className="wb-head">
        <div>
          <h1>Semantics workbench</h1>
          <p>
            Edit the spec, the operational rules or the parser, then run. Rules run in SWI-Prolog in your browser.
          </p>
        </div>
        <div className="wb-run">
          <span className="wb-status">{busy}</span>
          <button className="primary" onClick={() => run(files)} disabled={busy === "Running…"}>
            Run <kbd>⌘↵</kbd>
          </button>
        </div>
      </header>

      <div className="wb-grid">
        <section className="wb-editor">
          <div className="wb-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                className={tab === t.key ? "on" : ""}
                onClick={() => setTab(t.key)}
              >
                {t.name}
                {files[t.key] !== defaults[t.key] && <span className="dot" title="edited" />}
              </button>
            ))}
            <span className="wb-file">{TABS.find((t) => t.key === tab)!.file}</span>
            <button className="quiet" onClick={reset} disabled={files[tab] === defaults[tab]}>
              Reset
            </button>
          </div>
          <div className="wb-code">
            <pre ref={gutter} className="wb-gutter" aria-hidden>
              {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
            </pre>
            <textarea
              value={files[tab]}
              onChange={(e) => edit(e.target.value)}
              onKeyDown={keys}
              onScroll={(e) => gutter.current && (gutter.current.scrollTop = e.currentTarget.scrollTop)}
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
              wrap="off"
              aria-label={`${tab} source`}
            />
          </div>
          {error && <pre className="wb-error">{error}</pre>}
          {log && (
            <details className="wb-log" open>
              <summary>Load messages</summary>
              <pre>{log}</pre>
            </details>
          )}
        </section>

        <section className="wb-side">
          <div className="wb-panel">
            <div className="wb-panel-head">
              <h2>State {current && <span className="muted">#{current.id}</span>}</h2>
              <div className="wb-actions">
                <button className="quiet" onClick={back} disabled={!trace.length}>
                  Back
                </button>
                <button className="quiet" onClick={restart} disabled={initial === null}>
                  Restart
                </button>
              </div>
            </div>
            <pre className="wb-state">{current?.text ?? " "}</pre>
            {trace.length > 0 && (
              <p className="wb-trace">
                <span className="muted">trace </span>
                {trace.map((t, i) => (
                  <span key={i} className="ev">
                    {t.label}
                  </span>
                ))}
              </p>
            )}
            {current && transitions.length === 0 && (
              <p className="wb-none">No transitions: this state is stuck.</p>
            )}
            {KINDS.map(({ kind, title, note }) => {
              const ts = transitions.filter((t) => t.kind === kind);
              if (!ts.length) return null;
              return (
                <div key={kind} className="wb-group">
                  <h3>
                    {title} <span className="muted">{note}</span>
                  </h3>
                  <ul>
                    {ts.map((t, i) => (
                      <li key={i}>
                        <button className={`wb-tr ${kind}`} onClick={() => take(t)}>
                          <span className="ev">{t.label}</span>
                          <span className="rule">{t.rule}</span>
                          {kind === "step" && (
                            <span className="to">
                              <span className="muted">#{t.target}</span> {t.text}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          <div className="wb-panel">
            <div className="wb-panel-head">
              <h2>Reachable states</h2>
              <button className="quiet" onClick={explore} disabled={!current}>
                Explore from #{current?.id ?? "–"}
              </button>
            </div>
            {reachable && (
              <>
                <p className="muted small">
                  {reachable.states.length} state{reachable.states.length === 1 ? "" : "s"}
                  {reachable.truncated ? " (stopped at the limit)" : ""},{" "}
                  {reachable.states.filter((s) => s.status === "deadlock").length} stuck. Drops and refusals are
                  left out since they never change the state.
                </p>
                <ul className="wb-states">
                  {reachable.states.map((s) => (
                    <li key={s.id}>
                      <button className={s.status} onClick={() => jump(s.id)}>
                        <span className="muted">#{s.id}</span>
                        <span className="text">{s.text}</span>
                        <span className="badge">{s.status === "live" ? `${s.steps} out` : s.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="wb-panel">
            <div className="wb-panel-head">
              <h2>Query</h2>
            </div>
            <form
              className="wb-query"
              onSubmit={(e) => {
                e.preventDefault();
                ask();
              }}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                spellCheck={false}
                autoCapitalize="off"
                aria-label="Prolog query"
              />
              <button className="quiet" type="submit">
                Ask
              </button>
            </form>
            {typeof answer === "string" && <pre className="wb-error">{answer}</pre>}
            {answer && typeof answer !== "string" && (
              <pre className="wb-answer">
                {answer.output}
                {answer.solutions.length === 0
                  ? "false."
                  : answer.solutions.map((s) => (s.length ? s.join(", ") : "true.")).join("\n")}
              </pre>
            )}
            {channels.length > 0 && (
              <p className="muted small">
                Channels:{" "}
                {channels.map((c) => `${c.mark === "world" ? "~" : c.mark === "agent" ? "^" : ""}${c.name}`).join(", ")}
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
