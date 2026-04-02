"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

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

  const { positions, width, height } = useMemo(() => {
    const nodeWidth = 224;
    const nodeHeight = 126;
    const columnGap = 124;
    const rowGap = 56;
    const outgoing = new Map<string, string[]>();

    for (const edge of workflow.edges) {
      if (edge.kind === "next") {
        const current = outgoing.get(edge.source) ?? [];
        current.push(edge.target);
        outgoing.set(edge.source, current);
      }
    }

    const levels = new Map<string, number>([[workflow.startNodeId, 0]]);
    const queue = [workflow.startNodeId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const currentLevel = levels.get(current) ?? 0;
      for (const target of outgoing.get(current) ?? []) {
        if (!levels.has(target)) {
          levels.set(target, currentLevel + 1);
          queue.push(target);
        }
      }
    }

    let fallbackLevel = Math.max(...levels.values(), 0) + 1;
    for (const node of workflow.nodes) {
      if (!levels.has(node.id)) {
        levels.set(node.id, fallbackLevel);
        fallbackLevel += 1;
      }
    }

    const grouped = new Map<number, GraphNode[]>();
    for (const node of workflow.nodes) {
      const level = levels.get(node.id) ?? 0;
      const bucket = grouped.get(level) ?? [];
      bucket.push(node);
      grouped.set(level, bucket);
    }

    const positions = new Map<string, { x: number; y: number }>();
    const orderedLevels = [...grouped.keys()].sort((a, b) => a - b);
    let maxRows = 1;

    orderedLevels.forEach((level) => {
      const nodes = grouped.get(level) ?? [];
      maxRows = Math.max(maxRows, nodes.length);
      nodes.forEach((node, index) => {
        positions.set(node.id, {
          x: level * (nodeWidth + columnGap),
          y: index * (nodeHeight + rowGap),
        });
      });
    });

    const totalWidth =
      Math.max(orderedLevels.length, 1) * nodeWidth +
      Math.max(orderedLevels.length - 1, 0) * columnGap;
    const totalHeight = maxRows * nodeHeight + Math.max(maxRows - 1, 0) * rowGap;

    return { positions, width: totalWidth + 280, height: totalHeight + 240 };
  }, [workflow]);

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
          {workflow.edges.map((edge) => {
            const source = positions.get(edge.source);
            const target = positions.get(edge.target);

            if (!source || !target) {
              return null;
            }

            const x1 = source.x + 224;
            const y1 = source.y + 63;
            const x2 = target.x;
            const y2 = target.y + 63;
            const controlOffset = Math.max((x2 - x1) / 2, 56);
            const path = `M ${x1} ${y1} C ${x1 + controlOffset} ${y1}, ${x2 - controlOffset} ${y2}, ${x2} ${y2}`;
            const labelX = x1 + (x2 - x1) / 2;
            const labelY = Math.min(y1, y2) - 14;
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
                {edge.label ? (
                  <text
                    x={labelX}
                    y={labelY}
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
      </div>
    </div>
  );
}

export default function ContractPlayground() {
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const deferredSource = useDeferredValue(source);
  const [selectedWorkflow, setSelectedWorkflow] = useState("");
  const [runtime, setRuntime] = useState<PyodideLike | null>(null);
  const [loadingMessage, setLoadingMessage] = useState("Loading browser compiler…");
  const [compileResult, setCompileResult] = useState<CompileResponse | null>(null);
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const compileIdRef = useRef(0);

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
    <main className="min-h-screen bg-black text-foreground md:h-screen md:overflow-hidden">
      <div className="grid min-h-screen md:h-screen md:grid-cols-2">
        <section className="relative border-b border-border md:border-b-0 md:border-r">
          <textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
            className="min-h-[50vh] w-full resize-none bg-[#050607] px-5 py-5 font-mono text-sm leading-7 text-foreground outline-none md:h-screen"
            aria-label="CPL source editor"
          />
        </section>

        <section className="relative min-h-[50vh] md:h-screen">
          {compileResult?.ok && activeWorkflow ? (
            <div className="h-full">
              <GraphCanvas
                workflow={activeWorkflow}
                viewport={viewport}
                setViewport={setViewport}
              />
            </div>
          ) : (
            <div className="flex min-h-[50vh] items-center justify-center bg-[#050607] px-8 text-center md:h-screen">
              <div className="max-w-md">
                <div className="text-base text-foreground">
                  {runtime ? "The compiler has something to say." : loadingMessage}
                </div>
                <div className="mt-3 text-sm leading-relaxed text-secondary">
                  {compileResult && !compileResult.ok
                    ? `${compileResult.errorType ? `${compileResult.errorType}: ` : ""}${compileResult.error}`
                    : "Once the browser compiler is ready, the right side becomes a pan-and-zoom graph canvas."}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
