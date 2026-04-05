import { Handle, Position } from "@xyflow/react";
import InlineEdit from "./InlineEdit.tsx";

export interface UnorderedCaseGroupData {
  label: string;
  onLabelChange?: (value: string) => void;
  [key: string]: unknown;
}

export default function UnorderedCaseGroupNode({ data }: { data: UnorderedCaseGroupData }) {
  return (
    <div className="rf-group rf-group--arm">
      <Handle type="target" position={Position.Top} />
      <span className="rf-group-label">
        {data.onLabelChange ? (
          <InlineEdit
            value={data.label}
            placeholder="step"
            onChange={data.onLabelChange}
          />
        ) : (
          data.label || "step"
        )}
      </span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
