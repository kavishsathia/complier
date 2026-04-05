import { useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type OnConnect,
  type OnNodesChange,
  type OnEdgesChange,
  addEdge,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { nodeTypes } from "../nodes/index.ts";
interface CanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  onNodeClick: (id: string) => void;
}

export default function Canvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setEdges,
  onNodeClick,
}: CanvasProps) {
  const onConnect: OnConnect = useCallback(
    (params) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onNodeClick={(_, node) => onNodeClick(node.id)}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.3, minZoom: 0.4 }}
      defaultEdgeOptions={{
        type: "smoothstep",
        animated: false,
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} color="#222" gap={24} />
      <Controls position="bottom-left" />
    </ReactFlow>
  );
}
