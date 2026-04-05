import type { BranchArm, WorkflowDocument, WorkflowStep } from "../types.ts";

function emitTool(step: Extract<WorkflowStep, { kind: "tool" }>, indent: number): string[] {
  return [`${"    ".repeat(indent)}| ${step.toolName || "unnamed_tool"}`];
}

function emitBranchArm(arm: BranchArm, indent: number): string[] {
  if (arm.steps.length === 0) return [];
  const lines = [`${"    ".repeat(indent)}-when "${arm.condition}"`];
  lines.push(...emitSteps(arm.steps, indent + 1));
  return lines;
}

function emitBranch(step: Extract<WorkflowStep, { kind: "branch" }>, indent: number): string[] {
  const armLines: string[][] = step.arms.map((arm) => emitBranchArm(arm, indent + 1));
  const hasAnyArm = armLines.some((l) => l.length > 0) || step.elseSteps.length > 0;
  if (!hasAnyArm) return [];

  const lines = [`${"    ".repeat(indent)}| @branch`];
  for (const al of armLines) {
    lines.push(...al);
  }
  if (step.elseSteps.length > 0) {
    lines.push(`${"    ".repeat(indent + 1)}-else`);
    lines.push(...emitSteps(step.elseSteps, indent + 2));
  }
  return lines;
}

function emitLoop(step: Extract<WorkflowStep, { kind: "loop" }>, indent: number): string[] {
  if (step.body.length === 0) return [];
  const lines = [`${"    ".repeat(indent)}| @loop`];
  lines.push(...emitSteps(step.body, indent + 1));
  lines.push(`${"    ".repeat(indent + 1)}-until "${step.until || "done"}"`);
  return lines;
}

function emitFork(step: Extract<WorkflowStep, { kind: "fork" }>, indent: number): string[] {
  return [
    `${"    ".repeat(indent)}| @fork ${step.forkId || "f1"} @call ${step.workflowName || "sub"}`,
  ];
}

function emitJoin(step: Extract<WorkflowStep, { kind: "join" }>, indent: number): string[] {
  return [`${"    ".repeat(indent)}| @join ${step.forkId || "f1"}`];
}

function emitStep(step: WorkflowStep, indent: number): string[] {
  switch (step.kind) {
    case "tool":
      return emitTool(step, indent);
    case "branch":
      return emitBranch(step, indent);
    case "loop":
      return emitLoop(step, indent);
    case "fork":
      return emitFork(step, indent);
    case "join":
      return emitJoin(step, indent);
  }
}

function emitSteps(steps: WorkflowStep[], indent: number): string[] {
  const lines: string[] = [];
  for (const step of steps) {
    lines.push(...emitStep(step, indent));
  }
  return lines;
}

export function graphToCpl(workflow: WorkflowDocument): string {
  if (workflow.steps.length === 0) return "";
  const lines = [`workflow "${workflow.name}"`];
  lines.push(...emitSteps(workflow.steps, 1));
  return lines.join("\n") + "\n";
}
