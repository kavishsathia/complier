import { useState, useCallback } from "react";
import { useNodesState, useEdgesState, type Node, type Edge } from "@xyflow/react";
import Canvas from "./components/Canvas.tsx";
import Sidebar from "./components/Sidebar.tsx";
import NodePalette from "./components/NodePalette.tsx";
import ConfigPanel from "./components/ConfigPanel.tsx";
import RunOutput from "./components/RunOutput.tsx";
import Settings from "./components/Settings.tsx";
import { graphToCpl } from "./lib/graph-to-cpl.ts";
import * as bridge from "./lib/bridge.ts";
import type { StudioNodeData } from "./types.ts";

let nodeIdCounter = 0;
function nextId() {
  return `node-${++nodeIdCounter}`;
}

function defaultData(kind: StudioNodeData["kind"]): StudioNodeData {
  switch (kind) {
    case "tool":
      return { kind: "tool", toolName: "", params: {} };
    case "branch":
      return { kind: "branch", arms: [{ condition: "" }], hasElse: false };
    case "join":
      return { kind: "join" };
    case "loop":
      return { kind: "loop", until: "" };
    case "fork":
      return { kind: "fork", forkId: "", workflowName: "" };
  }
}

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [runOutput, setRunOutput] = useState<string | null>(null);
  const [workflowName, setWorkflowName] = useState("Untitled");
  const [activeWorkflow, setActiveWorkflow] = useState<string | null>(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("gemma4");
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  const handleAddNode = useCallback(
    (kind: StudioNodeData["kind"]) => {
      const id = nextId();
      const offset = nodes.length * 40;
      const position = { x: 300 + offset, y: 200 + offset };

      const newNode: Node = {
        id,
        type: kind,
        position,
        data: defaultData(kind),
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [nodes.length, setNodes]
  );

  const handleStudioNodeDataChange = useCallback(
    (id: string, data: StudioNodeData) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === id ? { ...n, data: data as any } : n))
      );
    },
    [setNodes]
  );

  const handleRun = useCallback(async () => {
    const cpl = graphToCpl({ name: workflowName, nodes, edges });
    if (!cpl) {
      setRunOutput("No nodes to compile.");
      return;
    }
    setRunOutput("Compiling...\n\n" + cpl);
    const result = await bridge.validateCpl(cpl);
    if (result.valid) {
      setRunOutput("Valid CPL:\n\n" + cpl);
    } else {
      setRunOutput("Compilation error:\n" + (result.error ?? "Unknown error") + "\n\nGenerated CPL:\n" + cpl);
    }
  }, [workflowName, nodes, edges]);

  const handleSave = useCallback(async () => {
    const graph = { name: workflowName, nodes, edges };
    await bridge.saveWorkflow(workflowName, JSON.stringify(graph));
    setActiveWorkflow(workflowName);
    setSidebarRefresh((n) => n + 1);
  }, [workflowName, nodes, edges]);

  const handleLoad = useCallback(
    async (name: string) => {
      const data = await bridge.loadWorkflow(name);
      if (!data) return;
      setWorkflowName((data.name as string) ?? name);
      setNodes((data.nodes as Node[]) ?? []);
      setEdges((data.edges as Edge[]) ?? []);
      setActiveWorkflow(name);
      setSelectedNodeId(null);
    },
    [setNodes, setEdges]
  );

  const handleNew = useCallback(() => {
    setWorkflowName("Untitled");
    setNodes([]);
    setEdges([]);
    setActiveWorkflow(null);
    setSelectedNodeId(null);
    setRunOutput(null);
    nodeIdCounter = 0;
  }, [setNodes, setEdges]);

  return (
    <div className="studio">
      <Sidebar
        activeWorkflow={activeWorkflow}
        onSelect={handleLoad}
        onNew={handleNew}
        onOpenSettings={() => setSettingsOpen(true)}
        refreshKey={sidebarRefresh}
      />

      <div className="studio-main">
        {/* Toolbar */}
        <div className="toolbar">
          <button className="run-btn" onClick={handleSave}>
            Save
          </button>
          <button className="run-btn" onClick={handleRun}>
            Run
          </button>
        </div>

        {/* Canvas */}
        <Canvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          setEdges={setEdges}
          onNodeClick={setSelectedNodeId}
        />

        {/* + Add node button */}
        <button className="add-btn" onClick={() => setPaletteOpen(!paletteOpen)}>
          +
        </button>

        {paletteOpen && (
          <NodePalette
            onAdd={handleAddNode}
            onClose={() => setPaletteOpen(false)}
          />
        )}

        {/* Config panel */}
        {selectedNode && (
          <ConfigPanel
            node={selectedNode}
            onChange={handleStudioNodeDataChange}
            onClose={() => setSelectedNodeId(null)}
          />
        )}

        {/* Run output */}
        {runOutput !== null && (
          <RunOutput output={runOutput} onClose={() => setRunOutput(null)} />
        )}
      </div>

      {/* Settings */}
      {settingsOpen && (
        <Settings
          ollamaUrl={ollamaUrl}
          ollamaModel={ollamaModel}
          onSave={(url, model) => {
            setOllamaUrl(url);
            setOllamaModel(model);
            setSettingsOpen(false);
          }}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
