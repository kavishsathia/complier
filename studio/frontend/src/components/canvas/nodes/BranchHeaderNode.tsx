import { Handle, Position } from "@xyflow/react";

export interface BranchHeaderData {
  onAddArm?: () => void;
  [key: string]: unknown;
}

export default function BranchHeaderNode({ data, selected }: { data: BranchHeaderData; selected?: boolean }) {
  return (
    <div className={`rf-node rf-node--header rf-node--branch-header${selected ? " rf-node--selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="rf-node-label">branch</div>
      <button
        className="rf-header-add-btn"
        onClick={(e) => {
          e.stopPropagation();
          data.onAddArm?.();
        }}
        title="Add arm"
      >
        +
      </button>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
