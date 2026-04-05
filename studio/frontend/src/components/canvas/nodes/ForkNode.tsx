import { Handle, Position } from "@xyflow/react";
import type { ForkStep } from "../../../types.ts";

interface ForkNodeProps {
  data: { step: ForkStep };
  selected?: boolean;
}

export default function ForkNode({ data, selected }: ForkNodeProps) {
  return (
    <div className={`rf-node rf-node--fork${selected ? " rf-node--selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="rf-node-label">{data.step.workflowName || "fork"}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
