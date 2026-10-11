// Translation units: pure maps between external events and the CSP alphabet.
// Input events come from the world (uncontrollable), output events from the agent (controllable).

// ---- alphabet ----

export type Event<T = unknown> = { channel: string; value: T };

export type Channel<T> = ((value: T) => Event<T>) & { name: string };

export function channel<T = void>(name: string): Channel<T> {
  const make = (value: T) => ({ channel: name, value });
  // A function's own `name` is read-only, so it has to be redefined rather than assigned.
  return Object.defineProperty(make, "name", { value: name }) as Channel<T>;
}

// ---- translation unit ----

export type OutputMap<A> = (args: A) => Event;

// Parses one tool's text result into a value, throwing if the result isn't what it expects.
export type Reader<T> = { read: (result: string) => T };

// Readers keyed by the tool they parse, as published in a package like packages/notion.
export type Readers<Tools> = { [K in keyof Tools]?: Reader<unknown> };

// A service as a package publishes it: its generated tool types and its reviewed readers.
// `tools` only carries the type; it has no runtime value.
export type Service<Tools, R> = { name: string; readers: R; tools?: Tools };

// service<NotionTools>()("notion", readers): curried so `Tools` is given and `R` inferred.
export function service<Tools extends Record<string, unknown>>() {
  return <R extends Readers<Tools>>(name: string, readers: R): Service<Tools, R> => ({ name, readers });
}

// What a poll of `K` hands to diff: the reader's value, or the raw text if no reader is registered.
export type Reading<R, K> = K extends keyof R ? (R[K] extends Reader<infer T> ? T : string) : string;

// Compares two successive readings of a polled tool and returns the input events that happened
// in between. Complier makes no claim about this step: the guarantee starts at the events it returns.
export type Diff<T> = (prev: T, next: T) => Event[];

// What the runtime sees: the reader is folded into the diff, so results cross over as text.
export type Poll = { tool: string; every: number; args: unknown; diff: Diff<string> };

// Built from a service, so tool names and arguments come from the server's own schemas
// and polled results are parsed by the service's reviewed readers.
export class Unit<Tools extends Record<string, unknown>, R extends Readers<Tools>> {
  readonly polls: Poll[] = [];
  readonly outputs = new Map<string, OutputMap<any>>();
  readonly hidden = new Set<string>();
  readonly name: string;
  private readonly readers: R;

  constructor(service: Service<Tools, R>) {
    this.name = service.name;
    this.readers = service.readers;
  }

  // Input events, observed by calling `tool` every `every` ms and diffing successive readings.
  // The tool runs outside CSP on complier's credentials, so it must also be declared
  // side-effect free with .hide().
  poll<K extends keyof Tools & string>(
    tool: K,
    spec: { every: number; args: Tools[K]; diff: Diff<Reading<R, K>> },
  ): this {
    const { every, args, diff } = spec;
    const reader = (this.readers as Readers<Tools>)[tool];
    const read = (result: string) => (reader ? reader.read(result) : result) as Reading<R, K>;
    this.polls.push({ tool, every, args, diff: (prev, next) => diff(read(prev), read(next)) });
    return this;
  }

  // An action the agent takes. Unregistered output events are refused (fail closed).
  output<K extends keyof Tools & string>(tool: K, map: OutputMap<Tools[K]>): this {
    this.outputs.set(tool, map);
    return this;
  }

  // Agent actions declared to have no effect on the modeled world.
  hide(...tools: (keyof Tools & string)[]): this {
    tools.forEach((t) => this.hidden.add(t));
    return this;
  }
}

export function unit<Tools extends Record<string, unknown>, R extends Readers<Tools>>(
  service: Service<Tools, R>,
): Unit<Tools, R> {
  return new Unit(service);
}
