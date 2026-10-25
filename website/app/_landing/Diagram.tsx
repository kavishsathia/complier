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

// The phone picture: the same story top to bottom, on a canvas a phone shows at about its own size,
// so the labels stay readable. The two calls take a column each.
function Tall() {
  const ok = 128;
  const bad = 224;
  return (
    <svg className="dg dg-tall" viewBox="0 0 320 932" role="presentation">
      <Arrowheads />
      <rect className="dg-band" x="0" y="0" width="320" height="172" rx="16" />
      <text x="16" y="30" className="dg-lane">
        At startup
      </text>
      <text x="304" y="30" textAnchor="end" className="dg-small">
        Unproven rules don&apos;t load.
      </text>
      <Doc x={16} y={44} w={136} name="unit.yaml" kind="CEL rules" />
      <Doc x={168} y={44} w={136} name="contract.csp" kind="CSP process" />
      <Chip x={90} y={146} w={166} tone="ok">
        ✓ no overlap · no gap
      </Chip>
      <Chip x={240} y={146} w={104} tone="plain" mono>
        machine up
      </Chip>

      <text x="16" y="206" className="dg-lane">
        On every call
      </text>
      <image href={mascot.src} x="12" y="218" width="88" height={(88 * 831) / 872} />
      <text x="108" y="270" className="dg-title">
        Agent
      </text>
      <text x="108" y="290" className="dg-small">
        Claude Code
      </text>

      <rect className="dg-wall" x="4" y="414" width="300" height="372" rx="20" />
      <text x="22" y="444" className="dg-brand">
        complier
      </text>
      <Station
        x={16}
        y={458}
        w={280}
        h={112}
        title="Translate"
        kind="CEL"
        note={
          <>
            <tspan x="34">one call →</tspan>
            <tspan x="34" dy="18">
              one event
            </tspan>
          </>
        }
      />
      <Station x={16} y={584} w={280} h={150} title="Contract" kind="CSP" note={<>now: <tspan className="dg-mono">DRAFTED</tspan></>} />

      {/* in turn: a review, allowed, and the contract moves on */}
      <Flow d={`M56 304V316Q56 326 66 326H${ok - 10}Q${ok} 326 ${ok} 336V836`} tone="ok" head />
      {/* out of turn: a publish before any review, stopped at the check */}
      <Flow d={`M56 304V316Q56 326 66 326H${bad - 10}Q${bad} 326 ${bad} 336V668`} tone="bad" />
      {/* a little left of its line, clear of the other one */}
      <Chip x={ok - 10} y={356} w={182} tone="tool" mono>
        notion-create-comment
      </Chip>
      <Chip x={bad} y={390} w={154} tone="tool" mono>
        notion-move-pages
      </Chip>
      <Chip x={ok} y={550} w={76} tone="event" mono>
        review
      </Chip>
      <Chip x={bad} y={550} w={82} tone="event" mono>
        publish
      </Chip>
      <Mark x={ok} y={668} ok />
      <Chip x={98} y={704} w={158} tone="ok" mono>
        DRAFTED → REVIEWED
      </Chip>
      <Mark x={bad} y={668} ok={false} />
      <Chip x={bad} y={704} w={76} tone="bad">
        not yet
      </Chip>
      <path className="dg-ghost" d={`M${bad} 718V766`} />
      <path className="dg-stop" d={`M${bad - 14} 768H${bad + 14}`} />
      <text x={bad} y="812" textAnchor="middle" className="dg-edge is-bad dg-struck">
        nothing sent
      </text>
      <Flow d={`M${bad + 13} 668H302Q312 668 312 658V242Q312 232 302 232H104`} tone="bad" head />
      <Chip x={206} y={232} w={180} tone="bad">
        ↩ refused, with reason
      </Chip>
      <text x={ok - 8} y="812" textAnchor="end" className="dg-edge is-ok">
        allowed
      </text>

      <rect className="dg-service" x="16" y="836" width="280" height="84" rx="16" />
      <text x="38" y="868" className="dg-title">
        Notion
      </text>
      <text x="102" y="868" className="dg-small">
        MCP server
      </text>
      <g className="dg-lock">
        <rect x="39" y="886" width="14" height="11" rx="2" />
        <path d="M42 886v-4a4 4 0 0 1 8 0v4" />
      </g>
      <text x="62" y="896" className="dg-small">
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
