import { Handle, Position } from "@xyflow/react";
import type { ToolStep } from "../../../types.ts";

interface ToolNodeProps {
  data: { step: ToolStep };
  selected?: boolean;
}

export default function ToolNode({ data, selected }: ToolNodeProps) {
  return (
    <div className={`rf-node rf-node--tool${selected ? " rf-node--selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="rf-node-label">{data.step.toolName || "tool"}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
