import { Handle, Position } from "@xyflow/react";

export interface AddNodeData {
  onAdd: () => void;
  [key: string]: unknown;
}

export default function AddNode({ data }: { data: AddNodeData }) {
  return (
    <div
      className="rf-add-node"
      onClick={(e) => {
        e.stopPropagation();
        data.onAdd?.();
      }}
    >
      <Handle type="target" position={Position.Top} />
      <span>+</span>
    </div>
  );
}
