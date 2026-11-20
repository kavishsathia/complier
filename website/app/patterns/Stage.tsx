"use client";

// A pattern's flow, animated. The agents sit where the pattern puts them, linked by who hands work to
// whom; complier's machine runs beneath them. Each step is an agent's call travelling down to the
// machine and the verdict it gets (allowed, refused, held, denied), or a call's result coming back
// up. Each agent shows what the policy lets it do at that moment. Everything shown comes from
// playing the flow over the example's compiled policy (flow.ts), as the daemon would.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Pattern } from "./_data/patterns.ts";
import { play, type Snapshot } from "./flow.ts";

const NODE_W = 164;
const NODE_H = 58;
const RAIL_Y = 290;
const RAIL_H = 44;
const H = RAIL_Y + RAIL_H + 30;
const TRAVEL_MS = 700;
const STEP_MS = 2900;

type Tone = "ready" | "waiting" | "running" | "held" | "done";
type ChipTone = "allowed" | "refused" | "denied" | "held";

function status(role: string, s: Snapshot): { text: string; tone: Tone } {
  if (s.held[role]) return { text: `held: ${s.held[role]}`, tone: "held" };
  if (s.running[role]) return { text: `running: ${s.running[role]}`, tone: "running" };
  if (s.status !== "running") return { text: s.status === "finished" ? "finished" : "stopped", tone: "done" };
  const next = s.next[role] ?? [];
  return next.length ? { text: `may ${next.join(", ")}`, tone: "ready" } : { text: "waiting", tone: "waiting" };
}

// A link from one agent to another, from edge to edge of their boxes; offset sideways when the two
// link both ways, so the arrows don't overlap. `spread` shifts where it arrives, when several links
// arrive at the same agent.
function link(a: { x: number; y: number }, b0: { x: number; y: number }, both: boolean, spread = 0) {
  const b = { x: b0.x + spread, y: b0.y };
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const hw = NODE_W / 2 + 8;
  const hh = NODE_H / 2 + 8;
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  const off = both ? 9 : 0;
  const nx = (-dy / len) * off;
  const ny = (dx / len) * off;
  return { x1: a.x + dx * t + nx, y1: a.y + dy * t + ny, x2: b.x - dx * t + nx, y2: b.y - dy * t + ny };
}

const pillWidth = (text: string) => text.length * 8 + 22;

export default function Stage({ pattern }: { pattern: Pattern }) {
  const { start, played } = useMemo(() => play(pattern), [pattern]);
  const at = Object.fromEntries(pattern.nodes.map((n) => [n.role, n]));
  // `shown` steps have happened; the last of them is animating until it lands.
  const [shown, setShown] = useState(0);
  const [landed, setLanded] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [still, setStill] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const go = useCallback(
    (to: number, animate: boolean) => {
      setShown(to);
      setLanded(!animate || still || to === 0);
    },
    [still],
  );

  // Respect reduced motion: no autoplay, no travelling.
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(q.matches);
    const on = () => setStill(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);

  // Start playing the first time the stage comes into view.
  useEffect(() => {
    if (still || !ref.current) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && !started.current) {
        started.current = true;
        setPlaying(true);
      }
    }, { threshold: 0.4 });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [still]);

  useEffect(() => {
    if (landed) return;
    const t = setTimeout(() => setLanded(true), TRAVEL_MS);
    return () => clearTimeout(t);
  }, [landed, shown]);

  useEffect(() => {
    if (!playing) return;
    const end = shown >= played.length;
    const t = setTimeout(() => go(end ? 0 : shown + 1, !end), end ? 4500 : shown === 0 ? 900 : STEP_MS);
    return () => clearTimeout(t);
  }, [playing, shown, played.length, go]);

  const current = shown > 0 ? played[shown - 1]! : null;
  const before = shown > 1 ? played[shown - 2]!.after : start;
  const snap = shown === 0 ? start : landed ? current!.after : before;

  // The verdicts on the machine: held calls stay marked until answered; this step's own verdict, and
  // any held call it answered, show once its call has landed.
  const chips = new Map<string, { text: string; tone: ChipTone }>();
  for (const role of Object.keys(snap.held)) chips.set(role, { text: "held", tone: "held" });
  if (current && landed) {
    for (const h of current.happened) {
      if (h.kind === "act") chips.set(h.role, { text: h.outcome, tone: h.outcome });
      if (h.kind === "verdict") chips.set(h.role, { text: h.outcome, tone: h.outcome });
    }
  }

  const step = current?.step;
  const own = current?.happened[0];
  const pill =
    step && own && !landed
      ? "act" in step
        ? { role: step.role, text: step.act, down: true }
        : { role: step.role, text: own.kind === "result" ? own.value : "", down: false }
      : null;

  const pairs = new Set(pattern.links.map(([a, b]) => `${a}>${b}`));
  // The drawing is cropped to its agents: drawn at its own size where there's room, and scaled down
  // on a phone only as far as its text stays legible (then it scrolls).
  const xs = pattern.nodes.map((n) => n.x);
  const pad = NODE_W / 2 + 28;
  let x0 = Math.min(...xs) - pad;
  let x1 = Math.max(...xs) + pad;
  if (x1 - x0 < 460) [x0, x1] = [(x0 + x1) / 2 - 230, (x0 + x1) / 2 + 230];
  const vw = x1 - x0;
  const done = snap.status !== "running";

  return (
    <figure className="pt-stage" ref={ref}>
      <div className="pt-stage-scroll">
        <svg
          viewBox={`${x0} 0 ${vw} ${H}`}
          style={{ maxWidth: `${vw}px`, minWidth: `${Math.round(vw * 0.72)}px` }}
          role="img" aria-label={`${pattern.name}: the agents and complier's machine`}>
          <defs>
            <marker id={`arrow-${pattern.slug}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0L10 5L0 10z" className="pt-arrowhead" />
            </marker>
          </defs>

          {pattern.links.map(([a, b]) => {
            const into = pattern.links.filter(([, t]) => t === b).map(([f]) => f);
            const spread = into.length > 1 ? (into.indexOf(a) - (into.length - 1) / 2) * 34 : 0;
            const l = link(at[a]!, at[b]!, pairs.has(`${b}>${a}`), spread);
            return <line key={`${a}>${b}`} {...l} className="pt-link" markerEnd={`url(#arrow-${pattern.slug})`} />;
          })}

          {pattern.nodes.map((n) => (
            <line key={`wire-${n.role}`} x1={n.x} y1={n.y + NODE_H / 2} x2={n.x} y2={RAIL_Y} className="pt-wire" />
          ))}

          <rect x={x0 + 16} y={RAIL_Y} width={vw - 32} height={RAIL_H} rx={12} className={`pt-rail${done ? " is-done" : ""}`} />
          {pattern.nodes.map((n) => (
            <circle key={`port-${n.role}`} cx={n.x} cy={RAIL_Y} r={3.5} className="pt-port" />
          ))}
          <text x={x0 + 24} y={RAIL_Y + RAIL_H + 20} className="pt-rail-label">
            <tspan className="pt-rail-name">complier</tspan> machine {pattern.slug} · {snap.status === "running" ? "running" : snap.status}
          </text>

          {[...chips].map(([role, c]) => {
            const x = at[role]!.x;
            const w = pillWidth(c.text) - 4;
            return (
              <g key={`chip-${role}-${shown}-${c.text}`} className={`pt-chip is-${c.tone}`}>
                <rect x={x - w / 2} y={RAIL_Y + RAIL_H / 2 - 12} width={w} height={24} rx={12} />
                <text x={x} y={RAIL_Y + RAIL_H / 2 + 4.5}>
                  {c.text}
                </text>
              </g>
            );
          })}

          {pattern.nodes.map((n) => {
            const s = status(n.role, snap);
            const acting = step?.role === n.role;
            return (
              <g key={n.role} className={`pt-node is-${s.tone}${acting ? " is-acting" : ""}`}>
                <rect x={n.x - NODE_W / 2} y={n.y - NODE_H / 2} width={NODE_W} height={NODE_H} rx={12} />
                <text x={n.x} y={n.y - 4} className="pt-node-role">
                  {n.role}
                </text>
                <text x={n.x} y={n.y + 15} className="pt-node-status">
                  {s.text}
                </text>
              </g>
            );
          })}

          {pill && (
            <g
              key={`pill-${shown}`}
              className={`pt-pill ${pill.down ? "is-call" : "is-result"}`}
              style={{ "--dy": `${pill.down ? RAIL_Y - (at[pill.role]!.y + NODE_H / 2) : -(RAIL_Y - (at[pill.role]!.y + NODE_H / 2))}px`, animationDuration: `${TRAVEL_MS}ms` } as React.CSSProperties}
            >
              <rect
                x={at[pill.role]!.x - pillWidth(pill.text) / 2}
                y={(pill.down ? at[pill.role]!.y + NODE_H / 2 : RAIL_Y) - 11}
                width={pillWidth(pill.text)}
                height={22}
                rx={11}
              />
              <text x={at[pill.role]!.x} y={(pill.down ? at[pill.role]!.y + NODE_H / 2 : RAIL_Y) + 4.5}>
                {pill.text}
              </text>
            </g>
          )}
        </svg>
      </div>

      <figcaption className="pt-caption">
        <div className="pt-say" aria-live="polite">
          {current ? (
            <>
              <span className="pt-count">
                {shown} / {played.length}
              </span>
              {current.step.say}
            </>
          ) : (
            <>
              <span className="pt-count">start</span>
              Each agent shows what the policy lets it do right now.
            </>
          )}
        </div>
        <div className="pt-controls">
          <button type="button" onClick={() => { setPlaying(false); go(0, false); }} aria-label="Back to the start">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 4v12M15 4l-7 6 7 6z" /></svg>
          </button>
          <button type="button" onClick={() => { setPlaying(false); go(Math.max(0, shown - 1), false); }} aria-label="Previous step" disabled={shown === 0}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M13 4l-7 6 7 6z" /></svg>
          </button>
          <button type="button" className="is-main" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>
            <svg viewBox="0 0 20 20" aria-hidden="true">{playing ? <path d="M6 4h3v12H6zM11 4h3v12h-3z" /> : <path d="M6 4l10 6-10 6z" />}</svg>
          </button>
          <button type="button" onClick={() => { setPlaying(false); go(Math.min(played.length, shown + 1), true); }} aria-label="Next step" disabled={shown === played.length}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4l7 6-7 6z" /></svg>
          </button>
          <div className="pt-progress" aria-hidden="true">
            <span style={{ width: `${(shown / played.length) * 100}%` }} />
          </div>
        </div>
      </figcaption>
    </figure>
  );
}
