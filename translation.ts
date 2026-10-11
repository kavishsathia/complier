// Translation units: pure maps between external events and the CSP alphabet.
// Input events come from the world (uncontrollable), output events from the agent (controllable).

// ---- alphabet ----

type Event<T = unknown> = { channel: string; value: T };

type Channel<T> = ((value: T) => Event<T>) & { name: string };

function channel<T = void>(name: string): Channel<T> {
  return Object.assign((value: T) => ({ channel: name, value }), { name });
}

// ---- translation unit ----

type InputMap<P> = (payload: P) => Event;
type OutputMap<A> = (args: A) => Event;

class Unit {
  readonly inputs = new Map<string, InputMap<any>>();
  readonly outputs = new Map<string, OutputMap<any>>();
  readonly hidden = new Set<string>();

  constructor(readonly name: string) {}

  // An external event the world emits. Unregistered input events are dropped (fail open).
  input<P>(source: string, map: InputMap<P>): this {
    this.inputs.set(source, map);
    return this;
  }

  // An action the agent takes. Unregistered output events are refused (fail closed).
  output<A>(tool: string, map: OutputMap<A>): this {
    this.outputs.set(tool, map);
    return this;
  }

  // Agent actions declared to have no effect on the modeled world.
  hide(...tools: string[]): this {
    tools.forEach((t) => this.hidden.add(t));
    return this;
  }
}

function unit(name: string): Unit {
  return new Unit(name);
}

// ---- example ----

const ciPassed = channel<string>("ci_passed");
const ciFailed = channel<string>("ci_failed");
const merge = channel<number>("merge");

type CheckRunCompleted = { head_sha: string; conclusion: "success" | "failure" };
type MergeArgs = { pr: number };

export const github = unit("github")
  .input<CheckRunCompleted>("check_run.completed", (e) =>
    e.conclusion === "success" ? ciPassed(e.head_sha) : ciFailed(e.head_sha),
  )
  .output<MergeArgs>("merge_pull_request", (a) => merge(a.pr))
  .hide("get_file_contents", "search_code");
