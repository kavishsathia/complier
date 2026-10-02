import { useMemo, useRef, useState } from "react";
import { CspError, Program } from "@/lib/csp/ast";
import { Monitor, formatEvent, parseEvent } from "@/lib/csp/monitor";
import { parse } from "@/lib/csp/parser";
import type { AssertionResult, ProveResponse } from "@/lib/csp/prove";
import styles from "./playground.module.css";

type Tab = "proof" | "run";

interface LogEntry {
  event: string;
  allowed: boolean;
  offered?: string[];
  error?: string;
}

export function Playground(props: {
  source: string;
  onSource: (s: string) => void;
  tab: Tab;
  onTab: (t: Tab) => void;
  runKey: number;
}) {
  const { source, onSource, tab, onTab, runKey } = props;
  const [proof, setProof] = useState<{ source: string; response: ProveResponse } | null>(null);
  const [proving, setProving] = useState(false);

  const parsed = useMemo((): { prog: Program } | { error: string; line: number } => {
    try {
      return { prog: parse(source) };
    } catch (e) {
      if (e instanceof CspError) return { error: e.message, line: e.line };
      return { error: String(e), line: 0 };
    }
  }, [source]);

  async function runProof() {
    onTab("proof");
    setProving(true);
    try {
      const res = await fetch("/api/prove", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source }),
      });
      setProof({ source, response: await res.json() });
    } catch {
      setProof({ source, response: { ok: false, error: "could not reach the prover", line: 0 } });
    } finally {
      setProving(false);
    }
  }

  return (
    <div className={styles.playground}>
      <div className={styles.toolbar}>
        <span className={styles.file}>account.csp</span>
        <button className={styles.primary} onClick={runProof} disabled={proving || "error" in parsed}>
          {proving ? "Proving…" : "Prove"}
        </button>
      </div>
      <Editor value={source} onChange={onSource} />
      {"error" in parsed && (
        <div className={styles.parseError}>
          {parsed.line ? `line ${parsed.line}: ` : ""}{parsed.error}
        </div>
      )}
      <div className={styles.tabs} role="tablist">
        <button role="tab" aria-selected={tab === "proof"} onClick={() => onTab("proof")}>Proof</button>
        <button role="tab" aria-selected={tab === "run"} onClick={() => onTab("run")}>Run</button>
      </div>
      <div className={styles.panel}>
        {tab === "proof" ? (
          <ProofPanel proof={proof} stale={proof !== null && proof.source !== source} proving={proving} />
        ) : "prog" in parsed ? (
          <RunPanel key={`${runKey}:${source}`} prog={parsed.prog} />
        ) : (
          <p className={styles.hint}>Fix the error above to run the system.</p>
        )}
      </div>
    </div>
  );
}

function Editor({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const lines = value.split("\n").length;
  const gutter = useRef<HTMLDivElement>(null);
  return (
    <div className={styles.editor}>
      <div className={styles.gutter} ref={gutter} aria-hidden>
        {Array.from({ length: lines }, (_, i) => <div key={i}>{i + 1}</div>)}
      </div>
      <textarea
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="CSP source"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onKeyDown={(e) => {
          if (e.key !== "Tab") return;
          e.preventDefault();
          const t = e.currentTarget;
          const { selectionStart: s, selectionEnd: end } = t;
          onChange(value.slice(0, s) + "  " + value.slice(end));
          requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2));
        }}
      />
    </div>
  );
}

function ProofPanel({ proof, stale, proving }: { proof: { response: ProveResponse } | null; stale: boolean; proving: boolean }) {
  if (!proof) {
    return <p className={styles.hint}>{proving ? "Asking Z3…" : "Press Prove to check every assertion against every possible run."}</p>;
  }
  const r = proof.response;
  return (
    <div className={stale ? styles.stale : undefined}>
      {stale && <p className={styles.hint}>The source changed since this proof. Press Prove again.</p>}
      {r.ok ? (
        r.results.map((a, i) => <AssertionView key={i} result={a} />)
      ) : (
        <p className={styles.parseError}>{r.line ? `line ${r.line}: ` : ""}{r.error}</p>
      )}
    </div>
  );
}

function AssertionView({ result }: { result: AssertionResult }) {
  return (
    <section className={styles.assertion}>
      <div className={styles.assertionHead}>
        <code>{result.process} :[always {result.assertion}]</code>
        <span className={styles[result.status]}>{result.status}</span>
      </div>
      {result.status === "holds" && (
        <>
          <p>Holds on every run, for any amounts and any number of events.</p>
          {result.certificate && (
            <details>
              <summary>Why it holds</summary>
              <p className={styles.hint}>
                Z3 found these facts. They are true at the start and every event preserves them,
                so no run can break the assertion.
              </p>
              {result.certificate.map((c) => (
                <div key={c.state} className={styles.invariant}>
                  <div className={styles.invariantState}>while {c.state}</div>
                  {c.facts.map((f) => <code key={f}>{f}</code>)}
                </div>
              ))}
            </details>
          )}
        </>
      )}
      {result.status === "violated" && (
        <>
          <p>A run that breaks it{result.trace ? `, in ${result.trace.length - 1} events:` : "."}</p>
          {result.trace && (
            <ol className={styles.trace}>
              {result.trace.map((s, i) => (
                <li key={i}>
                  <code className={styles.event}>{s.event ?? "start"}</code>
                  <span className={styles.state}>{s.state.join("   ")}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {result.note && <p className={styles.hint}>{result.note}</p>}
    </section>
  );
}

function RunPanel({ prog }: { prog: Program }) {
  const [states, setStates] = useState(() => new Monitor(prog).states);
  const monitor = useMemo(() => new Monitor(prog, states), [prog, states]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [input, setInput] = useState("");
  const field = useRef<HTMLInputElement>(null);

  function send(text: string) {
    if (!text.trim()) return;
    let entry: LogEntry;
    try {
      const ev = parseEvent(prog, text);
      const shown = formatEvent(prog, ev);
      const next = new Monitor(prog, states);
      if (next.fire(ev)) {
        setStates(next.states);
        entry = { event: shown, allowed: true };
      } else {
        entry = { event: shown, allowed: false, offered: monitor.offered() };
      }
    } catch (e) {
      entry = { event: text.trim(), allowed: false, error: e instanceof Error ? e.message : String(e) };
    }
    setLog((l) => [entry, ...l]);
    setInput("");
  }

  function reset() {
    setStates(new Monitor(prog).states);
    setLog([]);
  }

  const offered = monitor.offered();
  return (
    <div className={styles.run}>
      <div className={styles.runRow}>
        <div className={styles.label}>State</div>
        <div className={styles.stateList}>
          {monitor.describe()[0].map((s, i) => <code key={i}>{s}</code>)}
        </div>
      </div>
      <div className={styles.runRow}>
        <div className={styles.label}>Allowed now</div>
        <div className={styles.offers}>
          {offered.length ? (
            offered.map((o) => (
              <button
                key={o}
                className={styles.offer}
                onClick={() => {
                  setInput(o.replace(/\{.*\}$/, ""));
                  field.current?.focus();
                }}
              >
                {o}
              </button>
            ))
          ) : (
            <span className={styles.hint}>nothing: the system has stopped</span>
          )}
        </div>
      </div>
      <form
        className={styles.send}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          ref={field}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="an event, e.g. withdraw.Alice.80"
          spellCheck={false}
          autoCapitalize="off"
        />
        <button type="submit" className={styles.primary}>Send</button>
        <button type="button" onClick={reset} disabled={!log.length}>Reset</button>
      </form>
      <ol className={styles.log}>
        {log.map((e, i) => (
          <li key={log.length - i} className={e.allowed ? styles.allowedEntry : styles.blockedEntry}>
            <div>
              <code>{e.event}</code> {e.allowed ? "allowed" : e.error ? "not understood" : "blocked"}
            </div>
            {e.error && <div className={styles.hint}>{e.error}</div>}
            {e.offered && (
              <div className={styles.hint}>
                Not offered in this state. Allowed instead: {e.offered.length ? e.offered.join(", ") : "nothing"}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
