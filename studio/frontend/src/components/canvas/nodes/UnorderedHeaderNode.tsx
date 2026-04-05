import { Handle, Position } from "@xyflow/react";

export interface UnorderedHeaderData {
  onAddCase?: () => void;
  [key: string]: unknown;
}

export default function UnorderedHeaderNode({ data, selected }: { data: UnorderedHeaderData; selected?: boolean }) {
  return (
    <div className={`rf-node rf-node--header rf-node--branch-header${selected ? " rf-node--selected" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <div className="rf-node-label">unordered</div>
      <button
        className="rf-header-add-btn"
        onClick={(e) => {
          e.stopPropagation();
          data.onAddCase?.();
        }}
        title="Add case"
      >
        +
      </button>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
