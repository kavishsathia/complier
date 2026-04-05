import { Handle, Position } from "@xyflow/react";

interface BranchGroupNodeProps {
  selected?: boolean;
}

export default function BranchGroupNode({ selected }: BranchGroupNodeProps) {
  return (
    <div className={`rf-group rf-group--branch${selected ? " rf-group--selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <span className="rf-group-label">branch</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
