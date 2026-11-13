"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { diagram, type Diagram } from "./diagram.ts";
import { EXAMPLE, EXAMPLES } from "./examples.ts";
import { arrange } from "./arrange.ts";
import { parsePolicy } from "./policy.ts";
import { SequenceSvg } from "./svg.tsx";

const KEY = "sequence:policy";

const build = (src: string): { d: Diagram; error: "" } | { d: null; error: string } => {
  try {
    return { d: diagram(parsePolicy(src)), error: "" };
  } catch (e) {
    return { d: null, error: e instanceof Error ? e.message : String(e) };
  }
};

export default function Sequence() {
  const [src, setSrc] = useState(EXAMPLE);
  const gutter = useRef<HTMLPreElement>(null);
  const svg = useRef<SVGSVGElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved !== null) setSrc(saved);
    } catch {}
  }, []);

  const edit = (text: string) => {
    setSrc(text);
    try {
      if (text === EXAMPLE) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, text);
    } catch {}
  };

  // Drawn as you type; the last diagram that worked stays up while the spec has an error.
  const deferred = useDeferredValue(src);
  const built = useMemo(() => build(deferred), [deferred]);
  const [shown, setShown] = useState<Diagram | null>(null);
  useEffect(() => {
    if (built.d) setShown(built.d);
  }, [built]);
  const d = built.d ?? shown;
  const laid = useMemo(() => (d ? arrange(d) : null), [d]);

  const download = () => {
    if (!svg.current) return;
    const blob = new Blob([svg.current.outerHTML], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "policy-sequence.svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  const keys = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: s, selectionEnd: end } = el;
      edit(src.slice(0, s) + "    " + src.slice(end));
      requestAnimationFrame(() => el.setSelectionRange(s + 4, s + 4));
    }
  };

  const lines = src.split("\n").length;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Link href="/" className="logo">
            complier
          </Link>
          <span className="sep">/</span>
          <span>Sequence</span>
        </div>
        <p className="tagline">A policy as a sequence diagram: the agents, the monitor and the happy path between them.</p>
        <nav className="topnav" aria-label="Site">
          <Link href="/stepper" prefetch={false}>
            Stepper
          </Link>
          <Link href="/playground" prefetch={false}>
            Playground
          </Link>
        </nav>
      </header>

      <div className="workspace">
        <aside className="pane editor">
          <div className="pane-head">
            <span className="file">policy.csp</span>
            <div className="grow" />
            <label className="field">
              <span className="sr-only">Open an example</span>
              <select
                value=""
                onChange={(e) => {
                  const ex = EXAMPLES.find((x) => x.name === e.target.value);
                  if (ex) edit(ex.src);
                }}
              >
                <option value="" disabled>
                  Examples
                </option>
                {EXAMPLES.map((x) => (
                  <option key={x.name}>{x.name}</option>
                ))}
              </select>
            </label>
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
              aria-label="policy source"
            />
          </div>
          <div className={`status ${built.error ? "bad" : ""}`}>
            {built.error ? (
              built.error
            ) : (
              <>
                <span className="ok-dot" />
                {built.d.agents.length} agent{built.d.agents.length === 1 ? "" : "s"} and the monitor
              </>
            )}
          </div>
          <details className="syntax">
            <summary>Policies</summary>
            <dl>
              <dt><code>datatype Act = a | b</code> · <code>datatype Value = done | failed</code></dt>
              <dd>the actions, and what calls return; <code>Returns(x) = {'{..}'}</code> says which values x&apos;s calls return</dd>
              <dt><code>Permit(x, \ v @ P)</code></dt>
              <dd><code>attempt.x -&gt; allow.x -&gt; result.x?v : Returns(x) -&gt; P</code>: an allowed call, then P with its result</dd>
              <dt><code>Deny(x, P)</code></dt>
              <dd><code>attempt.x -&gt; deny.x -&gt; P</code>: not drawn, only listed</dd>
              <dt><code>P [] Q</code> · <code>if c then P else Q</code> · <code>STOP</code> · <code>SKIP</code></dt>
              <dd>external choice · a choice on a value · no more attempts · termination</dd>
              <dt><code>datatype Role = w | r</code></dt>
              <dd>one agent per role, with <code>Permit(r, x, P)</code> and <code>Deny(r, x, P)</code></dd>
            </dl>
          </details>
        </aside>

        <main className="pane main">
          <div className="column seq-column">
            <section className="card">
              <div className="card-head">
                <h2>Sequence diagram</h2>
                {built.error && shown && <span className="pill">showing the last policy that worked</span>}
                <div className="grow" />
                <button className="btn ghost sm" onClick={download} disabled={!laid}>
                  Download SVG
                </button>
              </div>
              <div className="seq-scroll">
                {laid && <SequenceSvg ref={svg} layout={laid} title="The policy's happy path as a sequence diagram" />}
              </div>
            </section>

            <section className="card">
              <div className="card-head">
                <h2>Reading it</h2>
              </div>
              <ul className="seq-legend">
                <li>
                  <b>Lifelines.</b> They come from the spec&apos;s own <code>System</code>: its <code>Agent</code>{" "}
                  (<code>ControllableCHAOS</code>, one per role if there are roles) against the monitor,{" "}
                  <code>ComplierGuard(Policy)</code>. A spec without both doesn&apos;t draw.
                </li>
                <li>
                  <b>One bar per allowed call.</b> On the left of the monitor&apos;s bar, <code>attempt</code> comes in,{" "}
                  <code>allow</code> goes out, and the call&apos;s <code>result</code> comes back in. The agent&apos;s bar is
                  the call running.
                </li>
                <li>
                  <b>
                    <code>[]</code> external choice.
                  </b>{" "}
                  The monitor offers every operand at once; the agent&apos;s attempt picks one. The operands aren&apos;t
                  steps in a row.
                </li>
                <li>
                  <b>
                    <code>result of x</code>.
                  </b>{" "}
                  The call&apos;s value decides where the policy goes. Neither the agent nor the monitor picks it.
                </li>
                <li>
                  <b>Pills</b> are the monitor&apos;s named states; <code>↺ Name</code> goes back to an earlier one.
                </li>
              </ul>
            </section>

            {d && (
              <section className="card">
                <div className="card-head">
                  <h2>Not drawn</h2>
                </div>
                <ul className="seq-legend">
                  <li>
                    Only happy paths are drawn. The policy still does everything below, and complier still enforces it.
                  </li>
                  {d.omitted.map((o) => (
                    <li key={`${o.event}@${o.at}`}>
                      <code>{o.event}</code> in <code>{o.at}</code>
                    </li>
                  ))}
                  <li>
                    Refusals: an attempt the current state doesn&apos;t offer is refused, and the policy stays where it was.
                  </li>
                </ul>
              </section>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
