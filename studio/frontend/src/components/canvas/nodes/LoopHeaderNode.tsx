import { Handle, Position } from "@xyflow/react";

interface LoopHeaderNodeProps {
  data: { until: string };
  selected?: boolean;
}

export default function LoopHeaderNode({ data, selected }: LoopHeaderNodeProps) {
  return (
    <div className={`rf-node rf-node--header${selected ? " rf-node--selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="rf-node-label">until: {data.until || "..."}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
