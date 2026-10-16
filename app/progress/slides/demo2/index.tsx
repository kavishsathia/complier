"use client";

import { useCallback, useMemo, useState } from "react";
import { parse } from "../demo/gatekeeper";
import { check, Controls, Flash, SpecPane, Switch, Thinking, useFollow, usePlayback } from "../demo/kit";
import { SPEC } from "./gatekeeper";
import { initial, type AgentName, type Step } from "./model";
import { AGENTS, finished, first, tick, type Frame } from "./run";

const FIRST = first(initial);

function Log({ steps, thinking }: { steps: Step[]; thinking: boolean }) {
  const log = useFollow(`${steps.length}${thinking}`);
  return (
    <ol ref={log}>
      {steps.map((s, i) => (
        <li key={i} className={`${s.kind}${s.refused ? " refused" : ""}`}>
          <code>{s.call}</code>
          {s.refused && <span className="verdict">refused</span>}
          {s.detail && <p>{s.detail}</p>}
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

  const parsed = useMemo(() => (complier && !specError ? parse(spec) : undefined), [complier, spec, specError]);
  const more = useCallback((f: Frame) => tick(f, parsed), [parsed]);

  const run = usePlayback(FIRST, more, finished, !!specError);
  const { frames, view, last, busy } = run;

  const desk = frames[view].desk;
  const shown = frames.slice(1, view + 1).map((f) => f.step!);
  const active = frames[view].step?.order;
  const breached = desk.inventory < desk.minimum;
  const thinking = (a: AgentName) => busy && view === last && !frames[last].done[a];

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
                className={`${o.status === "sent" ? "accepted" : o.status}${o.shipped > 1 ? " double" : ""}${o.id === active ? " active" : ""}`}
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
          <p className="task">
            Both work the orders top to bottom. Reading the next order and sending it are separate calls.
          </p>
          <div className="pair">
            {AGENTS.map((name) => (
              <div key={name} className="one">
                <span className="label">
                  <span className={`tag ${name}`}>{name}</span> Agent {name}
                </span>
                <Log steps={shown.filter((s) => s.agent === name)} thinking={thinking(name)} />
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
