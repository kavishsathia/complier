import type {
  NestedStepTarget,
  StepKind,
  StudioDocument,
  WorkflowBlockDocument,
  WorkflowDocument,
  WorkflowStep,
} from "../types.ts";

let stepCounter = 0;
let workflowCounter = 0;

function nextWorkflowId(): string {
  workflowCounter += 1;
  return `workflow-${workflowCounter}`;
}

function nextStepId(): string {
  stepCounter += 1;
  return `step-${stepCounter}`;
}

function syncCounterFromId(id: string, prefix: string, set: (value: number) => void) {
  if (!id.startsWith(prefix)) return;
  const suffix = Number(id.slice(prefix.length));
  if (!Number.isNaN(suffix) && suffix > 0) {
    set(suffix);
  }
}

function walkSteps(steps: WorkflowStep[], visitor: (step: WorkflowStep) => void) {
  for (const step of steps) {
    visitor(step);
    if (step.kind === "branch") {
      for (const arm of step.arms) {
        walkSteps(arm.steps, visitor);
      }
      walkSteps(step.elseSteps, visitor);
    } else if (step.kind === "loop") {
      walkSteps(step.body, visitor);
    }
  }
}

export function createStep(kind: StepKind): WorkflowStep {
  const id = nextStepId();
  switch (kind) {
    case "tool":
      return { id, kind: "tool", toolName: "", params: {} };
    case "branch":
      return {
        id,
        kind: "branch",
        arms: [{ id: `${id}-arm-1`, condition: "", steps: [] }],
        elseSteps: [],
      };
    case "loop":
      return { id, kind: "loop", until: "", body: [] };
    case "fork":
      return { id, kind: "fork", forkId: "", workflowName: "" };
    case "join":
      return { id, kind: "join", forkId: "" };
  }
}

export function createStudioDocument(name = "Untitled"): StudioDocument {
  return {
    version: 2,
    guarantees: [],
    workflows: [
      {
        id: nextWorkflowId(),
        name,
        always: [],
        steps: [],
      },
    ],
  };
}

export function getPrimaryWorkflow(document: StudioDocument): WorkflowBlockDocument {
  const workflow = document.workflows[0];
  return {
    ...workflow,
    blocks: workflow.steps,
  };
}

export function syncDocumentCounters(document: StudioDocument): void {
  let maxStep = stepCounter;
  let maxWorkflow = workflowCounter;

  for (const workflow of document.workflows) {
    syncCounterFromId(workflow.id, "workflow-", (value) => {
      maxWorkflow = Math.max(maxWorkflow, value);
    });
    walkSteps(workflow.steps, (step) => {
      syncCounterFromId(step.id, "step-", (value) => {
        maxStep = Math.max(maxStep, value);
      });
    });
  }

  workflowCounter = maxWorkflow;
  stepCounter = maxStep;
}

export function findStep(steps: WorkflowStep[], stepId: string): WorkflowStep | null {
  for (const step of steps) {
    if (step.id === stepId) return step;
    if (step.kind === "branch") {
      for (const arm of step.arms) {
        const found = findStep(arm.steps, stepId);
        if (found) return found;
      }
      const elseFound = findStep(step.elseSteps, stepId);
      if (elseFound) return elseFound;
    }
    if (step.kind === "loop") {
      const found = findStep(step.body, stepId);
      if (found) return found;
    }
  }
  return null;
}

function mapSteps(
  steps: WorkflowStep[],
  stepId: string,
  updater: (step: WorkflowStep) => WorkflowStep
): WorkflowStep[] {
  return steps.map((step) => {
    if (step.id === stepId) return updater(step);

    if (step.kind === "branch") {
      return {
        ...step,
        arms: step.arms.map((arm) => ({
          ...arm,
          steps: mapSteps(arm.steps, stepId, updater),
        })),
        elseSteps: mapSteps(step.elseSteps, stepId, updater),
      };
    }

    if (step.kind === "loop") {
      return {
        ...step,
        body: mapSteps(step.body, stepId, updater),
      };
    }

    return step;
  });
}

export function updateStep(
  workflow: WorkflowDocument,
  stepId: string,
  updater: (step: WorkflowStep) => WorkflowStep
): WorkflowDocument {
  return {
    ...workflow,
    steps: mapSteps(workflow.steps, stepId, updater),
  };
}

export function appendRootStep(workflow: WorkflowDocument, kind: StepKind): WorkflowDocument {
  return {
    ...workflow,
    steps: [...workflow.steps, createStep(kind)],
  };
}

export function appendNestedStep(
  workflow: WorkflowDocument,
  containerId: string,
  target: NestedStepTarget,
  kind: StepKind
): WorkflowDocument {
  return updateStep(workflow, containerId, (step) => {
    const child = createStep(kind);
    if (step.kind === "branch") {
      if (target.kind === "branch-arm") {
        return {
          ...step,
          arms: step.arms.map((arm) =>
            arm.id === target.armId ? { ...arm, steps: [...arm.steps, child] } : arm
          ),
        };
      }
      if (target.kind === "branch-else") {
        return {
          ...step,
          elseSteps: [...step.elseSteps, child],
        };
      }
    }

    if (step.kind === "loop" && target.kind === "loop-body") {
      return {
        ...step,
        body: [...step.body, child],
      };
    }

    return step;
  });
}

export function addBranchArm(workflow: WorkflowDocument, branchId: string): WorkflowDocument {
  return updateStep(workflow, branchId, (step) => {
    if (step.kind !== "branch") return step;
    const nextIndex = step.arms.length + 1;
    return {
      ...step,
      arms: [
        ...step.arms,
        {
          id: `${step.id}-arm-${nextIndex}`,
          condition: "",
          steps: [],
        },
      ],
    };
  });
}

export function replaceStep(workflow: WorkflowDocument, updated: WorkflowStep): WorkflowDocument {
  return updateStep(workflow, updated.id, () => updated);
}

export function isStudioDocument(value: unknown): value is StudioDocument {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<StudioDocument>;
  return candidate.version === 2 && Array.isArray(candidate.workflows);
}

export function getSelectedStep(
  document: StudioDocument,
  stepId: string | null
): WorkflowStep | null {
  if (!stepId) return null;
  return findStep(getPrimaryWorkflow(document).steps, stepId);
}
