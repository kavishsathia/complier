"use client";

import { useCallback, useState } from "react";
import type { Proc } from "../../../stepper/csp/syntax.ts";
import { check, Controls, Flash, SpecPane, Switch, Thinking, useFollow, usePlayback } from "../demo/kit";
import { SPEC } from "./gatekeeper";
import { apply, finished, initial, type AgentName, type Desk, type Step } from "./model";

// A state of the desk, the step that produced it and, under Complier, the
// spec's state.
type Frame = { desk: Desk; step?: Step; state?: Proc };

const FIRST: Frame = { desk: initial };

const AGENTS: { name: AgentName; takes: string }[] = [
  { name: "A", takes: "First" },
  { name: "B", takes: "Last" },
];

function Log({ steps, thinking }: { steps: Step[]; thinking: boolean }) {
  const log = useFollow(`${steps.length}${thinking}`);
  return (
    <ol ref={log}>
      {steps.map((s, i) => (
        <li key={i} className={`${s.call.name}${s.refused ? " refused" : ""}`}>
          <code>
            {s.call.name}({s.call.id})
          </code>
          {s.refused && <span className="verdict">refused</span>}
          <p>{s.call.reason}</p>
        </li>
      ))}
      {thinking && <Thinking />}
    </ol>
  );
}

export default function Demo2() {
  const [complier, setComplier] = useState(false);
  const [spec, setSpec] = useState(SPEC);
  const specError = complier ? check(spec) : null;

  const more = useCallback(
    async ({ desk, state }: Frame) => {
      const body = complier ? { desk, spec, state } : { desk };
      const res: { steps?: Step[]; state?: Proc; error?: string } = await (
        await fetch("/api/demo2", { method: "POST", body: JSON.stringify(body) })
      ).json();
      if (res.error || !res.steps) throw new Error(res.error ?? "no calls");
      const out: Frame[] = [];
      let d = desk;
      for (const step of res.steps) {
        if (!step.refused) d = apply(d, step.agent, step.call);
        out.push({ desk: d, step, state: res.state });
      }
      return out;
    },
    [complier, spec],
  );

  const run = usePlayback(FIRST, more, (f) => finished(f.desk), !!specError);
  const { frames, view, last, busy } = run;

  const desk = frames[view].desk;
  const shown = frames.slice(1, view + 1).map((f) => f.step!);
  const active = frames[view].step?.call.id;
  const breached = desk.inventory < desk.minimum;
  const thinking = busy && view === last;

  return (
    <section className="slide demo demo2">
      <div className="desk">
        <header>
          <span className="eyebrow">18 · Demo · Two agents · {complier ? "With" : "Without"} Complier</span>
          <div className="stats">
            <div>
              <span className="label">Minimum inventory</span>
              <strong>{desk.minimum}</strong>
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
              <th className="label">By</th>
            </tr>
          </thead>
          <tbody>
            {desk.orders.map((o) => (
              <tr
                key={o.id}
                className={`${o.status}${o.shipped > 1 ? " double" : ""}${o.id === active ? " active" : ""}`}
              >
                <td className="id">{o.id}</td>
                <td className="name">{o.name}</td>
                <td className="qty">
                  {o.quantity}
                  {o.shipped > 1 && <span className="times"> ×{o.shipped}</span>}
                </td>
                <td className="note">{o.note}</td>
                <td className="by">
                  {o.by.map((a, i) => (
                    <span key={i} className={`tag ${a}`}>
                      {a}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="side">
        <SpecPane
          open={complier}
          spec={spec}
          error={specError}
          onChange={(s) => {
            setSpec(s);
            run.reset();
          }}
        />
        <aside className="agent">
          <header>
            <strong>Two fulfilment agents</strong>
            <Switch
              on={complier}
              onToggle={() => {
                setComplier((c) => !c);
                run.reset();
              }}
            />
          </header>
          <p className="task">Both read the desk at the same moment, then decide their order by the same rule.</p>
          <div className="pair">
            {AGENTS.map(({ name, takes }) => (
              <div key={name} className="one">
                <span className="label">
                  <span className={`tag ${name}`}>{name}</span> {takes} pending order
                </span>
                <Log steps={shown.filter((s) => s.agent === name)} thinking={thinking} />
              </div>
            ))}
          </div>
          {run.error && <p className="error">{run.error}</p>}
          <Controls count={frames.length} view={view} playing={run.playing} seek={run.seek} reset={run.reset} />
        </aside>
      </div>

      <Flash flash={run.flash} />
    </section>
  );
}
