import { useState } from "react";
import Canvas from "./components/Canvas.tsx";
import Sidebar from "./components/Sidebar.tsx";
import ConfigPanel from "./components/ConfigPanel.tsx";
import RunOutput from "./components/RunOutput.tsx";
import Settings from "./components/Settings.tsx";
import { graphToCpl } from "./lib/graph-to-cpl.ts";
import {
  addBranchArm,
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
import type { NestedStepTarget, StepKind, StudioDocument, WorkflowStep } from "./types.ts";

const GROUP_TYPES = new Set(["branchGroup", "branchArmGroup", "loopGroup"]);

export default function App() {
  const [document, setDocument] = useState<StudioDocument>(() => createStudioDocument());
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [runOutput, setRunOutput] = useState<string | null>(null);
  const [activeWorkflow, setActiveWorkflow] = useState<string | null>(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("gemma4");
  const workflow = getPrimaryWorkflow(document);

  // Resolve selectedStepId to an actual step for ConfigPanel.
  // Header nodes (e.g. "step-5__header") map to their parent step.
  function resolveStepForConfig(nodeId: string | null): WorkflowStep | null {
    if (!nodeId) return null;
    // Direct match
    const direct = getSelectedStep(document, nodeId);
    if (direct) return direct;
    // Header node
    if (nodeId.includes("__header")) {
      const parentId = nodeId.split("__header")[0];
      return getSelectedStep(document, parentId);
    }
    return null;
  }

  const selectedStep = resolveStepForConfig(selectedStepId);

  function handleSelectNode(id: string | null, isGroup: boolean) {
    if (isGroup) {
      // Groups don't open ConfigPanel
      setSelectedStepId(null);
    } else {
      setSelectedStepId(id);
    }
  }

  async function handleRun() {
    const cpl = graphToCpl(workflow);
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
  }

  function handleNew() {
    setDocument(createStudioDocument());
    setActiveWorkflow(null);
    setSelectedStepId(null);
    setRunOutput(null);
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
          <button className="run-btn" onClick={handleSave}>
            Save
          </button>
          <button className="run-btn run-btn-primary" onClick={handleRun}>
            Run
          </button>
        </div>

        <Canvas
          workflow={workflow}
          selectedStepId={selectedStepId}
          onSelectNode={handleSelectNode}
          onDeleteStep={handleDeleteStep}
          onInsertStep={handleInsertStep}
          onStepChange={handleStepChange}
          onAddBranchArm={handleAddBranchArm}
        />

        {selectedStep && (
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
