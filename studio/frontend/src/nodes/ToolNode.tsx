import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ToolNodeData } from "../types.ts";

export default function ToolNode({ data, selected }: NodeProps) {
  const d = data as unknown as ToolNodeData;
  return (
    <div className={`studio-node${selected ? " studio-node-selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span className="studio-node-kind">Tool</span>
      <span className="studio-node-title">{d.toolName || "Untitled"}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
