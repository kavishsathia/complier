import { describe, expect, it } from "vitest";

import { graphToCpl } from "./graph-to-cpl.ts";
import type { WorkflowDocument } from "../types.ts";

function workflow(steps: WorkflowDocument["steps"], name = "test"): WorkflowDocument {
  return {
    id: "workflow-1",
    name,
    always: [],
    steps,
  };
}

describe("graphToCpl", () => {
  it("returns empty string for an empty workflow", () => {
    expect(graphToCpl(workflow([], "empty"))).toBe("");
  });

  it("compiles a linear sequence", () => {
    const result = graphToCpl(
      workflow(
        [
          { id: "step-1", kind: "tool", toolName: "step_a", params: {} },
          { id: "step-2", kind: "tool", toolName: "step_b", params: {} },
          { id: "step-3", kind: "tool", toolName: "step_c", params: {} },
        ],
        "linear"
      )
    );

    expect(result).toBe(
      'workflow "linear"\n    | step_a\n    | step_b\n    | step_c\n'
    );
  });

  it("compiles a branch from explicit branch arms", () => {
    const result = graphToCpl(
      workflow(
        [
          {
            id: "step-1",
            kind: "branch",
            arms: [
              {
                id: "arm-1",
                condition: "is_premium",
                steps: [{ id: "step-2", kind: "tool", toolName: "premium_flow", params: {} }],
              },
              {
                id: "arm-2",
                condition: "is_trial",
                steps: [{ id: "step-3", kind: "tool", toolName: "trial_flow", params: {} }],
              },
            ],
            elseSteps: [{ id: "step-4", kind: "tool", toolName: "fallback", params: {} }],
          },
        ],
        "branching"
      )
    );

    expect(result).toContain('@branch');
    expect(result).toContain('-when "is_premium"');
    expect(result).toContain("| premium_flow");
    expect(result).toContain('-when "is_trial"');
    expect(result).toContain("| trial_flow");
    expect(result).toContain("-else");
    expect(result).toContain("| fallback");
  });

  it("compiles a loop from an explicit body", () => {
    const result = graphToCpl(
      workflow(
        [
          {
            id: "step-1",
            kind: "loop",
            until: "task_complete",
            body: [{ id: "step-2", kind: "tool", toolName: "do_work", params: {} }],
          },
        ],
        "looping"
      )
    );

    expect(result).toBe(
      'workflow "looping"\n    | @loop\n        | do_work\n        -until "task_complete"\n'
    );
  });

  it("compiles fork and join steps from the workflow document", () => {
    const result = graphToCpl(
      workflow(
        [
          { id: "step-1", kind: "tool", toolName: "setup", params: {} },
          { id: "step-2", kind: "fork", forkId: "bg", workflowName: "background_task" },
          { id: "step-3", kind: "join", forkId: "bg" },
          { id: "step-4", kind: "tool", toolName: "cleanup", params: {} },
        ],
        "forking"
      )
    );

    expect(result).toContain("| setup");
    expect(result).toContain("@fork bg @call background_task");
    expect(result).toContain("@join bg");
    expect(result).toContain("| cleanup");
  });
});
