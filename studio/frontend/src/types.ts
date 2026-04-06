export interface GuaranteeDocument {
  id: string;
  name: string;
  expression: string;
}

export interface WorkflowDocument {
  id: string;
  name: string;
  always: string[];
  steps: WorkflowStep[];
}

export interface WorkflowBlockDocument extends WorkflowDocument {
  blocks: WorkflowStep[];
}

export interface StudioDocument {
  version: 2;
  workflows: WorkflowDocument[];
  guarantees: GuaranteeDocument[];
}

interface BaseStep {
  id: string;
  [key: string]: unknown;
}

export interface ToolStep extends BaseStep {
  kind: "tool";
  toolName: string;
  params: Record<string, string>;
}

export interface BranchArm {
  id: string;
  condition: string;
  steps: WorkflowStep[];
}

export interface BranchStep extends BaseStep {
  kind: "branch";
  arms: BranchArm[];
  elseSteps: WorkflowStep[];
}

export interface LoopStep extends BaseStep {
  kind: "loop";
  until: string;
  body: WorkflowStep[];
}

export interface ForkStep extends BaseStep {
  kind: "fork";
  forkId: string;
  workflowName: string;
}

export interface JoinStep extends BaseStep {
  kind: "join";
  forkId: string;
}

export interface UnorderedCase {
  id: string;
  label: string;
  steps: WorkflowStep[];
}

export interface UnorderedStep extends BaseStep {
  kind: "unordered";
  cases: UnorderedCase[];
}

export type WorkflowStep =
  | ToolStep
  | BranchStep
  | LoopStep
  | ForkStep
  | JoinStep
  | UnorderedStep;

export type StepKind = WorkflowStep["kind"];

export type StudioNodeData = WorkflowStep;

export interface WorkflowMeta {
  name: string;
  file: string;
}

export type NestedStepTarget =
  | { kind: "branch-arm"; armId: string }
  | { kind: "branch-else" }
  | { kind: "loop-body" }
  | { kind: "unordered-case"; caseId: string };

export interface MCPServerConfig {
  id: string;
  name: string;
  type: "remote" | "local";
  url?: string;
  command?: string;
  enabled: boolean;
}
