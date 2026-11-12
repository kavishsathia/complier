// Saved workflows as /spotlight shows them, and searching them. No file access here: this module
// runs in the browser too (the files are read by ./workflows.ts on the server).

export type Workflow = {
  name: string;
  description: string;
  noticed: string;
  created: string;
  spec: { file: string; src: string } | null;
  units: { file: string; src: string }[];
  // Claude Code sessions it is applied to right now.
  sessions: string[];
  // "saved": read from the person's complier folder; "fixture": a labelled demonstration example.
  source: "saved" | "fixture";
};

// The steps a workflow's spec names (its `datatype Act`), for search and the result list.
export function acts(w: Pick<Workflow, "spec">): string[] {
  const m = /^datatype\s+Act\s*=\s*([^\n]+)/m.exec(w.spec?.src ?? "");
  return m ? m[1].split("|").map((s) => s.trim()).filter(Boolean) : [];
}

// Workflows matching every word of the query, best first: a name match beats a description or
// "noticed" match, which beats a match only in the steps, spec or units.
export function search(all: Workflow[], query: string): Workflow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return all;
  const scored: [number, Workflow][] = [];
  for (const w of all) {
    const fields: [string, number][] = [
      [w.name.replace(/[-_]/g, " "), 4],
      [w.description, 2],
      [w.noticed, 2],
      [acts(w).join(" "), 1],
      [(w.spec?.src ?? "") + w.units.map((u) => u.src).join("\n"), 0.5],
    ];
    let score = 0;
    let all_ = true;
    for (const word of words) {
      const best = Math.max(0, ...fields.map(([text, weight]) => (text.toLowerCase().includes(word) ? weight : 0)));
      if (!best) all_ = false;
      score += best;
    }
    if (all_) scored.push([score, w]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name)).map(([, w]) => w);
}
