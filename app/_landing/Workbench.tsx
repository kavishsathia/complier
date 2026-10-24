"use client";

// The live demo. Edits stay in the browser; Run loads the CEL engine (once), admits the
// translation unit with cel-java's verifier, classifies each call with cel-java's runtime and
// steps the contract with the site's CSP engine. Nothing calls Notion or a model.

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { notionSchemaHashes } from "../../packages/notion/tools.ts";
import Editor from "./Editor";
import { CALLS, CONTRACT, TRANSLATION, TRIES } from "./demo/example";
import type { Call, CallResult, Progress, RunResult } from "./demo/run";
import type { Verdict } from "./demo/translation";

type RunModule = typeof import("./demo/run");
type Tab = "translation" | "contract";
type Problem = { line: number; col?: number; where?: string; message: string };

let loading: Promise<RunModule> | null = null;
const runModule = () => (loading ??= import("./demo/run"));

let nextKey = 0;
const withKeys = (calls: Omit<Call, "key">[]): Call[] => calls.map((c) => ({ ...c, key: `call${nextKey++}` }));

const fingerprint = (t: string, c: string, calls: Call[]) => JSON.stringify([t, c, calls.map((x) => [x.key, x.tool, x.args])]);

const TOOLS = Object.keys(notionSchemaHashes);

const PHASES: Record<string, string> = {
  z3: "Loading Z3, the solver (17 MB, once)…",
  cheerpj: "Starting a Java runtime in the page (CheerpJ)…",
  jar: "Loading cel-java and its verifier (8.5 MB, once)…",
};

function progressText(p: Progress | null): string {
  if (!p || p.k === "idle") return "Starting…";
  if (p.k === "engine") return PHASES[p.phase];
  if (p.k === "admission") {
    const done = p.verdicts.filter(Boolean).length;
    return `Proving the translation unit: ${done} of ${p.labels.length} checks done`;
  }
  return `Classifying call ${Math.min(p.done + 1, p.total)} of ${p.total}`;
}

export default function Workbench() {
  const [translation, setTranslation] = useState(TRANSLATION);
  const [contract, setContract] = useState(CONTRACT);
  const [calls, setCalls] = useState<Call[]>(() => withKeys(CALLS));
  const [tab, setTab] = useState<Tab>("translation");
  const [running, setRunning] = useState(false);
  // What the engine is doing right now, whether for Run or getting ready in the background.
  const [activity, setActivity] = useState<Progress | null>(null);
  const [result, setResult] = useState<{ fp: string; res: RunResult } | null>(null);
  const [problems, setProblems] = useState<{ translation: Problem[]; contract: Problem[] }>({ translation: [], contract: [] });

  const editors = { translation: useRef<HTMLTextAreaElement>(null), contract: useRef<HTMLTextAreaElement>(null) };
  const callsRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const tabRefs = { translation: useRef<HTMLButtonElement>(null), contract: useRef<HTMLButtonElement>(null) };

  const fp = fingerprint(translation, contract, calls);
  const stale = result !== null && result.fp !== fp;

  // Nothing heavy loads with the page. The first click, tap, focus or edit inside the demo starts
  // the engine and proves the translation as it stands, so Run has less to wait for.
  const started = useRef(false);
  const latest = useRef(translation);
  latest.current = translation;
  const engage = useCallback(() => {
    if (started.current) return;
    started.current = true;
    runModule().then((m) => {
      m.subscribe((p) => setActivity(p.k === "idle" ? null : p));
      m.prepare(latest.current);
    });
  }, []);
  const onEdit = engage;

  // Structure and syntax are checked as you type (cheap, no CEL); CEL compiles on Run.
  useEffect(() => {
    if (!started.current) return;
    const t = setTimeout(() => {
      runModule().then((m) => {
        const { u, k } = m.validate(translation, contract);
        setProblems({
          translation: u.ok === true ? [] : u.errors.map((e) => ({ line: e.line, col: e.col, where: e.path, message: e.message })),
          contract: k.ok === true ? [] : [{ line: k.error.line, message: k.error.message }],
        });
      });
    }, 250);
    return () => clearTimeout(t);
  }, [translation, contract]);

  // Stacked on a narrow screen, the results sit below the editor: once they've rendered, bring them
  // into view under the sticky bar, unless they're already showing there.
  useEffect(() => {
    const panel = callsRef.current;
    if (!result || !panel || !window.matchMedia("(max-width: 1000px)").matches) return;
    const top = panel.getBoundingClientRect().top;
    const bar = barRef.current?.getBoundingClientRect().bottom ?? 0;
    if (top > window.innerHeight * 0.6 || top < bar - 1) {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      panel.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
  }, [result]);

  // CEL compile errors from the last run belong to the translation it ran on.
  const compileProblems: Problem[] =
    !stale && result?.res.k === "not-admitted" && result.res.admission.ok === false && result.res.admission.compile
      ? result.res.admission.compile.map((c) => ({ line: c.line, where: c.path, message: c.message }))
      : [];
  const shown = { translation: [...problems.translation, ...compileProblems], contract: problems.contract };

  async function run() {
    if (running) return;
    const snapshot = { translation, contract, calls };
    const at = fingerprint(translation, contract, calls);
    engage();
    setRunning(true);
    try {
      const m = await runModule();
      const res = await m.run(snapshot);
      if (res.k === "invalid") {
        setProblems({
          translation: (res.unit ?? []).map((e) => ({ line: e.line, col: e.col, where: e.path, message: e.message })),
          contract: res.contract ? [{ line: res.contract.line, message: res.contract.message }] : [],
        });
        if (!res.unit && res.contract) setTab("contract");
        else if (res.unit && !res.contract) setTab("translation");
      }
      setResult({ fp: at, res });
    } catch (e) {
      setResult({ fp: at, res: { k: "engine-failed", message: (e as Error).message } });
    } finally {
      setRunning(false);
    }
  }

  function reset() {
    setTranslation(TRANSLATION);
    setContract(CONTRACT);
    setCalls(withKeys(CALLS));
    setResult(null);
    setProblems({ translation: [], contract: [] });
  }

  function goTo(which: Tab, line: number) {
    const select = () => {
      const el = editors[which].current;
      if (!el) return;
      const text = el.value.split("\n");
      const start = text.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
      el.focus();
      el.setSelectionRange(start, start + (text[line - 1]?.length ?? 0));
    };
    // In the open tab, focus right away: phones only raise the keyboard inside the tap itself.
    if (which === tab) select();
    else {
      setTab(which);
      requestAnimationFrame(select);
    }
  }

  function onTabKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const from: Tab = e.currentTarget.id === "tab-contract" ? "contract" : "translation";
    const next: Tab = e.key === "Home" ? "translation" : e.key === "End" ? "contract" : from === "translation" ? "contract" : "translation";
    setTab(next);
    tabRefs[next].current?.focus();
  }

  const runOnShortcut = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  };

  const setCall = (key: string, patch: Partial<Call>) => {
    setCalls((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
    onEdit();
  };

  const byKey = useMemo(() => {
    const m = new Map<string, CallResult>();
    if (result?.res.k === "done") for (const c of result.res.calls) m.set(c.key, c);
    return m;
  }, [result]);

  const status = running
    ? progressText(activity)
    : stale
      ? "Edited since the last run. Run again to update the results."
      : result
        ? summary(result.res)
        : activity
          ? `Getting ready: ${progressText(activity)}`
          : started.current
            ? "Ready. Run checks every call against both files."
            : "Run checks every call against both files. The first run loads Java and Z3 into this page (about 26 MB) and takes up to a minute.";

  return (
    <div className="bench" onKeyDown={runOnShortcut} onPointerDown={engage} onFocus={engage}>
      <div className="bench-bar" ref={barRef}>
        <div role="tablist" aria-label="Rules" className="tabs">
          {(["translation", "contract"] as const).map((t) => (
            <button
              key={t}
              ref={tabRefs[t]}
              role="tab"
              id={`tab-${t}`}
              aria-selected={tab === t}
              aria-controls={`panel-${t}`}
              tabIndex={tab === t ? 0 : -1}
              className="tab"
              onClick={() => setTab(t)}
              onKeyDown={onTabKey}
            >
              {t === "translation" ? "Translation" : "Contract"}
              <span className="tab-kind">{t === "translation" ? "YAML + CEL" : "CSP"}</span>
              {shown[t].length > 0 && <span className="tab-dot" aria-label={`${shown[t].length} error${shown[t].length > 1 ? "s" : ""}`} />}
            </button>
          ))}
        </div>
        <div className="bench-actions">
          <button type="button" className="btn btn-quiet reset-bar" onClick={reset}>
            Reset example
          </button>
          <button type="button" className="btn btn-run" onClick={run} disabled={running} aria-describedby="bench-status">
            <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
              <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
            </svg>
            {running ? "Running…" : "Run"}
          </button>
        </div>
        {/* On a narrow screen the bar stays in view while you scroll the demo, and so does the
            progress of a run. The status line below says the same to screen readers. */}
        {running && (
          <p className="bar-progress" aria-hidden="true">
            {status}
          </p>
        )}
      </div>

      <div className="bench-body">
        <div className="bench-editors">
          {(["translation", "contract"] as const).map((t) => (
            <div key={t} role="tabpanel" id={`panel-${t}`} aria-labelledby={`tab-${t}`} hidden={tab !== t} className="panel">
              <p className="panel-note" id={`note-${t}`}>
                {t === "translation"
                  ? "Rules that turn each Notion call into a contract event. complier proves no call matches two rules before it loads them."
                  : "The order events may happen in. An agent's call goes through only if the contract allows its event now."}
              </p>
              <Editor
                ref={editors[t]}
                id={`editor-${t}`}
                label={t === "translation" ? "Translation unit, YAML with CEL rules" : "Contract, CSP"}
                language={t === "translation" ? "yaml" : "csp"}
                value={t === "translation" ? translation : contract}
                onChange={t === "translation" ? setTranslation : setContract}
                onEdit={onEdit}
                errorLines={shown[t].map((p) => p.line)}
                describedBy={`note-${t}${shown[t].length ? ` problems-${t}` : ""}`}
              />
              {shown[t].length > 0 && (
                <ul className="problems" id={`problems-${t}`}>
                  {shown[t].map((p, i) => (
                    <li key={i}>
                      <button type="button" className="problem" onClick={() => goTo(t, p.line)}>
                        <span className="problem-at">
                          line {p.line}
                          {p.col ? `:${p.col}` : ""}
                        </span>
                        {p.where && <span className="problem-where">{p.where}</span>}
                        <span className="problem-msg">{p.message}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <div className="tries">
            <span className="tries-label">Try</span>
            {TRIES.map((t) => {
              const text = t.tab === "translation" ? translation : contract;
              const available = text.includes(t.find);
              return (
                <button
                  key={t.label}
                  type="button"
                  className="try"
                  disabled={!available}
                  title={available ? undefined : "Already changed. Reset example to try it again."}
                  onClick={() => {
                    const set = t.tab === "translation" ? setTranslation : setContract;
                    set(text.replace(t.find, t.replace));
                    setTab(t.tab);
                    onEdit();
                  }}
                >
                  {t.label}
                </button>
              );
            })}
            {/* Phones keep Reset here, under the editor; their bar only has room for Run. */}
            <button type="button" className="btn btn-quiet reset-tries" onClick={reset}>
              Reset example
            </button>
          </div>
        </div>

        <section className="bench-calls" aria-labelledby="calls-title" ref={callsRef}>
          <div className="calls-head">
            <h3 id="calls-title">Calls the agent makes</h3>
            <p>In order, as JSON arguments. Edit any of them.</p>
          </div>
          {activity?.k === "admission" && (running || !result) ? (
            <Proving labels={activity.labels} verdicts={activity.verdicts} background={!running} />
          ) : (
            result && !running && <Outcome res={result.res} stale={stale} />
          )}
          <ol className={`calls${stale ? " is-stale" : ""}`}>
            {calls.map((c, i) => (
              <li key={c.key} className="call">
                <div className="call-edit">
                  <span className="call-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  <input
                    className="call-tool"
                    aria-label={`Call ${i + 1}: tool`}
                    list="notion-tools"
                    value={c.tool}
                    spellCheck={false}
                    autoCapitalize="off"
                    onChange={(e) => setCall(c.key, { tool: e.target.value })}
                  />
                  <button
                    type="button"
                    className="call-remove"
                    aria-label={`Remove call ${i + 1}`}
                    onClick={() => setCalls((cs) => cs.filter((x) => x.key !== c.key))}
                  >
                    <svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
                      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                  </button>
                  <textarea
                    className="call-args"
                    aria-label={`Call ${i + 1}: arguments, JSON`}
                    value={c.args}
                    rows={2}
                    spellCheck={false}
                    autoCapitalize="off"
                    onChange={(e) => setCall(c.key, { args: e.target.value })}
                  />
                </div>
                {byKey.has(c.key) && <CallOutcome r={byKey.get(c.key)!} />}
              </li>
            ))}
          </ol>
          <datalist id="notion-tools">
            {TOOLS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <button
            type="button"
            className="btn btn-quiet add-call"
            onClick={() => {
              setCalls((cs) => [...cs, ...withKeys([{ tool: "notion-fetch", args: `{"id": "launch-post"}` }])]);
              onEdit();
            }}
          >
            + Add a call
          </button>
        </section>
      </div>

      <div className="bench-status" id="bench-status" role="status" aria-live="polite">
        <span
          className={`status-dot is-${running || (activity && !result) ? "busy" : stale ? "stale" : result ? statusKind(result.res) : "idle"}`}
          aria-hidden="true"
        />
        <span>{status}</span>
        <span className="status-hint">Ctrl/⌘ + Enter runs</span>
      </div>
    </div>
  );
}

function statusKind(res: RunResult) {
  return res.k === "done" ? "ok" : "bad";
}

function summary(res: RunResult): string {
  switch (res.k) {
    case "invalid":
      return "Not run: fix the marked lines first.";
    case "engine-failed":
      return "The CEL engine couldn't run, so nothing was classified.";
    case "not-admitted":
      return "complier refuses this translation unit, so no call would reach Notion.";
    case "done": {
      const f = res.calls.filter((c) => c.verdict.k === "forwarded").length;
      return `Unit admitted. ${f} of ${res.calls.length} calls forwarded, ${res.calls.length - f} refused.`;
    }
  }
}

const witnessText = (v: Verdict) =>
  "witness" in v && v.witness && Object.keys(v.witness).length
    ? Object.entries(v.witness)
        .map(([k, x]) => `${k} = ${x}`)
        .join(", ")
    : null;

const VERDICT_LABEL: Record<Verdict["kind"], string> = {
  proved: "proved",
  refuted: "fails",
  "not-proven": "inconclusive",
  error: "error",
};

function Outcome({ res, stale }: { res: RunResult; stale: boolean }) {
  const cls = `outcome${stale ? " is-stale" : ""}`;
  if (res.k === "invalid") {
    return (
      <div className={`${cls} is-bad`}>
        <strong>Nothing ran.</strong> The {res.unit && res.contract ? "translation and the contract have" : res.unit ? "translation has" : "contract has"} errors,
        marked on their lines.
      </div>
    );
  }
  if (res.k === "engine-failed") {
    return (
      <div className={`${cls} is-bad`}>
        <strong>The CEL engine couldn&apos;t run.</strong> {res.message} No call was classified, so there are no results to show. Check your
        connection and run again.
      </div>
    );
  }
  const checks = res.admission.checks;
  if (res.k === "not-admitted") {
    const failed = checks.filter((c) => c.verdict.kind !== "proved");
    return (
      <div className={`${cls} is-bad`}>
        <strong>complier would refuse this translation unit</strong>
        {res.admission.ok === false && res.admission.compile ? (
          <> because a rule doesn&apos;t compile. The proxy offers no tools until it&apos;s fixed.</>
        ) : (
          <>
            . The proxy offers no tools until it&apos;s fixed.
            <ul className="checks">
              {failed.map((c) => (
                <li key={c.label}>
                  <span className={`check is-${c.verdict.kind}`}>{VERDICT_LABEL[c.verdict.kind]}</span> {c.label}
                  {witnessText(c.verdict) && (
                    <span className="witness">
                      {c.verdict.kind === "refuted" && c.label.startsWith("No call") ? "Both match: " : "Example: "}
                      <code>{witnessText(c.verdict)}</code>
                    </span>
                  )}
                  {c.verdict.kind !== "refuted" && <span className="witness">{c.verdict.detail.split("\n")[0]}</span>}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }
  return (
    <details className={`${cls} is-ok`}>
      <summary>
        <strong>Unit admitted.</strong> cel-java&apos;s verifier proved its rules never overlap and, with the fallback, cover every
        call. The contract starts at <code>{res.start}</code>.
      </summary>
      <ul className="checks">
        {checks.map((c) => (
          <li key={c.label}>
            <span className={`check is-${c.verdict.kind}`}>{VERDICT_LABEL[c.verdict.kind]}</span> {c.label}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Proving({ labels, verdicts, background }: { labels: string[]; verdicts: (Verdict | null)[]; background: boolean }) {
  const current = verdicts.findIndex((v) => v === null);
  return (
    <div className="outcome is-busy">
      <strong>{background ? "Proving the translation unit before you run." : "Proving the translation unit."}</strong> complier admits a
      unit only if cel-java&apos;s verifier proves every check.
      <ul className="checks">
        {labels.map((l, i) => {
          const v = verdicts[i];
          const failedBefore = verdicts.slice(0, i).some((x) => x && x.kind !== "proved");
          return (
            <li key={l}>
              <span className={`check is-${v ? v.kind : i === current && !failedBefore ? "running" : "pending"}`}>
                {v ? VERDICT_LABEL[v.kind] : i === current && !failedBefore ? "checking" : "waiting"}
              </span>{" "}
              {l}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CallOutcome({ r }: { r: CallResult }) {
  const t = r.translated;
  const forwarded = r.verdict.k === "forwarded";
  let event: React.ReactNode;
  if (t.k === "hidden") event = <span className="ev-note">read-only, hidden: not checked</span>;
  else if (t.k === "not-offered") event = <span className="ev-note">not in the unit</span>;
  else if (t.k === "args-error") event = <span className="ev-note">bad JSON: {t.message}</span>;
  else if (t.event)
    event = (
      <>
        <span className="ev">{t.event}</span>
        <span className="ev-note">{t.rule === "fallback" ? "fallback: no rule matched" : `rule ${t.rule}`}</span>
      </>
    );
  else {
    const c = t.c;
    event = (
      <span className="ev-note">
        {c.kind === "ambiguous"
          ? "matches more than one rule"
          : c.kind === "outside-domain"
            ? "outside the domain"
            : c.kind === "input-error"
              ? c.errors.map((e) => `${e.field}: ${e.error}`).join("; ")
              : c.kind === "rule-error"
                ? c.errors.map((e) => `${e.rule}: ${e.error}`).join("; ")
                : "no event"}
      </span>
    );
  }
  return (
    <div className={`call-out ${forwarded ? "is-ok" : "is-bad"}`}>
      <div className="call-event">
        <span className="arrow" aria-hidden="true">
          →
        </span>
        {event}
      </div>
      <div className="call-verdict">
        <span className="verdict-icon" aria-hidden="true">
          {forwarded ? "✓" : "✕"}
        </span>
        <span>
          <strong>{forwarded ? "Forwarded to Notion" : "Refused"}</strong>
          {r.verdict.k === "refused" ? `: ${r.verdict.why}.` : r.verdict.to?.length ? `. Contract moves to ${r.verdict.to.join(" or ")}.` : "."}
        </span>
      </div>
      <div className="call-next">
        {r.next.length ? (
          <>
            Next it allows: {r.next.map((e, i) => (
              <span key={e}>
                {i > 0 && (i === r.next.length - 1 ? " or " : ", ")}
                <span className="ev ev-small">{e}</span>
              </span>
            ))}
          </>
        ) : (
          "Nothing more is allowed."
        )}
      </div>
    </div>
  );
}
