// One tool call through complier's hook: the harness asks before it runs the call, complier
// translates it (CEL) and checks the contract (CSP), and the harness runs it, with its own
// connection, only if it's allowed. Drawn twice in SVG, wide and tall, and the stylesheet shows the
// one that fits; the ordered list is the same picture as text.

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

function Station({ x, y, w, h, title, kind, note }: { x: number; y: number; w: number; h: number; title: string; kind?: string; note: React.ReactNode }) {
  return (
    <g className="dg-station">
      <rect x={x} y={y} width={w} height={h} rx={14} />
      <text x={x + 18} y={y + 30} className="dg-title">
        {title}
      </text>
      {kind && (
        <Chip x={x + w - 34} y={y + 25} w={44} tone="plain" mono>
          {kind}
        </Chip>
      )}
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

// The startup band: both pictures share it, scaled to their width.
function Startup({ wide }: { wide: boolean }) {
  if (!wide) {
    return (
      <>
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
          loaded
        </Chip>
      </>
    );
  }
  return (
    <>
      <rect className="dg-band" x="0" y="0" width="1160" height="186" rx="18" />
      <text x="28" y="44" className="dg-lane">
        At startup
      </text>
      <Doc x={390} y={26} w={150} name="unit.yaml" kind="CEL rules" />
      <Doc x={630} y={26} w={150} name="contract.csp" kind="CSP process" />
      <path className="dg-load" d="M465 96V128" markerEnd="url(#dg-head-load)" />
      <path className="dg-load" d="M705 96V128" markerEnd="url(#dg-head-load)" />
      <Chip x={465} y={150} w={176} tone="ok">
        ✓ no overlap · no gap
      </Chip>
      <Chip x={705} y={150} w={96} tone="plain" mono>
        loaded
      </Chip>
      {/* a unit whose rules overlap is turned away before anything runs */}
      <Doc x={930} y={26} w={150} name="unit.yaml" kind="two rules overlap" rejected />
      <path className="dg-ghost" d="M1005 96V128" />
      <path className="dg-stop" d="M991 130H1019" />
      <Chip x={1005} y={160} w={124} tone="bad">
        ✕ won&apos;t load
      </Chip>
    </>
  );
}

function Wide() {
  return (
    <svg className="dg dg-wide" viewBox="0 0 1160 700" role="presentation">
      <Arrowheads />
      <Startup wide />

      <text x="28" y="236" className="dg-lane">
        On every call
      </text>
      <image href={mascot.src} x="6" y="262" width="116" height={(116 * 831) / 872} />
      <text x="64" y="392" textAnchor="middle" className="dg-title">
        Agent
      </text>

      {/* the harness: it asks first, and runs the call itself */}
      <rect className="dg-harness" x="150" y="250" width="790" height="170" rx="22" />
      <text x="174" y="280" className="dg-title">
        Agent harness
      </text>
      <text x="306" y="280" className="dg-small">
        such as Claude Code
      </text>
      <Station x={180} y={296} w={240} h={104} title="Pre-tool hook" note="" />
      <Chip x={300} y={372} w={182} tone="tool" mono>
        notion-create-comment
      </Chip>
      <Station x={670} y={296} w={240} h={104} title="Runs the call" note="with its own connection" />

      {/* the service, reached only by the harness */}
      <rect className="dg-service" x="964" y="290" width="182" height="120" rx="16" />
      <text x="986" y="326" className="dg-title">
        Notion
      </text>
      <g className="dg-lock">
        <rect x="987" y="372" width="14" height="11" rx="2" />
        <path d="M990 372v-4a4 4 0 0 1 8 0v4" />
      </g>
      <text x="1008" y="382" className="dg-small">
        harness&apos;s sign-in
      </text>

      {/* complier answers the hook */}
      <rect className="dg-wall" x="150" y="464" width="790" height="156" rx="22" />
      <text x="174" y="494" className="dg-brand">
        complier
      </text>
      <Station x={180} y={508} w={300} h={92} title="Translate" kind="CEL" note="one call → one event" />
      <Chip x={420} y={576} w={84} tone="event" mono>
        review
      </Chip>
      <Station x={520} y={508} w={390} h={92} title="Contract" kind="CSP" note={<>now: <tspan className="dg-mono">DRAFTED</tspan></>} />
      <Mark x={688} y={570} ok />
      <Chip x={804} y={570} w={184} tone="ok" mono>
        DRAFTED → REVIEWED
      </Chip>

      {/* attempt → hook → translate → contract */}
      <Flow d="M120 340H180" tone="ok" head />
      <Flow d="M300 400V508" tone="ok" head />
      <text x="312" y="446" className="dg-small">
        may it run?
      </text>
      <Flow d="M480 554H520" tone="ok" head />

      {/* allowed: the harness runs it */}
      <Flow d="M790 508V400" tone="ok" head />
      <text x="802" y="446" className="dg-edge is-ok">
        allow
      </text>
      <Flow d="M910 348H964" tone="ok" head />

      {/* out of turn: refused, nothing runs, the contract stays put */}
      <Flow d="M880 600V652H64V404" tone="bad" head />
      <Chip x={470} y={652} w={300} tone="bad">
        ↩ out of turn: refused, with the reason
      </Chip>
      <text x="470" y="684" textAnchor="middle" className="dg-small">
        Like publish now. Nothing runs, and the contract stays in DRAFTED.
      </text>
    </svg>
  );
}

// The phone picture: the same story top to bottom, on a canvas a phone shows at about its own size,
// so the labels stay readable.
function Tall() {
  return (
    <svg className="dg dg-tall" viewBox="0 0 320 1010" role="presentation">
      <Arrowheads />
      <Startup wide={false} />

      <text x="16" y="206" className="dg-lane">
        On every call
      </text>
      <image href={mascot.src} x="12" y="218" width="80" height={(80 * 831) / 872} />
      <text x="100" y="262" className="dg-title">
        Agent
      </text>

      <rect className="dg-harness" x="4" y="310" width="300" height="146" rx="20" />
      <text x="290" y="338" textAnchor="end" className="dg-title">
        Agent harness
      </text>
      <Station x={16} y={350} w={276} h={92} title="Pre-tool hook" note="" />
      <Chip x={130} y={414} w={190} tone="tool" mono>
        notion-create-comment
      </Chip>

      <rect className="dg-wall" x="4" y="490" width="300" height="250" rx="20" />
      <text x="22" y="520" className="dg-brand">
        complier
      </text>
      <Station x={16} y={534} w={276} h={84} title="Translate" kind="CEL" note="one call → one event" />
      <Chip x={240} y={596} w={76} tone="event" mono>
        review
      </Chip>
      <Station x={16} y={630} w={276} h={96} title="Contract" kind="CSP" note={<>now: <tspan className="dg-mono">DRAFTED</tspan></>} />
      <Mark x={44} y={700} ok />
      <Chip x={160} y={700} w={190} tone="ok" mono>
        DRAFTED → REVIEWED
      </Chip>

      <rect className="dg-harness" x="4" y="790" width="300" height="84" rx="20" />
      <text x="22" y="824" className="dg-title">
        Harness runs the call
      </text>
      <text x="22" y="848" className="dg-small">
        with its own connection
      </text>

      <rect className="dg-service" x="16" y="910" width="276" height="84" rx="16" />
      <text x="38" y="944" className="dg-title">
        Notion
      </text>
      <g className="dg-lock">
        <rect x="39" y="962" width="14" height="11" rx="2" />
        <path d="M42 962v-4a4 4 0 0 1 8 0v4" />
      </g>
      <text x="62" y="972" className="dg-small">
        the harness&apos;s sign-in
      </text>

      <Flow d="M52 296V350" tone="ok" head />
      <Flow d="M130 442V534" tone="ok" head />
      <text x="142" y="476" className="dg-small">
        may it run?
      </text>
      <Flow d="M150 618V630" tone="ok" />
      <Flow d="M150 740V790" tone="ok" head />
      <text x="162" y="770" className="dg-edge is-ok">
        allow
      </text>
      <Flow d="M150 874V910" tone="ok" head />

      {/* refused: back to the agent along the right edge */}
      <Flow d="M292 678H312V244H112" tone="bad" head />
      <Chip x={226} y={282} w={164} tone="bad">
        ↩ out of turn: refused
      </Chip>
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
        <li>At startup, complier proves the CEL rules in the translation unit don&apos;t overlap or leave gaps, and loads the CSP contract. Unproven rules don&apos;t load.</li>
        <li>The agent attempts a tool call, notion-create-comment. Before running it, the agent&apos;s harness, such as Claude Code, asks complier through its pre-tool hook.</li>
        <li>complier translates the call to the event review. The contract is in DRAFTED and allows it, so complier answers allow and the contract moves to REVIEWED.</li>
        <li>The harness runs the call itself, with its own connection to Notion.</li>
        <li>A call that is out of turn, such as publish while the contract is in DRAFTED, is refused: nothing runs, the agent gets the reason, and the contract stays where it was.</li>
      </ol>
    </figure>
  );
}
