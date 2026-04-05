import { describe, it, expect } from "vitest";
import { graphToCpl } from "./graph-to-cpl.ts";

// Helper to create a minimal Node object that React Flow expects.
function node(id: string, type: string, data: Record<string, unknown>) {
  return { id, type, position: { x: 0, y: 0 }, data };
}

function edge(source: string, target: string, label?: string) {
  return { id: `${source}-${target}`, source, target, label };
}

describe("graphToCpl", () => {
  // ─── Empty / error cases ───

  it("returns empty string for empty graph", () => {
    expect(graphToCpl({ name: "test", nodes: [], edges: [] })).toBe("");
  });

  it("returns error comment when all nodes have incoming edges (cycle)", () => {
    const nodes = [
      node("a", "tool", { kind: "tool", toolName: "step_a" }),
      node("b", "tool", { kind: "tool", toolName: "step_b" }),
    ];
    const edges = [edge("a", "b"), edge("b", "a")];
    const result = graphToCpl({ name: "cycle", nodes, edges });
    expect(result).toContain("Error");
  });

  // ─── Single tool node ───

  it("compiles a single tool node", () => {
    const nodes = [node("1", "tool", { kind: "tool", toolName: "fetch_data" })];
    const result = graphToCpl({ name: "single", nodes: nodes as any, edges: [] });
    expect(result).toBe('workflow "single"\n    | fetch_data\n');
  });

  it("uses unnamed_tool when toolName is empty", () => {
    const nodes = [node("1", "tool", { kind: "tool", toolName: "" })];
    const result = graphToCpl({ name: "empty", nodes: nodes as any, edges: [] });
    expect(result).toContain("unnamed_tool");
  });

  // ─── Linear sequence ───

  it("compiles a linear sequence of tool nodes", () => {
    const nodes = [
      node("1", "tool", { kind: "tool", toolName: "step_a" }),
      node("2", "tool", { kind: "tool", toolName: "step_b" }),
      node("3", "tool", { kind: "tool", toolName: "step_c" }),
    ];
    const edges = [edge("1", "2"), edge("2", "3")];
    const result = graphToCpl({ name: "linear", nodes: nodes as any, edges: edges as any });
    expect(result).toBe(
      'workflow "linear"\n    | step_a\n    | step_b\n    | step_c\n'
    );
  });

  // ─── Branch with when arms ───

  it("compiles a branch with two when arms", () => {
    const nodes = [
      node("1", "branch", {
        kind: "branch",
        arms: [{ condition: "is_premium" }, { condition: "is_trial" }],
        hasElse: false,
      }),
      node("2", "tool", { kind: "tool", toolName: "premium_flow" }),
      node("3", "tool", { kind: "tool", toolName: "trial_flow" }),
    ];
    const edges = [
      edge("1", "2", "is_premium"),
      edge("1", "3", "is_trial"),
    ];
    const result = graphToCpl({ name: "branching", nodes: nodes as any, edges: edges as any });
    expect(result).toContain('@branch');
    expect(result).toContain('-when "is_premium"');
    expect(result).toContain("| premium_flow");
    expect(result).toContain('-when "is_trial"');
    expect(result).toContain("| trial_flow");
  });

  // ─── Branch with else ───

  it("compiles a branch with when and else", () => {
    const nodes = [
      node("1", "branch", {
        kind: "branch",
        arms: [{ condition: "has_access" }],
        hasElse: true,
      }),
      node("2", "tool", { kind: "tool", toolName: "grant" }),
      node("3", "tool", { kind: "tool", toolName: "deny" }),
    ];
    const edges = [
      edge("1", "2", "has_access"),
      edge("1", "3", "else"),
    ];
    const result = graphToCpl({ name: "else_branch", nodes: nodes as any, edges: edges as any });
    expect(result).toContain('-when "has_access"');
    expect(result).toContain("| grant");
    expect(result).toContain("-else");
    expect(result).toContain("| deny");
  });

  // ─── Branch followed by more steps ───

  it("compiles a branch followed by a continuation node", () => {
    const nodes = [
      node("1", "tool", { kind: "tool", toolName: "start" }),
      node("2", "branch", {
        kind: "branch",
        arms: [{ condition: "yes" }],
        hasElse: true,
      }),
      node("3", "tool", { kind: "tool", toolName: "do_yes" }),
      node("4", "tool", { kind: "tool", toolName: "do_no" }),
      node("5", "join", { kind: "join" }),
      node("6", "tool", { kind: "tool", toolName: "finish" }),
    ];
    const edges = [
      edge("1", "2"),
      edge("2", "3", "yes"),
      edge("2", "4", "else"),
      edge("2", "5"),          // branch -> join (unlabeled)
      edge("5", "6"),
    ];
    const result = graphToCpl({ name: "branch_then_continue", nodes: nodes as any, edges: edges as any });
    expect(result).toContain("| start");
    expect(result).toContain("@branch");
    expect(result).toContain("| finish");
  });

  // ─── Loop ───

  it("compiles a loop with body and until condition", () => {
    const nodes = [
      node("1", "loop", { kind: "loop", until: "task_complete" }),
      node("2", "tool", { kind: "tool", toolName: "do_work" }),
    ];
    const edges = [edge("1", "2")];
    const result = graphToCpl({ name: "looping", nodes: nodes as any, edges: edges as any });
    expect(result).toContain("@loop");
    expect(result).toContain("| do_work");
    expect(result).toContain('-until "task_complete"');
  });

  it("uses default until when condition is empty", () => {
    const nodes = [
      node("1", "loop", { kind: "loop", until: "" }),
      node("2", "tool", { kind: "tool", toolName: "retry" }),
    ];
    const edges = [edge("1", "2")];
    const result = graphToCpl({ name: "loop_default", nodes: nodes as any, edges: edges as any });
    expect(result).toContain('-until "done"');
  });

  // ─── Fork and Join ───

  it("compiles fork and join nodes", () => {
    const nodes = [
      node("1", "tool", { kind: "tool", toolName: "setup" }),
      node("2", "fork", { kind: "fork", forkId: "bg", workflowName: "background_task" }),
      node("3", "join", { kind: "join", forkId: "bg" }),
      node("4", "tool", { kind: "tool", toolName: "cleanup" }),
    ];
    const edges = [
      edge("1", "2"),
      edge("2", "3"),
      edge("3", "4"),
    ];
    const result = graphToCpl({ name: "forking", nodes: nodes as any, edges: edges as any });
    expect(result).toContain("| setup");
    expect(result).toContain("@fork bg @call background_task");
    expect(result).toContain("@join bg");
    expect(result).toContain("| cleanup");
  });

  it("uses default fork id when empty", () => {
    const nodes = [
      node("1", "fork", { kind: "fork", forkId: "", workflowName: "" }),
    ];
    const result = graphToCpl({ name: "fork_defaults", nodes: nodes as any, edges: [] });
    expect(result).toContain("@fork f1 @call sub");
  });

  // ─── Ordering ───

  it("follows edge order for sequential steps", () => {
    const nodes = [
      node("a", "tool", { kind: "tool", toolName: "first" }),
      node("b", "tool", { kind: "tool", toolName: "second" }),
      node("c", "tool", { kind: "tool", toolName: "third" }),
    ];
    const edges = [edge("a", "b"), edge("b", "c")];
    const result = graphToCpl({ name: "order", nodes: nodes as any, edges: edges as any });
    const lines = result.split("\n").filter((l) => l.includes("|"));
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("second");
    expect(lines[2]).toContain("third");
  });

  // ─── Multiple disconnected roots ───

  it("compiles all disconnected root nodes", () => {
    const nodes = [
      node("a", "tool", { kind: "tool", toolName: "alpha" }),
      node("b", "tool", { kind: "tool", toolName: "beta" }),
    ];
    // No edges — both are roots
    const result = graphToCpl({ name: "multi_root", nodes: nodes as any, edges: [] });
    expect(result).toContain("| alpha");
    expect(result).toContain("| beta");
  });

  // ─── Complex: tool → branch → tool → fork → join → tool ───

  it("compiles a complex multi-construct workflow", () => {
    const nodes = [
      node("1", "tool", { kind: "tool", toolName: "init" }),
      node("2", "branch", {
        kind: "branch",
        arms: [{ condition: "ready" }],
        hasElse: true,
      }),
      node("3", "tool", { kind: "tool", toolName: "proceed" }),
      node("4", "tool", { kind: "tool", toolName: "abort" }),
      node("5", "join", { kind: "join" }),
      node("6", "fork", { kind: "fork", forkId: "w", workflowName: "worker" }),
      node("7", "join", { kind: "join", forkId: "w" }),
      node("8", "tool", { kind: "tool", toolName: "done" }),
    ];
    const edges = [
      edge("1", "2"),
      edge("2", "3", "ready"),
      edge("2", "4", "else"),
      edge("2", "5"),
      edge("5", "6"),
      edge("6", "7"),
      edge("7", "8"),
    ];
    const result = graphToCpl({ name: "complex", nodes: nodes as any, edges: edges as any });
    expect(result).toContain("| init");
    expect(result).toContain("@branch");
    expect(result).toContain('-when "ready"');
    expect(result).toContain("| proceed");
    expect(result).toContain("-else");
    expect(result).toContain("| abort");
    expect(result).toContain("@fork w @call worker");
    expect(result).toContain("@join w");
    expect(result).toContain("| done");
  });
});
