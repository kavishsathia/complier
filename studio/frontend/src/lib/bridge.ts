/**
 * Typed wrapper around the pywebview JS bridge.
 *
 * In dev mode (plain browser), the bridge won't exist — methods return
 * sensible defaults so the UI can still be developed standalone.
 */

import type { MCPServerConfig, MCPToolInfo, WorkflowMeta } from "../types.ts";

interface ChatMessage {
  role: string;
  content: string;
}

interface PyWebViewAPI {
  ping(): Promise<string>;
  validate_cpl(source: string): Promise<{ valid: boolean; error?: string }>;
  parse_cpl(source: string): Promise<{ ok: boolean; ast?: unknown; error?: string }>;
  list_ollama_models(url: string): Promise<string[]>;
  list_workflows(): Promise<WorkflowMeta[]>;
  save_workflow(name: string, graph_json: string): Promise<{ ok: boolean }>;
  load_workflow(name: string): Promise<Record<string, unknown> | null>;
  delete_workflow(name: string): Promise<{ ok: boolean }>;
  list_mcp_servers(): Promise<MCPServerConfig[]>;
  save_mcp_server(config_json: string): Promise<{ ok: boolean }>;
  delete_mcp_server(config_id: string): Promise<{ ok: boolean }>;
  test_mcp_server(config_json: string): Promise<{ ok: boolean; error?: string; message?: string; tools?: MCPToolInfo[]; authenticated?: boolean }>;
  clear_mcp_tokens(config_id: string): Promise<{ ok: boolean }>;
  chat(
    ollama_url: string,
    model: string,
    messages_json: string
  ): Promise<string>;
}

declare global {
  interface Window {
    pywebview?: { api: PyWebViewAPI };
  }
}

function api(): PyWebViewAPI | null {
  return window.pywebview?.api ?? null;
}

export async function ping(): Promise<string> {
  return (await api()?.ping()) ?? "no-bridge";
}

export async function validateCpl(
  source: string
): Promise<{ valid: boolean; error?: string }> {
  return (
    (await api()?.validate_cpl(source)) ?? { valid: false, error: "No bridge" }
  );
}

export async function parseCpl(
  source: string
): Promise<{ ok: boolean; ast?: unknown; error?: string }> {
  return (
    (await api()?.parse_cpl(source)) ?? { ok: false, error: "No bridge" }
  );
}

export async function listOllamaModels(url: string): Promise<string[]> {
  return (await api()?.list_ollama_models(url)) ?? [];
}

export async function listWorkflows(): Promise<WorkflowMeta[]> {
  return (await api()?.list_workflows()) ?? [];
}

export async function saveWorkflow(
  name: string,
  graphJson: string
): Promise<boolean> {
  const res = await api()?.save_workflow(name, graphJson);
  return res?.ok ?? false;
}

export async function loadWorkflow(
  name: string
): Promise<Record<string, unknown> | null> {
  return (await api()?.load_workflow(name)) ?? null;
}

export async function deleteWorkflow(name: string): Promise<boolean> {
  const res = await api()?.delete_workflow(name);
  return res?.ok ?? false;
}

export async function listMcpServers(): Promise<MCPServerConfig[]> {
  return (await api()?.list_mcp_servers()) ?? [];
}

export async function saveMcpServer(config: MCPServerConfig): Promise<boolean> {
  const res = await api()?.save_mcp_server(JSON.stringify(config));
  return res?.ok ?? false;
}

export async function deleteMcpServer(id: string): Promise<boolean> {
  const res = await api()?.delete_mcp_server(id);
  return res?.ok ?? false;
}

export async function testMcpServer(
  config: MCPServerConfig
): Promise<{ ok: boolean; error?: string; message?: string; tools?: MCPToolInfo[]; authenticated?: boolean }> {
  return (
    (await api()?.test_mcp_server(JSON.stringify(config))) ?? {
      ok: false,
      error: "No bridge",
    }
  );
}

export async function clearMcpTokens(id: string): Promise<boolean> {
  const res = await api()?.clear_mcp_tokens(id);
  return res?.ok ?? false;
}

export async function chat(
  ollamaUrl: string,
  model: string,
  messages: { role: string; content: string }[]
): Promise<string> {
  return (
    (await api()?.chat(ollamaUrl, model, JSON.stringify(messages))) ??
    "No bridge"
  );
}
