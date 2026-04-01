import React, { useEffect, useMemo, useState } from "https://esm.sh/react@18";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
} from "https://esm.sh/@xyflow/react@12.3.6?bundle&deps=react@18.3.1";

const NODE_WIDTH = 232;
const NODE_HEIGHT = 96;
const COLUMN_GAP = 320;
const ROW_GAP = 170;
const CANVAS_CENTER_Y = 520;

function WorkflowTabs({ names, selectedName, onSelect }) {
  return React.createElement(
    "header",
    { className: "workflow-strip", role: "tablist", "aria-label": "Workflows" },
    names.map((name, index) =>
      React.createElement(
        "button",
        {
          key: name,
          className: `workflow-tab${name === selectedName ? " workflow-tab-active" : ""}`,
          onClick: () => onSelect(name),
          type: "button",
          role: "tab",
          "aria-selected": name === selectedName,
        },
        React.createElement("span", { className: "workflow-tab-index" }, String(index + 1).padStart(2, "0")),
        React.createElement("span", { className: "workflow-tab-name" }, name),
      ),
    ),
  );
}

function EdgeRail({ workflow, selectedNodeId }) {
  const relatedEdges = workflow.edges.filter(
    (edge) => edge.source === selectedNodeId || edge.target === selectedNodeId,
  );

  return React.createElement(
    "div",
    { className: "edge-rail" },
    relatedEdges.length
      ? relatedEdges.map((edge) =>
          React.createElement(
            "article",
            { key: edge.id, className: "edge-row" },
            React.createElement("code", { className: "edge-endpoint" }, edge.source),
            React.createElement("span", { className: "edge-separator" }, edge.label || edge.kind),
            React.createElement("code", { className: "edge-endpoint" }, edge.target),
          ),
        )
      : React.createElement("p", { className: "muted-copy" }, "No direct connections for this node."),
  );
}

function Inspector({ workflow, selectedNode }) {
  const fieldEntries = selectedNode ? getInspectableEntries(selectedNode.data) : [];

  return React.createElement(
    "aside",
    { className: "inspector-panel" },
    React.createElement(
      "div",
      { className: "inspector-header" },
      React.createElement("span", { className: "inspector-label" }, selectedNode ? humanizeKind(selectedNode.kind) : "Node"),
      React.createElement("code", { className: "inspector-node-id" }, selectedNode ? selectedNode.id : "Select a node"),
    ),
    selectedNode
      ? React.createElement(
          React.Fragment,
          null,
          fieldEntries.length
            ? React.createElement(
                React.Fragment,
                null,
                React.createElement("h3", null, "Fields"),
                React.createElement(FieldList, { entries: fieldEntries }),
              )
            : null,
          React.createElement("h3", null, "Connections"),
          React.createElement(EdgeRail, {
            workflow,
            selectedNodeId: selectedNode.id,
          }),
        )
      : React.createElement("p", { className: "muted-copy" }, "The contract is loaded. Pick a node to focus the inspector."),
  );
}

function FieldList({ entries }) {
  return React.createElement(
    "div",
    { className: "field-list" },
    entries.map(([key, value]) =>
      React.createElement(
        "article",
        { key, className: "field-row" },
        React.createElement("span", { className: "field-name" }, key),
        React.createElement("code", { className: "field-value" }, formatValue(value)),
      ),
    ),
  );
}

function GraphCanvas({ workflow, selectedNodeId, onSelect }) {
  const { nodes, edges } = useMemo(() => buildFlowGraph(workflow), [workflow]);

  const flowNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        selected: node.id === selectedNodeId,
      })),
    [nodes, selectedNodeId],
  );

  return React.createElement(
    "section",
    { className: "graph-panel" },
    React.createElement(
      ReactFlow,
      {
        nodes: flowNodes,
        edges,
        fitView: true,
        fitViewOptions: {
          padding: 0.2,
          minZoom: 0.4,
        },
        proOptions: { hideAttribution: true },
        nodesDraggable: false,
        nodesConnectable: false,
        elementsSelectable: true,
        onNodeClick: (_, node) => onSelect(node.id),
        defaultEdgeOptions: {
          type: "smoothstep",
          animated: false,
        },
      },
      React.createElement(MiniMap, {
        pannable: true,
        zoomable: true,
        className: "graph-minimap",
        nodeColor: "#000000",
        maskColor: "rgba(255, 255, 255, 0.82)",
      }),
      React.createElement(Controls, { className: "graph-controls", showInteractive: false }),
      React.createElement(Background, { color: "#d7d7d7", gap: 32, size: 1 }),
    ),
  );
}

function EmptyState({ error, loadingMessage }) {
  return React.createElement(
    "main",
    { className: "page page-empty" },
    React.createElement(
      "section",
      { className: "empty-state" },
      React.createElement("p", { className: "eyebrow" }, error ? "Load Failed" : "Loading"),
      React.createElement(
        "p",
        { className: "empty-copy" },
        error || loadingMessage,
      ),
    ),
  );
}

export function App() {
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState(
    "Fetching compiled contract data and staging the graph canvas.",
  );
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const slowLoadTimer = window.setTimeout(() => {
      setLoadingMessage("Waiting on /api/contract. The dashboard is ready, but the contract payload has not returned yet.");
    }, 2500);
    const abortTimer = window.setTimeout(() => {
      controller.abort();
    }, 12000);

    fetch("/api/contract", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load contract: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        setPayload(data);
        const names = Object.keys(data.workflows || {});
        const firstWorkflow = names[0] || null;
        setSelectedWorkflow(firstWorkflow);
        if (firstWorkflow) {
          setSelectedNodeId(data.workflows[firstWorkflow]?.startNodeId || null);
        }
      })
      .catch((err) => {
        if (err.name === "AbortError") {
          setError("Timed out waiting for /api/contract. The app loaded, but the backend contract endpoint did not answer in time.");
          return;
        }

        setError(err.message);
      });

    return () => {
      window.clearTimeout(slowLoadTimer);
      window.clearTimeout(abortTimer);
      controller.abort();
    };
  }, []);

  const workflowNames = useMemo(() => Object.keys(payload?.workflows || {}), [payload]);
  const workflow = selectedWorkflow ? payload?.workflows?.[selectedWorkflow] : null;
  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId) || workflow?.nodes[0] || null;

  useEffect(() => {
    if (!workflow) {
      setSelectedNodeId(null);
      return;
    }

    const nodeExists = workflow.nodes.some((node) => node.id === selectedNodeId);
    if (!nodeExists) {
      setSelectedNodeId(workflow.startNodeId || workflow.nodes[0]?.id || null);
    }
  }, [workflow, selectedNodeId]);

  if (error || !payload) {
    return React.createElement(EmptyState, { error, loadingMessage });
  }

  const totalNodes = workflowNames.reduce(
    (count, name) => count + (payload.workflows[name]?.nodes.length || 0),
    0,
  );

  return React.createElement(
    "main",
    { className: "page" },
    workflowNames.length
      ? React.createElement(WorkflowTabs, {
          names: workflowNames,
          selectedName: selectedWorkflow,
          onSelect: (name) => {
            setSelectedWorkflow(name);
            setSelectedNodeId(payload.workflows[name]?.startNodeId || payload.workflows[name]?.nodes[0]?.id || null);
          },
        })
      : null,
    workflow
      ? React.createElement(
          "section",
          { className: "dashboard" },
          React.createElement(GraphCanvas, {
            workflow,
            selectedNodeId: selectedNode?.id || null,
            onSelect: setSelectedNodeId,
          }),
          React.createElement(Inspector, {
            workflow,
            selectedNode,
          }),
        )
      : null,
  );
}

function buildFlowGraph(workflow) {
  const levels = getNodeLevels(workflow);
  const order = getTraversalOrder(workflow);
  const groupedLevels = groupNodesByLevel(workflow, levels, order);

  const sortedLevels = [...groupedLevels.keys()].sort((a, b) => a - b);
  const nodes = [];

  sortedLevels.forEach((level) => {
    const bucket = groupedLevels.get(level);
    const levelOffset = ((bucket.length - 1) * ROW_GAP) / 2;
    bucket.forEach((node, row) => {
      nodes.push({
        id: node.id,
        position: {
          x: level * COLUMN_GAP,
          y: CANVAS_CENTER_Y + row * ROW_GAP - levelOffset,
        },
        data: {
          label: React.createElement(
            "div",
            { className: "flow-node-inner" },
            React.createElement("span", { className: "flow-node-kind" }, humanizeKind(node.kind)),
            React.createElement("strong", { className: "flow-node-title" }, summarizeNode(node)),
            React.createElement("code", { className: "flow-node-id" }, node.id),
          ),
        },
        style: getNodeStyle(node, workflow),
        sourcePosition: "right",
        targetPosition: "left",
      });
    });
  });

  const edges = workflow.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label || edge.kind,
    type: "smoothstep",
    markerEnd: {
      type: "arrowclosed",
      color: "#000000",
    },
    style: {
      stroke: "#111111",
      strokeWidth: edge.kind === "next" ? 1.5 : 1,
    },
    labelStyle: {
      fill: "#111111",
      fontSize: 11,
      fontWeight: 600,
    },
    labelBgStyle: {
      fill: "#ffffff",
      fillOpacity: 0.95,
    },
  }));

  return { nodes, edges };
}

function getNodeLevels(workflow) {
  const levels = new Map();
  const queue = [workflow.startNodeId];
  const visited = new Set();
  const outgoing = new Map();

  if (!workflow.startNodeId) {
    workflow.nodes.forEach((node, index) => levels.set(node.id, index));
    return levels;
  }

  workflow.edges.forEach((edge) => {
    const bucket = outgoing.get(edge.source) || [];
    bucket.push(edge.target);
    outgoing.set(edge.source, bucket);
  });

  levels.set(workflow.startNodeId, 0);

  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) {
      continue;
    }

    visited.add(current);
    const level = levels.get(current) || 0;

    (outgoing.get(current) || []).forEach((targetId) => {
      const nextLevel = level + 1;
      const knownLevel = levels.get(targetId);
      if (knownLevel == null) {
        levels.set(targetId, nextLevel);
        queue.push(targetId);
      }
    });
  }

  workflow.nodes.forEach((node, index) => {
    if (!levels.has(node.id)) {
      levels.set(node.id, index);
    }
  });

  return levels;
}

function getTraversalOrder(workflow) {
  const visited = new Set();
  const order = new Map();
  const queue = workflow.startNodeId ? [workflow.startNodeId] : workflow.nodes.map((node) => node.id);
  let index = 0;

  while (queue.length) {
    const current = queue.shift();
    if (visited.has(current)) {
      continue;
    }

    visited.add(current);
    order.set(current, index);
    index += 1;

    workflow.edges
      .filter((edge) => edge.source === current)
      .forEach((edge) => {
        if (!visited.has(edge.target)) {
          queue.push(edge.target);
        }
      });
  }

  workflow.nodes.forEach((node) => {
    if (!order.has(node.id)) {
      order.set(node.id, index);
      index += 1;
    }
  });

  return order;
}

function groupNodesByLevel(workflow, levels, order) {
  const groupedLevels = new Map();

  workflow.nodes.forEach((node) => {
    const level = levels.get(node.id) || 0;
    const bucket = groupedLevels.get(level) || [];
    bucket.push(node);
    groupedLevels.set(level, bucket);
  });

  groupedLevels.forEach((bucket, level) => {
    bucket.sort((left, right) => {
      const leftOrder = order.get(left.id) ?? 0;
      const rightOrder = order.get(right.id) ?? 0;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      return left.id.localeCompare(right.id);
    });
    groupedLevels.set(level, bucket);
  });

  return groupedLevels;
}

function getNodeStyle(node, workflow) {
  const isTerminal = node.id === workflow.endNodeId;
  const isStart = node.id === workflow.startNodeId;

  return {
    width: NODE_WIDTH,
    minHeight: NODE_HEIGHT,
    padding: 0,
    borderRadius: 24,
    border: `1px solid ${isStart || isTerminal ? "#000000" : "#2b2b2b"}`,
    background: "#ffffff",
    color: "#000000",
    boxShadow: isStart || isTerminal ? "0 18px 45px rgba(0, 0, 0, 0.14)" : "0 12px 28px rgba(0, 0, 0, 0.08)",
  };
}

function summarizeNode(node) {
  return (
    node.data.prompt ||
    node.data.tool_name ||
    node.data.workflow_name ||
    node.data.name ||
    node.id
  );
}

function humanizeKind(kind) {
  return kind.replace(/Node$/, "").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatValue(value) {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
}

function getInspectableEntries(data) {
  return Object.entries(data).filter(([key]) => key !== "id");
}
