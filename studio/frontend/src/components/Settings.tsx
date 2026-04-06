import { useState, useEffect } from "react";
import type { MCPServerConfig } from "../types.ts";
import * as bridge from "../lib/bridge.ts";

interface SettingsProps {
  mcpServers: MCPServerConfig[];
  onMcpServersChange: (servers: MCPServerConfig[]) => void;
  onClose: () => void;
}

interface ServerStatus {
  loading: boolean;
  ok?: boolean;
  tools?: string[];
  error?: string;
}

function newId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function Settings({
  mcpServers,
  onMcpServersChange,
  onClose,
}: SettingsProps) {
  // Per-server status (tool probe results)
  const [serverStatus, setServerStatus] = useState<Record<string, ServerStatus>>({});

  // MCP add form state
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"remote" | "local">("remote");
  const [newUrl, setNewUrl] = useState("");
  const [newCommand, setNewCommand] = useState("");
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message?: string;
    error?: string;
    tools?: string[];
  } | null>(null);
  const [testing, setTesting] = useState(false);

  // Probe each enabled server on mount
  useEffect(() => {
    for (const s of mcpServers) {
      if (!s.enabled) continue;
      setServerStatus((prev) => ({ ...prev, [s.id]: { loading: true } }));
      bridge.testMcpServer(s).then((result) => {
        setServerStatus((prev) => ({
          ...prev,
          [s.id]: {
            loading: false,
            ok: result.ok,
            tools: result.tools,
            error: result.error,
          },
        }));
      });
    }
  }, [mcpServers]);

  function resetForm() {
    setNewName("");
    setNewType("remote");
    setNewUrl("");
    setNewCommand("");
    setTestResult(null);
    setTesting(false);
    setAdding(false);
  }

  async function handleTestConnection() {
    const config: MCPServerConfig = {
      id: "test",
      name: newName || "test",
      type: newType,
      url: newType === "remote" ? newUrl : undefined,
      command: newType === "local" ? newCommand : undefined,
      enabled: true,
    };
    setTesting(true);
    setTestResult(null);
    const result = await bridge.testMcpServer(config);
    setTestResult(result);
    setTesting(false);
  }

  async function handleAddServer() {
    const config: MCPServerConfig = {
      id: newId(),
      name: newName || (newType === "remote" ? "Remote MCP" : "Local MCP"),
      type: newType,
      url: newType === "remote" ? newUrl : undefined,
      command: newType === "local" ? newCommand : undefined,
      enabled: true,
    };
    await bridge.saveMcpServer(config);
    onMcpServersChange([...mcpServers, config]);
    resetForm();
  }

  async function handleDeleteServer(id: string) {
    await bridge.deleteMcpServer(id);
    onMcpServersChange(mcpServers.filter((s) => s.id !== id));
  }

  async function handleToggleServer(id: string) {
    const updated = mcpServers.map((s) =>
      s.id === id ? { ...s, enabled: !s.enabled } : s
    );
    const toggled = updated.find((s) => s.id === id);
    if (toggled) await bridge.saveMcpServer(toggled);
    onMcpServersChange(updated);
  }

  const canAdd =
    newName.trim() &&
    ((newType === "remote" && newUrl.trim()) ||
      (newType === "local" && newCommand.trim()));

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div
        className="settings-dialog settings-dialog--wide"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="settings-title">MCP Servers</h2>

        <div className="mcp-server-list">
          {mcpServers.length === 0 && !adding && (
            <div className="mcp-empty">
              No MCP servers configured. Add one to connect tools to your
              workflows.
            </div>
          )}
          {mcpServers.map((s) => {
            const status = serverStatus[s.id];
            return (
              <div key={s.id} className="mcp-server-item">
                <div className="mcp-server-info">
                  <span className="mcp-server-name">{s.name}</span>
                  <span className={`mcp-badge mcp-badge--${s.type}`}>
                    {s.type}
                  </span>
                  {status && !status.loading && status.ok && status.tools && (
                    <span className="mcp-tool-count">
                      {status.tools.length} tool{status.tools.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {status && !status.loading && !status.ok && (
                    <span className="mcp-status-err">error</span>
                  )}
                  {status?.loading && (
                    <span className="mcp-status-loading">connecting...</span>
                  )}
                </div>
                <div className="mcp-server-detail">
                  {s.type === "remote" ? s.url : s.command}
                </div>
                {status && !status.loading && status.ok && status.tools && status.tools.length > 0 && (
                  <div className="mcp-server-tools">
                    {status.tools.map((t) => (
                      <span key={t} className="mcp-tool-chip">{t}</span>
                    ))}
                  </div>
                )}
                {status && !status.loading && !status.ok && status.error && (
                  <div className="mcp-server-error">{status.error}</div>
                )}
                <div className="mcp-server-actions">
                  <button
                    className={`mcp-toggle${s.enabled ? " mcp-toggle--on" : ""}`}
                    onClick={() => handleToggleServer(s.id)}
                    title={s.enabled ? "Disable" : "Enable"}
                  >
                    {s.enabled ? "On" : "Off"}
                  </button>
                  <button
                    className="mcp-delete-btn"
                    onClick={() => handleDeleteServer(s.id)}
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {adding ? (
          <div className="mcp-server-form">
            <div className="settings-field">
              <span className="config-label">Name</span>
              <input
                className="config-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Filesystem"
              />
            </div>
            <div className="settings-field">
              <span className="config-label">Type</span>
              <div className="mcp-type-toggle">
                <button
                  className={`mcp-type-btn${newType === "remote" ? " mcp-type-btn--active" : ""}`}
                  onClick={() => {
                    setNewType("remote");
                    setTestResult(null);
                  }}
                >
                  Remote (URL)
                </button>
                <button
                  className={`mcp-type-btn${newType === "local" ? " mcp-type-btn--active" : ""}`}
                  onClick={() => {
                    setNewType("local");
                    setTestResult(null);
                  }}
                >
                  Local (stdio)
                </button>
              </div>
            </div>
            {newType === "remote" ? (
              <div className="settings-field">
                <span className="config-label">Server URL</span>
                <input
                  className="config-input"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://mcp.example.com/sse"
                />
              </div>
            ) : (
              <div className="settings-field">
                <span className="config-label">Command</span>
                <input
                  className="config-input"
                  value={newCommand}
                  onChange={(e) => setNewCommand(e.target.value)}
                  placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp"
                />
              </div>
            )}

            {testResult && (
              <div
                className={`mcp-test-result${testResult.ok ? " mcp-test-result--ok" : " mcp-test-result--err"}`}
              >
                <div>
                  {testResult.ok
                    ? (testResult.message ?? "Connection successful")
                    : (testResult.error ?? "Connection failed")}
                </div>
                {testResult.ok && testResult.tools && testResult.tools.length > 0 && (
                  <div className="mcp-test-tools">
                    {testResult.tools.map((t) => (
                      <span key={t} className="mcp-tool-chip">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="settings-actions">
              <button
                className="settings-btn-secondary"
                onClick={() => handleTestConnection()}
                disabled={testing || !canAdd}
              >
                {testing ? "Testing..." : "Test"}
              </button>
              <button className="settings-btn-secondary" onClick={resetForm}>
                Cancel
              </button>
              <button
                className="settings-btn-primary"
                onClick={handleAddServer}
                disabled={!canAdd}
              >
                Add
              </button>
            </div>
          </div>
        ) : (
          <div className="mcp-add-area">
            <button
              className="settings-btn-primary"
              onClick={() => setAdding(true)}
            >
              + Add MCP Server
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
