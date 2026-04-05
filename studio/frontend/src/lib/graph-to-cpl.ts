/**
 * Compiles a React Flow graph (nodes + edges) into CPL source text.
 *
 * The algorithm:
 * 1. Find root nodes (no incoming edges).
 * 2. Walk forward through edges, emitting CPL steps.
 * 3. Branch nodes → @branch with -when/-else arms.
 * 4. Loop nodes → @loop with body and -until.
 * 5. Fork nodes → @fork id @call workflow.
 * 6. Join nodes → @join id.
 */

import type { Node, Edge } from "@xyflow/react";
import type { StudioNodeData } from "../types.ts";

interface GraphInput {
  name: string;
  nodes: Node[];
  edges: Edge[];
}

export function graphToCpl({ name, nodes, edges }: GraphInput): string {
  if (nodes.length === 0) return "";

  const outgoing = new Map<string, Edge[]>();
  const incoming = new Map<string, Edge[]>();
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, []);
    outgoing.get(e.source)!.push(e);
    if (!incoming.has(e.target)) incoming.set(e.target, []);
    incoming.get(e.target)!.push(e);
  }

  const nodeMap = new Map<string, Node>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Find root nodes (no incoming edges)
  const roots = nodes.filter((n) => !incoming.has(n.id) || incoming.get(n.id)!.length === 0);
  if (roots.length === 0) return `// Error: no root node found (all nodes have incoming edges)\n`;

  const lines: string[] = [`workflow "${name}"`];
  const visited = new Set<string>();

  function emit(nodeId: string, indent: number) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = nodeMap.get(nodeId);
    if (!node) return;

    const data = node.data as unknown as StudioNodeData;
    const pad = "    ".repeat(indent);

    switch (data.kind) {
      case "tool":
        lines.push(`${pad}| ${data.toolName || "unnamed_tool"}`);
        break;
      case "branch": {
        lines.push(`${pad}| @branch`);
        const outs = outgoing.get(nodeId) || [];
        for (const arm of data.arms) {
          const armEdge = outs.find((e) => e.label === arm.condition);
          lines.push(`${pad}    -when "${arm.condition}"`);
          if (armEdge) emitChain(armEdge.target, indent + 2);
        }
        if (data.hasElse) {
          const elseEdge = outs.find((e) => e.label === "else");
          lines.push(`${pad}    -else`);
          if (elseEdge) emitChain(elseEdge.target, indent + 2);
        }
        // After branch, continue from the join node if any
        // Find the join node connected after branch arms
        const joinEdges = outs.filter(
          (e) =>
            !data.arms.some((a: { condition: string }) => e.label === a.condition) &&
            e.label !== "else"
        );
        for (const je of joinEdges) {
          emit(je.target, indent);
        }
        return; // don't follow default outgoing
      }
      case "loop":
        lines.push(`${pad}| @loop`);
        {
          const outs = outgoing.get(nodeId) || [];
          for (const out of outs) emitChain(out.target, indent + 1);
          lines.push(`${pad}    -until "${data.until || "done"}"`);
        }
        return;
      case "fork":
        lines.push(
          `${pad}| @fork ${data.forkId || "f1"} @call ${data.workflowName || "sub"}`
        );
        break;
      case "join":
        lines.push(`${pad}| @join ${(node.data as unknown as { forkId?: string }).forkId || "f1"}`);
        break;
    }

    // Follow outgoing edges
    const outs = outgoing.get(nodeId) || [];
    for (const out of outs) {
      emit(out.target, indent);
    }
  }

  function emitChain(nodeId: string, indent: number) {
    let current: string | null = nodeId;
    while (current && !visited.has(current)) {
      const node = nodeMap.get(current);
      if (!node) break;
      const data = node.data as unknown as StudioNodeData;
      // If we hit a join node, stop — the branch handler will continue
      if (data.kind === "join") break;
      emit(current, indent);
      const chainOuts: Edge[] = outgoing.get(current) || [];
      current = chainOuts.length === 1 ? chainOuts[0].target : null;
    }
  }

  for (const root of roots) {
    emit(root.id, 1);
  }

  return lines.join("\n") + "\n";
}
