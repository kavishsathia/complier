import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { BranchNodeData } from "../types.ts";

export default function BranchNode({ data, selected }: NodeProps) {
  const d = data as unknown as BranchNodeData;
  const armCount = d.arms.length + (d.hasElse ? 1 : 0);
  return (
    <div className={`studio-node${selected ? " studio-node-selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span className="studio-node-kind">Branch</span>
      <span className="studio-node-title">
        {armCount} {armCount === 1 ? "arm" : "arms"}
      </span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
