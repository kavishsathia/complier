import type { WorkflowBlockDocument } from "../types.ts";

interface CanvasProps {
  workflow: WorkflowBlockDocument;
  selectedStepId: string | null;
  onSelectStep: (id: string) => void;
}

export default function Canvas({
  workflow: _workflow,
  selectedStepId: _selectedStepId,
  onSelectStep: _onSelectStep,
}: CanvasProps) {
  return (
    <div className="workflow-canvas">
      <div className="workflow-blank" />
    </div>
  );
}
