// One call that's out of turn and one that isn't, through complier. Drawn twice in SVG, wide and
// tall, and the stylesheet shows the one that fits; the ordered list is the same picture as text.

import mascot from "../controllable-chaos.png";

type Tone = "ok" | "bad" | "event" | "tool" | "plain";

// A pill centred on (x, y); widths are set by hand to the text they hold.
function Chip({ x, y, w, tone, mono, children }: { x: number; y: number; w: number; tone: Tone; mono?: boolean; children: React.ReactNode }) {
  return (
    <g className={`dg-chip is-${tone}`}>
      <rect x={x - w / 2} y={y - 13} width={w} height={26} rx={13} />
      <text x={x} y={y + 4.5} textAnchor="middle" className={mono ? "dg-mono" : undefined}>
        {children}
      </text>
    </g>
  );
}

// A file with a folded corner, top-left at (x, y).
function Doc({ x, y, w, name, kind, rejected }: { x: number; y: number; w: number; name: string; kind: string; rejected?: boolean }) {
  const h = 70;
  return (
    <g className={`dg-doc${rejected ? " is-rejected" : ""}`}>
      <path d={`M${x} ${y + 8}a8 8 0 0 1 8-8H${x + w - 18}L${x + w} ${y + 18}V${y + h - 8}a8 8 0 0 1-8 8H${x + 8}a8 8 0 0 1-8-8Z`} />
      <path className="dg-fold" d={`M${x + w - 18} ${y}V${y + 18}H${x + w}`} />
      <text x={x + w / 2} y={y + 33} textAnchor="middle" className="dg-mono dg-doc-name">
        {name}
      </text>
      <text x={x + w / 2} y={y + 53} textAnchor="middle" className="dg-small">
        {kind}
      </text>
    </g>
  );
}

function Station({ x, y, w, h, title, kind, note }: { x: number; y: number; w: number; h: number; title: string; kind: string; note: React.ReactNode }) {
  return (
    <g className="dg-station">
      <rect x={x} y={y} width={w} height={h} rx={14} />
      <text x={x + 18} y={y + 30} className="dg-title">
        {title}
      </text>
      <Chip x={x + w - 34} y={y + 25} w={44} tone="plain" mono>
        {kind}
      </Chip>
      <text x={x + 18} y={y + 52} className="dg-small">
        {note}
      </text>
    </g>
  );
}

function Mark({ x, y, ok }: { x: number; y: number; ok: boolean }) {
  return (
    <g className={`dg-mark is-${ok ? "ok" : "bad"}`}>
      <circle cx={x} cy={y} r={13} />
      <path d={ok ? `M${x - 5.5} ${y}l3.8 4 7-8` : `M${x - 4.5} ${y - 4.5}l9 9m0-9l-9 9`} />
    </g>
  );
}

function Arrowheads() {
  return (
    <defs>
      {(["ok", "bad", "load"] as const).map((t) => (
        <marker key={t} id={`dg-head-${t}`} className={`dg-head is-${t}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10Z" />
        </marker>
      ))}
    </defs>
  );
}

// The flowing dashes ride on top of a solid path, so the picture reads the same without motion.
function Flow({ d, tone, head }: { d: string; tone: "ok" | "bad"; head?: boolean }) {
  return (
    <>
      <path d={d} className={`dg-path is-${tone}`} markerEnd={head ? `url(#dg-head-${tone})` : undefined} />
      <path d={d} className={`dg-flow is-${tone}`} />
    </>
  );
}

function Wide() {
  return (
    <svg className="dg dg-wide" viewBox="0 0 1160 600" role="presentation">
      <Arrowheads />
      {/* at startup */}
      <rect className="dg-band" x="0" y="0" width="1160" height="186" rx="18" />
      <text x="28" y="44" className="dg-lane">
        At startup
      </text>
      <Doc x={390} y={26} w={150} name="unit.yaml" kind="CEL rules" />
      <Doc x={630} y={26} w={150} name="contract.csp" kind="CSP process" />
      <path className="dg-load" d="M465 96V268" markerEnd="url(#dg-head-load)" />
      <path className="dg-load" d="M705 96V268" markerEnd="url(#dg-head-load)" />
      <Chip x={465} y={146} w={176} tone="ok">
        ✓ no overlap · no gap
      </Chip>
      <Chip x={705} y={146} w={112} tone="plain" mono>
        machine up
      </Chip>
      {/* a unit whose rules overlap is turned away before anything runs */}
      <Doc x={930} y={26} w={150} name="unit.yaml" kind="two rules overlap" rejected />
      <path className="dg-ghost" d="M1005 96V128" />
      <path className="dg-stop" d="M991 130H1019" />
      <Chip x={1005} y={160} w={124} tone="bad">
        ✕ won&apos;t load
      </Chip>

      {/* on every call */}
      <text x="28" y="236" className="dg-lane">
        On every call
      </text>
      <image href={mascot.src} x="4" y="262" width="128" height={(128 * 831) / 872} />
      <text x="68" y="410" textAnchor="middle" className="dg-title">
        Agent
      </text>
      <text x="68" y="430" textAnchor="middle" className="dg-small">
        Claude Code
      </text>

      <rect className="dg-wall" x="330" y="214" width="500" height="354" rx="22" />
      <text x="354" y="244" className="dg-brand">
        complier
      </text>
      <text x="438" y="244" className="dg-small">
        proxy + daemon
      </text>

      <Station x={360} y={270} w={210} h={246} title="Translate" kind="CEL" note="one call → one event" />
      <Station x={610} y={270} w={190} h={246} title="Contract" kind="CSP" note={<>now: <tspan className="dg-mono">DRAFTED</tspan></>} />

      {/* in turn: a review, allowed, and the contract moves on */}
      <Flow d="M136 362H930" tone="ok" head />
      <Chip x={232} y={362} w={170} tone="tool" mono>
        notion-create-comment
      </Chip>
      <Chip x={465} y={362} w={84} tone="event" mono>
        review
      </Chip>
      <Mark x={634} y={362} ok />
      <Chip x={724} y={362} w={140} tone="ok" mono>
        DRAFTED → REVIEWED
      </Chip>
      <text x="880" y="350" textAnchor="middle" className="dg-edge is-ok">
        allowed
      </text>

      {/* out of turn: a publish before any review; it stops at the check and never leaves */}
      <Flow d="M136 446H621" tone="bad" />
      <Chip x={232} y={446} w={150} tone="tool" mono>
        notion-move-pages
      </Chip>
      <Chip x={465} y={446} w={84} tone="event" mono>
        publish
      </Chip>
      <Mark x={634} y={446} ok={false} />
      <Chip x={690} y={446} w={76} tone="bad">
        not yet
      </Chip>
      <path className="dg-ghost" d="M732 446H812" />
      <path className="dg-stop" d="M814 432V460" />
      <text x="880" y="451" textAnchor="middle" className="dg-edge is-bad dg-struck">
        nothing sent
      </text>
      <Flow d="M634 459V542H68V444" tone="bad" head />
      <Chip x={470} y={542} w={232} tone="bad">
        ↩ refused, with the reason
      </Chip>

      {/* the service */}
      <rect className="dg-service" x="930" y="306" width="216" height="168" rx="16" />
      <text x="954" y="342" className="dg-title">
        Notion
      </text>
      <text x="954" y="362" className="dg-small">
        MCP server
      </text>
      <g className="dg-lock">
        <rect x="955" y="434" width="14" height="11" rx="2" />
        <path d="M958 434v-4a4 4 0 0 1 8 0v4" />
      </g>
      <text x="978" y="444" className="dg-small">
        keys stay in complier
      </text>
    </svg>
  );
}

function Tall() {
  return (
    <svg className="dg dg-tall" viewBox="0 0 360 1006" role="presentation">
      <Arrowheads />
      <rect className="dg-band" x="0" y="0" width="360" height="190" rx="16" />
      <text x="20" y="32" className="dg-lane">
        At startup
      </text>
      <text x="340" y="32" textAnchor="end" className="dg-small">
        Unproven rules don&apos;t load.
      </text>
      <Doc x={28} y={50} w={140} name="unit.yaml" kind="CEL rules" />
      <Doc x={192} y={50} w={140} name="contract.csp" kind="CSP process" />
      <Chip x={98} y={160} w={150} tone="ok">
        ✓ no overlap · no gap
      </Chip>
      <Chip x={262} y={160} w={112} tone="plain" mono>
        machine up
      </Chip>

      <text x="20" y="228" className="dg-lane">
        On every call
      </text>
      <image href={mascot.src} x="20" y="240" width="96" height={(96 * 831) / 872} />
      <text x="128" y="296" className="dg-title">
        Agent
      </text>
      <text x="128" y="316" className="dg-small">
        Claude Code
      </text>

      <rect className="dg-wall" x="10" y="436" width="340" height="400" rx="20" />
      <text x="30" y="466" className="dg-brand">
        complier
      </text>
      <Station x={26} y={482} w={308} h={118} title="Translate" kind="CEL" note="one call → one event" />
      <Station x={26} y={616} w={308} h={150} title="Contract" kind="CSP" note={<>now: <tspan className="dg-mono">DRAFTED</tspan></>} />

      <Flow d="M68 334V346Q68 356 78 356H170Q180 356 180 366V908" tone="ok" head />
      <Flow d="M68 334V346Q68 356 78 356H258Q268 356 268 366V689" tone="bad" />
      <Chip x={180} y={380} w={170} tone="tool" mono>
        notion-create-comment
      </Chip>
      <Chip x={268} y={410} w={146} tone="tool" mono>
        notion-move-pages
      </Chip>
      <Chip x={180} y={568} w={76} tone="event" mono>
        review
      </Chip>
      <Chip x={268} y={568} w={76} tone="event" mono>
        publish
      </Chip>
      <Mark x={180} y={702} ok />
      <Chip x={98} y={738} w={136} tone="ok" mono>
        DRAFTED → REVIEWED
      </Chip>
      <Mark x={268} y={702} ok={false} />
      <Chip x={268} y={738} w={76} tone="bad">
        not yet
      </Chip>
      <path className="dg-ghost" d="M268 752V812" />
      <path className="dg-stop" d="M254 814H282" />
      <text x="268" y="864" textAnchor="middle" className="dg-edge is-bad dg-struck">
        nothing sent
      </text>
      <Flow d="M281 702H342Q352 702 352 692V272Q352 262 342 262H126" tone="bad" head />
      <Chip x={236} y={262} w={160} tone="bad">
        ↩ refused, with reason
      </Chip>
      <text x="168" y="874" textAnchor="end" className="dg-edge is-ok">
        allowed
      </text>

      <rect className="dg-service" x="26" y="908" width="308" height="86" rx="16" />
      <text x="48" y="942" className="dg-title">
        Notion
      </text>
      <text x="112" y="942" className="dg-small">
        MCP server
      </text>
      <g className="dg-lock">
        <rect x="49" y="960" width="14" height="11" rx="2" />
        <path d="M52 960v-4a4 4 0 0 1 8 0v4" />
      </g>
      <text x="72" y="970" className="dg-small">
        keys stay in complier
      </text>
    </svg>
  );
}

export default function Diagram() {
  return (
    <figure className="diagram">
      <div aria-hidden="true">
        <Wide />
        <Tall />
      </div>
      <ol className="sr-only">
        <li>At startup, complier proves the CEL rules in the translation unit don&apos;t overlap or leave gaps, and loads the CSP contract with machine up. Unproven rules don&apos;t load.</li>
        <li>On every call, the agent calls complier, never the service directly.</li>
        <li>notion-create-comment translates to review. The contract is in DRAFTED and allows it, so the call goes to Notion and the contract moves to REVIEWED.</li>
        <li>notion-move-pages translates to publish. The contract doesn&apos;t allow it yet, so nothing is sent to Notion and the agent gets the reason.</li>
        <li>Notion&apos;s credentials stay in complier.</li>
      </ol>
      <figcaption className="dg-caption">The demo above runs these same checks in your browser. It never calls Notion.</figcaption>
    </figure>
  );
}
