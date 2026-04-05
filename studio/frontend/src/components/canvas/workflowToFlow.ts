import type { Node, Edge } from "@xyflow/react";
import type { WorkflowStep, BranchStep, LoopStep, UnorderedStep, NestedStepTarget } from "../../types.ts";
import { NODE_WIDTH, NODE_HEIGHT } from "./constants.ts";

export interface ScopeInfo {
  parentStepId: string | null;
  target: NestedStepTarget | null;
}

export interface AddEdgeMeta {
  scopeInfo: ScopeInfo;
  insertIndex: number;
  [key: string]: unknown;
}

export interface AddNodeMeta {
  scopeInfo: ScopeInfo;
  insertIndex: number;
  [key: string]: unknown;
}

interface ConversionResult {
  nodes: Node[];
  edges: Edge[];
}

const ADD_NODE_SIZE = 28;

function outerNodeId(step: WorkflowStep): string {
  return step.id;
}

function makeScopeInfo(parentStepId: string | null, target: NestedStepTarget | null): ScopeInfo {
  return { parentStepId, target };
}

let addNodeCounter = 0;

function nextAddNodeId(): string {
  addNodeCounter += 1;
  return `__add-${addNodeCounter}`;
}

function convertBranch(step: BranchStep, scopeParentId?: string): ConversionResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: step.id,
    type: "branchGroup",
    position: { x: 0, y: 0 },
    data: { step },
    ...(scopeParentId ? { parentId: scopeParentId } : {}),
    style: { width: NODE_WIDTH, height: NODE_HEIGHT },
  });

  const headerId = `${step.id}__header`;
  nodes.push({
    id: headerId,
    type: "branchHeader",
    position: { x: 0, y: 0 },
    data: { step },
    parentId: step.id,
    style: { width: NODE_WIDTH, height: NODE_HEIGHT },
  });

  const allArms: { id: string; condition: string; steps: WorkflowStep[]; target: NestedStepTarget }[] = [
    ...step.arms.map((arm) => ({
      id: arm.id,
      condition: arm.condition,
      steps: arm.steps,
      target: { kind: "branch-arm" as const, armId: arm.id },
    })),
    ...(step.elseSteps.length > 0 || true
      ? [{
          id: `${step.id}__else`,
          condition: "else",
          steps: step.elseSteps,
          target: { kind: "branch-else" as const },
        }]
      : []),
  ];

  for (const arm of allArms) {
    nodes.push({
      id: arm.id,
      type: "branchArmGroup",
      position: { x: 0, y: 0 },
      data: { condition: arm.condition },
      parentId: step.id,
      style: { width: NODE_WIDTH, height: NODE_HEIGHT },
    });

    edges.push({
      id: `e-${headerId}-${arm.id}`,
      source: headerId,
      target: arm.id,
      type: "smoothstep",
    });

    const armScope = makeScopeInfo(step.id, arm.target);
    const armResult = convertSteps(arm.steps, arm.id, armScope);
    nodes.push(...armResult.nodes);
    edges.push(...armResult.edges);
  }

  return { nodes, edges };
}

function convertLoop(step: LoopStep, scopeParentId?: string): ConversionResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Loop group node — no separate header, "until" is edited inline on the group label
  nodes.push({
    id: step.id,
    type: "loopGroup",
    position: { x: 0, y: 0 },
    data: { step, until: step.until },
    ...(scopeParentId ? { parentId: scopeParentId } : {}),
    style: { width: NODE_WIDTH, height: NODE_HEIGHT },
  });

  const bodyScope = makeScopeInfo(step.id, { kind: "loop-body" });
  const bodyResult = convertSteps(step.body, step.id, bodyScope);
  nodes.push(...bodyResult.nodes);
  edges.push(...bodyResult.edges);

  return { nodes, edges };
}

function convertUnordered(step: UnorderedStep, scopeParentId?: string): ConversionResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Group node
  nodes.push({
    id: step.id,
    type: "unorderedGroup",
    position: { x: 0, y: 0 },
    data: { step },
    ...(scopeParentId ? { parentId: scopeParentId } : {}),
    style: { width: NODE_WIDTH, height: NODE_HEIGHT },
  });

  // Header node inside group
  const headerId = `${step.id}__header`;
  nodes.push({
    id: headerId,
    type: "unorderedHeader",
    position: { x: 0, y: 0 },
    data: { step },
    parentId: step.id,
    style: { width: NODE_WIDTH, height: NODE_HEIGHT },
  });

  // Each case as a sub-group
  for (const c of step.cases) {
    nodes.push({
      id: c.id,
      type: "unorderedCaseGroup",
      position: { x: 0, y: 0 },
      data: { label: c.label },
      parentId: step.id,
      style: { width: NODE_WIDTH, height: NODE_HEIGHT },
    });

    edges.push({
      id: `e-${headerId}-${c.id}`,
      source: headerId,
      target: c.id,
      type: "smoothstep",
    });

    const caseScope = makeScopeInfo(step.id, { kind: "unordered-case" as const, caseId: c.id });
    const caseResult = convertSteps(c.steps, c.id, caseScope);
    nodes.push(...caseResult.nodes);
    edges.push(...caseResult.edges);
  }

  return { nodes, edges };
}

function convertSteps(
  steps: WorkflowStep[],
  reactFlowParentId: string | undefined,
  scopeInfo: ScopeInfo
): ConversionResult {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  for (const step of steps) {
    if (step.kind === "branch") {
      const result = convertBranch(step, reactFlowParentId);
      nodes.push(...result.nodes);
      edges.push(...result.edges);
    } else if (step.kind === "loop") {
      const result = convertLoop(step, reactFlowParentId);
      nodes.push(...result.nodes);
      edges.push(...result.edges);
    } else if (step.kind === "unordered") {
      const result = convertUnordered(step, reactFlowParentId);
      nodes.push(...result.nodes);
      edges.push(...result.edges);
    } else {
      nodes.push({
        id: step.id,
        type: step.kind,
        position: { x: 0, y: 0 },
        data: { step },
        ...(reactFlowParentId ? { parentId: reactFlowParentId } : {}),
        style: { width: NODE_WIDTH, height: NODE_HEIGHT },
      });
    }
  }

  // Sequential edges with add-edge type and scope metadata
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const curr = steps[i];
    const meta: AddEdgeMeta = { scopeInfo, insertIndex: i };
    edges.push({
      id: `e-${outerNodeId(prev)}-${outerNodeId(curr)}`,
      source: outerNodeId(prev),
      target: outerNodeId(curr),
      type: "addEdge",
      data: meta,
    });
  }

  // Add-node at the end of this scope
  const addNodeId = nextAddNodeId();
  const addMeta: AddNodeMeta = { scopeInfo, insertIndex: steps.length };
  nodes.push({
    id: addNodeId,
    type: "addNode",
    position: { x: 0, y: 0 },
    data: addMeta,
    ...(reactFlowParentId ? { parentId: reactFlowParentId } : {}),
    style: { width: ADD_NODE_SIZE, height: ADD_NODE_SIZE },
  });

  // Edge from last step to add-node
  if (steps.length > 0) {
    const lastStep = steps[steps.length - 1];
    edges.push({
      id: `e-${outerNodeId(lastStep)}-${addNodeId}`,
      source: outerNodeId(lastStep),
      target: addNodeId,
      type: "smoothstep",
    });
  }

  return { nodes, edges };
}

export function workflowToFlow(steps: WorkflowStep[]): ConversionResult {
  addNodeCounter = 0;
  const rootScope = makeScopeInfo(null, null);
  return convertSteps(steps, undefined, rootScope);
}
