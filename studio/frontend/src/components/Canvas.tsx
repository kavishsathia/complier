import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type OnNodesDelete,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { WorkflowBlockDocument, WorkflowStep, NestedStepTarget, StepKind } from "../types.ts";
import { useWorkflowGraph } from "./canvas/useWorkflowGraph.ts";
import { nodeTypes } from "./canvas/nodes/nodeTypes.ts";
import { edgeTypes } from "./canvas/edges/edgeTypes.ts";
import type { AddEdgeMeta, AddNodeMeta, ScopeInfo } from "./canvas/workflowToFlow.ts";
import NodePalette from "./NodePalette.tsx";

const GROUP_TYPES = new Set(["branchGroup", "branchArmGroup", "loopGroup", "unorderedGroup", "unorderedCaseGroup"]);

interface CanvasProps {
  workflow: WorkflowBlockDocument;
  selectedStepId: string | null;
  onSelectNode: (id: string | null, isGroup: boolean) => void;
  onDeleteStep?: (stepId: string) => void;
  onInsertStep: (
    parentStepId: string | null,
    target: NestedStepTarget | null,
    index: number,
    kind: StepKind
  ) => void;
  onStepChange: (step: WorkflowStep) => void;
  onAddBranchArm: (branchId: string) => void;
  onAddUnorderedCase: (unorderedId: string) => void;
}

interface PaletteState {
  x: number;
  y: number;
  scopeInfo: ScopeInfo;
  insertIndex: number;
}

function CanvasInner({
  workflow,
  selectedStepId,
  onSelectNode,
  onDeleteStep,
  onInsertStep,
  onStepChange,
  onAddBranchArm,
  onAddUnorderedCase,
}: CanvasProps) {
  const { nodes: layoutNodes, edges: layoutEdges } = useWorkflowGraph(
    workflow.steps,
    selectedStepId
  );
  const [nodes, setNodes, onNodesChange] = useNodesState([] as Node[]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([] as Edge[]);
  const { fitView, screenToFlowPosition } = useReactFlow();
  const [palette, setPalette] = useState<PaletteState | null>(null);

  const openPalette = useCallback(
    (scopeInfo: ScopeInfo, insertIndex: number, screenX: number, screenY: number) => {
      setPalette({ x: screenX, y: screenY, scopeInfo, insertIndex });
    },
    []
  );

  // Inject callbacks into nodes
  const wiredNodes = useMemo(() => {
    return layoutNodes.map((n) => {
      if (n.type === "addNode") {
        const meta = n.data as unknown as AddNodeMeta;
        return {
          ...n,
          data: {
            ...meta,
            onAdd: () => {
              const el = document.querySelector(`[data-id="${n.id}"]`);
              if (el) {
                const rect = el.getBoundingClientRect();
                openPalette(meta.scopeInfo, meta.insertIndex, rect.right + 8, rect.top);
              } else {
                openPalette(meta.scopeInfo, meta.insertIndex, 400, 300);
              }
            },
          },
        };
      }
      if (n.type === "branchHeader") {
        const step = (n.data as Record<string, unknown>)?.step as WorkflowStep | undefined;
        return {
          ...n,
          data: {
            ...n.data,
            onAddArm: step ? () => onAddBranchArm(step.id) : undefined,
          },
        };
      }
      if (n.type === "branchArmGroup") {
        const data = n.data as Record<string, unknown>;
        const condition = (data.condition as string) ?? "";
        // Find the branch step that owns this arm to update its condition
        const armId = n.id;
        return {
          ...n,
          data: {
            ...data,
            onConditionChange: (newCondition: string) => {
              // Find the branch step containing this arm
              const findAndUpdate = (steps: WorkflowStep[]): WorkflowStep | null => {
                for (const s of steps) {
                  if (s.kind === "branch") {
                    const armIdx = s.arms.findIndex((a) => a.id === armId);
                    if (armIdx >= 0) {
                      const newArms = [...s.arms];
                      newArms[armIdx] = { ...newArms[armIdx], condition: newCondition };
                      onStepChange({ ...s, arms: newArms });
                      return s;
                    }
                    for (const arm of s.arms) {
                      const found = findAndUpdate(arm.steps);
                      if (found) return found;
                    }
                    const found = findAndUpdate(s.elseSteps);
                    if (found) return found;
                  }
                  if (s.kind === "loop") {
                    const found = findAndUpdate(s.body);
                    if (found) return found;
                  }
                }
                return null;
              };
              findAndUpdate(workflow.steps);
            },
          },
        };
      }
      if (n.type === "loopGroup") {
        const step = (n.data as Record<string, unknown>)?.step as WorkflowStep | undefined;
        const until = ((n.data as Record<string, unknown>)?.until as string) ?? "";
        return {
          ...n,
          data: {
            ...n.data,
            until,
            onUntilChange: step && step.kind === "loop"
              ? (newUntil: string) => onStepChange({ ...step, until: newUntil })
              : undefined,
          },
        };
      }
      if (n.type === "unorderedHeader") {
        const step = (n.data as Record<string, unknown>)?.step as WorkflowStep | undefined;
        return {
          ...n,
          data: {
            ...n.data,
            onAddCase: step ? () => onAddUnorderedCase(step.id) : undefined,
          },
        };
      }
      if (n.type === "unorderedCaseGroup") {
        const data = n.data as Record<string, unknown>;
        const caseId = n.id;
        return {
          ...n,
          data: {
            ...data,
            onLabelChange: (newLabel: string) => {
              const findAndUpdate = (steps: WorkflowStep[]): WorkflowStep | null => {
                for (const s of steps) {
                  if (s.kind === "unordered") {
                    const caseIdx = s.cases.findIndex((c) => c.id === caseId);
                    if (caseIdx >= 0) {
                      const newCases = [...s.cases];
                      newCases[caseIdx] = { ...newCases[caseIdx], label: newLabel };
                      onStepChange({ ...s, cases: newCases });
                      return s;
                    }
                    for (const c of s.cases) {
                      const found = findAndUpdate(c.steps);
                      if (found) return found;
                    }
                  }
                  if (s.kind === "branch") {
                    for (const arm of s.arms) {
                      const found = findAndUpdate(arm.steps);
                      if (found) return found;
                    }
                    const found = findAndUpdate(s.elseSteps);
                    if (found) return found;
                  }
                  if (s.kind === "loop") {
                    const found = findAndUpdate(s.body);
                    if (found) return found;
                  }
                }
                return null;
              };
              findAndUpdate(workflow.steps);
            },
          },
        };
      }
      return n;
    });
  }, [layoutNodes, openPalette, onAddBranchArm, onAddUnorderedCase, onStepChange, workflow.steps]);

  const wiredEdges = useMemo(() => {
    return layoutEdges.map((e) => {
      if (e.type === "addEdge") {
        const meta = e.data as unknown as AddEdgeMeta;
        return {
          ...e,
          data: {
            ...meta,
            onAdd: () => {
              // Position palette near the edge midpoint
              const edgeEl = document.querySelector(`[data-testid="rf__edge-${e.id}"]`);
              if (edgeEl) {
                const rect = edgeEl.getBoundingClientRect();
                const cx = rect.left + rect.width / 2;
                const cy = rect.top + rect.height / 2;
                openPalette(meta.scopeInfo, meta.insertIndex, cx, cy - 60);
              } else {
                openPalette(meta.scopeInfo, meta.insertIndex, 400, 300);
              }
            },
          },
        };
      }
      return e;
    });
  }, [layoutEdges, openPalette]);

  useEffect(() => {
    setNodes(wiredNodes);
    setEdges(wiredEdges);
    requestAnimationFrame(() => {
      fitView({ padding: 0.2 });
    });
  }, [wiredNodes, wiredEdges, setNodes, setEdges, fitView]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (node.type === "addNode") return; // handled by AddNode's own onClick
      const isGroup = GROUP_TYPES.has(node.type ?? "");
      onSelectNode(node.id, isGroup);
    },
    [onSelectNode]
  );

  const handleNodesDelete: OnNodesDelete = useCallback(
    (deleted) => {
      if (!onDeleteStep) return;
      for (const node of deleted) {
        const data = node.data as Record<string, unknown> | undefined;
        const step = data?.step as { id: string } | undefined;
        if (step?.id) onDeleteStep(step.id);
      }
    },
    [onDeleteStep]
  );

  const handlePaneClick = useCallback(() => {
    onSelectNode(null, false);
    setPalette(null);
  }, [onSelectNode]);

  const handlePaletteAdd = useCallback(
    (kind: StepKind) => {
      if (!palette) return;
      onInsertStep(
        palette.scopeInfo.parentStepId,
        palette.scopeInfo.target,
        palette.insertIndex,
        kind
      );
      setPalette(null);
    },
    [palette, onInsertStep]
  );

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={handleNodeClick}
        onNodesDelete={handleNodesDelete}
        onPaneClick={handlePaneClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        defaultEdgeOptions={{ type: "smoothstep", animated: false }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={["Backspace", "Delete"]}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="rgba(255,255,255,0.05)"
        />
        <Controls showInteractive={false} />
      </ReactFlow>
      {palette && (
        <div
          className="canvas-palette-overlay"
          onClick={() => setPalette(null)}
        >
          <div
            className="canvas-palette"
            style={{ left: palette.x, top: palette.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <NodePalette
              onAdd={handlePaletteAdd}
              onClose={() => setPalette(null)}
            />
          </div>
        </div>
      )}
    </>
  );
}

export default function Canvas(props: CanvasProps) {
  return (
    <div className="workflow-canvas" style={{ width: "100%", height: "100%" }}>
      <ReactFlowProvider>
        <CanvasInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
