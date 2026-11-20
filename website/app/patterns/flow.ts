// A pattern's flow, played over its compiled policy: what each step did (for the animation), and the
// `complier machine` commands that do the same by hand (for the page's "Try it").

import { EXAMPLES } from "./_data/compiled.ts";
import type { Pattern, Step } from "./_data/patterns.ts";
import { Machine, type Happening, type Status } from "./engine.ts";

// The machine after a step: who may act, whose call is in flight or held.
export type Snapshot = {
  next: Record<string, string[]>;
  running: Record<string, string>;
  held: Record<string, string>;
  status: Status;
};

export type Played = { step: Step; happened: Happening[]; after: Snapshot };

function snapshot(m: Machine, roles: string[]): Snapshot {
  return {
    next: Object.fromEntries(roles.map((r) => [r, m.status === "running" ? m.next(r) : []])),
    running: Object.fromEntries(m.running),
    held: Object.fromEntries(m.held),
    status: m.status,
  };
}

export function play(p: Pattern): { start: Snapshot; played: Played[] } {
  const example = EXAMPLES[p.slug]!;
  const m = new Machine(example.automaton);
  const start = snapshot(m, example.roles);
  const played = p.steps.map((step) => {
    const happened = "act" in step ? m.act(step.role, step.act) : m.result(step.role, step.result);
    return { step, happened, after: snapshot(m, example.roles) };
  });
  return { start, played };
}

export type Line = { command: string; note: string; held: boolean };

// One command per step. A held call goes to the background, as its verdict prints only once other
// agents have acted; the pause after it lets it reach the daemon before the next command does.
export function commands(p: Pattern): Line[] {
  return play(p).played.map(({ step, happened }) => {
    const verdicts = happened
      .filter((h) => h.kind === "verdict")
      .map((h) => `${h.role}'s ${h.act} ${h.outcome === "allowed" ? "is allowed" : "is denied"}`);
    if ("act" in step) {
      const own = happened[0]!;
      const held = own.kind === "act" && own.outcome === "held";
      const command = `complier machine act ${p.slug} --role ${step.role} ${step.act}${held ? " & sleep 1" : ""}`;
      const outcome = own.kind === "act" ? (own.outcome === "refused" ? `refused: ${own.reason}` : held ? "held: its verdict prints when it comes" : own.outcome) : "";
      return { command, note: [outcome, ...verdicts].join("; "), held };
    }
    return { command: `complier machine result ${p.slug} --role ${step.role} ${step.result}`, note: verdicts.join("; "), held: false };
  });
}

export function script(p: Pattern): string {
  const lines = commands(p);
  const width = Math.max(...lines.map((l) => l.command.length));
  return lines.map((l) => (l.note ? `${l.command.padEnd(width)}   # ${l.note}` : l.command)).join("\n");
}
