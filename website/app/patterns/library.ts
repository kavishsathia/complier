// Pieces of the pattern library and the example specs, for the pages to quote.

import { LIBRARY } from "./_data/compiled.ts";

// The library's paragraphs (a comment and its definitions) that define any of these processes.
export function definitions(names: string[]): string {
  return LIBRARY.split("\n\n")
    .filter((p) => p.split("\n").some((line) => names.some((n) => line.startsWith(`${n}(`))))
    .join("\n\n");
}

// A spec's own assertions, with the comment above them.
export function assertions(spec: string): string {
  const lines = spec.split("\n");
  const first = lines.findIndex((l) => l.startsWith("assert "));
  if (first < 0) return "";
  let from = first;
  while (from > 0 && lines[from - 1]!.startsWith("--")) from--;
  let to = first;
  while (to + 1 < lines.length && lines[to + 1]!.startsWith("assert ")) to++;
  return lines.slice(from, to + 1).join("\n");
}

// The spec's opening comment, which says what the example is.
export function about(spec: string): string {
  const lines: string[] = [];
  for (const l of spec.split("\n")) {
    if (!l.startsWith("--")) break;
    lines.push(l.replace(/^-- ?/, ""));
  }
  return lines.join(" ");
}
