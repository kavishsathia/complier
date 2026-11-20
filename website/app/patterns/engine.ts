// complier's daemon walking a compiled policy, for the pattern pages' animations: the same rules as
// cli/src/daemon.rs, over the automaton FDR compiled (compiled.ts). An attempt the policy offers is
// allowed or denied by its own edge; one it offers but answers only after other agents act is held,
// and answered as soon as the policy offers its verdict; anything else is refused and changes
// nothing. Each role has at most one call in flight. patterns.test.ts checks this against the real
// daemon.

import type { Automaton } from "./_data/compiled.ts";

export type Outcome = "allowed" | "denied" | "refused" | "held";

// What one step did: the step's own act or result, then any held calls it let the policy answer.
export type Happening =
  | { kind: "act"; role: string; act: string; outcome: Outcome; reason: string }
  | { kind: "result"; role: string; act: string; value: string }
  | { kind: "verdict"; role: string; act: string; outcome: "allowed" | "denied" };

export type Status = "running" | "finished" | "deadlocked";

export class Machine {
  state: number;
  // Each role's allowed call whose result hasn't come back, and each role's held attempt.
  running = new Map<string, string>();
  held = new Map<string, string>();
  status: Status = "running";

  private automaton: Automaton;

  constructor(automaton: Automaton) {
    this.automaton = automaton;
    this.state = automaton.root;
    this.checkEnd();
  }

  private edges(): Record<string, number> {
    return this.automaton.edges[this.state]!;
  }

  // What the role may do now: its attempts the policy offers and wouldn't deny.
  next(role: string): string[] {
    const out: string[] = [];
    for (const [event, after] of Object.entries(this.edges())) {
      const x = event.startsWith(`attempt.${role}.`) ? event.slice(`attempt.${role}.`.length) : null;
      if (x !== null && !(`deny.${role}.${x}` in this.automaton.edges[after]!)) out.push(x);
    }
    return out;
  }

  act(role: string, x: string): Happening[] {
    const refuse = (reason: string): Happening[] => [{ kind: "act", role, act: x, outcome: "refused", reason }];
    if (this.status !== "running")
      return refuse(this.status === "finished" ? "the machine is finished (the policy terminated)" : "the machine is deadlocked (the policy takes no more attempts)");
    if (this.running.has(role)) return refuse(`the result of ${role}.${this.running.get(role)} hasn't come back yet`);
    if (this.held.has(role)) return refuse(`${role}.${this.held.get(role)} is still waiting for the policy's verdict`);
    const key = `${role}.${x}`;
    const taken = this.edges()[`attempt.${key}`];
    if (taken === undefined) {
      // In role order, as the daemon keeps them.
      const others = [...this.running].filter(([r]) => r !== role).sort(([a], [b]) => (a < b ? -1 : 1)).map(([r, a]) => `${r}.${a}`);
      const base = `the policy doesn't take ${x} from ${role} now`;
      return refuse(
        others.length === 0
          ? base
          : others.length === 1
            ? `${base} (the result of ${others[0]} hasn't come back yet)`
            : `${base} (the results of ${others.join(", ")} haven't come back yet)`,
      );
    }
    const answers = this.automaton.edges[taken]!;
    const allow = answers[`allow.${key}`];
    const deny = answers[`deny.${key}`];
    let outcome: Outcome;
    if (allow !== undefined) {
      this.state = allow;
      this.running.set(role, x);
      outcome = "allowed";
    } else if (deny !== undefined) {
      this.state = deny;
      outcome = "denied";
    } else {
      this.state = taken;
      this.held.set(role, x);
      outcome = "held";
    }
    const reason = outcome === "denied" ? `the policy denied ${x}` : outcome === "held" ? "the policy answers it once other agents have acted" : "";
    const out: Happening[] = [{ kind: "act", role, act: x, outcome, reason }, ...this.settle()];
    this.checkEnd();
    return out;
  }

  result(role: string, value: string): Happening[] {
    const x = this.running.get(role);
    if (x === undefined) throw new Error(`${role} has no call waiting for a result`);
    const next = this.edges()[`result.${role}.${x}.${value}`];
    if (next === undefined) throw new Error(`the policy doesn't accept ${value} from ${role}.${x}`);
    this.running.delete(role);
    this.state = next;
    const out: Happening[] = [{ kind: "result", role, act: x, value }, ...this.settle()];
    this.checkEnd();
    return out;
  }

  // Takes the policy's answer to every held call it now answers.
  private settle(): Happening[] {
    const out: Happening[] = [];
    for (let moved = true; moved; ) {
      moved = false;
      for (const [role, x] of this.held) {
        const allow = this.edges()[`allow.${role}.${x}`];
        const deny = this.edges()[`deny.${role}.${x}`];
        if (allow === undefined && deny === undefined) continue;
        this.held.delete(role);
        if (allow !== undefined) {
          this.state = allow;
          this.running.set(role, x);
        } else this.state = deny!;
        out.push({ kind: "verdict", role, act: x, outcome: allow !== undefined ? "allowed" : "denied" });
        moved = true;
        break;
      }
    }
    return out;
  }

  private checkEnd() {
    const events = Object.keys(this.edges());
    if (events.some((e) => e.startsWith("attempt.") || e.startsWith("result."))) return;
    this.status = events.includes("✓") ? "finished" : "deadlocked";
  }
}
