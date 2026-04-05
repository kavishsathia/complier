import { Handle, Position } from "@xyflow/react";

interface UnorderedGroupNodeProps {
  selected?: boolean;
}

export default function UnorderedGroupNode({ selected }: UnorderedGroupNodeProps) {
  return (
    <div className={`rf-group rf-group--unordered${selected ? " rf-group--selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <span className="rf-group-label">unordered</span>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
