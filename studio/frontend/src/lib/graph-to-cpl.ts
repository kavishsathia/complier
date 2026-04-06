import type { BranchArm, MCPServerConfig, MCPToolInfo, UnorderedCase, WorkflowDocument, WorkflowStep } from "../types.ts";

function buildToolNamespace(servers: MCPServerConfig[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of servers) {
    if (!s.enabled || !s.tools) continue;
    for (const raw of s.tools as unknown[]) {
      const name = typeof raw === "string" ? raw : (raw as MCPToolInfo).name;
      if (name && !map.has(name)) {
        map.set(name, s.name.toLowerCase().replace(/\s+/g, "_"));
      }
    }
  }
  return map;
}

function emitTool(step: Extract<WorkflowStep, { kind: "tool" }>, indent: number, ns: Map<string, string>): string[] {
  const pad = "    ".repeat(indent);
  const rawName = typeof step.toolName === "string" ? step.toolName : "";
  const raw = rawName || "unnamed_tool";
  const prefix = ns.get(raw);
  const name = prefix ? `${prefix}.${raw}` : raw;
  const paramParts: string[] = [];
  if (step.params && typeof step.params === "object") {
    for (const [paramName, expr] of Object.entries(step.params)) {
      if (typeof expr === "string" && expr) {
        paramParts.push(`${paramName}=${expr}`);
      }
    }
  }
  const paramStr = paramParts.length > 0 ? " " + paramParts.join(" ") : "";
  return [`${pad}| ${name}${paramStr}`];
}

function emitBranchArm(arm: BranchArm, indent: number, ns: Map<string, string>): string[] {
  if (arm.steps.length === 0) return [];
  const lines = [`${"    ".repeat(indent)}-when "${arm.condition}"`];
  lines.push(...emitSteps(arm.steps, indent + 1, ns));
  return lines;
}

function emitBranch(step: Extract<WorkflowStep, { kind: "branch" }>, indent: number, ns: Map<string, string>): string[] {
  const armLines: string[][] = step.arms.map((arm) => emitBranchArm(arm, indent + 1, ns));
  const hasAnyArm = armLines.some((l) => l.length > 0) || step.elseSteps.length > 0;
  if (!hasAnyArm) return [];

  const lines = [`${"    ".repeat(indent)}| @branch`];
  for (const al of armLines) {
    lines.push(...al);
  }
  if (step.elseSteps.length > 0) {
    lines.push(`${"    ".repeat(indent + 1)}-else`);
    lines.push(...emitSteps(step.elseSteps, indent + 2, ns));
  }
  return lines;
}

function emitLoop(step: Extract<WorkflowStep, { kind: "loop" }>, indent: number, ns: Map<string, string>): string[] {
  if (step.body.length === 0) return [];
  const lines = [`${"    ".repeat(indent)}| @loop`];
  lines.push(...emitSteps(step.body, indent + 1, ns));
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

function emitUnorderedCase(c: UnorderedCase, indent: number, ns: Map<string, string>): string[] {
  if (c.steps.length === 0) return [];
  const lines = [`${"    ".repeat(indent)}-step "${c.label}"`];
  lines.push(...emitSteps(c.steps, indent + 1, ns));
  return lines;
}

function emitUnordered(step: Extract<WorkflowStep, { kind: "unordered" }>, indent: number, ns: Map<string, string>): string[] {
  const caseLines: string[][] = step.cases.map((c) => emitUnorderedCase(c, indent + 1, ns));
  const hasAnyCase = caseLines.some((l) => l.length > 0);
  if (!hasAnyCase) return [];

  const lines = [`${"    ".repeat(indent)}| @unordered`];
  for (const cl of caseLines) {
    lines.push(...cl);
  }
  return lines;
}

function emitStep(step: WorkflowStep, indent: number, ns: Map<string, string>): string[] {
  switch (step.kind) {
    case "tool":
      return emitTool(step, indent, ns);
    case "branch":
      return emitBranch(step, indent, ns);
    case "loop":
      return emitLoop(step, indent, ns);
    case "fork":
      return emitFork(step, indent);
    case "join":
      return emitJoin(step, indent);
    case "unordered":
      return emitUnordered(step, indent, ns);
  }
}

function emitSteps(steps: WorkflowStep[], indent: number, ns: Map<string, string>): string[] {
  const lines: string[] = [];
  for (const step of steps) {
    lines.push(...emitStep(step, indent, ns));
  }
  return lines;
}

export function graphToCpl(workflow: WorkflowDocument, mcpServers?: MCPServerConfig[]): string {
  if (workflow.steps.length === 0) return "";
  const ns = buildToolNamespace(mcpServers ?? []);
  const lines = [`workflow "${workflow.name}"`];
  lines.push(...emitSteps(workflow.steps, 1, ns));
  return lines.join("\n") + "\n";
}
