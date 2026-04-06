import { useState, useEffect } from "react";
import Canvas from "./components/Canvas.tsx";
import Sidebar from "./components/Sidebar.tsx";
import ConfigPanel from "./components/ConfigPanel.tsx";
import RunOutput from "./components/RunOutput.tsx";
import Settings from "./components/Settings.tsx";
import CodeEditor from "./components/CodeEditor.tsx";
import { graphToCpl } from "./lib/graph-to-cpl.ts";
import { cplAstToDocument } from "./lib/cpl-ast-to-steps.ts";
import {
  addBranchArm,
  addUnorderedCase,
  createStudioDocument,
  deleteStep,
  getPrimaryWorkflow,
  getSelectedStep,
  insertStepAt,
  isStudioDocument,
  replaceStep,
  syncDocumentCounters,
} from "./lib/studio-document.ts";
import * as bridge from "./lib/bridge.ts";
import type { MCPServerConfig, NestedStepTarget, StepKind, StudioDocument, WorkflowStep } from "./types.ts";

type EditorMode = "flow" | "code";

export default function App() {
  const [document, setDocument] = useState<StudioDocument>(() => createStudioDocument());
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [runOutput, setRunOutput] = useState<string | null>(null);
  const [activeWorkflow, setActiveWorkflow] = useState<string | null>(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("gemma4");
  const [mode, setMode] = useState<EditorMode>("flow");
  const [cplSource, setCplSource] = useState("");
  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);

  useEffect(() => {
    bridge.listMcpServers().then(setMcpServers);
  }, []);
  const workflow = getPrimaryWorkflow(document);

  function resolveStepForConfig(nodeId: string | null): WorkflowStep | null {
    if (!nodeId) return null;
    const direct = getSelectedStep(document, nodeId);
    if (direct) return direct;
    if (nodeId.includes("__header")) {
      const parentId = nodeId.split("__header")[0];
      return getSelectedStep(document, parentId);
    }
    return null;
  }

  const selectedStep = resolveStepForConfig(selectedStepId);

  function handleSelectNode(id: string | null, isGroup: boolean) {
    if (isGroup) {
      setSelectedStepId(null);
    } else {
      setSelectedStepId(id);
    }
  }

  // -- Mode switching --

  function switchToCode() {
    const cpl = graphToCpl(workflow);
    setCplSource(cpl);
    setMode("code");
    setSelectedStepId(null);
  }

  async function switchToFlow() {
    const trimmed = cplSource.trim();
    if (!trimmed) {
      setDocument(createStudioDocument());
      setMode("flow");
      return;
    }

    const result = await bridge.parseCpl(trimmed);
    if (!result.ok || !result.ast) {
      setRunOutput("CPL parse error:\n" + (result.error ?? "Unknown error"));
      return;
    }

    const newDoc = cplAstToDocument(result.ast as { items: Record<string, unknown>[] });
    syncDocumentCounters(newDoc);
    setDocument(newDoc);
    setMode("flow");
    setSelectedStepId(null);
    setRunOutput(null);
  }

  function handleModeToggle(newMode: EditorMode) {
    if (newMode === mode) return;
    if (newMode === "code") {
      switchToCode();
    } else {
      switchToFlow();
    }
  }

  // -- Existing handlers --

  async function handleRun() {
    const cpl = mode === "code" ? cplSource : graphToCpl(workflow);
    if (!cpl) {
      setRunOutput("No steps to compile.");
      return;
    }
    setRunOutput("Compiling...\n\n" + cpl);
    const result = await bridge.validateCpl(cpl);
    if (result.valid) {
      setRunOutput("Valid CPL:\n\n" + cpl);
    } else {
      setRunOutput("Compilation error:\n" + (result.error ?? "Unknown error") + "\n\nGenerated CPL:\n" + cpl);
    }
  }

  async function handleSave() {
    if (mode === "code") {
      // Parse code back to document before saving
      const trimmed = cplSource.trim();
      if (trimmed) {
        const result = await bridge.parseCpl(trimmed);
        if (result.ok && result.ast) {
          const newDoc = cplAstToDocument(result.ast as { items: Record<string, unknown>[] });
          syncDocumentCounters(newDoc);
          setDocument(newDoc);
          const wf = getPrimaryWorkflow(newDoc);
          await bridge.saveWorkflow(wf.name, JSON.stringify(newDoc));
          setActiveWorkflow(wf.name);
          setSidebarRefresh((n) => n + 1);
          return;
        }
      }
    }
    await bridge.saveWorkflow(workflow.name, JSON.stringify(document));
    setActiveWorkflow(workflow.name);
    setSidebarRefresh((n) => n + 1);
  }

  async function handleLoad(name: string) {
    const data = await bridge.loadWorkflow(name);
    if (!data) return;
    if (!isStudioDocument(data)) {
      setRunOutput(
        `Workflow "${name}" uses the older canvas-only save format and cannot be loaded into the new typed document model yet.`
      );
      return;
    }
    syncDocumentCounters(data);
    setDocument(data);
    setActiveWorkflow(getPrimaryWorkflow(data).name);
    setSelectedStepId(null);
    setRunOutput(null);
    if (mode === "code") {
      setCplSource(graphToCpl(getPrimaryWorkflow(data)));
    }
  }

  function handleNew() {
    setDocument(createStudioDocument());
    setActiveWorkflow(null);
    setSelectedStepId(null);
    setRunOutput(null);
    if (mode === "code") {
      setCplSource("");
    }
  }

  function handleInsertStep(
    parentStepId: string | null,
    target: NestedStepTarget | null,
    index: number,
    kind: StepKind
  ) {
    setDocument((current) => ({
      ...current,
      workflows: [insertStepAt(getPrimaryWorkflow(current), parentStepId, target, index, kind)],
    }));
  }

  function handleStepChange(step: WorkflowStep) {
    setDocument((current) => ({
      ...current,
      workflows: [replaceStep(getPrimaryWorkflow(current), step)],
    }));
  }

  function handleDeleteStep(stepId: string) {
    setDocument((current) => ({
      ...current,
      workflows: [deleteStep(getPrimaryWorkflow(current), stepId)],
    }));
    if (selectedStepId === stepId) setSelectedStepId(null);
  }

  function handleAddBranchArm(branchId: string) {
    setDocument((current) => ({
      ...current,
      workflows: [addBranchArm(getPrimaryWorkflow(current), branchId)],
    }));
  }

  function handleAddUnorderedCase(unorderedId: string) {
    setDocument((current) => ({
      ...current,
      workflows: [addUnorderedCase(getPrimaryWorkflow(current), unorderedId)],
    }));
  }

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
        <div className="toolbar">
          <div className="mode-toggle">
            <button
              className={`mode-btn${mode === "flow" ? " mode-btn--active" : ""}`}
              onClick={() => handleModeToggle("flow")}
            >
              Flow
            </button>
            <button
              className={`mode-btn${mode === "code" ? " mode-btn--active" : ""}`}
              onClick={() => handleModeToggle("code")}
            >
              Code
            </button>
          </div>
          <button className="run-btn" onClick={handleSave}>
            Save
          </button>
          <button className="run-btn run-btn-primary" onClick={handleRun}>
            Run
          </button>
        </div>

        {mode === "flow" ? (
          <Canvas
            workflow={workflow}
            selectedStepId={selectedStepId}
            onSelectNode={handleSelectNode}
            onDeleteStep={handleDeleteStep}
            onInsertStep={handleInsertStep}
            onStepChange={handleStepChange}
            onAddBranchArm={handleAddBranchArm}
            onAddUnorderedCase={handleAddUnorderedCase}
          />
        ) : (
          <CodeEditor value={cplSource} onChange={setCplSource} />
        )}

        {mode === "flow" && selectedStep && (
          <ConfigPanel
            step={selectedStep}
            onChange={handleStepChange}
            onAddBranchArm={handleAddBranchArm}
            onClose={() => setSelectedStepId(null)}
          />
        )}

        {runOutput !== null && (
          <RunOutput output={runOutput} onClose={() => setRunOutput(null)} />
        )}
      </div>

      {settingsOpen && (
        <Settings
          mcpServers={mcpServers}
          onMcpServersChange={setMcpServers}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
