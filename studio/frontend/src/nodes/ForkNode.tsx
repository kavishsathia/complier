import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ForkNodeData } from "../types.ts";

export default function ForkNode({ data, selected }: NodeProps) {
  const d = data as unknown as ForkNodeData;
  return (
    <div className={`studio-node${selected ? " studio-node-selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span className="studio-node-kind">Fork</span>
      <span className="studio-node-title">
        {d.workflowName || d.forkId || "Fork"}
      </span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
