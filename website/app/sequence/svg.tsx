// A laid-out sequence diagram as SVG. Colours and fonts are attributes, not classes, so the
// downloaded file looks the same as the page.

import type { Ref } from "react";
import type { ArrowKind, Layout, Shape } from "./arrange.ts";

const INK = "#1b1430";
const MUTED = "#6b6480";
const LINE = "#d8d1e6";
const ACCENT = "#5b3fb5";
const ACCENT_SOFT = "#f2eefc";
const OK = "#0b6b50";
const MINT_SOFT = "#e4f8f0";
const SUNKEN = "#f5f2ec";
const MONO = "ui-monospace, 'SF Mono', Menlo, monospace";
const SANS = "ui-sans-serif, system-ui, -apple-system, sans-serif";

const ARROW: Record<ArrowKind, { color: string; dash?: string }> = {
  attempt: { color: ACCENT },
  allow: { color: OK, dash: "6 4" },
  result: { color: INK },
};

function shape(s: Shape, i: number) {
  switch (s.k) {
    case "actor":
      return (
        <g key={i}>
          <rect x={s.x - s.w / 2} y={s.y} width={s.w} height={s.h} rx={10} fill={s.title === "Monitor" ? MINT_SOFT : ACCENT_SOFT} stroke={LINE} />
          <text x={s.x} y={s.y + 21} textAnchor="middle" fontFamily={SANS} fontSize={13} fontWeight={600} fill={INK}>
            {s.title}
          </text>
          <text x={s.x} y={s.y + 37} textAnchor="middle" fontFamily={MONO} fontSize={11} fill={MUTED}>
            {s.sub}
          </text>
        </g>
      );
    case "life":
      return <line key={i} x1={s.x} x2={s.x} y1={s.y1} y2={s.y2} stroke={LINE} strokeDasharray="4 4" />;
    case "bar":
      return (
        <rect
          key={i}
          x={s.x - 6}
          y={s.y1}
          width={12}
          height={s.y2 - s.y1}
          fill={s.who === "monitor" ? MINT_SOFT : ACCENT_SOFT}
          stroke={s.who === "monitor" ? OK : ACCENT}
        />
      );
    case "arrow": {
      const { color, dash } = ARROW[s.kind];
      const right = s.x2 > s.x1;
      return (
        <g key={i}>
          <line x1={s.x1} x2={s.x2} y1={s.y} y2={s.y} stroke={color} strokeWidth={1.5} strokeDasharray={dash} markerEnd={`url(#seq-${s.kind})`} />
          <text
            x={right ? s.x2 - 12 : s.x1 - 12}
            y={s.y - 6}
            textAnchor="end"
            fontFamily={MONO}
            fontSize={12}
            fill={color}
          >
            {s.label}
          </text>
        </g>
      );
    }
    case "pill": {
      const fill = s.kind === "state" ? "#ffffff" : s.kind === "loop" ? ACCENT_SOFT : SUNKEN;
      return (
        <g key={i}>
          <rect x={s.x - s.w / 2} y={s.y + 4} width={s.w} height={26} rx={13} fill={fill} stroke={s.kind === "loop" ? ACCENT : LINE} />
          <text x={s.x} y={s.y + 21} textAnchor="middle" fontFamily={MONO} fontSize={12} fill={s.kind === "denied" ? MUTED : INK}>
            {s.label}
          </text>
        </g>
      );
    }
    case "frag":
      return (
        <g key={i}>
          <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="none" stroke={s.kind === "choice" ? ACCENT : MUTED} strokeWidth={1.2} rx={4} />
          <path
            d={`M${s.x} ${s.y} h${s.tagW} v14 l-8 8 h${-s.tagW + 8} z`}
            fill={s.kind === "choice" ? ACCENT_SOFT : SUNKEN}
            stroke={s.kind === "choice" ? ACCENT : MUTED}
            strokeWidth={1.2}
          />
          <text x={s.x + 8} y={s.y + 15} fontFamily={MONO} fontSize={11} fontWeight={600} fill={s.kind === "choice" ? ACCENT : INK}>
            {s.tag}
          </text>
        </g>
      );
    case "sep":
      return <line key={i} x1={s.x1} x2={s.x2} y1={s.y} y2={s.y} stroke={MUTED} strokeDasharray="6 4" />;
    case "guard":
      return (
        <text key={i} x={s.x} y={s.y} fontFamily={MONO} fontSize={11} fill={MUTED}>
          {s.label}
        </text>
      );
    case "note":
      return (
        <text key={i} x={s.x} y={s.y} textAnchor={s.anchor} fontFamily={SANS} fontSize={11} fontStyle="italic" fill={MUTED}>
          {s.label}
        </text>
      );
  }
}

export function SequenceSvg({ layout, title, ref }: { layout: Layout; title: string; ref?: Ref<SVGSVGElement> }) {
  return (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <defs>
        {(Object.keys(ARROW) as ArrowKind[]).map((k) => (
          <marker key={k} id={`seq-${k}`} viewBox="0 0 10 10" refX={9} refY={5} markerWidth={8} markerHeight={8} orient="auto-start-reverse">
            {k === "allow" ? (
              <path d="M1 1 L9 5 L1 9" fill="none" stroke={ARROW[k].color} strokeWidth={1.5} />
            ) : (
              <path d="M0 0 L10 5 L0 10 z" fill={ARROW[k].color} />
            )}
          </marker>
        ))}
      </defs>
      <rect width={layout.width} height={layout.height} fill="#ffffff" />
      {layout.shapes.map(shape)}
    </svg>
  );
}
