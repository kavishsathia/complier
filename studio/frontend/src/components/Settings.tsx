import { useState, useEffect } from "react";
import type { MCPServerConfig, MCPToolInfo } from "../types.ts";
import * as bridge from "../lib/bridge.ts";

interface SettingsProps {
  mcpServers: MCPServerConfig[];
  onMcpServersChange: (servers: MCPServerConfig[]) => void;
  onClose: () => void;
}

interface ServerStatus {
  loading: boolean;
  ok?: boolean;
  tools?: MCPToolInfo[];
  error?: string;
  authenticated?: boolean;
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
    tools?: MCPToolInfo[];
  } | null>(null);
  const [testing, setTesting] = useState(false);

  async function handleRefreshServer(id: string) {
    const server = mcpServers.find((s) => s.id === id);
    if (!server) return;
    setServerStatus((prev) => ({ ...prev, [id]: { loading: true } }));
    const result = await bridge.testMcpServer(server);
    setServerStatus((prev) => ({
      ...prev,
      [id]: {
        loading: false,
        ok: result.ok,
        tools: result.tools,
        error: result.error,
        authenticated: result.authenticated,
      },
    }));
    if (result.ok && result.tools) {
      const updated = mcpServers.map((s) =>
        s.id === id
          ? { ...s, tools: result.tools, authenticated: result.authenticated }
          : s
      );
      const changed = updated.find((s) => s.id === id);
      if (changed) await bridge.saveMcpServer(changed);
      onMcpServersChange(updated);
    }
  }

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
      tools: testResult?.ok ? testResult.tools : undefined,
    };
    await bridge.saveMcpServer(config);
    onMcpServersChange([...mcpServers, config]);
    resetForm();
  }

  async function handleDeleteServer(id: string) {
    await bridge.deleteMcpServer(id);
    onMcpServersChange(mcpServers.filter((s) => s.id !== id));
  }

  async function handleDisconnectServer(id: string) {
    await bridge.clearMcpTokens(id);
    setServerStatus((prev) => ({
      ...prev,
      [id]: { ...prev[id], authenticated: false },
    }));
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
    <div className="settings-page">
      <div className="settings-header">
        <button className="settings-back-btn" onClick={onClose}>
          &larr; Back
        </button>
        <h2 className="settings-title">MCP Servers</h2>
      </div>

      <div className="settings-content">
        <div className="mcp-server-list">
          {mcpServers.length === 0 && !adding && (
            <div className="mcp-empty">
              No MCP servers configured. Add one to connect tools to your
              workflows.
            </div>
          )}
          {mcpServers.map((s) => {
            const status = serverStatus[s.id];
            const displayTools = status?.tools ?? s.tools;
            const toolCount = displayTools?.length ?? 0;
            const isAuthenticated = status?.authenticated ?? s.authenticated;
            return (
              <div key={s.id} className="mcp-server-item">
                <div className="mcp-server-info">
                  <span className="mcp-server-name">{s.name}</span>
                  <span className={`mcp-badge mcp-badge--${s.type}`}>
                    {s.type}
                  </span>
                  {toolCount > 0 && !status?.loading && (
                    <span className="mcp-tool-count">
                      {toolCount} tool{toolCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  {isAuthenticated && !status?.loading && (
                    <span className="mcp-badge mcp-badge--auth">authenticated</span>
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
                {displayTools && displayTools.length > 0 && !status?.loading && (
                  <div className="mcp-server-tools">
                    {displayTools.map((t) => (
                      <span key={t.name} className="mcp-tool-chip" title={t.description}>{t.name}</span>
                    ))}
                  </div>
                )}
                {status && !status.loading && !status.ok && status.error && (
                  <div className="mcp-server-error">{status.error}</div>
                )}
                <div className="mcp-server-actions">
                  <button
                    className="mcp-refresh-btn"
                    onClick={() => handleRefreshServer(s.id)}
                    disabled={status?.loading}
                    title="Refresh tools"
                  >
                    {status?.loading ? "..." : "\u21BB"}
                  </button>
                  {isAuthenticated && !status?.loading && (
                    <button
                      className="mcp-disconnect-btn"
                      onClick={() => handleDisconnectServer(s.id)}
                      title="Clear stored OAuth tokens"
                    >
                      Disconnect
                    </button>
                  )}
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
                      <span key={t.name} className="mcp-tool-chip" title={t.description}>{t.name}</span>
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
