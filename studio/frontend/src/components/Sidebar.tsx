import { useState, useEffect } from "react";
import type { WorkflowMeta } from "../types.ts";
import * as bridge from "../lib/bridge.ts";

interface SidebarProps {
  activeWorkflow: string | null;
  onSelect: (name: string) => void;
  onNew: () => void;
  onOpenSettings: () => void;
  refreshKey: number;
}

export default function Sidebar({
  activeWorkflow,
  onSelect,
  onNew,
  onOpenSettings,
  refreshKey,
}: SidebarProps) {
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    bridge.listWorkflows().then(setWorkflows);
  }, [refreshKey]);

  const filtered = workflows.filter((w) =>
    w.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <aside className="studio-sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">Workflows</h1>
        <input
          className="sidebar-search"
          type="text"
          placeholder="Search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="sidebar-list">
        {filtered.length === 0 && (
          <div className="sidebar-empty">No workflows</div>
        )}
        {filtered.map((w) => (
          <button
            key={w.name}
            className={`sidebar-item${
              w.name === activeWorkflow ? " sidebar-item-active" : ""
            }`}
            onClick={() => onSelect(w.name)}
          >
            {w.name}
          </button>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className="settings-btn" onClick={onNew}>
          + New Workflow
        </button>
        <button className="settings-btn" onClick={onOpenSettings}>
          Settings
        </button>
      </div>
    </aside>
  );
}
