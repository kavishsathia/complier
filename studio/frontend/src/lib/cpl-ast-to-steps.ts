/**
 * Maps a CPL AST (from the Python parser, serialized as JSON) back into
 * the studio's WorkflowStep[] tree.
 */

import type {
  WorkflowStep,
  ToolStep,
  BranchStep,
  LoopStep,
  ForkStep,
  JoinStep,
  UnorderedStep,
  StudioDocument,
} from "../types.ts";

let counter = 0;

function nextId(): string {
  counter += 1;
  return `step-${counter}`;
}

// -- AST shapes from Python (loosely typed) --

interface AstToolStep {
  name: string;
  params?: { name: string; value: unknown }[];
}

interface AstBranchStep {
  when_arms: { condition: string; steps: AstStep[] }[];
  else_arm?: { steps: AstStep[] } | null;
}

interface AstLoopStep {
  steps: AstStep[];
  until: string;
}

interface AstForkStep {
  fork_id: string;
  target: { workflow_name: string; call_type: string };
}

interface AstJoinStep {
  fork_id: string;
}

interface AstUnorderedStep {
  cases: { label: string; steps: AstStep[] }[];
}

type AstStep = Record<string, unknown>;

interface AstWorkflow {
  name: string;
  always?: string[];
  steps: AstStep[];
}

interface AstProgram {
  items: AstItem[];
}

type AstItem = Record<string, unknown>;

function isToolStep(s: AstStep): s is AstToolStep & AstStep {
  return "name" in s && !("fork_id" in s) && !("when_arms" in s) && !("until" in s) && !("cases" in s) && !("prompt" in s) && !("call_type" in s);
}

function isBranchStep(s: AstStep): s is AstBranchStep & AstStep {
  return "when_arms" in s;
}

function isLoopStep(s: AstStep): s is AstLoopStep & AstStep {
  return "until" in s && "steps" in s;
}

function isForkStep(s: AstStep): s is AstForkStep & AstStep {
  return "fork_id" in s && "target" in s;
}

function isJoinStep(s: AstStep): s is AstJoinStep & AstStep {
  return "fork_id" in s && !("target" in s);
}

function isUnorderedStep(s: AstStep): s is AstUnorderedStep & AstStep {
  return "cases" in s;
}

function convertStep(s: AstStep): WorkflowStep | null {
  if (isToolStep(s)) {
    const id = nextId();
    const params: Record<string, string> = {};
    for (const p of s.params ?? []) {
      params[p.name] = String(p.value ?? "");
    }
    return { id, kind: "tool", toolName: s.name, params } satisfies ToolStep;
  }

  if (isBranchStep(s)) {
    const id = nextId();
    const arms = s.when_arms.map((arm, i) => ({
      id: `${id}-arm-${i + 1}`,
      condition: arm.condition,
      steps: convertSteps(arm.steps),
    }));
    const elseSteps = s.else_arm?.steps ? convertSteps(s.else_arm.steps) : [];
    return { id, kind: "branch", arms, elseSteps } satisfies BranchStep;
  }

  if (isLoopStep(s)) {
    const id = nextId();
    return {
      id,
      kind: "loop",
      until: s.until,
      body: convertSteps(s.steps),
    } satisfies LoopStep;
  }

  if (isForkStep(s)) {
    const id = nextId();
    return {
      id,
      kind: "fork",
      forkId: s.fork_id,
      workflowName: s.target.workflow_name,
    } satisfies ForkStep;
  }

  if (isJoinStep(s)) {
    const id = nextId();
    return { id, kind: "join", forkId: s.fork_id } satisfies JoinStep;
  }

  if (isUnorderedStep(s)) {
    const id = nextId();
    const cases = s.cases.map((c, i) => ({
      id: `${id}-case-${i + 1}`,
      label: c.label,
      steps: convertSteps(c.steps),
    }));
    return { id, kind: "unordered", cases } satisfies UnorderedStep;
  }

  // Unknown step type (llm, human, subworkflow) — represent as a tool placeholder
  const id = nextId();
  const label = (s as Record<string, unknown>).prompt
    ? `llm`
    : (s as Record<string, unknown>).call_type
      ? `${(s as Record<string, unknown>).call_type} ${(s as Record<string, unknown>).workflow_name}`
      : "unknown";
  return { id, kind: "tool", toolName: label, params: {} } satisfies ToolStep;
}

function convertSteps(steps: AstStep[]): WorkflowStep[] {
  const result: WorkflowStep[] = [];
  for (const s of steps) {
    const converted = convertStep(s);
    if (converted) result.push(converted);
  }
  return result;
}

/**
 * Convert a CPL AST program (from the Python parser) into a StudioDocument.
 * Only the first workflow is used.
 */
export function cplAstToDocument(ast: AstProgram): StudioDocument {
  counter = 0;

  const workflows = ast.items.filter(
    (item): item is AstWorkflow & AstItem => "steps" in item && "name" in item
  );

  const wf = workflows[0];
  if (!wf) {
    return {
      version: 2,
      workflows: [{ id: "workflow-1", name: "Untitled", always: [], steps: [] }],
      guarantees: [],
    };
  }

  const steps = convertSteps(wf.steps);

  return {
    version: 2,
    workflows: [
      {
        id: "workflow-1",
        name: wf.name,
        always: wf.always ?? [],
        steps,
      },
    ],
    guarantees: [],
  };
}
