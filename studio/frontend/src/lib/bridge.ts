/**
 * Typed wrapper around the pywebview JS bridge.
 *
 * In dev mode (plain browser), the bridge won't exist — methods return
 * sensible defaults so the UI can still be developed standalone.
 */

import type { WorkflowMeta } from "../types.ts";

interface PyWebViewAPI {
  ping(): Promise<string>;
  validate_cpl(source: string): Promise<{ valid: boolean; error?: string }>;
  list_ollama_models(url: string): Promise<string[]>;
  list_workflows(): Promise<WorkflowMeta[]>;
  save_workflow(name: string, graph_json: string): Promise<{ ok: boolean }>;
  load_workflow(name: string): Promise<Record<string, unknown> | null>;
  delete_workflow(name: string): Promise<{ ok: boolean }>;
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
