import { Handle, Position } from "@xyflow/react";
import InlineEdit from "./InlineEdit.tsx";

export interface BranchArmGroupData {
  condition: string;
  onConditionChange?: (value: string) => void;
  [key: string]: unknown;
}

export default function BranchArmGroupNode({ data }: { data: BranchArmGroupData }) {
  return (
    <div className="rf-group rf-group--arm">
      <Handle type="target" position={Position.Top} />
      <span className="rf-group-label">
        {data.onConditionChange ? (
          <InlineEdit
            value={data.condition}
            placeholder="when"
            onChange={data.onConditionChange}
          />
        ) : (
          data.condition || "when"
        )}
      </span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
