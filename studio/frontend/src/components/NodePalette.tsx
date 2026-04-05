import type { StepKind } from "../types.ts";

const NODE_KINDS: { kind: StepKind; label: string }[] = [
  { kind: "tool", label: "Tool" },
  { kind: "branch", label: "Branch" },
  { kind: "loop", label: "Loop" },
  { kind: "unordered", label: "Unordered" },
  { kind: "fork", label: "Fork" },
  { kind: "join", label: "Join" },
];

interface NodePaletteProps {
  onAdd: (kind: StepKind) => void;
  onClose: () => void;
}

export default function NodePalette({ onAdd, onClose }: NodePaletteProps) {
  return (
    <div className="node-palette">
      {NODE_KINDS.map(({ kind, label }) => (
        <button
          key={kind}
          className="palette-item"
          onClick={() => {
            onAdd(kind);
            onClose();
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
