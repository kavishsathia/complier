import { Handle, Position } from "@xyflow/react";
import InlineEdit from "./InlineEdit.tsx";

export interface LoopGroupData {
  until: string;
  onUntilChange?: (value: string) => void;
  [key: string]: unknown;
}

export default function LoopGroupNode({ data, selected }: { data: LoopGroupData; selected?: boolean }) {
  return (
    <div className={`rf-group rf-group--loop${selected ? " rf-group--selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <span className="rf-group-label">
        loop until{" "}
        {data.onUntilChange ? (
          <InlineEdit
            value={data.until}
            placeholder="..."
            onChange={data.onUntilChange}
          />
        ) : (
          data.until || "..."
        )}
      </span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
