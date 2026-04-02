"use client";

import { basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  ViewUpdate,
  keymap,
} from "@codemirror/view";
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import ELK from "elkjs/lib/elk.bundled.js";
import Image from "next/image";
import Link from "next/link";
import { useDeferredValue, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

type GraphNode = {
  id: string;
  kind: string;
  data: Record<string, unknown>;
};

type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  label?: string;
};

type WorkflowGraph = {
  name: string;
  startNodeId: string;
  endNodeId: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

type ContractGraph = {
  name: string;
  workflows: Record<string, WorkflowGraph>;
};

type CompileResponse =
  | { ok: true; graph: ContractGraph }
  | { ok: false; error: string; errorType?: string };

type PyodideLike = {
  FS: {
    mkdirTree: (path: string) => void;
    writeFile: (path: string, content: string) => void;
  };
  loadPackage: (packages: string | string[]) => Promise<void>;
  runPython: (code: string) => unknown;
  runPythonAsync: (code: string) => Promise<unknown>;
};

type Viewport = {
  x: number;
  y: number;
  scale: number;
};

type RoutedEdge = GraphEdge & {
  points: Array<{ x: number; y: number }>;
};

type LayoutState = {
  positions: Map<string, { x: number; y: number }>;
  edges: RoutedEdge[];
  width: number;
  height: number;
};

type ElkSectionLike = {
  startPoint?: { x: number; y: number };
  bendPoints?: Array<{ x: number; y: number }>;
  endPoint?: { x: number; y: number };
};

type ElkEdgeLike = {
  id: string;
  sections?: ElkSectionLike[];
};

type ElkLayoutLike = {
  children?: Array<{ id: string; x?: number; y?: number }>;
  edges?: ElkEdgeLike[];
  width?: number;
  height?: number;
};

type DocPage = {
  slug: string;
  title: string;
  content: string;
};

declare global {
  interface Window {
    loadPyodide?: (options: { indexURL: string }) => Promise<PyodideLike>;
  }
}

const DEFAULT_SOURCE = `guarantee safe [relevant]:halt

workflow "research" @always safe
    | search_web query="agent compliance"
    | summarize style="brief"
    | @branch
        -when "technical"
            | cite_sources format="academic"
        -else
            | draft_summary tone="clear"
    | @unordered
        -step "format"
            | format_notes style="structured"
        -step "verify"
            | verify_sources depth="light"`;

const DEFAULT_VIEWPORT: Viewport = { x: 72, y: 56, scale: 1 };
const PYODIDE_VERSION = "0.27.3";
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const NODE_WIDTH = 224;
const NODE_HEIGHT = 126;
const elk = new ELK();

const cplLanguage = StreamLanguage.define({
  startState: () => ({}),
  token(stream) {
    if (stream.eatSpace()) {
      return null;
    }

    if (stream.match(/^"([^"\\]|\\.)*"/)) {
      return "string";
    }
    if (stream.match(/^#\{[a-zA-Z_][a-zA-Z0-9_]*\}/)) {
      return "atom";
    }
    if (stream.match(/^\[[a-zA-Z_][a-zA-Z0-9_]*\]/)) {
      return "attributeName";
    }
    if (stream.match(/^\{[a-zA-Z_][a-zA-Z0-9_]*\}/)) {
      return "attributeValue";
    }
    if (stream.match(/^@[a-zA-Z_][a-zA-Z0-9_]*/)) {
      return "annotation";
    }
    if (stream.match(/^-when\b|^-else\b|^-until\b|^-step\b/)) {
      return "keyword";
    }
    if (stream.match(/^guarantee\b|^workflow\b/)) {
      return "keyword";
    }
    if (stream.match(/^\|\|?|^&&|^!|^:|^=|^\(|^\)/)) {
      return "operator";
    }
    if (stream.match(/^(true|false|null)\b/)) {
      return "bool";
    }
    if (stream.match(/^[0-9]+\b/)) {
      return "number";
    }
    if (stream.match(/^[a-zA-Z_][a-zA-Z0-9_]*/)) {
      return "variableName";
    }

    stream.next();
    return null;
  },
});

const cplHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#2dd4bf" },
  { tag: tags.string, color: "#93e0fb" },
  { tag: tags.number, color: "#93e0fb" },
  { tag: tags.bool, color: "#93e0fb" },
  { tag: tags.annotation, color: "#fdad5c" },
  { tag: tags.operator, color: "#a0a0a0" },
  { tag: tags.atom, color: "#2dd4bf" },
  { tag: tags.attributeName, color: "#b9a1fa" },
  { tag: tags.attributeValue, color: "#93e0fb" },
  { tag: tags.variableName, color: "#f0f0f0" },
]);

const COMPILE_PYTHON = `
import json
from complier.contract.compiler import ContractCompiler
from complier.contract.parser import ContractParser
from complier.visualizer.graph import contract_to_graph

def compile_contract_to_json(source):
    try:
        parsed = ContractParser().parse(source)
        contract = ContractCompiler().compile(parsed)
        return json.dumps({"ok": True, "graph": contract_to_graph(contract)})
    except Exception as exc:
        return json.dumps(
            {
                "ok": False,
                "error": str(exc),
                "errorType": type(exc).__name__,
            }
        )
`;

function clampScale(value: number) {
  return Math.min(Math.max(value, 0.35), 2.5);
}

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-pyodide="${src}"]`,
    );
    if (existing) {
      if (window.loadPyodide) {
        resolve();
        return;
      }

      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Pyodide.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.pyodide = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Pyodide."));
    document.head.appendChild(script);
  });
}

function formatNodeTitle(kind: string) {
  return kind.replace(/Node$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatValue(value: unknown) {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
}

function renderInlineMarkdown(
  text: string,
  onOpenDoc: (slug: string) => void,
): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      parts.push(
        <code
          key={`${match.index}-code`}
          className="rounded bg-[rgba(255,255,255,0.06)] px-1.5 py-0.5 text-[0.95em] text-foreground"
        >
          {match[1]}
        </code>,
      );
    } else if (match[2] && match[3]) {
      const href = match[3];
      if (href.startsWith("doc:")) {
        const slug = href.slice(4);
        parts.push(
          <button
            key={`${match.index}-link`}
            type="button"
            onClick={() => onOpenDoc(slug)}
            className="text-left text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
          >
            {match[2]}
          </button>,
        );
      } else {
        parts.push(
          <a
            key={`${match.index}-link`}
            href={href}
            className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent"
          >
            {match[2]}
          </a>,
        );
      }
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function renderMarkdown(content: string, onOpenDoc: (slug: string) => void) {
  const lines = content.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const language = trimmed.slice(3).trim();
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) {
        index += 1;
      }

      blocks.push(
        <pre
          key={`code-${blocks.length}`}
          className="overflow-x-auto rounded-2xl border border-border bg-[#050607] p-4 text-sm leading-7 text-secondary"
        >
          {language ? (
            <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted">
              {language}
            </div>
          ) : null}
          <code>{codeLines.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (/^###\s+/.test(trimmed)) {
      blocks.push(
        <h3 key={`h3-${blocks.length}`} className="text-base font-medium text-foreground">
          {renderInlineMarkdown(trimmed.replace(/^###\s+/, ""), onOpenDoc)}
        </h3>,
      );
      index += 1;
      continue;
    }

    if (/^##\s+/.test(trimmed)) {
      blocks.push(
        <h2 key={`h2-${blocks.length}`} className="pt-2 text-lg font-medium text-foreground">
          {renderInlineMarkdown(trimmed.replace(/^##\s+/, ""), onOpenDoc)}
        </h2>,
      );
      index += 1;
      continue;
    }

    if (/^#\s+/.test(trimmed)) {
      blocks.push(
        <h1 key={`h1-${blocks.length}`} className="text-2xl font-medium text-foreground">
          {renderInlineMarkdown(trimmed.replace(/^#\s+/, ""), onOpenDoc)}
        </h1>,
      );
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ul key={`ul-${blocks.length}`} className="space-y-2 pl-5 text-secondary">
          {items.map((item, itemIndex) => (
            <li key={itemIndex} className="list-disc">
              {renderInlineMarkdown(item, onOpenDoc)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }

      blocks.push(
        <ol key={`ol-${blocks.length}`} className="space-y-2 pl-5 text-secondary">
          {items.map((item, itemIndex) => (
            <li key={itemIndex} className="list-decimal">
              {renderInlineMarkdown(item, onOpenDoc)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^```/.test(lines[index].trim()) &&
      !/^#{1,3}\s+/.test(lines[index].trim()) &&
      !/^[-*]\s+/.test(lines[index].trim()) &&
      !/^\d+\.\s+/.test(lines[index].trim())
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }

    blocks.push(
      <p key={`p-${blocks.length}`} className="leading-7 text-secondary">
        {renderInlineMarkdown(paragraphLines.join(" "), onOpenDoc)}
      </p>,
    );
  }

  return blocks;
}

function CplEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (nextValue: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const initialValueRef = useRef(value);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!editorRef.current) {
      return;
    }

    const state = EditorState.create({
      doc: initialValueRef.current,
      extensions: [
        basicSetup,
        cplLanguage,
        syntaxHighlighting(cplHighlightStyle),
        EditorView.lineWrapping,
        keymap.of([]),
        EditorView.theme({
          "&": {
            height: "100%",
            backgroundColor: "#050607",
            color: "#f0f0f0",
            fontFamily: "var(--font-mono), monospace",
            fontSize: "0.875rem",
          },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: "var(--font-mono), monospace",
            lineHeight: "1.75rem",
            scrollbarWidth: "none",
          },
          ".cm-content, .cm-gutter": {
            minHeight: "100%",
          },
          ".cm-content": {
            padding: "1.25rem",
            caretColor: "#2dd4bf",
          },
          ".cm-line": {
            padding: 0,
          },
          ".cm-gutters": {
            display: "none",
          },
          ".cm-activeLine": {
            backgroundColor: "transparent",
          },
          ".cm-activeLineGutter": {
            backgroundColor: "transparent",
          },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
            backgroundColor: "rgba(45, 212, 191, 0.35)",
          },
          "&.cm-focused": {
            outline: "none",
          },
          ".cm-cursor, .cm-dropCursor": {
            borderLeftColor: "#2dd4bf",
          },
          ".cm-scroller::-webkit-scrollbar": {
            display: "none",
          },
        }),
        EditorView.updateListener.of((update: ViewUpdate) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue === value) {
      return;
    }

    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value },
    });
  }, [value]);

  return <div ref={editorRef} className="h-full min-h-0 w-full" />;
}

function buildEdgePoints(
  edge: GraphEdge,
  positions: Map<string, { x: number; y: number }>,
) {
  const source = positions.get(edge.source);
  const target = positions.get(edge.target);

  if (!source || !target) {
    return [];
  }

  return [
    { x: source.x + NODE_WIDTH, y: source.y + NODE_HEIGHT / 2 },
    { x: target.x, y: target.y + NODE_HEIGHT / 2 },
  ];
}

async function computeWorkflowLayout(workflow: WorkflowGraph): Promise<LayoutState> {
  const layout = (await elk.layout({
    id: workflow.name,
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.spacing.nodeNode": "64",
      "elk.padding": "[top=80,left=96,bottom=80,right=128]",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
    },
    children: workflow.nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: workflow.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source],
      targets: [edge.target],
    })),
  })) as ElkLayoutLike;

  const positions = new Map<string, { x: number; y: number }>();
  for (const child of layout.children ?? []) {
    positions.set(child.id, {
      x: child.x ?? 0,
      y: child.y ?? 0,
    });
  }

  const routedEdges: RoutedEdge[] = workflow.edges.map((edge) => {
    const routed = (layout.edges ?? []).find((candidate) => candidate.id === edge.id);
    const section = routed?.sections?.[0];
    const points = [
      section?.startPoint,
      ...(section?.bendPoints ?? []),
      section?.endPoint,
    ]
      .filter((point): point is { x: number; y: number } => Boolean(point))
      .map((point) => ({ x: point.x, y: point.y }));

    return {
      ...edge,
      points: points.length > 1 ? points : buildEdgePoints(edge, positions),
    };
  });

  return {
    positions,
    edges: routedEdges,
    width: (layout.width ?? NODE_WIDTH) + 120,
    height: (layout.height ?? NODE_HEIGHT) + 120,
  };
}

function GraphCanvas({
  workflow,
  viewport,
  setViewport,
}: {
  workflow: WorkflowGraph;
  viewport: Viewport;
  setViewport: React.Dispatch<React.SetStateAction<Viewport>>;
}) {
  const dragState = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [layoutState, setLayoutState] = useState<LayoutState | null>(null);

  useEffect(() => {
    let cancelled = false;

    void computeWorkflowLayout(workflow).then((result) => {
      if (!cancelled) {
        setLayoutState(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [workflow]);

  const positions = layoutState?.positions ?? new Map<string, { x: number; y: number }>();
  const width = layoutState?.width ?? 1200;
  const height = layoutState?.height ?? 800;
  const routedEdges = layoutState?.edges ?? [];

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_top,rgba(45,212,191,0.12),transparent_30%),linear-gradient(rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:auto,36px_36px,36px_36px] cursor-grab active:cursor-grabbing"
      onWheel={(event) => {
        event.preventDefault();
        const delta = event.deltaY > 0 ? -0.1 : 0.1;
        setViewport((current) => ({
          ...current,
          scale: clampScale(current.scale + delta),
        }));
      }}
      onPointerDown={(event) => {
        dragState.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: viewport.x,
          originY: viewport.y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!dragState.current || dragState.current.pointerId !== event.pointerId) {
          return;
        }

        const deltaX = event.clientX - dragState.current.startX;
        const deltaY = event.clientY - dragState.current.startY;
        setViewport((current) => ({
          ...current,
          x: dragState.current!.originX + deltaX,
          y: dragState.current!.originY + deltaY,
        }));
      }}
      onPointerUp={(event) => {
        if (dragState.current?.pointerId === event.pointerId) {
          dragState.current = null;
        }
      }}
      onPointerCancel={() => {
        dragState.current = null;
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width,
          height,
          transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        }}
      >
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          {routedEdges.map((edge) => {
            if (edge.points.length < 2) {
              return null;
            }

            const path = edge.points.reduce((result, point, index) => {
              return `${result}${index === 0 ? "M" : " L"} ${point.x} ${point.y}`;
            }, "");
            const midpoint = edge.points[Math.floor(edge.points.length / 2)];
            const stroke =
              edge.kind === "branch"
                ? "#fdad5c"
                : edge.kind === "else"
                  ? "#93e0fb"
                  : edge.kind === "unordered"
                    ? "#b9a1fa"
                    : "rgba(240,240,240,0.34)";

            return (
              <g key={edge.id}>
                <path
                  d={path}
                  fill="none"
                  stroke={stroke}
                  strokeDasharray={edge.kind === "next" ? undefined : "6 6"}
                  strokeWidth="2"
                />
                {edge.label && midpoint ? (
                  <text
                    x={midpoint.x}
                    y={midpoint.y - 12}
                    textAnchor="middle"
                    fill={stroke}
                    fontSize="11"
                    fontFamily="var(--font-mono)"
                  >
                    {edge.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>

        {workflow.nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) {
            return null;
          }

          const entries = Object.entries(node.data).filter(
            ([key, value]) =>
              key !== "id" &&
              key !== "guards" &&
              key !== "branch_back_id" &&
              key !== "back_node_id" &&
              value !== null &&
              value !== "" &&
              (!(Array.isArray(value)) || value.length > 0) &&
              (!(typeof value === "object") || Object.keys(value as object).length > 0),
          );

          return (
            <div
              key={node.id}
              className="absolute w-56 rounded-3xl border border-border bg-[rgba(10,10,10,0.92)] p-4 shadow-[0_28px_90px_rgba(0,0,0,0.38)] backdrop-blur"
              style={{ left: position.x, top: position.y }}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-[11px] uppercase tracking-[0.22em] text-accent">
                  {formatNodeTitle(node.kind)}
                </div>
                <div className="rounded-full border border-border px-2 py-1 text-[10px] text-muted">
                  {node.id.split(":").slice(1, 3).join(":")}
                </div>
              </div>
              <div className="space-y-2 text-xs leading-relaxed text-secondary">
                {entries.length > 0 ? (
                  entries.map(([key, value]) => (
                    <div key={key}>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-muted">
                        {key.replaceAll("_", " ")}
                      </div>
                      <div className="mt-1 break-words text-foreground">
                        {formatValue(value)}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-muted">No extra payload.</div>
                )}
              </div>
            </div>
          );
        })}

        {layoutState === null ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">
            Computing layout…
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ContractPlayground({
  docsPages,
}: {
  docsPages: DocPage[];
}) {
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const deferredSource = useDeferredValue(source);
  const [selectedWorkflow, setSelectedWorkflow] = useState("");
  const [runtime, setRuntime] = useState<PyodideLike | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("Loading browser compiler…");
  const [compileResult, setCompileResult] = useState<CompileResponse | null>(null);
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const [openDocTabs, setOpenDocTabs] = useState<string[]>(["docs"]);
  const [activeDocSlug, setActiveDocSlug] = useState("docs");
  const compileIdRef = useRef(0);
  const docPagesBySlug = new Map(docsPages.map((page) => [page.slug, page]));

  const openDocTab = (slug: string) => {
    if (!docPagesBySlug.has(slug)) {
      return;
    }

    setOpenDocTabs((current) => (current.includes(slug) ? current : [...current, slug]));
    setActiveDocSlug(slug);
  };

  const closeDocTab = (slug: string) => {
    if (slug === "docs") {
      return;
    }

    setOpenDocTabs((current) => {
      const next = current.filter((item) => item !== slug);
      if (activeDocSlug === slug) {
        setActiveDocSlug(next[next.length - 1] ?? "docs");
      }
      return next;
    });
  };

  useEffect(() => {
    let cancelled = false;

    async function bootPyodide() {
      try {
        setLoadingMessage("Loading browser compiler…");
        await loadScript(`${PYODIDE_INDEX_URL}pyodide.js`);
        if (!window.loadPyodide) {
          throw new Error("Pyodide loader did not initialize.");
        }

        const pyodide = await window.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
        if (cancelled) {
          return;
        }

        setLoadingMessage("Installing Python parser dependencies…");
        await pyodide.loadPackage("micropip");
        await pyodide.runPythonAsync(`
import micropip
await micropip.install("lark")
`);

        if (cancelled) {
          return;
        }

        setLoadingMessage("Mounting complier compiler modules…");
        const response = await fetch("/api/playground/python-sources", {
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error("Failed to fetch Python compiler sources.");
        }

        const payload = (await response.json()) as { files: Record<string, string> };
        for (const [filePath, contents] of Object.entries(payload.files)) {
          const fullPath = `/tmp/complier/${filePath}`;
          const directory = fullPath.slice(0, fullPath.lastIndexOf("/"));
          pyodide.FS.mkdirTree(directory);
          pyodide.FS.writeFile(fullPath, contents);
        }

        pyodide.runPython(`
import sys
sys.path.insert(0, "/tmp/complier")
`);
        pyodide.runPython(COMPILE_PYTHON);

        if (!cancelled) {
          setRuntime(pyodide);
          setLoadingMessage("Compiler ready.");
        }
      } catch (error) {
        if (!cancelled) {
          setCompileResult({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "Failed to initialize the in-browser compiler.",
          });
          setLoadingMessage("Compiler failed to load.");
        }
      }
    }

    void bootPyodide();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!runtime) {
      return;
    }

    const currentCompileId = ++compileIdRef.current;

    const handle = window.setTimeout(() => {
      try {
        const escaped = JSON.stringify(deferredSource);
        const result = runtime.runPython(
          `compile_contract_to_json(${escaped})`,
        ) as string;
        const parsed = JSON.parse(result) as CompileResponse;

        if (compileIdRef.current === currentCompileId) {
          setCompileResult(parsed);
          if (parsed.ok) {
            const workflows = Object.keys(parsed.graph.workflows);
            setSelectedWorkflow((current) =>
              current && workflows.includes(current) ? current : (workflows[0] ?? ""),
            );
          }
        }
      } catch (error) {
        if (compileIdRef.current === currentCompileId) {
          setCompileResult({
            ok: false,
            error:
              error instanceof Error
                ? error.message
                : "The browser compiler failed while compiling this contract.",
          });
        }
      } finally {
      }
    }, 280);

    return () => {
      window.clearTimeout(handle);
    };
  }, [deferredSource, runtime]);

  const workflowNames =
    compileResult && compileResult.ok ? Object.keys(compileResult.graph.workflows) : [];
  const activeWorkflow =
    compileResult && compileResult.ok
      ? compileResult.graph.workflows[selectedWorkflow || workflowNames[0] || ""]
      : null;

  return (
    <main className="flex min-h-screen h-screen flex-col overflow-hidden bg-black text-foreground">
      <header className="flex h-13 shrink-0 items-center justify-center border-b border-border bg-[rgba(5,6,7,0.92)] px-6 backdrop-blur">
        <Link href="/" className="transition-opacity hover:opacity-85" aria-label="Go to homepage">
          <Image
            src="/logo-transparent.png"
            alt="complier logo"
            width={102}
            height={40}
            priority
            className="h-auto w-[102px]"
          />
        </Link>
      </header>

      <div className="grid flex-1 min-h-0 overflow-hidden md:grid-cols-2">
        <section className="flex min-h-0 flex-col overflow-hidden border-b border-border bg-black md:border-b-0 md:border-r">
          <div className="border-b border-border">
            <div className="scrollbar-none overflow-x-auto">
              <div className="flex min-w-max">
                {openDocTabs.map((slug) => {
                  const page = docPagesBySlug.get(slug);
                  if (!page) {
                    return null;
                  }

                  const active = slug === activeDocSlug;
                  return (
                    <div
                      key={slug}
                      className={`flex h-11 items-center gap-2 border-r px-4 text-sm transition-colors ${
                        active
                          ? "border-border bg-[#111315] text-foreground"
                          : "border-border bg-[#090a0b] text-secondary"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveDocSlug(slug)}
                        className="whitespace-nowrap"
                      >
                        {slug === "docs" ? "Docs" : page.title}
                      </button>
                      {slug !== "docs" ? (
                        <button
                          type="button"
                          onClick={() => closeDocTab(slug)}
                          className="text-muted transition-colors hover:text-foreground"
                          aria-label={`Close ${page.title}`}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-10 py-6 md:px-14">
            <article className="mx-auto flex max-w-3xl flex-col gap-5 pt-3 text-[0.75rem]">
              {renderMarkdown(
                docPagesBySlug.get(activeDocSlug)?.content ?? "# Docs\n\nNo content found.",
                openDocTab,
              )}
            </article>
          </div>
        </section>

        <section className="grid min-h-0 grid-rows-2">
          <div className="border-b border-border">
            <div className="h-full min-h-0 bg-[#050607]">
              <CplEditor value={source} onChange={setSource} />
            </div>
          </div>

          <div className="relative min-h-0">
            {compileResult?.ok && activeWorkflow ? (
              <div className="h-full">
                <GraphCanvas
                  workflow={activeWorkflow}
                  viewport={viewport}
                  setViewport={setViewport}
                />
              </div>
            ) : (
              <div className="flex h-full min-h-0 items-center justify-center bg-[#050607] px-8 text-center">
                <div className="max-w-md">
                  <div className="text-base text-foreground">
                    {runtime ? "The compiler has something to say." : loadingMessage}
                  </div>
                  <div className="mt-3 text-sm leading-relaxed text-secondary">
                    {compileResult && !compileResult.ok
                      ? `${compileResult.errorType ? `${compileResult.errorType}: ` : ""}${compileResult.error}`
                      : "Once the browser compiler is ready, the graph appears below the editor."}
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
