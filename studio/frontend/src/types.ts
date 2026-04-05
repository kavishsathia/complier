// ── Node data types (discriminated union on `kind`) ──

export interface ToolNodeData {
  kind: "tool";
  toolName: string;
  params: Record<string, string>;
  [key: string]: unknown;
}

export interface BranchNodeData {
  kind: "branch";
  arms: { condition: string }[];
  hasElse: boolean;
  [key: string]: unknown;
}

export interface JoinNodeData {
  kind: "join";
  [key: string]: unknown;
}

export interface LoopNodeData {
  kind: "loop";
  until: string;
  [key: string]: unknown;
}

export interface ForkNodeData {
  kind: "fork";
  forkId: string;
  workflowName: string;
  [key: string]: unknown;
}

export type StudioNodeData =
  | ToolNodeData
  | BranchNodeData
  | JoinNodeData
  | LoopNodeData
  | ForkNodeData;

// ── Persisted workflow ──

export interface WorkflowMeta {
  name: string;
  file: string;
}
