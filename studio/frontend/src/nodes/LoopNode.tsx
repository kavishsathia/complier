import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { LoopNodeData } from "../types.ts";

export default function LoopNode({ data, selected }: NodeProps) {
  const d = data as unknown as LoopNodeData;
  return (
    <div className={`studio-node${selected ? " studio-node-selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span className="studio-node-kind">Loop</span>
      <span className="studio-node-title">
        {d.until ? `until "${d.until}"` : "Loop"}
      </span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
