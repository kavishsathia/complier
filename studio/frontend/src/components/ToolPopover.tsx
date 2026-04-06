import { useEffect, useRef } from "react";
import type { ToolStep, MCPServerConfig, MCPToolInfo } from "../types.ts";
import ToolDropdown from "./ToolDropdown.tsx";

interface ToolPopoverProps {
  step: ToolStep;
  position: { x: number; y: number };
  mcpServers: MCPServerConfig[];
  onChange: (step: ToolStep) => void;
  onClose: () => void;
}

function normalizeTool(t: MCPToolInfo | string): MCPToolInfo {
  return typeof t === "string" ? { name: t } : t;
}

function getToolInfo(
  servers: MCPServerConfig[],
  toolName: string
): MCPToolInfo | null {
  for (const s of servers) {
    if (!s.enabled || !s.tools) continue;
    for (const raw of s.tools as unknown[]) {
      const t = normalizeTool(raw as MCPToolInfo | string);
      if (t.name === toolName) return t;
    }
  }
  return null;
}

function getParamNames(tool: MCPToolInfo | null): string[] {
  if (!tool?.inputSchema) return [];
  const props = (tool.inputSchema as Record<string, unknown>).properties;
  if (!props || typeof props !== "object") return [];
  return Object.keys(props as Record<string, unknown>);
}

export default function ToolPopover({
  step,
  position,
  mcpServers,
  onChange,
  onClose,
}: ToolPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  const groups: { serverName: string; tools: MCPToolInfo[] }[] = [];
  for (const s of mcpServers) {
    if (!s.enabled || !s.tools || s.tools.length === 0) continue;
    const normalized: MCPToolInfo[] = (s.tools as unknown[]).map((t) =>
      typeof t === "string" ? { name: t } : (t as MCPToolInfo)
    );
    groups.push({ serverName: s.name, tools: normalized });
  }

  const selectedTool = getToolInfo(mcpServers, step.toolName);
  const paramNames = getParamNames(selectedTool);

  function handleToolSelect(toolName: string) {
    const newTool = getToolInfo(mcpServers, toolName);
    const newParams: Record<string, string> = {};
    for (const p of getParamNames(newTool)) {
      const existing = step.params[p];
      newParams[p] = typeof existing === "string" ? existing : "";
    }
    onChange({ ...step, toolName, params: newParams });
  }

  function handleParamChange(paramName: string, value: string) {
    onChange({
      ...step,
      params: { ...step.params, [paramName]: value },
    });
  }

  return (
    <div
      ref={popoverRef}
      className="tool-popover"
      style={{ left: position.x, top: position.y }}
    >
      <div className="tool-popover-header">
        <span className="tool-popover-title">Configure Tool</span>
        <button className="tool-popover-close" onClick={onClose}>
          &times;
        </button>
      </div>

      <div className="tool-popover-section">
        <span className="config-label">Tool</span>
        <ToolDropdown
          groups={groups}
          value={step.toolName}
          onSelect={handleToolSelect}
        />
      </div>

      {paramNames.length > 0 && (
        <div className="tool-popover-params">
          <span className="config-label">Parameters</span>
          {paramNames.map((paramName) => (
            <div key={paramName} className="param-section">
              <span className="param-name">{paramName}</span>
              <input
                className="param-check-input"
                value={typeof step.params[paramName] === "string" ? step.params[paramName] : ""}
                onChange={(e) => handleParamChange(paramName, e.target.value)}
                placeholder="e.g. [relevant]:skip"
              />
            </div>
          ))}
        </div>
      )}

      {step.toolName && paramNames.length === 0 && (
        <p className="tool-popover-no-params">No parameters for this tool.</p>
      )}
    </div>
  );
}
