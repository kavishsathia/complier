import type { StudioNodeData } from "../types.ts";

const NODE_KINDS: { kind: StudioNodeData["kind"]; label: string }[] = [
  { kind: "tool", label: "Tool" },
  { kind: "branch", label: "Branch" },
  { kind: "join", label: "Join" },
  { kind: "loop", label: "Loop" },
  { kind: "fork", label: "Fork" },
];

interface NodePaletteProps {
  onAdd: (kind: StudioNodeData["kind"]) => void;
  onClose: () => void;
}

export default function NodePalette({ onAdd, onClose }: NodePaletteProps) {
  return (
    <>
      <div
        style={{ position: "fixed", inset: 0, zIndex: 19 }}
        onClick={onClose}
      />
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
    </>
  );
}
