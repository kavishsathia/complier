import { useState, useEffect, useRef } from "react";
import type { MCPServerConfig } from "../types.ts";
import type { LogEntry } from "../lib/bridge.ts";
import * as bridge from "../lib/bridge.ts";

interface LogsPanelProps {
  cpl: string;
  ollamaUrl: string;
  ollamaModel: string;
  mcpServers: MCPServerConfig[];
  onClose: () => void;
}

function buildDefaultPrompt(cpl: string): string {
  const toolLines = cpl
    .split("\n")
    .filter((l) => l.trim().startsWith("| ") && !l.trim().startsWith("| @"))
    .map((l) => l.trim().replace("| ", "").split(" ")[0]);
  if (toolLines.length === 0) return "";
  return toolLines[0];
}

export default function LogsPanel({
  cpl,
  ollamaUrl,
  ollamaModel,
  mcpServers,
  onClose,
}: LogsPanelProps) {
  const [prompt, setPrompt] = useState(() => buildDefaultPrompt(cpl));
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<string>("idle");
  const [finalOutput, setFinalOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logsBodyRef = useRef<HTMLDivElement>(null);

  // Poll for logs while running
  useEffect(() => {
    if (status !== "running") return;
    const interval = setInterval(async () => {
      const result = await bridge.getRunLogs();
      if (result.logs.length > 0) {
        setLogs((prev) => [...prev, ...result.logs]);
      }
      setStatus(result.status);
      if (result.final_output) setFinalOutput(result.final_output);
      if (result.error) setError(result.error);
    }, 500);
    return () => clearInterval(interval);
  }, [status]);

  // Auto-scroll to bottom
  useEffect(() => {
    const el = logsBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, finalOutput, error]);

  async function handleStart() {
    if (!prompt.trim() || !cpl.trim()) return;
    setLogs([]);
    setFinalOutput(null);
    setError(null);
    setStatus("running");
    const result = await bridge.runWorkflow(cpl, prompt, "", "gpt-5.4-mini", mcpServers);
    if (!result.ok) {
      setError(result.error ?? "Failed to start run.");
      setStatus("error");
    }
  }

  async function handleStop() {
    await bridge.stopRun();
    setStatus("stopped");
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleStart();
    }
  }

  const isRunning = status === "running";

  return (
    <div className="logs-panel">
      <div className="logs-header">
        <span className="logs-title">Logs</span>
        <button className="logs-close" onClick={onClose}>&times;</button>
      </div>

      <div className="logs-prompt-area">
        <textarea
          className="logs-prompt-input"
          placeholder="Describe what the agent should do..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={isRunning}
        />
        <div className="logs-prompt-actions">
          {isRunning ? (
            <button className="logs-stop-btn" onClick={handleStop}>Stop</button>
          ) : (
            <button
              className="logs-start-btn"
              onClick={handleStart}
              disabled={!prompt.trim() || !cpl.trim()}
            >
              Start
            </button>
          )}
        </div>
      </div>

      <div className="logs-body" ref={logsBodyRef}>
        {logs.length === 0 && status === "idle" && (
          <div className="logs-empty">Enter a prompt and click Start to run the workflow.</div>
        )}

        {logs.map((entry, i) => (
          <div key={i} className={`logs-entry logs-entry--${entry.event}`}>
            <span className="logs-entry-badge">{entry.event}</span>
            <span className="logs-entry-tool">{entry.tool}</span>
            {entry.detail && (
              <div className="logs-entry-detail">{entry.detail}</div>
            )}
          </div>
        ))}

        {isRunning && (
          <div className="logs-running">Running...</div>
        )}

        {finalOutput && (
          <div className="logs-final">
            <span className="logs-final-label">Output</span>
            <div className="logs-final-content">{finalOutput}</div>
          </div>
        )}

        {error && (
          <div className="logs-error">{error}</div>
        )}

      </div>
    </div>
  );
}
