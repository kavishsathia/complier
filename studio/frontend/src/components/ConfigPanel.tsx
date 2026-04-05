import type { Node } from "@xyflow/react";
import type { StudioNodeData } from "../types.ts";

interface ConfigPanelProps {
  node: Node;
  onChange: (id: string, data: StudioNodeData) => void;
  onClose: () => void;
}

export default function ConfigPanel({ node, onChange, onClose }: ConfigPanelProps) {
  const data = node.data as unknown as StudioNodeData;

  function update(patch: Partial<StudioNodeData>) {
    onChange(node.id, { ...data, ...patch } as StudioNodeData);
  }

  return (
    <div className="config-panel">
      <div className="config-header">
        <h2 className="config-header-title">
          {data.kind.charAt(0).toUpperCase() + data.kind.slice(1)} Node
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
        {data.kind === "tool" && (
          <>
            <label>
              <span className="config-label">Tool Name</span>
              <input
                className="config-input"
                value={data.toolName}
                onChange={(e) => update({ toolName: e.target.value })}
              />
            </label>
          </>
        )}
        {data.kind === "branch" && (
          <>
            {data.arms.map((arm, i) => (
              <label key={i}>
                <span className="config-label">When {i + 1}</span>
                <input
                  className="config-input"
                  value={arm.condition}
                  onChange={(e) => {
                    const arms = [...data.arms];
                    arms[i] = { condition: e.target.value };
                    update({ arms });
                  }}
                />
              </label>
            ))}
            <button
              className="settings-btn"
              onClick={() =>
                update({ arms: [...data.arms, { condition: "" }] })
              }
            >
              + Add arm
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={data.hasElse}
                onChange={(e) => update({ hasElse: e.target.checked })}
              />
              <span style={{ fontSize: 13 }}>Else arm</span>
            </label>
          </>
        )}
        {data.kind === "loop" && (
          <label>
            <span className="config-label">Until</span>
            <input
              className="config-input"
              value={data.until}
              onChange={(e) => update({ until: e.target.value })}
            />
          </label>
        )}
        {data.kind === "fork" && (
          <>
            <label>
              <span className="config-label">Fork ID</span>
              <input
                className="config-input"
                value={data.forkId}
                onChange={(e) => update({ forkId: e.target.value })}
              />
            </label>
            <label>
              <span className="config-label">Workflow Name</span>
              <input
                className="config-input"
                value={data.workflowName}
                onChange={(e) => update({ workflowName: e.target.value })}
              />
            </label>
          </>
        )}
        {data.kind === "join" && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Join merges branching paths back together.
          </p>
        )}
      </div>
    </div>
  );
}
