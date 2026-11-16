"use client";

import { useCallback, useMemo, useState } from "react";
import { load } from "../_complier/gate";
import { Controls, Flash, post, SpecPane, Switch, Thinking, useFollow, usePassword, usePlayback, VerdictChip } from "../kit";
import { initial, type AgentName, type Step } from "./model";
import { AGENTS, finished, first, tick, type Ask, type Frame } from "./run";
import { POLICY, UNIT } from "./spec";

const FIRST = first(initial);

function Log({ agent, steps, thinking }: { agent: AgentName; steps: Step[]; thinking: boolean }) {
  const log = useFollow(`${steps.length}${thinking}`);
  return (
    <ol ref={log} className="il-log" aria-label={`Agent ${agent}'s calls`} aria-live="polite">
      {steps.map((s, i) => {
        const stopped = s.verdict && s.verdict.k !== "allowed" ? s.verdict.k : null;
        return (
          <li key={i} className={`game-call il-${s.kind}${stopped ? ` is-${stopped}` : ""}`}>
            <div className="game-call-head">
              <code>{s.call}</code>
              {stopped && <VerdictChip k={stopped} />}
            </div>
            {s.verdict?.event && <span className="il-event">{s.verdict.event}</span>}
            {s.detail && <p className="game-detail">{s.detail}</p>}
          </li>
        );
      })}
      {thinking && <Thinking />}
    </ol>
  );
}

export default function PairIllustration() {
  const [complier, setComplier] = useState(false);
  const [unit, setUnit] = useState(UNIT);
  const [policy, setPolicy] = useState(POLICY);
  const loaded = useMemo(() => load(unit, policy), [unit, policy]);
  const errors = complier && "errors" in loaded ? loaded.errors : null;
  const [password, setPassword] = usePassword();

  const machine = complier && "machine" in loaded ? loaded.machine : undefined;
  const more = useCallback(
    (f: Frame) => {
      // The model's next call for one agent, from the password-gated route.
      const ask: Ask = async (messages) => {
        const { message, error } = await post("/api/demo2", { messages }, password, () => setPassword(null));
        if (error || !message) throw new Error(error ?? "no reply");
        return message;
      };
      return tick(f, machine, ask);
    },
    [machine, password, setPassword],
  );

  const run = usePlayback(FIRST, more, finished, !!errors || !password);
  const { frames, view, last, busy } = run;

  const desk = frames[view].desk;
  const shown = frames.slice(1, view + 1).map((f) => f.step!);
  const active = frames[view].step?.order;
  const breached = desk.inventory < desk.minimum;
  const thinking = (a: AgentName) => busy && view === last && !frames[last].done[a];

  return (
    <div className="il game il-two" tabIndex={-1} onKeyDown={run.onKeyDown} aria-label="Two agents illustration" role="group">
      <div className="il-body">
        <div className="il-desk">
          <header>
            <span className="il-eyebrow">Two agents · {complier ? "With" : "Without"} complier</span>
            <div className="il-stats">
              <div className="game-meter">
                <span className="game-small">Minimum inventory</span>
                <strong>{desk.minimum}</strong>
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
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {desk.orders.map((o) => (
                  <tr
                    key={o.id}
                    className={`is-${o.status === "sent" ? "accepted" : o.status}${o.shipped > 1 ? " is-double" : ""}${o.id === active ? " is-active" : ""}`}
                  >
                    <td className="il-id">{o.id}</td>
                    <td className="il-name">{o.name}</td>
                    <td className="il-qty">
                      {o.quantity}
                      {o.shipped > 1 && <span className="il-times"> ×{o.shipped}</span>}
                    </td>
                    <td className="il-note">{o.note}</td>
                    <td className="il-by">
                      {o.by.map((a, i) => (
                        <span key={i} className={`il-tag is-${a}`}>
                          {a}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="il-side">
          <SpecPane
            id="pair"
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
              <strong className="game-label">Two fulfilment agents</strong>
              <Switch
                on={complier}
                onToggle={() => {
                  setComplier((c) => !c);
                  run.reset();
                }}
              />
            </header>
            <p className="il-task">Both work the orders top to bottom. Reading the next order and sending it are separate calls.</p>
            <div className="il-pair">
              {AGENTS.map((name) => (
                <div key={name} className="il-one">
                  <span className="game-who">
                    <span className={`il-tag is-${name}`}>{name}</span> Agent {name}
                  </span>
                  <Log agent={name} steps={shown.filter((s) => s.agent === name)} thinking={thinking(name)} />
                </div>
              ))}
            </div>
            {run.error && <p className="game-error il-error">{run.error}</p>}
            <Controls
              id="pair"
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
