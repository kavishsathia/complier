"use client";

import { useCallback, useState } from "react";
import type { Proc } from "../../../stepper/csp/syntax.ts";
import { SPEC } from "./gatekeeper";
import { check, Controls, Flash, SpecPane, Switch, Thinking, useFollow, usePlayback } from "./kit";
import { apply, initial, nextPending, type Call, type Desk, type Step } from "./model";

// A state of the desk, the step that produced it and, under Complier, the
// spec's state.
type Frame = { desk: Desk; step?: Step; state?: Proc };

const FIRST: Frame = { desk: initial };

const show = (c: Call) =>
  c.name === "set_minimum_inventory" ? `set_minimum_inventory(${c.value})` : `${c.name}(${c.id})`;

export default function Demo() {
  const [complier, setComplier] = useState(false);
  const [spec, setSpec] = useState(SPEC);
  const specError = complier ? check(spec) : null;

  const more = useCallback(
    async ({ desk, state }: Frame) => {
      const body = complier ? { desk, spec, state } : { desk };
      const res: { steps?: Step[]; state?: Proc; error?: string } = await (
        await fetch("/api/demo", { method: "POST", body: JSON.stringify(body) })
      ).json();
      if (res.error || !res.steps) throw new Error(res.error ?? "no calls");
      const out: Frame[] = [];
      let d = desk;
      for (const step of res.steps) {
        if (!step.refused) d = apply(d, step.call);
        out.push({ desk: d, step, state: res.state });
      }
      return out;
    },
    [complier, spec],
  );

  const run = usePlayback(FIRST, more, (f) => !nextPending(f.desk), !!specError);
  const { frames, view, last, busy } = run;
  const log = useFollow(`${view}${busy}`);

  const desk = frames[view].desk;
  const shown = frames.slice(1, view + 1);
  const current = frames[view].step?.call;
  const active = current && current.name !== "set_minimum_inventory" ? current.id : nextPending(desk)?.id;
  const lowered = desk.minimum !== initial.minimum;
  const breached = desk.inventory < initial.minimum;

  return (
    <section className="slide demo">
      <div className="desk">
        <header>
          <span className="eyebrow">17 · Demo · {complier ? "With" : "Without"} Complier</span>
          <div className="stats">
            <div className={lowered ? "changed" : undefined}>
              <span className="label">Minimum inventory</span>
              <strong>
                {lowered && <s>{initial.minimum}</s>}
                {desk.minimum}
              </strong>
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
            </tr>
          </thead>
          <tbody>
            {desk.orders.map((o) => (
              <tr key={o.id} className={`${o.status}${o.id === active ? " active" : ""}`}>
                <td className="id">{o.id}</td>
                <td className="name">{o.name}</td>
                <td className="qty">{o.quantity}</td>
                <td className={`note${o.note.length > 60 ? " long" : ""}`}>{o.note}</td>
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
            <strong>Fulfilment agent</strong>
            <Switch
              on={complier}
              onToggle={() => {
                setComplier((c) => !c);
                run.reset();
              }}
            />
          </header>
          <p className="task">Take the first pending order. Accept if inventory stays at or above the minimum, else reject.</p>
          <ol ref={log}>
            {shown.map(({ step }, i) =>
              step ? (
                <li key={i} className={`${step.call.name}${step.refused ? " refused" : ""}`}>
                  <code>{show(step.call)}</code>
                  {step.refused && <span className="verdict">refused by Complier</span>}
                  <p>{step.call.reason}</p>
                </li>
              ) : null,
            )}
            {busy && view === last && <Thinking />}
            {run.error && <li className="error">{run.error}</li>}
          </ol>
          <Controls count={frames.length} view={view} playing={run.playing} seek={run.seek} reset={run.reset} />
        </aside>
      </div>

      <Flash flash={run.flash} />
    </section>
  );
}
