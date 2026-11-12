// Saved complier workflows, read from complier's own folder (~/.complier, or COMPLIER_DIR), the way
// `complier workflow save` leaves them: workflows/<name>/{workflow.toml, one .csp, .yaml units} and
// sessions/<id>.json for each Claude Code session a workflow is applied to. Reading only: nothing
// here writes, applies or releases anything.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Workflow } from "./search.ts";

export type { Workflow };

export const complierDir = () => process.env.COMPLIER_DIR || join(homedir(), ".complier");

// workflow.toml holds flat `key = "value"` lines (serde's About).
export function parseAbout(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/\\(["\\nt])/g, (_, c) => ({ n: "\n", t: "\t" })[c as "n" | "t"] ?? c);
  }
  return out;
}

const isDir = (p: string) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

export function loadSaved(dir = complierDir()): Workflow[] {
  const root = join(dir, "workflows");
  if (!isDir(root)) return [];
  const applied = new Map<string, string[]>();
  const sessions = join(dir, "sessions");
  if (isDir(sessions)) {
    for (const f of readdirSync(sessions).filter((f) => f.endsWith(".json"))) {
      try {
        const b = JSON.parse(readFileSync(join(sessions, f), "utf8"));
        if (typeof b.workflow === "string") applied.set(b.workflow, [...(applied.get(b.workflow) ?? []), f.replace(/\.json$/, "")]);
      } catch {}
    }
  }
  const out: Workflow[] = [];
  for (const name of readdirSync(root).sort()) {
    const folder = join(root, name);
    if (!isDir(folder)) continue;
    const files = readdirSync(folder).sort();
    let about: Record<string, string> = {};
    try {
      about = parseAbout(readFileSync(join(folder, "workflow.toml"), "utf8"));
    } catch {}
    const specFile = files.find((f) => f.endsWith(".csp"));
    out.push({
      name,
      description: about.description ?? "",
      noticed: about.noticed ?? "",
      created: about.created ?? "",
      spec: specFile ? { file: specFile, src: readFileSync(join(folder, specFile), "utf8") } : null,
      units: files.filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ file: f, src: readFileSync(join(folder, f), "utf8") })),
      sessions: applied.get(name) ?? [],
      source: "saved",
    });
  }
  return out;
}
