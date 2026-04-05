import type { NestedStepTarget, StepKind, WorkflowStep } from "../types.ts";

interface ConfigPanelProps {
  step: WorkflowStep;
  onChange: (step: WorkflowStep) => void;
  onAddNestedStep: (containerId: string, target: NestedStepTarget, kind: StepKind) => void;
  onAddBranchArm: (branchId: string) => void;
  onClose: () => void;
}

const STEP_KINDS: StepKind[] = ["tool", "branch", "loop", "fork", "join"];

function AddStepButtons({
  onAdd,
}: {
  onAdd: (kind: StepKind) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
      {STEP_KINDS.map((kind) => (
        <button key={kind} className="settings-btn" onClick={() => onAdd(kind)}>
          + {kind}
        </button>
      ))}
    </div>
  );
}

export default function ConfigPanel({
  step,
  onChange,
  onAddNestedStep,
  onAddBranchArm,
  onClose,
}: ConfigPanelProps) {
  function update(patch: Partial<WorkflowStep>) {
    onChange({ ...step, ...patch } as WorkflowStep);
  }

  return (
    <div className="config-panel">
      <div className="config-header">
        <h2 className="config-header-title">
          {step.kind.charAt(0).toUpperCase() + step.kind.slice(1)} Step
        </h2>
        <button
          className="run-panel-close"
          style={{ position: "absolute", top: 14, right: 16 }}
          onClick={onClose}
        >
          &times;
        </button>
      </div>
      <div className="config-section">
        {step.kind === "tool" && (
          <>
            <label>
              <span className="config-label">Tool Name</span>
              <input
                className="config-input"
                value={step.toolName}
                onChange={(e) => update({ toolName: e.target.value })}
              />
            </label>
          </>
        )}
        {step.kind === "branch" && (
          <>
            <button
              className="settings-btn"
              onClick={() => onAddBranchArm(step.id)}
            >
              + Add arm
            </button>
            {step.arms.map((arm, i) => (
              <div key={arm.id} style={{ marginTop: 16 }}>
                <label>
                  <span className="config-label">When {i + 1}</span>
                  <input
                    className="config-input"
                    value={arm.condition}
                    onChange={(e) => {
                      const arms = [...step.arms];
                      arms[i] = { ...arm, condition: e.target.value };
                      update({ arms });
                    }}
                  />
                </label>
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {arm.steps.length} step{arm.steps.length === 1 ? "" : "s"} in this arm.
                </p>
                <AddStepButtons
                  onAdd={(kind) =>
                    onAddNestedStep(step.id, { kind: "branch-arm", armId: arm.id }, kind)
                  }
                />
              </div>
            ))}
            <div style={{ marginTop: 16 }}>
              <span className="config-label">Else</span>
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {step.elseSteps.length} step{step.elseSteps.length === 1 ? "" : "s"} in the else branch.
              </p>
              <AddStepButtons
                onAdd={(kind) => onAddNestedStep(step.id, { kind: "branch-else" }, kind)}
              />
            </div>
          </>
        )}
        {step.kind === "loop" && (
          <>
            <label>
              <span className="config-label">Until</span>
              <input
                className="config-input"
                value={step.until}
                onChange={(e) => update({ until: e.target.value })}
              />
            </label>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 12 }}>
              {step.body.length} step{step.body.length === 1 ? "" : "s"} in the loop body.
            </p>
            <AddStepButtons
              onAdd={(kind) => onAddNestedStep(step.id, { kind: "loop-body" }, kind)}
            />
          </>
        )}
        {step.kind === "fork" && (
          <>
            <label>
              <span className="config-label">Fork ID</span>
              <input
                className="config-input"
                value={step.forkId}
                onChange={(e) => update({ forkId: e.target.value })}
              />
            </label>
            <label>
              <span className="config-label">Workflow Name</span>
              <input
                className="config-input"
                value={step.workflowName}
                onChange={(e) => update({ workflowName: e.target.value })}
              />
            </label>
          </>
        )}
        {step.kind === "join" && (
          <label>
            <span className="config-label">Join Fork ID</span>
            <input
              className="config-input"
              value={step.forkId}
              onChange={(e) => update({ forkId: e.target.value })}
            />
          </label>
        )}
      </div>
    </div>
  );
}
