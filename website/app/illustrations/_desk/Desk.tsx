"use client";

import { useCallback, useMemo, useState } from "react";
import { load } from "../_complier/gate";
import type { PState } from "../_complier/policy";
import { Controls, Flash, post, SpecPane, Switch, Thinking, useFollow, usePassword, usePlayback, VerdictChip } from "../kit";
import { apply, initial, nextPending, ran, type Call, type Desk, type Step } from "./model";
import { POLICY, UNIT } from "./spec";

// A state of the desk, the step that produced it and, under complier, the policy's state.
type Frame = { desk: Desk; step?: Step; state?: PState };

const FIRST: Frame = { desk: initial };

const show = (c: Call) => (c.name === "set_minimum_inventory" ? `set_minimum_inventory(${c.value})` : `${c.name}(${c.id})`);

export default function DeskIllustration() {
  const [complier, setComplier] = useState(false);
  const [unit, setUnit] = useState(UNIT);
  const [policy, setPolicy] = useState(POLICY);
  const loaded = useMemo(() => load(unit, policy), [unit, policy]);
  const errors = complier && "errors" in loaded ? loaded.errors : null;
  const [password, setPassword] = usePassword();

  const more = useCallback(
    async ({ desk, state }: Frame) => {
      const body = complier ? { desk, unit, policy, state } : { desk };
      const res: { steps?: Step[]; state?: PState; error?: string } = await post("/api/demo", body, password, () => setPassword(null));
      if (res.error || !res.steps) throw new Error(res.error ?? "no calls");
      const out: Frame[] = [];
      let d = desk;
      for (const step of res.steps) {
        if (ran(step)) d = apply(d, step.call);
        out.push({ desk: d, step, state: res.state });
      }
      return out;
    },
    [complier, unit, policy, password, setPassword],
  );

  const run = usePlayback(FIRST, more, (f) => !nextPending(f.desk), !!errors || !password);
  const { frames, view, last, busy } = run;
  const log = useFollow(`${view}${busy}`);

  const desk = frames[view].desk;
  const shown = frames.slice(1, view + 1);
  const current = frames[view].step?.call;
  const active = current && current.name !== "set_minimum_inventory" ? current.id : nextPending(desk)?.id;
  const lowered = desk.minimum !== initial.minimum;
  const breached = desk.inventory < initial.minimum;

  return (
    <div className="il game" tabIndex={-1} onKeyDown={run.onKeyDown} aria-label="Order desk illustration" role="group">
      <div className="il-body">
        <div className="il-desk">
          <header>
            <span className="il-eyebrow">{complier ? "With" : "Without"} complier</span>
            <div className="il-stats">
              <div className={`game-meter${lowered ? " is-breached" : ""}`}>
                <span className="game-small">Minimum inventory</span>
                <strong>
                  {lowered && <s>{initial.minimum}</s>}
                  {desk.minimum}
                </strong>
              </div>
              <div className={`game-meter${breached ? " is-breached" : ""}`}>
                <span className="game-small">Current inventory</span>
                <strong>{desk.inventory}</strong>
              </div>
            </div>
          </header>

          <div className="il-table">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Customer</th>
                  <th>Qty</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {desk.orders.map((o) => (
                  <tr key={o.id} className={`is-${o.status}${o.id === active ? " is-active" : ""}`}>
                    <td className="il-id">{o.id}</td>
                    <td className="il-name">{o.name}</td>
                    <td className="il-qty">{o.quantity}</td>
                    <td className={`il-note${o.note.length > 60 ? " is-long" : ""}`}>{o.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="il-side">
          <SpecPane
            id="desk"
            open={complier}
            unit={unit}
            policy={policy}
            errors={errors}
            onUnit={(s) => {
              setUnit(s);
              run.reset();
            }}
            onPolicy={(s) => {
              setPolicy(s);
              run.reset();
            }}
          />
          <aside className="il-agent">
            <header>
              <strong className="game-label">Fulfilment agent</strong>
              <Switch
                on={complier}
                onToggle={() => {
                  setComplier((c) => !c);
                  run.reset();
                }}
              />
            </header>
            <p className="il-task">Take the first pending order. Accept if inventory stays at or above the minimum, else reject.</p>
            <ol ref={log} className="il-log" aria-live="polite">
              {shown.map(({ step }, i) =>
                step ? (
                  <li
                    key={i}
                    className={`game-call il-${step.call.name}${step.verdict && step.verdict.k !== "allowed" ? ` is-${step.verdict.k}` : ""}`}
                  >
                    <div className="game-call-head">
                      <code>{show(step.call)}</code>
                      {step.verdict && step.verdict.k !== "allowed" && <VerdictChip k={step.verdict.k} />}
                    </div>
                    {step.verdict?.event && <span className="il-event">{step.verdict.event}</span>}
                    <p className="game-detail">{step.call.reason}</p>
                  </li>
                ) : null,
              )}
              {busy && view === last && <Thinking />}
              {run.error && <li className="game-error">{run.error}</li>}
            </ol>
            <Controls
              id="desk"
              count={frames.length}
              view={view}
              playing={run.playing}
              busy={busy}
              finished={run.finished}
              seek={run.seek}
              toggle={run.toggle}
              reset={run.reset}
              password={password}
              onPassword={setPassword}
            />
          </aside>
        </div>
      </div>

      <Flash flash={run.flash} />
    </div>
  );
}
