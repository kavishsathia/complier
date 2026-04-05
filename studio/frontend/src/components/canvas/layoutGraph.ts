import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import {
  NODE_WIDTH,
  NODE_HEIGHT,
  GROUP_PADDING_TOP,
  GROUP_PADDING_BOTTOM,
  GROUP_PADDING_X,
  NODE_SPACING_V,
  NODE_SPACING_H,
  MIN_GROUP_WIDTH,
  MIN_GROUP_HEIGHT,
} from "./constants.ts";

const ROOT_SCOPE = "__root__";

type ScopeKey = string;

function getNodeDimensions(node: Node): { width: number; height: number } {
  const w = (node.style?.width as number) ?? NODE_WIDTH;
  const h = (node.style?.height as number) ?? NODE_HEIGHT;
  return { width: w, height: h };
}

/**
 * Bottom-up dagre layout:
 * 1. Partition nodes by parentId into scopes
 * 2. Process leaf scopes first, computing group dimensions
 * 3. Then process parent scopes using the computed child dimensions
 */
export function layoutGraph(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;

  // Clone nodes so we can mutate positions/styles
  const nodeMap = new Map<string, Node>();
  for (const n of nodes) {
    nodeMap.set(n.id, { ...n, position: { ...n.position } });
  }

  // Partition into scopes
  const scopes = new Map<ScopeKey, string[]>();
  for (const n of nodes) {
    const key = n.parentId ?? ROOT_SCOPE;
    if (!scopes.has(key)) scopes.set(key, []);
    scopes.get(key)!.push(n.id);
  }

  // Build edges lookup: only edges where both endpoints are in the same scope
  const edgesByScope = new Map<ScopeKey, Edge[]>();
  for (const e of edges) {
    const sourceNode = nodeMap.get(e.source);
    const targetNode = nodeMap.get(e.target);
    if (!sourceNode || !targetNode) continue;
    const sourceScope = sourceNode.parentId ?? ROOT_SCOPE;
    const targetScope = targetNode.parentId ?? ROOT_SCOPE;
    if (sourceScope !== targetScope) continue;
    if (!edgesByScope.has(sourceScope)) edgesByScope.set(sourceScope, []);
    edgesByScope.get(sourceScope)!.push(e);
  }

  // Determine processing order: bottom-up (leaf scopes first)
  // A scope depends on another if it contains group nodes that are themselves scopes
  const scopeOrder: ScopeKey[] = [];
  const visited = new Set<ScopeKey>();

  function visit(scopeKey: ScopeKey) {
    if (visited.has(scopeKey)) return;
    visited.add(scopeKey);

    // Visit child scopes first
    const childNodeIds = scopes.get(scopeKey) ?? [];
    for (const childId of childNodeIds) {
      if (scopes.has(childId)) {
        visit(childId);
      }
    }
    scopeOrder.push(scopeKey);
  }

  for (const key of scopes.keys()) {
    visit(key);
  }

  // Process each scope
  for (const scopeKey of scopeOrder) {
    const childIds = scopes.get(scopeKey) ?? [];
    if (childIds.length === 0) continue;

    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: "TB",
      nodesep: NODE_SPACING_H,
      ranksep: NODE_SPACING_V,
      marginx: 0,
      marginy: 0,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const id of childIds) {
      const node = nodeMap.get(id)!;
      const { width, height } = getNodeDimensions(node);
      g.setNode(id, { width, height });
    }

    const scopeEdges = edgesByScope.get(scopeKey) ?? [];
    for (const e of scopeEdges) {
      g.setEdge(e.source, e.target);
    }

    dagre.layout(g);

    // Read back positions (dagre gives center coords, convert to top-left)
    // For non-root scopes, offset by group padding
    const isRoot = scopeKey === ROOT_SCOPE;
    const offsetX = isRoot ? 0 : GROUP_PADDING_X;
    const offsetY = isRoot ? 0 : GROUP_PADDING_TOP;

    let maxRight = 0;
    let maxBottom = 0;

    for (const id of childIds) {
      const node = nodeMap.get(id)!;
      const dagreNode = g.node(id);
      const { width, height } = getNodeDimensions(node);

      node.position = {
        x: dagreNode.x - width / 2 + offsetX,
        y: dagreNode.y - height / 2 + offsetY,
      };

      maxRight = Math.max(maxRight, node.position.x + width);
      maxBottom = Math.max(maxBottom, node.position.y + height);
    }

    // If this scope has a parent group node, set its dimensions
    if (!isRoot && nodeMap.has(scopeKey)) {
      const groupNode = nodeMap.get(scopeKey)!;
      const groupWidth = Math.max(maxRight + GROUP_PADDING_X, MIN_GROUP_WIDTH);
      const groupHeight = Math.max(maxBottom + GROUP_PADDING_BOTTOM, MIN_GROUP_HEIGHT);
      groupNode.style = {
        ...groupNode.style,
        width: groupWidth,
        height: groupHeight,
      };
    }
  }

  return Array.from(nodeMap.values());
}
