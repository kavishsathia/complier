// The person's saved complier workflows, for /spotlight. Local only: it reads ~/.complier (or
// COMPLIER_DIR) on the machine running `next dev`/`next start`, and answers nothing on Vercel.
// Read-only: applying a workflow stays in Claude Code, which asks the person first.

import { complierDir, loadSaved } from "../../spotlight/workflows.ts";

export const dynamic = "force-dynamic";

export function GET() {
  if (process.env.VERCEL) return Response.json({ error: "saved workflows are only read on your own computer" }, { status: 404 });
  const dir = complierDir();
  try {
    return Response.json({ dir, workflows: loadSaved(dir) });
  } catch (e) {
    return Response.json({ dir, workflows: [], error: e instanceof Error ? e.message : String(e) });
  }
}
