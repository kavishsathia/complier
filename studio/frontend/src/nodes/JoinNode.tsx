import { Handle, Position, type NodeProps } from "@xyflow/react";

export default function JoinNode({ selected }: NodeProps) {
  return (
    <div className={`studio-node${selected ? " studio-node-selected" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <span className="studio-node-kind">Join</span>
      <span className="studio-node-title">Join</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
