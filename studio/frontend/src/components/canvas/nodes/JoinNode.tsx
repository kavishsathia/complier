import { Handle, Position } from "@xyflow/react";
import type { JoinStep } from "../../../types.ts";

interface JoinNodeProps {
  data: { step: JoinStep };
  selected?: boolean;
}

export default function JoinNode({ data, selected }: JoinNodeProps) {
  return (
    <div className={`rf-node rf-node--join${selected ? " rf-node--selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="rf-node-label">{data.step.forkId || "join"}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
