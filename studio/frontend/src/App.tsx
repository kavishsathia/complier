import { useState } from "react";
import Canvas from "./components/Canvas.tsx";
import Sidebar from "./components/Sidebar.tsx";
import NodePalette from "./components/NodePalette.tsx";
import ConfigPanel from "./components/ConfigPanel.tsx";
import RunOutput from "./components/RunOutput.tsx";
import Settings from "./components/Settings.tsx";
import { graphToCpl } from "./lib/graph-to-cpl.ts";
import {
  addBranchArm,
  appendNestedStep,
  appendRootStep,
  createStudioDocument,
  getPrimaryWorkflow,
  getSelectedStep,
  isStudioDocument,
  replaceStep,
  syncDocumentCounters,
} from "./lib/studio-document.ts";
import * as bridge from "./lib/bridge.ts";
import type { NestedStepTarget, StepKind, StudioDocument, WorkflowStep } from "./types.ts";

export default function App() {
  const [document, setDocument] = useState<StudioDocument>(() => createStudioDocument());
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [runOutput, setRunOutput] = useState<string | null>(null);
  const [activeWorkflow, setActiveWorkflow] = useState<string | null>(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434");
  const [ollamaModel, setOllamaModel] = useState("gemma4");
  const workflow = getPrimaryWorkflow(document);
  const selectedStep = getSelectedStep(document, selectedStepId);

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

  function handleAddRootStep(kind: StepKind) {
    setDocument((current) => ({
      ...current,
      workflows: [appendRootStep(getPrimaryWorkflow(current), kind)],
    }));
  }

  function handleStepChange(step: WorkflowStep) {
    setDocument((current) => ({
      ...current,
      workflows: [replaceStep(getPrimaryWorkflow(current), step)],
    }));
  }

  function handleAddNestedStep(containerId: string, target: NestedStepTarget, kind: StepKind) {
    setDocument((current) => ({
      ...current,
      workflows: [appendNestedStep(getPrimaryWorkflow(current), containerId, target, kind)],
    }));
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
          onSelectStep={setSelectedStepId}
        />

        <button className="add-btn" onClick={() => setPaletteOpen(!paletteOpen)}>
          +
        </button>

        {paletteOpen && (
          <NodePalette
            onAdd={handleAddRootStep}
            onClose={() => setPaletteOpen(false)}
          />
        )}

        {selectedStep && (
          <ConfigPanel
            step={selectedStep}
            onChange={handleStepChange}
            onAddNestedStep={handleAddNestedStep}
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
